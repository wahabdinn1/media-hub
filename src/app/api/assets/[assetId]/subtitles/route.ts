import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  canEnqueueJob,
  evaluateQuotaState,
  requireOwnerRequest,
  resolveConnectionForOperation,
  validateSubtitleUrl,
  type ProviderConnectionRecord,
} from "@/core";
import { hasCapability, type ServiceType } from "@/shared";
import { getDb } from "@/db/client";
import { assetLocations, assets, providerConnections, subtitles } from "@/db/schema";
import { recordActivity } from "@/db/repositories/activity";
import { createIdempotentJob, transitionJob } from "@/db/repositories/jobs";
import { decryptConnectionCredentials } from "@/db/repositories/providers";
import { assertModuleEnabled, getPersistedSettings } from "@/db/repositories/settings";
import { getCurrentUsageCounters, incrementUsageCounter } from "@/db/repositories/usage";
import { toApiErrorResponse } from "@/lib/api-error";
import { getProviderRegistry } from "@/lib/registry";

const AttachSubtitleSchema = z.object({
  language: z.string().trim().min(2).max(32),
  format: z.enum(["srt", "vtt"]),
  subtitleUrl: z.string().trim().min(1).max(2048),
  locationId: z.string().optional(),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ assetId: string }> },
) {
  try {
    const principal = await requireOwnerRequest(request, "asset.write");
    await requireOwnerRequest(request, "job.create");
    const { assetId } = await context.params;
    const body = AttachSubtitleSchema.parse(await request.json());

    const { db } = await getDb();
    if (!(await assertModuleEnabled(db, "library"))) {
      return NextResponse.json(
        { error: "The Library module is disabled in Settings." },
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
    const gate = canEnqueueJob(quota, "subtitle.add");
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
    if (!hasCapability(adapter.meta.capabilities, "subtitles") || !adapter.addSubtitle) {
      return NextResponse.json(
        { error: `${adapter.meta.displayName} does not support subtitle attachment.` },
        { status: 400 },
      );
    }

    const validation = await validateSubtitleUrl(body.subtitleUrl, body.format);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.reason }, { status: 400 });
    }

    const idempotencyKey =
      request.headers.get("idempotency-key")?.trim() ||
      `subtitle.add:${assetId}:${body.language}:${Date.now()}`;

    const { job } = await createIdempotentJob(db, {
      idempotencyKey,
      jobType: "subtitle.add",
      providerConnectionId: connRow.id,
      payload: {
        assetId,
        externalId: loc.externalId,
        language: body.language,
        format: body.format,
        redactedUrl: validation.redactedUrl,
      },
      status: "processing",
    });

    await transitionJob(db, job.id, {
      status: "processing",
      started: true,
      incrementAttempts: true,
      eventMessage: `Attaching ${body.format.toUpperCase()} subtitle (${body.language}) on ${adapter.meta.displayName}.`,
    });

    const credentials = await decryptConnectionCredentials(connRow);

    try {
      await adapter.addSubtitle(credentials, loc.externalId, body.language, {
        url: body.subtitleUrl,
        format: body.format,
      });

      const subId = crypto.randomUUID();
      const now = new Date().toISOString();
      await db.insert(subtitles).values({
        id: subId,
        assetId,
        providerConnectionId: connRow.id,
        language: body.language,
        format: body.format,
        sourceUrl: body.subtitleUrl,
        createdAt: now,
      });
      await incrementUsageCounter(db, "d1_rows_written_daily", 2);

      const doneJob = await transitionJob(db, job.id, {
        status: "completed",
        finished: true,
        result: { assetId, subtitleId: subId, language: body.language, format: body.format },
        eventMessage: `Subtitle (${body.language}, ${body.format.toUpperCase()}) attached.`,
      });

      await recordActivity(db, {
        actorId: principal.actorId,
        action: "subtitle.attached",
        entityType: "asset",
        entityId: assetId,
        context: {
          providerKey: connRow.providerKey,
          subtitleId: subId,
          language: body.language,
          format: body.format,
          jobId: job.id,
        },
      });

      return NextResponse.json({ ok: true, subtitleId: subId, job: doneJob }, { status: 201 });
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
