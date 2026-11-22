import { CRON_BUDGET } from "@/shared";

export interface TickCandidateJob {
  id: string;
  status: "queued" | "provider_processing" | "retry_wait";
  attempts: number;
  createdAt: string;
}

export interface CronTickPlan {
  queuedToDispatch: TickCandidateJob[];
  processingToPoll: TickCandidateJob[];
  retryToRequeue: TickCandidateJob[];
  totalExternalCallsPlanned: number;
  deferredCount: number;
}

/**
 * Plans one per-minute cron tick strictly within Cloudflare Free's subrequest budget
 * (PRD 14.5 & TC-21: at most 40 external provider calls per tick, priority ordered).
 */
export function planCronTick(params: {
  queuedJobs: TickCandidateJob[];
  dueProcessingJobs: TickCandidateJob[];
  dueRetryJobs: TickCandidateJob[];
  killSwitchEnabled: boolean;
  degradeModeActive: boolean;
  maxExternalCalls?: number;
}): CronTickPlan {
  if (params.killSwitchEnabled) {
    return {
      queuedToDispatch: [],
      processingToPoll: [],
      retryToRequeue: [],
      totalExternalCallsPlanned: 0,
      deferredCount:
        params.queuedJobs.length + params.dueProcessingJobs.length + params.dueRetryJobs.length,
    };
  }

  const maxCalls = Math.min(
    params.maxExternalCalls ?? CRON_BUDGET.maxExternalSubrequestsPerTick,
    CRON_BUDGET.maxExternalSubrequestsPerTick,
  );

  let remaining = maxCalls;

  // Priority 1: Dispatch queued jobs (blocked in degrade mode; chunked max 10 per tick)
  const queuedCap = params.degradeModeActive
    ? 0
    : Math.min(CRON_BUDGET.maxChunkJobIdsPerQueueMessage, remaining);
  const queuedToDispatch = params.queuedJobs.slice(0, queuedCap);
  remaining -= queuedToDispatch.length;

  // Priority 2: Poll due provider_processing jobs (reduced to max 10 in degrade mode)
  const pollCap = params.degradeModeActive ? Math.min(10, remaining) : remaining;
  const processingToPoll = params.dueProcessingJobs.slice(0, pollCap);
  remaining -= processingToPoll.length;

  // Priority 3: Move retry_wait back to queued (D1-only write, 0 external calls)
  const retryToRequeue = params.degradeModeActive ? [] : params.dueRetryJobs.slice(0, 20);

  const totalExternalCallsPlanned = queuedToDispatch.length + processingToPoll.length;
  const deferredCount =
    params.queuedJobs.length -
    queuedToDispatch.length +
    (params.dueProcessingJobs.length - processingToPoll.length) +
    (params.dueRetryJobs.length - retryToRequeue.length);

  return {
    queuedToDispatch,
    processingToPoll,
    retryToRequeue,
    totalExternalCallsPlanned,
    deferredCount,
  };
}

/**
 * Progressive polling backoff schedule (PRD 14.5): 30s -> 2m -> 10m.
 * After max age (6 hours), job transitions to `unknown` for manual check.
 */
export function computeNextPollSchedule(params: {
  attempts: number;
  createdAtIso: string;
  nowMs?: number;
}): { timedOut: boolean; nextPollAtIso: string | null } {
  const now = params.nowMs ?? Date.now();
  const createdMs = Date.parse(params.createdAtIso);
  const maxAgeMs = 6 * 60 * 60 * 1000;

  if (Number.isFinite(createdMs) && now - createdMs >= maxAgeMs) {
    return { timedOut: true, nextPollAtIso: null };
  }

  const delayMs =
    params.attempts <= 2 ? 30_000 : params.attempts <= 6 ? 120_000 : 600_000;
  return {
    timedOut: false,
    nextPollAtIso: new Date(now + delayMs).toISOString(),
  };
}
