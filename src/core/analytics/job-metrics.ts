export interface AnalyticsJobSample {
  status: string;
  jobType: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface DailyJobMetricPoint {
  day: string;
  completed: number;
  failed: number;
  other: number;
}

export interface JobAnalyticsSummary {
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  unknownJobs: number;
  activeJobs: number;
  successRatePercent: number;
  medianDurationMs: number | null;
  p95DurationMs: number | null;
  byDay: DailyJobMetricPoint[];
  byType: Array<{ jobType: string; count: number; failed: number }>;
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Math.round(sorted[idx]!);
}

/**
 * Pure deterministic analytics aggregator for MediaHub Dashboard Analytics (PRD AN-01, AN-02).
 */
export function computeJobAnalytics(samples: readonly AnalyticsJobSample[]): JobAnalyticsSummary {
  let completedJobs = 0;
  let failedJobs = 0;
  let unknownJobs = 0;
  let activeJobs = 0;
  const durationsMs: number[] = [];

  const dayMap = new Map<string, DailyJobMetricPoint>();
  const typeMap = new Map<string, { jobType: string; count: number; failed: number }>();

  for (const job of samples) {
    if (job.status === "completed") completedJobs += 1;
    else if (job.status === "failed") failedJobs += 1;
    else if (job.status === "unknown") unknownJobs += 1;
    else if (job.status !== "cancelled") activeJobs += 1;

    const startIso = job.startedAt ?? job.createdAt;
    if (job.finishedAt && startIso) {
      const dur = Date.parse(job.finishedAt) - Date.parse(startIso);
      if (Number.isFinite(dur) && dur >= 0) {
        durationsMs.push(dur);
      }
    }

    const day = job.createdAt.slice(0, 10);
    const point = dayMap.get(day) ?? { day, completed: 0, failed: 0, other: 0 };
    if (job.status === "completed") point.completed += 1;
    else if (job.status === "failed") point.failed += 1;
    else point.other += 1;
    dayMap.set(day, point);

    const tEntry = typeMap.get(job.jobType) ?? { jobType: job.jobType, count: 0, failed: 0 };
    tEntry.count += 1;
    if (job.status === "failed") tEntry.failed += 1;
    typeMap.set(job.jobType, tEntry);
  }

  durationsMs.sort((a, b) => a - b);
  const terminal = completedJobs + failedJobs;
  const successRatePercent =
    terminal > 0 ? Math.round((completedJobs / terminal) * 1000) / 10 : 100;

  return {
    totalJobs: samples.length,
    completedJobs,
    failedJobs,
    unknownJobs,
    activeJobs,
    successRatePercent,
    medianDurationMs: percentile(durationsMs, 50),
    p95DurationMs: percentile(durationsMs, 95),
    byDay: Array.from(dayMap.values()).sort((a, b) => a.day.localeCompare(b.day)),
    byType: Array.from(typeMap.values()).sort((a, b) => b.count - a.count),
  };
}
