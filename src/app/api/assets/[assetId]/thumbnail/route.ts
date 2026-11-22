import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  canEnqueueJob,
  evaluateQuotaState,
  requireOwnerRequest,
  resolveConnectionForOperation,
  validateThumbnailUrl,
  type ProviderConnectionRecord,
} from "@/core";
import { hasCapability, type ServiceType } from "@/shared";
import { getDb } from "@/db/client";
import { assetLocations, assets, providerConnections, thumbnails } from "@/db/schema";
import { recordActivity } from "@/db/repositories/activity";
import { createIdempotentJob, transitionJob } from "@/db/repositories/jobs";
import { decryptConnectionCredentials } from "@/db/repositories/providers";
import { assertModuleEnabled, getPersistedSettings } from "@/db/repositories/settings";
import { getCurrentUsageCounters, incrementUsageCounter } from "@/db/repositories/usage";
import { toApiErrorResponse } from "@/lib/api-error";
import { getProviderRegistry } from "@/lib/registry";

const ApplyThumbnailSchema = z.object({
  imageUrl: z.string().trim().min(1).max(2048),
  locationId: z.string().optional(),
});

const SwitchThumbnailSchema = z.object({
  thumbnailId: z.string().min(1),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ assetId: string }> },
) {
  try {
    const principal = await requireOwnerRequest(request, "thumbnail.write");
    await requireOwnerRequest(request, "job.create");
    const { assetId } = await context.params;
    const body = ApplyThumbnailSchema.parse(await request.json());

    const { db } = await getDb();
    if (!(await assertModuleEnabled(db, "thumbnails"))) {
      return NextResponse.json(
        { error: "The Thumbnails module is disabled in Settings." },
        { status: 403 },
      );
    }

    const [settings, counters, assetRows, locs, allConns] = await Promise.all([
      getPersistedSettings(db),
      getCurrentUsageCounters(db),
      db
        .select()
        .from(assets)
        .where(and(eq(assets.id, assetId), isNull(assets.deletedAt)))
        .limit(1),
      db.select().from(assetLocations).where(eq(assetLocations.assetId, assetId)),
      db.select().from(providerConnections),
    ]);

    if (!assetRows[0]) {
      return NextResponse.json({ error: "Asset not found." }, { status: 404 });
    }

    const quota = evaluateQuotaState(counters, { killSwitchEnabled: settings.killSwitchEnabled });
    const gate = canEnqueueJob(quota, "thumbnail.update");
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
    if (!hasCapability(adapter.meta.capabilities, "thumbnail.url") || !adapter.setThumbnail) {
      return NextResponse.json(
        { error: `${adapter.meta.displayName} does not support URL-based custom thumbnails.` },
        { status: 400 },
      );
    }

    const normalizedUrl = body.imageUrl.trim();
    const validation = await validateThumbnailUrl(normalizedUrl);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.reason }, { status: 400 });
    }

    const idempotencyKey =
      request.headers.get("idempotency-key")?.trim() ||
      `thumbnail.update:${assetId}:${Date.now()}`;

    const { job } = await createIdempotentJob(db, {
      idempotencyKey,
      jobType: "thumbnail.update",
      providerConnectionId: connRow.id,
      payload: {
        assetId,
        externalId: loc.externalId,
        redactedUrl: validation.redactedUrl,
        contentType: validation.contentType,
      },
      status: "processing",
    });

    await transitionJob(db, job.id, {
      status: "processing",
      started: true,
      incrementAttempts: true,
      eventMessage: `Applying custom thumbnail via ${adapter.meta.displayName}.`,
    });

    const credentials = await decryptConnectionCredentials(connRow);

    try {
      await adapter.setThumbnail(credentials, loc.externalId, {
        url: normalizedUrl,
        contentType: validation.contentType,
      });

      const now = new Date().toISOString();
      const thumbId = crypto.randomUUID();
      await db
        .update(thumbnails)
        .set({ isActive: false })
        .where(eq(thumbnails.assetId, assetId));

      await db.insert(thumbnails).values({
        id: thumbId,
        assetId,
        sourceType: "custom_url",
        sourceUrl: normalizedUrl,
        isActive: true,
        metadataJson: JSON.stringify({
          contentType: validation.contentType ?? null,
          contentLength: validation.contentLength ?? null,
        }),
        createdAt: now,
      });
      await db.update(assets).set({ updatedAt: now }).where(eq(assets.id, assetId));
      await incrementUsageCounter(db, "d1_rows_written_daily", 3);

      const doneJob = await transitionJob(db, job.id, {
        status: "completed",
        finished: true,
        result: { assetId, thumbnailId: thumbId },
        eventMessage: "Custom thumbnail applied and marked active (native fallback retained).",
      });

      await recordActivity(db, {
        actorId: principal.actorId,
        action: "thumbnail.applied",
        entityType: "asset",
        entityId: assetId,
        context: {
          providerKey: connRow.providerKey,
          thumbnailId: thumbId,
          sourceType: "custom_url",
          jobId: job.id,
        },
      });

      return NextResponse.json({ ok: true, thumbnailId: thumbId, job: doneJob }, { status: 201 });
    } catch (err) {
      const canonical = adapter.normalizeError(err);
      const failedJob = await transitionJob(db, job.id, {
        status: "failed",
        finished: true,
        errorCode: canonical.code,
        eventMessage: canonical.message,
      });
      return NextResponse.json(
        { error: canonical.message, code: canonical.code, job: failedJob },
        { status: 502 },
      );
    }
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ assetId: string }> },
) {
  try {
    const principal = await requireOwnerRequest(request, "thumbnail.write");
    const { assetId } = await context.params;
    const body = SwitchThumbnailSchema.parse(await request.json());

    const { db } = await getDb();
    if (!(await assertModuleEnabled(db, "thumbnails"))) {
      return NextResponse.json(
        { error: "The Thumbnails module is disabled in Settings." },
        { status: 403 },
      );
    }

    const targetRows = await db
      .select()
      .from(thumbnails)
      .where(and(eq(thumbnails.id, body.thumbnailId), eq(thumbnails.assetId, assetId)))
      .limit(1);
    const target = targetRows[0];
    if (!target) {
      return NextResponse.json({ error: "Thumbnail not found for this asset." }, { status: 404 });
    }

    // Best-effort re-apply to provider when URL is present and connection is writable
    let syncedToProvider = false;
    if (target.sourceUrl) {
      const [locs, allConns, settings] = await Promise.all([
        db.select().from(assetLocations).where(eq(assetLocations.assetId, assetId)),
        db.select().from(providerConnections),
        getPersistedSettings(db),
      ]);
      const loc = locs[0];
      const connRow = loc ? allConns.find((c) => c.id === loc.providerConnectionId) : undefined;
      if (loc && connRow && !settings.killSwitchEnabled) {
        const connRecords: ProviderConnectionRecord[] = allConns.map((c) => ({
          id: c.id,
          serviceType: c.serviceType as ServiceType,
          providerKey: c.providerKey,
          status: c.status as "active" | "disabled" | "error",
          isDefault: c.isDefault,
        }));
        const routing = resolveConnectionForOperation({
          connections: connRecords,
          serviceType: connRow.serviceType as ServiceType,
          locationConnectionId: loc.providerConnectionId,
          mutation: true,
        });
        const adapter = getProviderRegistry().get(connRow.providerKey);
        if (
          routing.allowed &&
          adapter &&
          hasCapability(adapter.meta.capabilities, "thumbnail.url") &&
          adapter.setThumbnail
        ) {
          try {
            const credentials = await decryptConnectionCredentials(connRow);
            await adapter.setThumbnail(credentials, loc.externalId, { url: target.sourceUrl });
            syncedToProvider = true;
          } catch {
            // Keep local switch even if provider refuses re-applying its own native URL
          }
        }
      }
    }

    await db.update(thumbnails).set({ isActive: false }).where(eq(thumbnails.assetId, assetId));
    await db.update(thumbnails).set({ isActive: true }).where(eq(thumbnails.id, target.id));
    await incrementUsageCounter(db, "d1_rows_written_daily", 2);

    await recordActivity(db, {
      actorId: principal.actorId,
      action: "thumbnail.activated",
      entityType: "asset",
      entityId: assetId,
      context: {
        thumbnailId: target.id,
        sourceType: target.sourceType,
        syncedToProvider,
      },
    });

    return NextResponse.json({ ok: true, thumbnailId: target.id, syncedToProvider });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
