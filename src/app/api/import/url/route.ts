import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
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
import { createIdempotentJob, transitionJob } from "@/db/repositories/jobs";
import { decryptConnectionCredentials } from "@/db/repositories/providers";
import { getCurrentUsageCounters, incrementUsageCounter } from "@/db/repositories/usage";
import { toApiErrorResponse } from "@/lib/api-error";
import { getProviderRegistry } from "@/lib/registry";

const ImportUrlSchema = z.object({
  url: z.string().min(1).max(2048),
  title: z.string().max(255).optional(),
  rightsConfirmed: z.boolean(),
  idempotencyKey: z.string().min(4).max(128).optional(),
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
    const counters = await getCurrentUsageCounters(db);
    const quota = evaluateQuotaState(counters);
    const gate = canEnqueueJob(quota, "video.upload_url");
    if (!gate.allowed) {
      return NextResponse.json({ error: gate.reason, code: "QUOTA_EXCEEDED" }, { status: 429 });
    }

    // Re-validate server-side before submitting to provider (PRD 13.3 rule d, TC-01, TC-09)
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

    const conns = await db
      .select()
      .from(providerConnections)
      .where(eq(providerConnections.isDefault, true))
      .limit(1);
    const conn = conns[0];
    if (!conn || conn.status !== "active") {
      return NextResponse.json(
        { error: "No active default provider connection. Connect Vidara in Providers first." },
        { status: 400 },
      );
    }

    const adapter = getProviderRegistry().require(conn.providerKey);
    if (!hasCapability(adapter.meta.capabilities, "upload.url") || !adapter.uploadFromUrl) {
      return NextResponse.json(
        { error: `Provider "${adapter.meta.displayName}" does not support direct URL import.` },
        { status: 400 },
      );
    }

    const idempotencyKey =
      body.idempotencyKey ??
      request.headers.get("idempotency-key")?.trim() ??
      `upload_url:${conn.id}:${validation.sourceUrlHash}`;

    const resolvedTitle = body.title?.trim() || validation.inferredTitle || "Imported video";

    // Create idempotent job first (TC-03: repeat submission returns existing job, no duplicate external op)
    const { job, deduplicated } = await createIdempotentJob(db, {
      idempotencyKey,
      jobType: "video.upload_url",
      providerConnectionId: conn.id,
      payload: {
        redactedUrl: validation.redactedUrl,
        sourceUrlHash: validation.sourceUrlHash,
        title: resolvedTitle,
        contentType: validation.contentType,
        contentLength: validation.contentLength,
      },
      status: "validating",
    });

    if (deduplicated) {
      return NextResponse.json({ job, deduplicated: true });
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
      },
    });

    await transitionJob(db, job.id, {
      status: "processing",
      started: true,
      incrementAttempts: true,
      eventMessage: `Submitting direct URL to ${adapter.meta.displayName}.`,
      eventData: { redactedUrl: validation.redactedUrl },
    });

    const credentials = await decryptConnectionCredentials(conn);

    try {
      const uploadRes = await adapter.uploadFromUrl(credentials, body.url.trim(), {
        title: resolvedTitle,
      });

      const registered = await registerImportedAsset(db, {
        connectionId: conn.id,
        externalId: uploadRes.externalId,
        title: body.title?.trim() || uploadRes.title || resolvedTitle,
        canonicalStatus: adapter.meta.capabilities.asyncProcessing ? "processing" : "active",
        sizeBytes: uploadRes.sizeBytes ?? validation.contentLength,
        sourceUrlHash: validation.sourceUrlHash,
        providerMetadata: uploadRes.providerMetadata,
      });

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
        },
      });

      return NextResponse.json(
        {
          job: updatedJob,
          assetId: registered.assetId,
          deduplicated: false,
        },
        { status: 201 },
      );
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

      return NextResponse.json(
        {
          error: canonical.message,
          code: canonical.code,
          job: updatedJob,
        },
        { status: isAmbiguous ? 504 : 502 },
      );
    }
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
