import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOwnerRequest } from "@/core";
import { getDb } from "@/db/client";
import { recordActivity } from "@/db/repositories/activity";
import { createCollection, listCollections } from "@/db/repositories/collections";
import { toApiErrorResponse } from "@/lib/api-error";

const CreateCollectionSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  parentId: z.string().nullable().optional(),
});

export async function GET(request: NextRequest) {
  try {
    await requireOwnerRequest(request, "asset.read");
    const { db } = await getDb();
    const items = await listCollections(db);
    return NextResponse.json({ collections: items });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const principal = await requireOwnerRequest(request, "asset.write");
    const body = CreateCollectionSchema.parse(await request.json());
    const { db } = await getDb();
    const created = await createCollection(db, body);

    await recordActivity(db, {
      actorId: principal.actorId,
      action: "collection.created",
      entityType: "collection",
      entityId: created.id,
      context: { name: created.name },
    });

    return NextResponse.json({ collection: created }, { status: 201 });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
