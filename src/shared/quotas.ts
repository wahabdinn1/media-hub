import { z } from "zod";

export const QUOTA_METRICS = [
  "worker_requests_daily",
  "queue_messages_daily",
  "d1_rows_written_daily",
  "r2_class_a_monthly",
  "r2_class_b_monthly",
  "r2_staging_bytes",
  "r2_thumbnails_bytes",
] as const;

export const QuotaMetricSchema = z.enum(QUOTA_METRICS);
export type QuotaMetric = z.infer<typeof QuotaMetricSchema>;

export const QUOTA_THRESHOLDS = {
  warningRatio: 0.7,
  degradeRatio: 0.9,
} as const;

export const GIB = 1024 * 1024 * 1024;
export const MIB = 1024 * 1024;

export const FREE_TIER_BUDGETS: Record<
  QuotaMetric,
  {
    budget: number;
    hardLimit: number;
    unit: "count" | "bytes";
    window: "daily" | "monthly" | "current";
  }
> = {
  worker_requests_daily: {
    budget: 70_000,
    hardLimit: 100_000,
    unit: "count",
    window: "daily",
  },
  queue_messages_daily: {
    budget: 2_300,
    hardLimit: 3_300,
    unit: "count",
    window: "daily",
  },
  d1_rows_written_daily: {
    budget: 70_000,
    hardLimit: 100_000,
    unit: "count",
    window: "daily",
  },
  r2_class_a_monthly: {
    budget: 700_000,
    hardLimit: 1_000_000,
    unit: "count",
    window: "monthly",
  },
  r2_class_b_monthly: {
    budget: 7_000_000,
    hardLimit: 10_000_000,
    unit: "count",
    window: "monthly",
  },
  r2_staging_bytes: {
    budget: 3 * GIB,
    hardLimit: 3 * GIB,
    unit: "bytes",
    window: "current",
  },
  r2_thumbnails_bytes: {
    budget: 1 * GIB,
    hardLimit: 1 * GIB,
    unit: "bytes",
    window: "current",
  },
};

export const R2_ITEM_CAPS = {
  maxPerFileStagingBytes: 1 * GIB,
  maxCustomThumbnailBytes: 5 * MIB,
  stagingExpiryHours: 24,
} as const;

export const CRON_BUDGET = {
  maxExternalSubrequestsPerTick: 40,
  maxChunkJobIdsPerQueueMessage: 10,
  retentionDays: {
    jobEvents: 90,
    activityLogs: 365,
  },
} as const;
