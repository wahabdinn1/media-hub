import { describe, expect, it } from "vitest";
import { computeJobAnalytics } from "./job-metrics";

describe("computeJobAnalytics", () => {
  it("computes success rate, median/p95 durations, and daily buckets", () => {
    const result = computeJobAnalytics([
      {
        status: "completed",
        jobType: "video.sync",
        createdAt: "2026-11-20T10:00:00.000Z",
        startedAt: "2026-11-20T10:00:00.000Z",
        finishedAt: "2026-11-20T10:00:01.000Z",
      },
      {
        status: "completed",
        jobType: "video.upload_url",
        createdAt: "2026-11-20T11:00:00.000Z",
        startedAt: "2026-11-20T11:00:00.000Z",
        finishedAt: "2026-11-20T11:00:05.000Z",
      },
      {
        status: "failed",
        jobType: "video.upload_url",
        createdAt: "2026-11-21T09:00:00.000Z",
        startedAt: "2026-11-21T09:00:00.000Z",
        finishedAt: "2026-11-21T09:00:10.000Z",
      },
    ]);

    expect(result.totalJobs).toBe(3);
    expect(result.completedJobs).toBe(2);
    expect(result.failedJobs).toBe(1);
    expect(result.successRatePercent).toBe(66.7);
    expect(result.medianDurationMs).toBe(5000);
    expect(result.p95DurationMs).toBe(10000);
    expect(result.byDay).toHaveLength(2);
    expect(result.byType[0]?.jobType).toBe("video.upload_url");
  });
});
