import { NextRequest, NextResponse } from "next/server";
import { requireOwnerRequest } from "@/core";
import { getDb } from "@/db/client";
import { getJobWithEvents } from "@/db/repositories/jobs";
import { toApiErrorResponse } from "@/lib/api-error";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ jobId: string }> },
) {
  try {
    await requireOwnerRequest(request, "job.manage");
    const { jobId } = await context.params;
    const { db } = await getDb();
    const data = await getJobWithEvents(db, jobId);
    if (!data) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }
    return NextResponse.json(data);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
