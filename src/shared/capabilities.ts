import { z } from "zod";

export const IdempotencyModeSchema = z.enum(["none", "key", "lookup"]);
export const ReconciliationStrategySchema = z.enum(["lookup", "diff", "none"]);
export const InputModeSchema = z.enum(["url", "file", "both", "none"]);
export const PaginationStyleSchema = z.enum(["page", "cursor"]);
export const FolderShapeSchema = z.enum(["none", "flat", "tree"]);
export const DeleteSemanticsModeSchema = z.enum(["soft", "hard", "none"]);

export const CapabilityDescriptorSchema = z.object({
  version: z.string().min(1),
  idempotency: IdempotencyModeSchema,
  reconciliation: ReconciliationStrategySchema,
  uploadInput: InputModeSchema,
  thumbnailInput: InputModeSchema,
  pagination: z.object({
    style: PaginationStyleSchema,
    maxPageSize: z.number().int().positive(),
  }),
  listFilters: z.object({
    title: z.boolean(),
    folder: z.boolean(),
    status: z.boolean(),
    updatedSince: z.boolean(),
  }),
  folders: FolderShapeSchema,
  deleteSemantics: z.object({
    mode: DeleteSemanticsModeSchema,
    restorable: z.boolean(),
  }),
  clone: z.boolean(),
  rename: z.boolean(),
  asyncProcessing: z.boolean(),
  removedList: z.boolean(),
  copyrightFlags: z.boolean(),
  stats: z.boolean(),
  subtitles: z.boolean(),
  rateLimit: z.object({
    requestsPerWindow: z.number().int().positive(),
    windowSeconds: z.number().int().positive(),
    burst: z.number().int().positive(),
  }),
  limits: z.object({
    maxFileSizeBytes: z.number().int().positive().nullable(),
    acceptedMimeTypes: z.array(z.string().min(1)),
    maxTitleLength: z.number().int().positive().nullable(),
  }),
});

export type CapabilityDescriptor = z.infer<typeof CapabilityDescriptorSchema>;

export type CapabilityFlag =
  | "upload.url"
  | "upload.file"
  | "thumbnail.url"
  | "thumbnail.file"
  | "folders"
  | "clone"
  | "rename"
  | "delete"
  | "asyncProcessing"
  | "removedList"
  | "copyrightFlags"
  | "stats"
  | "subtitles";

export function hasCapability(
  descriptor: CapabilityDescriptor,
  capability: CapabilityFlag,
): boolean {
  switch (capability) {
    case "upload.url":
      return descriptor.uploadInput === "url" || descriptor.uploadInput === "both";
    case "upload.file":
      return descriptor.uploadInput === "file" || descriptor.uploadInput === "both";
    case "thumbnail.url":
      return descriptor.thumbnailInput === "url" || descriptor.thumbnailInput === "both";
    case "thumbnail.file":
      return descriptor.thumbnailInput === "file" || descriptor.thumbnailInput === "both";
    case "folders":
      return descriptor.folders !== "none";
    case "clone":
      return descriptor.clone;
    case "rename":
      return descriptor.rename;
    case "delete":
      return descriptor.deleteSemantics.mode !== "none";
    case "asyncProcessing":
      return descriptor.asyncProcessing;
    case "removedList":
      return descriptor.removedList;
    case "copyrightFlags":
      return descriptor.copyrightFlags;
    case "stats":
      return descriptor.stats;
    case "subtitles":
      return descriptor.subtitles;
  }
}
