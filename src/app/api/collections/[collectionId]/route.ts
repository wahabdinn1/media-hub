import { NextRequest, NextResponse } from "next/server";
import { requireOwnerRequest } from "@/core";
import { getDb } from "@/db/client";
import { recordActivity } from "@/db/repositories/activity";
import { deleteCollection } from "@/db/repositories/collections";
import { toApiErrorResponse } from "@/lib/api-error";

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ collectionId: string }> },
) {
  try {
    const principal = await requireOwnerRequest(request, "asset.write");
    const { collectionId } = await context.params;
    const { db } = await getDb();

    await deleteCollection(db, collectionId);
    await recordActivity(db, {
      actorId: principal.actorId,
      action: "collection.deleted",
      entityType: "collection",
      entityId: collectionId,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
