import { describe, expect, it } from "vitest";
import { CRON_BUDGET } from "@/shared";
import { computeNextPollSchedule, planCronTick, type TickCandidateJob } from "./cron-tick";

describe("Cron tick subrequest budget & backoff (PRD 14.5, TC-21)", () => {
  it("caps 100 due polling jobs to at most 40 external calls in one tick (TC-21)", () => {
    const dueProcessing: TickCandidateJob[] = Array.from({ length: 100 }, (_, i) => ({
      id: `job-${i}`,
      status: "provider_processing",
      attempts: 1,
      createdAt: "2026-11-22T09:00:00.000Z",
    }));

    const plan = planCronTick({
      queuedJobs: [],
      dueProcessingJobs: dueProcessing,
      dueRetryJobs: [],
      killSwitchEnabled: false,
      degradeModeActive: false,
    });

    expect(plan.totalExternalCallsPlanned).toBe(CRON_BUDGET.maxExternalSubrequestsPerTick);
    expect(plan.processingToPoll).toHaveLength(40);
    expect(plan.deferredCount).toBe(60);
  });

  it("halts all cron dispatch when kill-switch is active and throttles in degrade mode", () => {
    const queued: TickCandidateJob[] = Array.from({ length: 5 }, (_, i) => ({
      id: `q-${i}`,
      status: "queued",
      attempts: 0,
      createdAt: "2026-11-22T09:00:00.000Z",
    }));

    const paused = planCronTick({
      queuedJobs: queued,
      dueProcessingJobs: [],
      dueRetryJobs: [],
      killSwitchEnabled: true,
      degradeModeActive: false,
    });
    expect(paused.totalExternalCallsPlanned).toBe(0);

    const degraded = planCronTick({
      queuedJobs: queued,
      dueProcessingJobs: [],
      dueRetryJobs: [],
      killSwitchEnabled: false,
      degradeModeActive: true,
    });
    expect(degraded.queuedToDispatch).toHaveLength(0);
  });

  it("applies progressive backoff and marks expired polling as timedOut", () => {
    const now = Date.parse("2026-11-22T10:00:00.000Z");
    const step1 = computeNextPollSchedule({
      attempts: 1,
      createdAtIso: "2026-11-22T09:59:00.000Z",
      nowMs: now,
    });
    expect(step1.timedOut).toBe(false);
    expect(Date.parse(step1.nextPollAtIso!) - now).toBe(30_000);

    const expired = computeNextPollSchedule({
      attempts: 20,
      createdAtIso: "2026-11-22T03:00:00.000Z",
      nowMs: now,
    });
    expect(expired.timedOut).toBe(true);
    expect(expired.nextPollAtIso).toBeNull();
  });
});
