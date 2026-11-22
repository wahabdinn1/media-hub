import { NextRequest, NextResponse } from "next/server";
import { requireOwnerRequest } from "@/core";
import { getDb } from "@/db/client";
import { listAssetsPaginated } from "@/db/repositories/assets";
import { incrementUsageCounter } from "@/db/repositories/usage";
import { toApiErrorResponse } from "@/lib/api-error";

export async function GET(request: NextRequest) {
  try {
    await requireOwnerRequest(request, "asset.read");
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q") ?? undefined;
    const status = searchParams.get("status") ?? "all";
    const page = Number(searchParams.get("page") ?? "1") || 1;
    const pageSize = Number(searchParams.get("pageSize") ?? "24") || 24;

    const { db } = await getDb();
    await incrementUsageCounter(db, "worker_requests_daily", 1);
    const result = await listAssetsPaginated(db, { q, status, page, pageSize });
    return NextResponse.json(result);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
