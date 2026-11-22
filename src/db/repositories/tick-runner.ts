import { and, asc, eq, isNull, lte, sql } from "drizzle-orm";
import {
  computeNextPollSchedule,
  evaluateQuotaState,
  planCronTick,
  validateImportUrl,
  type TickCandidateJob,
} from "@/core";
import { CRON_BUDGET } from "@/shared";
import { getProviderRegistry } from "@/lib/registry";
import type { MediaHubDb } from "../client";
import { activityLogs, assets, jobEvents, jobs } from "../schema";
import { recordActivity } from "./activity";
import { registerImportedAsset } from "./assets";
import { extractJobSourceUrl, reconcileBatchStatus } from "./batches";
import { transitionJob, type JobRow } from "./jobs";
import { decryptConnectionCredentials, getConnectionById } from "./providers";
import { getPersistedSettings } from "./settings";
import { getCurrentUsageCounters, incrementUsageCounter } from "./usage";
import { runDueScheduledWorkflows } from "./workflows";

export interface TickExecutionReport {
  skippedReason?: string;
  dispatched: number;
  polled: number;
  requeuedRetries: number;
  workflowsExecuted: number;
  prunedJobEvents: number;
  prunedActivityLogs: number;
  deferredCount: number;
}

async function processSingleQueuedUploadJob(db: MediaHubDb, job: JobRow): Promise<void> {
  if (!job.providerConnectionId) {
    await transitionJob(db, job.id, {
      status: "failed",
      finished: true,
      errorCode: "INVALID_INPUT",
      eventMessage: "Missing provider connection snapshot on queued job.",
    });
    return;
  }

  const conn = await getConnectionById(db, job.providerConnectionId);
  if (!conn || conn.status !== "active") {
    await transitionJob(db, job.id, {
      status: "failed",
      finished: true,
      errorCode: "AUTH_FAILED",
      eventMessage: "Provider connection is inactive or missing.",
    });
    return;
  }

  const rawUrl = await extractJobSourceUrl(job);
  if (!rawUrl) {
    await transitionJob(db, job.id, {
      status: "failed",
      finished: true,
      errorCode: "INVALID_INPUT",
      eventMessage: "Encrypted source URL could not be decrypted.",
    });
    return;
  }

  const validation = await validateImportUrl(rawUrl);
  if (!validation.valid) {
    await transitionJob(db, job.id, {
      status: "failed",
      finished: true,
      errorCode: "INVALID_INPUT",
      eventMessage: validation.reason,
      eventData: { classification: validation.classification },
    });
    return;
  }

  const adapter = getProviderRegistry().require(conn.providerKey);
  if (!adapter.uploadFromUrl) {
    await transitionJob(db, job.id, {
      status: "failed",
      finished: true,
      errorCode: "UNSUPPORTED",
      eventMessage: `Provider "${adapter.meta.displayName}" does not support direct URL import.`,
    });
    return;
  }

  await transitionJob(db, job.id, {
    status: "processing",
    started: true,
    incrementAttempts: true,
    eventMessage: `Dispatching queued upload to ${adapter.meta.displayName}.`,
  });

  const payload = JSON.parse(job.payloadJson ?? "{}") as {
    title?: string;
    sourceUrlHash?: string;
  };
  const credentials = await decryptConnectionCredentials(conn);

  try {
    const uploadRes = await adapter.uploadFromUrl(credentials, rawUrl, {
      title: payload.title,
    });

    const registered = await registerImportedAsset(db, {
      connectionId: conn.id,
      externalId: uploadRes.externalId,
      title: payload.title || uploadRes.title || validation.inferredTitle || "Imported video",
      canonicalStatus: adapter.meta.capabilities.asyncProcessing ? "processing" : "active",
      sizeBytes: uploadRes.sizeBytes ?? validation.contentLength,
      sourceUrlHash: payload.sourceUrlHash ?? validation.sourceUrlHash,
      providerMetadata: uploadRes.providerMetadata,
    });

    const nextStatus = adapter.meta.capabilities.asyncProcessing
      ? "provider_processing"
      : "completed";

    await transitionJob(db, job.id, {
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
          ? "Upload accepted by provider; awaiting encoding completion."
          : "Upload completed and asset registered.",
    });
  } catch (err) {
    const canonical = adapter.normalizeError(err);
    const isUnknown = canonical.code === "TIMEOUT_UNKNOWN";
    const isRetryable = canonical.retryable && job.attempts < 3;

    await transitionJob(db, job.id, {
      status: isUnknown ? "unknown" : isRetryable ? "retry_wait" : "failed",
      finished: !isUnknown && !isRetryable,
      errorCode: canonical.code,
      nextPollAt: isRetryable ? new Date(Date.now() + 60_000).toISOString() : null,
      eventMessage: canonical.message,
      eventData: { code: canonical.code, retryable: canonical.retryable },
    });
  }
}

