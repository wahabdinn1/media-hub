import { NextRequest, NextResponse } from "next/server";
import { requireOwnerRequest } from "@/core";
import { getDb } from "@/db/client";
import { recordActivity } from "@/db/repositories/activity";
import { requeueEligibleBatchFailures } from "@/db/repositories/batches";
import { executeBoundedTick } from "@/db/repositories/tick-runner";
import { toApiErrorResponse } from "@/lib/api-error";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ batchId: string }> },
) {
  try {
    const principal = await requireOwnerRequest(request, "job.manage");
    const { batchId } = await context.params;
    const { db } = await getDb();

    const retrySummary = await requeueEligibleBatchFailures(db, batchId);
    const tick = await executeBoundedTick(db, {
      batchId,
      maxExternalCalls: 5,
    });

    await recordActivity(db, {
      actorId: principal.actorId,
      action: "bulk.batch.retried",
      entityType: "batch",
      entityId: batchId,
      context: { ...retrySummary, dispatched: tick.dispatched },
    });

    return NextResponse.json({ ...retrySummary, tick });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
