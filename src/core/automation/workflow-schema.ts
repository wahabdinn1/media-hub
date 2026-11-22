import { z } from "zod";

export const WorkflowTriggerTypeSchema = z.enum(["manual", "interval_hourly", "interval_daily"]);
export type WorkflowTriggerType = z.infer<typeof WorkflowTriggerTypeSchema>;

export const WorkflowStepSchema = z.discriminatedUnion("type", [
  z.object({
    id: z.string().min(1),
    type: z.literal("sync_provider"),
    maxPages: z.number().int().min(1).max(5).default(3),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("import_url"),
    url: z.string().trim().min(1).max(2048),
    title: z.string().trim().max(255).optional(),
    rightsConfirmed: z.literal(true),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("add_recent_to_collection"),
    collectionId: z.string().min(1),
    limit: z.number().int().min(1).max(50).default(10),
  }),
]);

export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;

export const CreateWorkflowInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  enabled: z.boolean().optional(),
  triggerType: WorkflowTriggerTypeSchema.default("manual"),
  steps: z.array(WorkflowStepSchema).min(1).max(10),
});

export type CreateWorkflowInput = z.infer<typeof CreateWorkflowInputSchema>;

export function computeNextWorkflowRunAt(
  triggerType: WorkflowTriggerType,
  fromDate: Date = new Date(),
): string | null {
  if (triggerType === "manual") return null;
  const deltaMs = triggerType === "interval_hourly" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  return new Date(fromDate.getTime() + deltaMs).toISOString();
}
