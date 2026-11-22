import { NextRequest, NextResponse } from "next/server";
import { requireOwnerRequest } from "@/core";
import { getDb } from "@/db/client";
import { executeBoundedTick } from "@/db/repositories/tick-runner";
import { toApiErrorResponse } from "@/lib/api-error";

export async function POST(request: NextRequest) {
  try {
    await requireOwnerRequest(request, "job.manage");
    const { searchParams } = new URL(request.url);
    const batchId = searchParams.get("batchId") ?? undefined;
    const { db } = await getDb();

    const report = await executeBoundedTick(db, {
      batchId,
      maxExternalCalls: 10,
      includePrune: false,
    });
    return NextResponse.json({ ok: true, report });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
