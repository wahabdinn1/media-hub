import { NextRequest, NextResponse } from "next/server";
import { CreateWorkflowInputSchema, requireOwnerRequest } from "@/core";
import { getDb } from "@/db/client";
import { recordActivity } from "@/db/repositories/activity";
import { assertModuleEnabled } from "@/db/repositories/settings";
import { createWorkflow, listWorkflows } from "@/db/repositories/workflows";
import { toApiErrorResponse } from "@/lib/api-error";

export async function GET(request: NextRequest) {
  try {
    await requireOwnerRequest(request, "workflow.manage");
    const { db } = await getDb();
    const [enabled, items] = await Promise.all([
      assertModuleEnabled(db, "automation"),
      listWorkflows(db),
    ]);
    return NextResponse.json({ enabled, workflows: items });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const principal = await requireOwnerRequest(request, "workflow.manage");
    const body = CreateWorkflowInputSchema.parse(await request.json());
    const { db } = await getDb();

    if (!(await assertModuleEnabled(db, "automation"))) {
      return NextResponse.json(
        { error: "The Automation module is disabled in Settings." },
        { status: 403 },
      );
    }

    const created = await createWorkflow(db, body);
    await recordActivity(db, {
      actorId: principal.actorId,
      action: "workflow.created",
      entityType: "workflow",
      entityId: created.id,
      context: { name: created.name, triggerType: created.triggerType, steps: created.steps.length },
    });

    return NextResponse.json({ workflow: created }, { status: 201 });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
