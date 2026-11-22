import { NextRequest, NextResponse } from "next/server";
import { requireOwnerRequest } from "@/core";
import { getDb } from "@/db/client";
import { listActivityPaginated, listJobsPaginated } from "@/db/repositories/jobs";
import { toApiErrorResponse } from "@/lib/api-error";

export async function GET(request: NextRequest) {
  try {
    await requireOwnerRequest(request, "job.manage");
    const { searchParams } = new URL(request.url);
    const tab = searchParams.get("tab") ?? "jobs";
    const status = searchParams.get("status") ?? "all";
    const jobType = searchParams.get("jobType") ?? "all";
    const page = Number(searchParams.get("page") ?? "1") || 1;
    const pageSize = Number(searchParams.get("pageSize") ?? "25") || 25;

    const { db } = await getDb();
    if (tab === "activity") {
      const activity = await listActivityPaginated(db, { page, pageSize });
      return NextResponse.json({ tab: "activity", ...activity });
    }

    const jobsList = await listJobsPaginated(db, { status, jobType, page, pageSize });
    return NextResponse.json({ tab: "jobs", ...jobsList });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
