import { and, asc, eq, sql } from "drizzle-orm";
import type { MediaHubDb } from "../client";
import { collectionAssets, collections } from "../schema";
import { incrementUsageCounter } from "./usage";

export interface CollectionView {
  id: string;
  name: string;
  description: string;
  parentId: string | null;
  assetCount: number;
  createdAt: string;
  updatedAt: string;
}

export async function listCollections(db: MediaHubDb): Promise<CollectionView[]> {
  const [cols, counts] = await Promise.all([
    db.select().from(collections).orderBy(asc(collections.name)),
    db
      .select({
        collectionId: collectionAssets.collectionId,
        count: sql<number>`count(*)`,
      })
      .from(collectionAssets)
      .groupBy(collectionAssets.collectionId),
  ]);

  const countMap = new Map(counts.map((c) => [c.collectionId, Number(c.count)]));
  return cols.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    parentId: c.parentId,
    assetCount: countMap.get(c.id) ?? 0,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  }));
}

export async function createCollection(
  db: MediaHubDb,
  input: { name: string; description?: string; parentId?: string | null },
) {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await db.insert(collections).values({
    id,
    name: input.name.trim(),
    description: (input.description ?? "").trim(),
    parentId: input.parentId ?? null,
    createdAt: now,
    updatedAt: now,
  });
  await incrementUsageCounter(db, "d1_rows_written_daily", 1);
  const rows = await db.select().from(collections).where(eq(collections.id, id)).limit(1);
  return rows[0]!;
}

export async function deleteCollection(db: MediaHubDb, collectionId: string): Promise<void> {
  await db.delete(collections).where(eq(collections.id, collectionId));
  await incrementUsageCounter(db, "d1_rows_written_daily", 1);
}

export async function addAssetsToCollection(
  db: MediaHubDb,
  collectionId: string,
  assetIds: string[],
): Promise<number> {
  const now = new Date().toISOString();
  let added = 0;
  for (let i = 0; i < assetIds.length; i += 1) {
    const assetId = assetIds[i]!;
    await db
      .insert(collectionAssets)
      .values({
        collectionId,
        assetId,
        sortOrder: i,
        addedAt: now,
      })
      .onConflictDoNothing();
    added += 1;
  }
  if (added > 0) {
    await incrementUsageCounter(db, "d1_rows_written_daily", added);
  }
  return added;
}

export async function removeAssetFromCollection(
  db: MediaHubDb,
  collectionId: string,
  assetId: string,
): Promise<void> {
  await db
    .delete(collectionAssets)
    .where(
      and(
        eq(collectionAssets.collectionId, collectionId),
        eq(collectionAssets.assetId, assetId),
      ),
    );
  await incrementUsageCounter(db, "d1_rows_written_daily", 1);
}
