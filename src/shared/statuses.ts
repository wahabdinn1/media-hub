import { z } from "zod";

export const CANONICAL_ASSET_STATUSES = [
  "active",
  "processing",
  "blocked",
  "error",
  "removed_remote",
  "dmca",
] as const;

export const CanonicalAssetStatusSchema = z.enum(CANONICAL_ASSET_STATUSES);
export type CanonicalAssetStatus = z.infer<typeof CanonicalAssetStatusSchema>;

export const JOB_STATUSES = [
  "pending",
  "validating",
  "queued",
  "processing",
  "provider_processing",
  "verifying",
  "completed",
  "failed",
  "retry_wait",
  "unknown",
  "cancelled",
] as const;

export const JobStatusSchema = z.enum(JOB_STATUSES);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const JOB_TYPES = [
  "video.sync",
  "video.upload_url",
  "video.upload_file",
  "video.clone",
  "video.rename",
  "video.move",
  "video.delete",
  "thumbnail.update",
  "subtitle.add",
  "folder.manage",
  "asset.organize",
  "workflow.execute",
  "analytics.sync",
] as const;

export const JobTypeSchema = z.enum(JOB_TYPES);
export type JobType = z.infer<typeof JobTypeSchema>;

export const CANONICAL_ERROR_CODES = [
  "AUTH_FAILED",
  "RATE_LIMITED",
  "NOT_FOUND",
  "INVALID_INPUT",
  "UNSUPPORTED",
  "CONFLICT",
  "QUOTA_EXCEEDED",
  "PROVIDER_UNAVAILABLE",
  "TIMEOUT_UNKNOWN",
  "UNKNOWN_PROVIDER_ERROR",
] as const;

export const CanonicalErrorCodeSchema = z.enum(CANONICAL_ERROR_CODES);
export type CanonicalErrorCode = z.infer<typeof CanonicalErrorCodeSchema>;

export const CanonicalErrorSchema = z.object({
  code: CanonicalErrorCodeSchema,
  retryable: z.boolean(),
  message: z.string().min(1),
  providerCode: z.string().optional(),
  retryAfterSeconds: z.number().int().positive().optional(),
});

export type CanonicalError = z.infer<typeof CanonicalErrorSchema>;

export const SERVICE_TYPES = ["video_host"] as const;
export const ServiceTypeSchema = z.enum(SERVICE_TYPES);
export type ServiceType = z.infer<typeof ServiceTypeSchema>;