async function pollSingleProcessingJob(db: MediaHubDb, job: JobRow): Promise<void> {
  if (!job.providerConnectionId) return;
  const conn = await getConnectionById(db, job.providerConnectionId);
  if (!conn || conn.status !== "active") return;

  const adapter = getProviderRegistry().require(conn.providerKey);
  if (!adapter.getProcessingStatus) return;

  const result = JSON.parse(job.resultJson ?? "{}") as {
    assetId?: string;
    externalId?: string;
  };
  if (!result.externalId) return;

  const schedule = computeNextPollSchedule({
    attempts: job.attempts + 1,
    createdAtIso: job.createdAt,
  });

  if (schedule.timedOut) {
    await transitionJob(db, job.id, {
      status: "unknown",
      nextPollAt: null,
      errorCode: "TIMEOUT_UNKNOWN",
      eventMessage:
        "Encoding poll exceeded maximum age (6h). Outcome unclear — check at provider.",
    });
    return;
  }

  try {
    const credentials = await decryptConnectionCredentials(conn);
    const encoding = await adapter.getProcessingStatus(credentials, result.externalId);
    if (result.assetId) {
      await db
        .update(assets)
        .set({
          canonicalStatus: encoding.canonicalStatus,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(assets.id, result.assetId));
    }

    await transitionJob(db, job.id, {
      status: encoding.completed ? "completed" : "provider_processing",
      finished: encoding.completed,
      incrementAttempts: true,
      nextPollAt: encoding.completed ? null : schedule.nextPollAtIso,
      result: { ...result, progressPercent: encoding.progressPercent },
      eventMessage: encoding.completed
        ? "Encoding reached 100%. Job completed."
        : `Encoding progress: ${encoding.progressPercent}%.`,
    });
  } catch (err) {
    const canonical = adapter.normalizeError(err);
    await transitionJob(db, job.id, {
      status: "provider_processing",
      incrementAttempts: true,
      nextPollAt: schedule.nextPollAtIso,
      eventMessage: `Encoding poll transient error (${canonical.code}); retrying on next backoff.`,
    });
  }
}

export async function executeBoundedTick(
  db: MediaHubDb,
  options?: { batchId?: string; maxExternalCalls?: number; includePrune?: boolean },
): Promise<TickExecutionReport> {
  const [settings, counters] = await Promise.all([
    getPersistedSettings(db),
    getCurrentUsageCounters(db),
  ]);
  const quota = evaluateQuotaState(counters, { killSwitchEnabled: settings.killSwitchEnabled });

  if (quota.killSwitchEnabled) {
    return {
      skippedReason: "Kill-switch is enabled.",
      dispatched: 0,
      polled: 0,
      requeuedRetries: 0,
      workflowsExecuted: 0,
      prunedJobEvents: 0,
      prunedActivityLogs: 0,
      deferredCount: 0,
    };
  }

  const nowIso = new Date().toISOString();

  const [queuedRows, dueProcRows, dueRetryRows] = await Promise.all([
    options?.batchId
      ? db
          .select()
          .from(jobs)
          .where(and(eq(jobs.status, "queued"), eq(jobs.batchId, options.batchId)))
          .orderBy(asc(jobs.createdAt))
          .limit(20)
      : db
          .select()
          .from(jobs)
          .where(eq(jobs.status, "queued"))
          .orderBy(asc(jobs.createdAt))
          .limit(20),
    db
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.status, "provider_processing"),
          sql`(${jobs.nextPollAt} IS NULL OR ${jobs.nextPollAt} <= ${nowIso})`,
        ),
      )
      .orderBy(asc(jobs.createdAt))
      .limit(100),
    db
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.status, "retry_wait"),
          sql`(${jobs.nextPollAt} IS NULL OR ${jobs.nextPollAt} <= ${nowIso})`,
        ),
      )
      .orderBy(asc(jobs.createdAt))
      .limit(20),
  ]);

  const toCandidate = (r: JobRow): TickCandidateJob => ({
    id: r.id,
    status: r.status as TickCandidateJob["status"],
    attempts: r.attempts,
    createdAt: r.createdAt,
  });

  const plan = planCronTick({
    queuedJobs: queuedRows.map(toCandidate),
    dueProcessingJobs: dueProcRows.map(toCandidate),
    dueRetryJobs: dueRetryRows.map(toCandidate),
    killSwitchEnabled: quota.killSwitchEnabled,
    degradeModeActive: quota.degradeModeActive,
    maxExternalCalls: options?.maxExternalCalls,
  });

  const touchedBatches = new Set<string>();
  const queuedMap = new Map(queuedRows.map((r) => [r.id, r]));
  const procMap = new Map(dueProcRows.map((r) => [r.id, r]));

  for (const cand of plan.queuedToDispatch) {
    const row = queuedMap.get(cand.id);
    if (!row) continue;
    if (row.jobType === "video.upload_url") {
      await processSingleQueuedUploadJob(db, row);
    }
    if (row.batchId) touchedBatches.add(row.batchId);
  }

  for (const cand of plan.processingToPoll) {
    const row = procMap.get(cand.id);
    if (!row) continue;
    await pollSingleProcessingJob(db, row);
    if (row.batchId) touchedBatches.add(row.batchId);
  }

  for (const cand of plan.retryToRequeue) {
    await transitionJob(db, cand.id, {
      status: "queued",
      nextPollAt: null,
      eventMessage: "Backoff elapsed; moved from retry_wait back to queued.",
    });
  }

  for (const batchId of touchedBatches) {
    await reconcileBatchStatus(db, batchId);
  }

  let workflowsExecuted = 0;
  if (!quota.degradeModeActive && !options?.batchId) {
    workflowsExecuted = await runDueScheduledWorkflows(db, 2);
  }

  let prunedJobEvents = 0;
  let prunedActivityLogs = 0;

  if (options?.includePrune) {
    const eventsCutoff = new Date(
      Date.now() - CRON_BUDGET.retentionDays.jobEvents * 86_400_000,
    ).toISOString();
    const activityCutoff = new Date(
      Date.now() - CRON_BUDGET.retentionDays.activityLogs * 86_400_000,
    ).toISOString();

    const oldEvents = await db
      .select({ count: sql<number>`count(*)` })
      .from(jobEvents)
      .where(lte(jobEvents.createdAt, eventsCutoff));
    prunedJobEvents = Number(oldEvents[0]?.count ?? 0);
    if (prunedJobEvents > 0) {
      await db.delete(jobEvents).where(lte(jobEvents.createdAt, eventsCutoff));
    }

    const oldActivity = await db
      .select({ count: sql<number>`count(*)` })
      .from(activityLogs)
      .where(lte(activityLogs.createdAt, activityCutoff));
    prunedActivityLogs = Number(oldActivity[0]?.count ?? 0);
    if (prunedActivityLogs > 0) {
      await db.delete(activityLogs).where(lte(activityLogs.createdAt, activityCutoff));
    }

    if (prunedJobEvents > 0 || prunedActivityLogs > 0) {
      await recordActivity(db, {
        actorId: "system:cron",
        action: "retention.pruned",
        entityType: "system",
        entityId: "retention",
        context: { prunedJobEvents, prunedActivityLogs },
      });
    }
  }

  if (plan.totalExternalCallsPlanned > 0) {
    await incrementUsageCounter(db, "d1_rows_written_daily", plan.totalExternalCallsPlanned * 2);
  }

  return {
    dispatched: plan.queuedToDispatch.length,
    polled: plan.processingToPoll.length,
    requeuedRetries: plan.retryToRequeue.length,
    workflowsExecuted,
    prunedJobEvents,
    prunedActivityLogs,
    deferredCount: plan.deferredCount,
  };
}

export async function listExistingSourceUrlHashes(db: MediaHubDb): Promise<Set<string>> {
  const rows = await db
    .select({ hash: assets.sourceUrlHash })
    .from(assets)
    .where(and(isNull(assets.deletedAt), sql`${assets.sourceUrlHash} IS NOT NULL`));
  const set = new Set<string>();
  for (const r of rows) {
    if (r.hash) set.add(r.hash);
  }
  return set;
}
