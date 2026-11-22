import {
  FREE_TIER_BUDGETS,
  QUOTA_METRICS,
  QUOTA_THRESHOLDS,
  R2_ITEM_CAPS,
  type JobType,
  type QuotaMetric,
} from "@/shared";

export type QuotaHealthLevel = "ok" | "warning" | "degraded" | "paused";

export interface QuotaMeterSnapshot {
  metric: QuotaMetric;
  used: number;
  budget: number;
  hardLimit: number;
  ratio: number;
  percent: number;
  unit: "count" | "bytes";
  window: "daily" | "monthly" | "current";
  level: Exclude<QuotaHealthLevel, "paused">;
}

export interface QuotaGuardEvaluation {
  overallLevel: QuotaHealthLevel;
  killSwitchEnabled: boolean;
  degradeModeActive: boolean;
  meters: QuotaMeterSnapshot[];
  triggeredMetrics: QuotaMetric[];
}

const DEGRADE_BLOCKED_JOB_TYPES = new Set<JobType>([
  "video.upload_url",
  "video.upload_file",
  "video.clone",
  "video.sync",
  "workflow.execute",
  "analytics.sync",
]);

export function evaluateQuotaState(
  counters: Partial<Record<QuotaMetric, number>>,
  options?: { killSwitchEnabled?: boolean },
): QuotaGuardEvaluation {
  const killSwitchEnabled = Boolean(options?.killSwitchEnabled);
  const meters: QuotaMeterSnapshot[] = [];
  const triggeredMetrics: QuotaMetric[] = [];
  let maxLevel: Exclude<QuotaHealthLevel, "paused"> = "ok";

  for (const metric of QUOTA_METRICS) {
    const config = FREE_TIER_BUDGETS[metric];
    const used = Math.max(0, counters[metric] ?? 0);
    const ratio = config.budget > 0 ? used / config.budget : 0;
    const percent = Math.min(100, Math.round(ratio * 100));

    let level: Exclude<QuotaHealthLevel, "paused"> = "ok";
    if (ratio >= QUOTA_THRESHOLDS.degradeRatio) {
      level = "degraded";
      maxLevel = "degraded";
      triggeredMetrics.push(metric);
    } else if (ratio >= QUOTA_THRESHOLDS.warningRatio) {
      level = "warning";
      if (maxLevel === "ok") {
        maxLevel = "warning";
      }
      triggeredMetrics.push(metric);
    }

    meters.push({
      metric,
      used,
      budget: config.budget,
      hardLimit: config.hardLimit,
      ratio,
      percent,
      unit: config.unit,
      window: config.window,
      level,
    });
  }

  const degradeModeActive = maxLevel === "degraded";
  const overallLevel: QuotaHealthLevel = killSwitchEnabled ? "paused" : maxLevel;

  return {
    overallLevel,
    killSwitchEnabled,
    degradeModeActive,
    meters,
    triggeredMetrics,
  };
}

export function canEnqueueJob(
  evaluation: QuotaGuardEvaluation,
  jobType: JobType,
  isBulk = false,
): { allowed: boolean; reason?: string } {
  if (evaluation.killSwitchEnabled) {
    return {
      allowed: false,
      reason: "Kill-switch is enabled. Queue dispatch and background jobs are paused.",
    };
  }

  if (evaluation.degradeModeActive && (isBulk || DEGRADE_BLOCKED_JOB_TYPES.has(jobType))) {
    return {
      allowed: false,
      reason:
        "Degrade mode is active (>= 90% of a tracked free-tier quota). Bulk and upload jobs are blocked; reads and manual actions remain available.",
    };
  }

  return { allowed: true };
}

export function canStageR2File(params: {
  currentStagingBytes: number;
  incomingFileBytes: number;
}): { allowed: boolean; reason?: string } {
  if (params.incomingFileBytes <= 0) {
    return { allowed: false, reason: "File size must be greater than zero bytes." };
  }

  if (params.incomingFileBytes > R2_ITEM_CAPS.maxPerFileStagingBytes) {
    return {
      allowed: false,
      reason: `File exceeds the per-file staging cap of ${R2_ITEM_CAPS.maxPerFileStagingBytes} bytes.`,
    };
  }

  const stagingCap = FREE_TIER_BUDGETS.r2_staging_bytes.hardLimit;
  if (params.currentStagingBytes + params.incomingFileBytes > stagingCap) {
    return {
      allowed: false,
      reason: `Staging upload would exceed the R2 staging cap of ${stagingCap} bytes.`,
    };
  }

  return { allowed: true };
}

export function canStoreCustomThumbnail(params: {
  currentThumbnailsBytes: number;
  incomingImageBytes: number;
}): { allowed: boolean; reason?: string } {
  if (params.incomingImageBytes <= 0) {
    return { allowed: false, reason: "Thumbnail image size must be greater than zero bytes." };
  }

  if (params.incomingImageBytes > R2_ITEM_CAPS.maxCustomThumbnailBytes) {
    return {
      allowed: false,
      reason: `Thumbnail exceeds the maximum size of ${R2_ITEM_CAPS.maxCustomThumbnailBytes} bytes.`,
    };
  }

  const thumbsCap = FREE_TIER_BUDGETS.r2_thumbnails_bytes.hardLimit;
  if (params.currentThumbnailsBytes + params.incomingImageBytes > thumbsCap) {
    return {
      allowed: false,
      reason: `Custom thumbnail would exceed the R2 thumbnail storage cap of ${thumbsCap} bytes.`,
    };
  }

  return { allowed: true };
}
