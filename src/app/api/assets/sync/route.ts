import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { canEnqueueJob, evaluateQuotaState, requireOwnerRequest } from "@/core";
import { getDb } from "@/db/client";
import { providerConnections } from "@/db/schema";
import { recordActivity } from "@/db/repositories/activity";
import { syncProviderCatalog } from "@/db/repositories/assets";
import { createIdempotentJob, transitionJob } from "@/db/repositories/jobs";
import { decryptConnectionCredentials } from "@/db/repositories/providers";
import { getCurrentUsageCounters, incrementUsageCounter } from "@/db/repositories/usage";
import { toApiErrorResponse } from "@/lib/api-error";
import { getProviderRegistry } from "@/lib/registry";

export async function POST(request: NextRequest) {
  try {
    const principal = await requireOwnerRequest(request, "asset.write");
    await requireOwnerRequest(request, "job.create");

    const { db } = await getDb();
    const counters = await getCurrentUsageCounters(db);
    const quota = evaluateQuotaState(counters);
    const gate = canEnqueueJob(quota, "video.sync");
    if (!gate.allowed) {
      return NextResponse.json({ error: gate.reason, code: "QUOTA_EXCEEDED" }, { status: 429 });
    }

    const conns = await db
      .select()
      .from(providerConnections)
      .where(eq(providerConnections.isDefault, true))
      .limit(1);

    const conn = conns[0];
    if (!conn || conn.status !== "active") {
      return NextResponse.json(
        { error: "No active default provider connection configured. Connect a provider first." },
        { status: 400 },
      );
    }

    const adapter = getProviderRegistry().require(conn.providerKey);
    const credentials = await decryptConnectionCredentials(conn);

    const idempotencyKey =
      request.headers.get("idempotency-key")?.trim() ||
      `sync:${conn.id}:${new Date().toISOString().slice(0, 16)}`;

    const { job, deduplicated } = await createIdempotentJob(db, {
      idempotencyKey,
      jobType: "video.sync",
      providerConnectionId: conn.id,
      payload: { providerKey: conn.providerKey, trigger: "manual" },
      status: "processing",
    });

    if (deduplicated) {
      return NextResponse.json({ job, deduplicated: true });
    }

    await incrementUsageCounter(db, "worker_requests_daily", 1);
    await transitionJob(db, job.id, {
      status: "processing",
      started: true,
      incrementAttempts: true,
      eventMessage: `Syncing catalog from ${adapter.meta.displayName}...`,
    });

    try {
      const summary = await syncProviderCatalog(db, {
        connectionId: conn.id,
        adapter,
        credentials,
        maxPages: 5,
      });

      const finishedJob = await transitionJob(db, job.id, {
        status: "completed",
        finished: true,
        result: { ...summary },
        eventMessage: `Sync completed: ${summary.created} created, ${summary.updated} updated, ${summary.unchanged} unchanged.`,
        eventData: { ...summary },
      });

      await recordActivity(db, {
        actorId: principal.actorId,
        action: "library.sync.completed",
        entityType: "provider_connection",
        entityId: conn.id,
        context: { jobId: job.id, ...summary },
      });

      return NextResponse.json({ job: finishedJob, summary });
    } catch (err) {
      const canonical = adapter.normalizeError(err);
      const failedJob = await transitionJob(db, job.id, {
        status: canonical.code === "TIMEOUT_UNKNOWN" ? "unknown" : "failed",
        finished: canonical.code !== "TIMEOUT_UNKNOWN",
        errorCode: canonical.code,
        eventMessage: canonical.message,
        eventData: { code: canonical.code, providerCode: canonical.providerCode },
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
