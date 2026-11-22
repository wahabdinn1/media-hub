import { NextRequest, NextResponse } from "next/server";
import { requireOwnerRequest } from "@/core";
import { getDb } from "@/db/client";
import { getAssetDetail } from "@/db/repositories/assets";
import { toApiErrorResponse } from "@/lib/api-error";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ assetId: string }> },
) {
  try {
    await requireOwnerRequest(request, "asset.read");
    const { assetId } = await context.params;
    const { db } = await getDb();
    const detail = await getAssetDetail(db, assetId);
    if (!detail) {
      return NextResponse.json({ error: "Asset not found." }, { status: 404 });
    }
    return NextResponse.json(detail);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
