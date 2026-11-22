import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOwnerRequest, WorkflowStepSchema, WorkflowTriggerTypeSchema } from "@/core";
import { getDb } from "@/db/client";
import { recordActivity } from "@/db/repositories/activity";
import { deleteWorkflow, getWorkflowDetail, updateWorkflow } from "@/db/repositories/workflows";
import { toApiErrorResponse } from "@/lib/api-error";

const PatchWorkflowSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).optional(),
  enabled: z.boolean().optional(),
  triggerType: WorkflowTriggerTypeSchema.optional(),
  steps: z.array(WorkflowStepSchema).min(1).max(10).optional(),
});

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ workflowId: string }> },
) {
  try {
    await requireOwnerRequest(request, "workflow.manage");
    const { workflowId } = await context.params;
    const { db } = await getDb();
    const detail = await getWorkflowDetail(db, workflowId);
    if (!detail) {
      return NextResponse.json({ error: "Workflow not found." }, { status: 404 });
    }
    return NextResponse.json(detail);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ workflowId: string }> },
) {
  try {
    const principal = await requireOwnerRequest(request, "workflow.manage");
    const { workflowId } = await context.params;
    const body = PatchWorkflowSchema.parse(await request.json());
    const { db } = await getDb();

    const updated = await updateWorkflow(db, workflowId, body);
    if (!updated) {
      return NextResponse.json({ error: "Workflow not found." }, { status: 404 });
    }

    await recordActivity(db, {
      actorId: principal.actorId,
      action: "workflow.updated",
      entityType: "workflow",
      entityId: workflowId,
      context: { enabled: updated.enabled, triggerType: updated.triggerType },
    });

    return NextResponse.json({ workflow: updated });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ workflowId: string }> },
) {
  try {
    const principal = await requireOwnerRequest(request, "workflow.manage");
    const { workflowId } = await context.params;
    const { db } = await getDb();

    await deleteWorkflow(db, workflowId);
    await recordActivity(db, {
      actorId: principal.actorId,
      action: "workflow.deleted",
      entityType: "workflow",
      entityId: workflowId,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
