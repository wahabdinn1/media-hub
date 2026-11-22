import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  canEnqueueJob,
  evaluateQuotaState,
  requireOwnerRequest,
  resolveConnectionForOperation,
  type ProviderConnectionRecord,
} from "@/core";
import { hasCapability, type ServiceType } from "@/shared";
import { getDb } from "@/db/client";
import { assetLocations, assets, providerConnections } from "@/db/schema";
import { recordActivity } from "@/db/repositories/activity";
import { registerImportedAsset } from "@/db/repositories/assets";
import { createIdempotentJob, transitionJob } from "@/db/repositories/jobs";
import { decryptConnectionCredentials } from "@/db/repositories/providers";
import { assertModuleEnabled, getPersistedSettings } from "@/db/repositories/settings";
import { getCurrentUsageCounters, incrementUsageCounter } from "@/db/repositories/usage";
import { toApiErrorResponse } from "@/lib/api-error";
import { getProviderRegistry } from "@/lib/registry";

const AssetActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("rename"),
    title: z.string().trim().min(1).max(255),
    locationId: z.string().optional(),
  }),
  z.object({
    action: z.literal("move"),
    folderExternalId: z.string().trim().min(1).nullable(),
    locationId: z.string().optional(),
  }),
  z.object({
    action: z.literal("clone"),
    locationId: z.string().optional(),
  }),
  z.object({
    action: z.literal("delete_provider"),
    confirmProviderDelete: z.literal(true),
    deleteLocalAlso: z.boolean().optional(),
    locationId: z.string().optional(),
  }),
  z.object({
    action: z.literal("soft_delete_local"),
  }),
]);

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ assetId: string }> },
) {
  try {
    const body = AssetActionSchema.parse(await request.json());
    const { assetId } = await context.params;
    const isDelete = body.action === "delete_provider" || body.action === "soft_delete_local";
    const principal = await requireOwnerRequest(request, isDelete ? "asset.delete" : "asset.write");

    const { db } = await getDb();
    if (!(await assertModuleEnabled(db, "library"))) {
      return NextResponse.json(
        { error: "The Library module is disabled in Settings." },
        { status: 403 },
      );
    }

    const assetRows = await db
      .select()
      .from(assets)
      .where(and(eq(assets.id, assetId), isNull(assets.deletedAt)))
      .limit(1);
    const asset = assetRows[0];
    if (!asset) {
      return NextResponse.json({ error: "Asset not found." }, { status: 404 });
    }

    // Local soft-delete never touches the provider (PRD 13.5)
    if (body.action === "soft_delete_local") {
      const now = new Date().toISOString();
      await db
        .update(assets)
        .set({ deletedAt: now, updatedAt: now })
        .where(eq(assets.id, assetId));
      await incrementUsageCounter(db, "d1_rows_written_daily", 1);
      await recordActivity(db, {
        actorId: principal.actorId,
        action: "asset.soft_deleted_local",
        entityType: "asset",
        entityId: assetId,
        context: { title: asset.title },
      });
      return NextResponse.json({ ok: true, action: "soft_delete_local" });
    }

    // Provider-touching operations require job.create + quota/kill-switch check
    await requireOwnerRequest(request, "job.create");
    const [settings, counters, locs, allConns] = await Promise.all([
      getPersistedSettings(db),
      getCurrentUsageCounters(db),
      db.select().from(assetLocations).where(eq(assetLocations.assetId, assetId)),
      db.select().from(providerConnections),
    ]);

    const jobType =
      body.action === "rename"
        ? "video.rename"
        : body.action === "move"
          ? "video.move"
          : body.action === "clone"
            ? "video.clone"
            : "video.delete";

    const quota = evaluateQuotaState(counters, { killSwitchEnabled: settings.killSwitchEnabled });
    const gate = canEnqueueJob(quota, jobType);
    if (!gate.allowed) {
      return NextResponse.json({ error: gate.reason, code: "QUOTA_EXCEEDED" }, { status: 429 });
    }

    const loc = body.locationId ? locs.find((l) => l.id === body.locationId) : locs[0];
    if (!loc) {
      return NextResponse.json(
        { error: "Asset has no linked provider location." },
        { status: 400 },
      );
    }

    const connRow = allConns.find((c) => c.id === loc.providerConnectionId);
    const connRecords: ProviderConnectionRecord[] = allConns.map((c) => ({
      id: c.id,
      serviceType: c.serviceType as ServiceType,
      providerKey: c.providerKey,
      status: c.status as "active" | "disabled" | "error",
      isDefault: c.isDefault,
    }));

    // Strict routing to the owning connection (PRD 12.6 — never reroute to a different default)
    const routing = resolveConnectionForOperation({
      connections: connRecords,
      serviceType: (connRow?.serviceType ?? "video_host") as ServiceType,
      locationConnectionId: loc.providerConnectionId,
      mutation: true,
    });
    if (!routing.allowed || !connRow) {
      return NextResponse.json(
        { error: routing.allowed ? "Owning provider connection missing." : routing.reason },
        { status: 403 },
      );
    }

    const adapter = getProviderRegistry().require(connRow.providerKey);
    const caps = adapter.meta.capabilities;

    if (body.action === "rename" && (!hasCapability(caps, "rename") || !adapter.renameAsset)) {
      return NextResponse.json(
        { error: `${adapter.meta.displayName} does not support renaming assets.` },
        { status: 400 },
      );
    }
    if (body.action === "move" && (!hasCapability(caps, "folders") || !adapter.moveAsset)) {
      return NextResponse.json(
        { error: `${adapter.meta.displayName} does not support moving assets between folders.` },
        { status: 400 },
      );
    }
    if (body.action === "clone" && (!hasCapability(caps, "clone") || !adapter.cloneAsset)) {
      return NextResponse.json(
        { error: `${adapter.meta.displayName} does not support cloning assets.` },
        { status: 400 },
      );
    }
    if (
      body.action === "delete_provider" &&
      (!hasCapability(caps, "delete") || !adapter.deleteAsset)
    ) {
      return NextResponse.json(
        { error: `${adapter.meta.displayName} does not support remote deletion.` },
        { status: 400 },
      );
    }

    const idempotencyKey =
      request.headers.get("idempotency-key")?.trim() ||
      `${jobType}:${assetId}:${loc.externalId}:${Date.now()}`;

    const { job } = await createIdempotentJob(db, {
      idempotencyKey,
      jobType,
      providerConnectionId: connRow.id,
      payload: {
        assetId,
        locationId: loc.id,
        externalId: loc.externalId,
        action: body.action,
        ...(body.action === "rename" ? { title: body.title } : {}),
        ...(body.action === "move" ? { folderExternalId: body.folderExternalId } : {}),
      },
      status: "processing",
    });

    await transitionJob(db, job.id, {
      status: "processing",
      started: true,
      incrementAttempts: true,
      eventMessage: `Executing ${body.action} on ${adapter.meta.displayName}.`,
    });

    const credentials = await decryptConnectionCredentials(connRow);
    const now = new Date().toISOString();

    try {
      if (body.action === "rename") {
        await adapter.renameAsset!(credentials, loc.externalId, body.title);
        await db
          .update(assets)
          .set({ title: body.title, updatedAt: now })
          .where(eq(assets.id, assetId));
        await incrementUsageCounter(db, "d1_rows_written_daily", 2);

        const doneJob = await transitionJob(db, job.id, {
          status: "completed",
          finished: true,
          result: { assetId, title: body.title },
          eventMessage: `Renamed asset to "${body.title}".`,
        });

        await recordActivity(db, {
          actorId: principal.actorId,
          action: "asset.renamed",
          entityType: "asset",
          entityId: assetId,
          context: { providerKey: connRow.providerKey, title: body.title, jobId: job.id },
        });

        return NextResponse.json({ ok: true, action: "rename", job: doneJob });
      }

      if (body.action === "move") {
        await adapter.moveAsset!(credentials, loc.externalId, body.folderExternalId);

        let meta: Record<string, unknown> = {};
        try {
          meta = JSON.parse(loc.providerMetadataJson) as Record<string, unknown>;
        } catch {
          meta = {};
        }
        meta.folderId = body.folderExternalId;
        meta.folder_id = body.folderExternalId;

        await db
          .update(assetLocations)
          .set({
            providerMetadataJson: JSON.stringify(meta),
            lastSeenAt: now,
          })
          .where(eq(assetLocations.id, loc.id));
        await db.update(assets).set({ updatedAt: now }).where(eq(assets.id, assetId));
        await incrementUsageCounter(db, "d1_rows_written_daily", 2);

        const doneJob = await transitionJob(db, job.id, {
          status: "completed",
          finished: true,
          result: { assetId, folderExternalId: body.folderExternalId },
          eventMessage: body.folderExternalId
            ? `Moved asset to folder ${body.folderExternalId}.`
            : "Moved asset to provider root.",
        });

        await recordActivity(db, {
          actorId: principal.actorId,
          action: "asset.moved",
          entityType: "asset",
          entityId: assetId,
          context: {
            providerKey: connRow.providerKey,
            folderExternalId: body.folderExternalId,
            jobId: job.id,
          },
        });

        return NextResponse.json({ ok: true, action: "move", job: doneJob });
      }

      if (body.action === "clone") {
        const cloned = await adapter.cloneAsset!(credentials, loc.externalId);
        const registered = await registerImportedAsset(db, {
          connectionId: connRow.id,
          externalId: cloned.externalId,
          title: cloned.title || `${asset.title} (Copy)`,
          canonicalStatus: cloned.canonicalStatus,
          sizeBytes: cloned.sizeBytes ?? asset.sizeBytes ?? undefined,
          providerMetadata: cloned.providerMetadata,
        });

        const doneJob = await transitionJob(db, job.id, {
          status: "completed",
          finished: true,
          result: {
            sourceAssetId: assetId,
            clonedAssetId: registered.assetId,
            externalId: cloned.externalId,
          },
          eventMessage: `Cloned asset into ${registered.assetId}.`,
        });

        await recordActivity(db, {
          actorId: principal.actorId,
          action: "asset.cloned",
          entityType: "asset",
          entityId: assetId,
          context: {
            providerKey: connRow.providerKey,
            clonedAssetId: registered.assetId,
            jobId: job.id,
          },
        });

        return NextResponse.json(
          { ok: true, action: "clone", clonedAssetId: registered.assetId, job: doneJob },
          { status: 201 },
        );
      }

      // delete_provider
      await adapter.deleteAsset!(credentials, loc.externalId);
      await db
        .update(assetLocations)
        .set({ syncState: "removed_remote", lastSeenAt: now })
        .where(eq(assetLocations.id, loc.id));
      await db
        .update(assets)
        .set({
          canonicalStatus: "removed_remote",
          deletedAt: body.deleteLocalAlso ? now : null,
          updatedAt: now,
        })
        .where(eq(assets.id, assetId));
      await incrementUsageCounter(db, "d1_rows_written_daily", 2);

      const doneJob = await transitionJob(db, job.id, {
        status: "completed",
        finished: true,
        result: {
          assetId,
          externalId: loc.externalId,
          deleteSemantics: caps.deleteSemantics,
          deleteLocalAlso: Boolean(body.deleteLocalAlso),
        },
        eventMessage: `Deleted asset at ${adapter.meta.displayName} (${caps.deleteSemantics.mode}, restorable=${caps.deleteSemantics.restorable}).`,
      });

      await recordActivity(db, {
        actorId: principal.actorId,
        action: "asset.deleted_provider",
        entityType: "asset",
        entityId: assetId,
        context: {
          providerKey: connRow.providerKey,
          externalId: loc.externalId,
          deleteLocalAlso: Boolean(body.deleteLocalAlso),
          jobId: job.id,
        },
      });

      return NextResponse.json({
        ok: true,
        action: "delete_provider",
        deletedLocal: Boolean(body.deleteLocalAlso),
        job: doneJob,
      });
    } catch (err) {
      const canonical = adapter.normalizeError(err);
      const isAmbiguous = body.action === "clone" && canonical.code === "TIMEOUT_UNKNOWN";

      const failedJob = await transitionJob(db, job.id, {
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
        { error: canonical.message, code: canonical.code, job: failedJob },
        { status: isAmbiguous ? 504 : 502 },
      );
    }
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
