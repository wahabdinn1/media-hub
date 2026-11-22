import { NextRequest, NextResponse } from "next/server";
import { requireOwnerRequest } from "@/core";
import { getDb } from "@/db/client";
import { executeWorkflowRun } from "@/db/repositories/workflows";
import { toApiErrorResponse } from "@/lib/api-error";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ workflowId: string }> },
) {
  try {
    const principal = await requireOwnerRequest(request, "workflow.manage");
    await requireOwnerRequest(request, "job.create");
    const { workflowId } = await context.params;
    const { db } = await getDb();

    const result = await executeWorkflowRun(db, {
      workflowId,
      actorId: principal.actorId,
      triggerSource: "manual",
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
