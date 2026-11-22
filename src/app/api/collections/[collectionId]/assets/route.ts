import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOwnerRequest } from "@/core";
import { getDb } from "@/db/client";
import { recordActivity } from "@/db/repositories/activity";
import { addAssetsToCollection, removeAssetFromCollection } from "@/db/repositories/collections";
import { toApiErrorResponse } from "@/lib/api-error";

const AddAssetsSchema = z.object({
  assetIds: z.array(z.string().min(1)).min(1).max(200),
});

const RemoveAssetSchema = z.object({
  assetId: z.string().min(1),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ collectionId: string }> },
) {
  try {
    const principal = await requireOwnerRequest(request, "asset.write");
    const { collectionId } = await context.params;
    const body = AddAssetsSchema.parse(await request.json());
    const { db } = await getDb();

    const added = await addAssetsToCollection(db, collectionId, body.assetIds);

    await recordActivity(db, {
      actorId: principal.actorId,
      action: "collection.assets_added",
      entityType: "collection",
      entityId: collectionId,
      context: { count: added },
    });

    return NextResponse.json({ ok: true, added });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ collectionId: string }> },
) {
  try {
    const principal = await requireOwnerRequest(request, "asset.write");
    const { collectionId } = await context.params;
    const body = RemoveAssetSchema.parse(await request.json());
    const { db } = await getDb();

    await removeAssetFromCollection(db, collectionId, body.assetId);

    await recordActivity(db, {
      actorId: principal.actorId,
      action: "collection.asset_removed",
      entityType: "collection",
      entityId: collectionId,
      context: { assetId: body.assetId },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
