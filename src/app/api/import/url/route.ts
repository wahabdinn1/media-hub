import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  canEnqueueJob,
  evaluateQuotaState,
  requireOwnerRequest,
  validateImportUrl,
} from "@/core";
import { hasCapability } from "@/shared";
import { getDb } from "@/db/client";
import { providerConnections } from "@/db/schema";
import { recordActivity } from "@/db/repositories/activity";
import { registerImportedAsset } from "@/db/repositories/assets";
import { addAssetsToCollection } from "@/db/repositories/collections";
import { createIdempotentJob, transitionJob } from "@/db/repositories/jobs";
import { decryptConnectionCredentials } from "@/db/repositories/providers";
import { assertModuleEnabled, getPersistedSettings } from "@/db/repositories/settings";
import { getCurrentUsageCounters, incrementUsageCounter } from "@/db/repositories/usage";
import { toApiErrorResponse } from "@/lib/api-error";
import { getProviderRegistry } from "@/lib/registry";

const ImportUrlSchema = z.object({
  url: z.string().min(1).max(2048),
  title: z.string().max(255).optional(),
  rightsConfirmed: z.boolean(),
  idempotencyKey: z.string().min(4).max(128).optional(),
  providerConnectionIds: z.array(z.string().min(1)).max(10).optional(),
  folderByConnectionId: z.record(z.string(), z.string().nullable()).optional(),
  collectionIds: z.array(z.string().min(1)).max(25).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const principal = await requireOwnerRequest(request, "job.create");
    const body = ImportUrlSchema.parse(await request.json());

    if (!body.rightsConfirmed) {
      return NextResponse.json(
        { error: "Rights confirmation is required before importing media." },
        { status: 400 },
      );
    }

    const { db } = await getDb();
    if (!(await assertModuleEnabled(db, "import"))) {
      return NextResponse.json(
        { error: "The Import module is disabled in Settings. History stays viewable." },
        { status: 403 },
      );
    }

    const [settings, counters, allConns] = await Promise.all([
      getPersistedSettings(db),
      getCurrentUsageCounters(db),
      db.select().from(providerConnections),
    ]);

    const quota = evaluateQuotaState(counters, { killSwitchEnabled: settings.killSwitchEnabled });
    const gate = canEnqueueJob(quota, "video.upload_url");
    if (!gate.allowed) {
      return NextResponse.json({ error: gate.reason, code: "QUOTA_EXCEEDED" }, { status: 429 });
    }

    const activeConns = allConns.filter((c) => c.status === "active");
    const defaultConn = activeConns.find((c) => c.isDefault) ?? activeConns[0];

    const targetConns =
      body.providerConnectionIds && body.providerConnectionIds.length > 0
        ? Array.from(new Set(body.providerConnectionIds))
            .map((id) => activeConns.find((c) => c.id === id))
            .filter((c): c is (typeof allConns)[number] => Boolean(c))
        : defaultConn
          ? [defaultConn]
          : [];

    if (targetConns.length === 0) {
      return NextResponse.json(
        { error: "No active provider connection selected. Connect a provider in Providers first." },
        { status: 400 },
      );
    }

    const registry = getProviderRegistry();
    for (const conn of targetConns) {
      const adapter = registry.require(conn.providerKey);
      if (!hasCapability(adapter.meta.capabilities, "upload.url") || !adapter.uploadFromUrl) {
        return NextResponse.json(
          { error: `Provider "${adapter.meta.displayName}" does not support direct URL import.` },
          { status: 400 },
        );
      }
    }

    // Re-validate server-side once before submitting to providers (PRD 13.3 rule d, TC-01, TC-09)
    const validation = await validateImportUrl(body.url);
    if (!validation.valid) {
      return NextResponse.json(
        {
          error: validation.reason,
          classification: validation.classification,
          validation,
        },
        { status: 400 },
      );
    }

    const resolvedTitle = body.title?.trim() || validation.inferredTitle || "Imported video";
    const collectionIds = Array.from(new Set(body.collectionIds ?? []));
    const results: Array<{
      connectionId: string;
      providerKey: string;
      job: Awaited<ReturnType<typeof transitionJob>>;
      assetId?: string;
      deduplicated: boolean;
      error?: string;
    }> = [];

    let sharedAssetId: string | undefined;

    for (const conn of targetConns) {
      const adapter = registry.require(conn.providerKey);
      const folderExternalId = body.folderByConnectionId?.[conn.id] ?? null;
      const baseKey =
        body.idempotencyKey ??
        request.headers.get("idempotency-key")?.trim() ??
        `upload_url:${validation.sourceUrlHash}`;
      const idempotencyKey =
        targetConns.length === 1 ? baseKey : `${baseKey}:${conn.id}`;

      const { job, deduplicated } = await createIdempotentJob(db, {
        idempotencyKey,
        jobType: "video.upload_url",
        providerConnectionId: conn.id,
        payload: {
          redactedUrl: validation.redactedUrl,
          sourceUrlHash: validation.sourceUrlHash,
          title: resolvedTitle,
          folderExternalId,
          collectionIds,
          contentType: validation.contentType,
          contentLength: validation.contentLength,
        },
        status: "validating",
      });

      if (deduplicated) {
        results.push({
          connectionId: conn.id,
          providerKey: conn.providerKey,
          job,
          deduplicated: true,
        });
        continue;
      }

      await incrementUsageCounter(db, "worker_requests_daily", 1);
      await recordActivity(db, {
        actorId: principal.actorId,
        action: "import.rights.confirmed",
        entityType: "job",
        entityId: job.id,
        context: {
          sourceUrlHash: validation.sourceUrlHash,
          redactedUrl: validation.redactedUrl,
          providerKey: conn.providerKey,
          folderExternalId,
        },
      });

      await transitionJob(db, job.id, {
        status: "processing",
        started: true,
        incrementAttempts: true,
        eventMessage: `Submitting direct URL to ${adapter.meta.displayName}.`,
        eventData: { redactedUrl: validation.redactedUrl, folderExternalId },
      });

      const credentials = await decryptConnectionCredentials(conn);

      try {
        const uploadRes = await adapter.uploadFromUrl!(credentials, body.url.trim(), {
          title: resolvedTitle,
          folderExternalId: folderExternalId ?? undefined,
        });

        const registered = await registerImportedAsset(db, {
          connectionId: conn.id,
          externalId: uploadRes.externalId,
          title: body.title?.trim() || uploadRes.title || resolvedTitle,
          canonicalStatus: adapter.meta.capabilities.asyncProcessing ? "processing" : "active",
          sizeBytes: uploadRes.sizeBytes ?? validation.contentLength,
          sourceUrlHash: validation.sourceUrlHash,
          providerMetadata: uploadRes.providerMetadata,
          existingAssetId: sharedAssetId,
        });
        sharedAssetId = registered.assetId;

        const nextStatus = adapter.meta.capabilities.asyncProcessing
          ? "provider_processing"
          : "completed";

        const updatedJob = await transitionJob(db, job.id, {
          status: nextStatus,
          finished: nextStatus === "completed",
          nextPollAt:
            nextStatus === "provider_processing"
              ? new Date(Date.now() + 30_000).toISOString()
              : null,
          result: {
            assetId: registered.assetId,
            locationId: registered.locationId,
            externalId: uploadRes.externalId,
            folderExternalId,
            progressPercent: nextStatus === "completed" ? 100 : 0,
          },
          eventMessage:
            nextStatus === "provider_processing"
              ? "Provider accepted upload. Tracking encoding status until 100%."
              : "Upload completed and asset registered.",
          eventData: { assetId: registered.assetId },
        });

        await recordActivity(db, {
          actorId: principal.actorId,
          action: "asset.created",
          entityType: "asset",
          entityId: registered.assetId,
          context: {
            jobId: job.id,
            sourceType: "direct_url",
            providerKey: conn.providerKey,
            folderExternalId,
          },
        });

        results.push({
          connectionId: conn.id,
          providerKey: conn.providerKey,
          job: updatedJob,
          assetId: registered.assetId,
          deduplicated: false,
        });
      } catch (err) {
        const canonical = adapter.normalizeError(err);
        const isAmbiguous = canonical.code === "TIMEOUT_UNKNOWN";

        const updatedJob = await transitionJob(db, job.id, {
          status: isAmbiguous ? "unknown" : "failed",
          finished: !isAmbiguous,
          errorCode: canonical.code,
          eventMessage: canonical.message,
          eventData: {
            code: canonical.code,
            providerCode: canonical.providerCode,
            reconcileRequired: isAmbiguous,
          },
        });

        results.push({
          connectionId: conn.id,
          providerKey: conn.providerKey,
          job: updatedJob,
          deduplicated: false,
          error: canonical.message,
        });
      }
    }

    if (sharedAssetId && collectionIds.length > 0) {
      for (const colId of collectionIds) {
        await addAssetsToCollection(db, colId, [sharedAssetId]);
      }
    }

    const allFailed = results.every((r) => Boolean(r.error));
    if (allFailed) {
      const firstErr = results[0]!;
      return NextResponse.json(
        {
          error: firstErr.error ?? "Import failed.",
          job: firstErr.job,
          jobs: results,
        },
        { status: firstErr.job.status === "unknown" ? 504 : 502 },
      );
    }

    const first = results[0]!;
    return NextResponse.json(
      {
        job: first.job,
        jobs: results,
        assetId: sharedAssetId,
        deduplicated: results.every((r) => r.deduplicated),
      },
      { status: first.deduplicated ? 200 : 201 },
    );
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
