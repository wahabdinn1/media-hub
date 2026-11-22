import { and, desc, eq, isNull, like, sql } from "drizzle-orm";
import type {
  NormalizedProviderAsset,
  ProviderAdapter,
  ProviderCredentials,
} from "@/core";
import type { CanonicalAssetStatus } from "@/shared";
import type { MediaHubDb } from "../client";
import {
  activityLogs,
  assetLocations,
  assets,
  collectionAssets,
  collections,
  jobs,
  providerConnections,
  thumbnails,
} from "../schema";
import { incrementUsageCounter } from "./usage";
import { syncConnectionFolders } from "./folders";

export interface AssetListItem {
  id: string;
  assetType: string;
  title: string;
  canonicalStatus: CanonicalAssetStatus;
  sizeBytes: number | null;
  durationSeconds: number | null;
  createdAt: string;
  updatedAt: string;
  thumbnailUrl: string | null;
  providers: Array<{
    connectionId: string;
    providerKey: string;
    externalId: string;
    externalUrl: string | null;
    syncState: string;
  }>;
}

export interface SyncSummary {
  pagesFetched: number;
  assetsSeen: number;
  created: number;
  updated: number;
  unchanged: number;
  removedMarked: number;
  dmcaMarked: number;
  foldersSynced: number;
}

async function computeContentHash(item: NormalizedProviderAsset): Promise<string> {
  const canonical = JSON.stringify({
    title: item.title,
    canonicalStatus: item.canonicalStatus,
    externalUrl: item.externalUrl ?? null,
    thumbnailUrl: item.thumbnailUrl ?? null,
    sizeBytes: item.sizeBytes ?? null,
    durationSeconds: item.durationSeconds ?? null,
    folderExternalId: item.folderExternalId ?? null,
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest))
    .slice(0, 12)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Idempotent write-on-change provider sync (PRD VID-03, 11.1, TC-15).
 * Only writes rows whose content_hash changed to stay within Cloudflare D1 free daily writes.
 */
export async function syncProviderCatalog(
  db: MediaHubDb,
  params: {
    connectionId: string;
    adapter: ProviderAdapter;
    credentials: ProviderCredentials;
    maxPages?: number;
  },
): Promise<SyncSummary> {
  const maxPages = Math.min(params.maxPages ?? 5, 10);
  const maxPageSize = params.adapter.meta.capabilities.pagination.maxPageSize;
  const now = new Date().toISOString();

  const summary: SyncSummary = {
    pagesFetched: 0,
    assetsSeen: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    removedMarked: 0,
    dmcaMarked: 0,
    foldersSynced: 0,
  };

  let nextPage: number | undefined = 1;
  let nextCursor: string | undefined;
  let writesCount = 0;

  while (summary.pagesFetched < maxPages && (nextPage !== undefined || nextCursor !== undefined)) {
    const pageResult = await params.adapter.listAssets(params.credentials, {
      page: nextPage,
      cursor: nextCursor,
      limit: maxPageSize,
    });
    summary.pagesFetched += 1;

    for (const item of pageResult.items) {
      if (!item.externalId) continue;
      summary.assetsSeen += 1;
      const contentHash = await computeContentHash(item);

      const existingLocs = await db
        .select()
        .from(assetLocations)
        .where(
          and(
            eq(assetLocations.providerConnectionId, params.connectionId),
            eq(assetLocations.externalId, item.externalId),
          ),
        )
        .limit(1);

      const existingLoc = existingLocs[0];
      if (existingLoc) {
        if (existingLoc.contentHash === contentHash) {
          summary.unchanged += 1;
          continue;
        }

        await db
          .update(assets)
          .set({
            title: item.title,
            canonicalStatus: item.canonicalStatus,
            sizeBytes: item.sizeBytes ?? null,
            durationSeconds: item.durationSeconds ?? null,
            updatedAt: now,
          })
          .where(eq(assets.id, existingLoc.assetId));

        await db
          .update(assetLocations)
          .set({
            externalUrl: item.externalUrl ?? null,
            providerMetadataJson: JSON.stringify(item.providerMetadata),
            metadataSchemaVersion: item.metadataSchemaVersion,
            syncState: "synced",
            lastSeenAt: now,
            contentHash,
          })
          .where(eq(assetLocations.id, existingLoc.id));

        if (item.thumbnailUrl) {
          await upsertNativeThumbnail(db, existingLoc.assetId, item.thumbnailUrl, now);
          writesCount += 1;
        }

        summary.updated += 1;
        writesCount += 2;
      } else {
        const assetId = crypto.randomUUID();
        await db.insert(assets).values({
          id: assetId,
          assetType: "video",
          title: item.title,
          canonicalStatus: item.canonicalStatus,
          sizeBytes: item.sizeBytes ?? null,
          durationSeconds: item.durationSeconds ?? null,
          metadataJson: "{}",
          createdAt: item.createdAt && !Number.isNaN(Date.parse(item.createdAt))
            ? new Date(item.createdAt).toISOString()
            : now,
          updatedAt: now,
        });

        await db.insert(assetLocations).values({
          id: crypto.randomUUID(),
          assetId,
          providerConnectionId: params.connectionId,
          externalId: item.externalId,
          externalUrl: item.externalUrl ?? null,
          providerMetadataJson: JSON.stringify(item.providerMetadata),
          metadataSchemaVersion: item.metadataSchemaVersion,
          syncState: "synced",
          lastSeenAt: now,
          contentHash,
        });

        if (item.thumbnailUrl) {
          await upsertNativeThumbnail(db, assetId, item.thumbnailUrl, now);
          writesCount += 1;
        }

        summary.created += 1;
        writesCount += 2;
      }
    }

    nextPage = pageResult.nextPage;
    nextCursor = pageResult.nextCursor;
  }

  // Mark removed_remote without deleting local assets (PRD VID-07, TC-15)
  if (params.adapter.meta.capabilities.removedList && params.adapter.listRemoved) {
    try {
      const removed = await params.adapter.listRemoved(params.credentials, 100);
      for (const rem of removed) {
        if (!rem.externalId) continue;
        const locs = await db
          .select()
          .from(assetLocations)
          .where(
            and(
              eq(assetLocations.providerConnectionId, params.connectionId),
              eq(assetLocations.externalId, rem.externalId),
            ),
          )
          .limit(1);
        if (locs[0]) {
          await db
            .update(assets)
            .set({ canonicalStatus: "removed_remote", updatedAt: now })
            .where(eq(assets.id, locs[0].assetId));
          await db
            .update(assetLocations)
            .set({ syncState: "removed_remote" })
            .where(eq(assetLocations.id, locs[0].id));
          summary.removedMarked += 1;
          writesCount += 2;
        }
      }
    } catch {
      // Non-fatal: removed list check should not fail main sync
    }
  }

  // Mark DMCA flags (PRD VID-08)
  if (params.adapter.meta.capabilities.copyrightFlags && params.adapter.listFlagged) {
    try {
      const flagged = await params.adapter.listFlagged(params.credentials);
      for (const flag of flagged) {
        if (!flag.externalId) continue;
        const locs = await db
          .select()
          .from(assetLocations)
          .where(
            and(
              eq(assetLocations.providerConnectionId, params.connectionId),
              eq(assetLocations.externalId, flag.externalId),
            ),
          )
          .limit(1);
        if (locs[0]) {
          await db
            .update(assets)
            .set({ canonicalStatus: "dmca", updatedAt: now })
            .where(eq(assets.id, locs[0].assetId));
          summary.dmcaMarked += 1;
          writesCount += 1;
        }
      }
    } catch {
      // Non-fatal
    }
  }

  // Sync provider folders when adapter declares folder support (PRD VID-09)
  if (params.adapter.meta.capabilities.folders !== "none" && params.adapter.listFolders) {
    try {
      const remoteFolders = await params.adapter.listFolders(params.credentials);
      const folderRes = await syncConnectionFolders(db, params.connectionId, remoteFolders);
      summary.foldersSynced = folderRes.synced;
      writesCount += folderRes.writes;
    } catch {
      // Non-fatal: folder sync should not fail asset sync
    }
  }

  if (writesCount > 0) {
    await incrementUsageCounter(db, "d1_rows_written_daily", writesCount);
  }

  return summary;
}

async function upsertNativeThumbnail(
  db: MediaHubDb,
  assetId: string,
  sourceUrl: string,
  now: string,
): Promise<void> {
  const existing = await db
    .select()
    .from(thumbnails)
    .where(and(eq(thumbnails.assetId, assetId), eq(thumbnails.sourceType, "native")))
    .limit(1);

  if (existing[0]) {
    if (existing[0].sourceUrl !== sourceUrl) {
      await db
        .update(thumbnails)
        .set({ sourceUrl })
        .where(eq(thumbnails.id, existing[0].id));
    }
    return;
  }

  const activeAny = await db
    .select()
    .from(thumbnails)
    .where(and(eq(thumbnails.assetId, assetId), eq(thumbnails.isActive, true)))
    .limit(1);

  await db.insert(thumbnails).values({
    id: crypto.randomUUID(),
    assetId,
    sourceType: "native",
    sourceUrl,
    isActive: !activeAny[0],
    metadataJson: "{}",
    createdAt: now,
  });
}

export async function registerImportedAsset(
  db: MediaHubDb,
  params: {
    connectionId: string;
    externalId: string;
    title: string;
    canonicalStatus: CanonicalAssetStatus;
    sizeBytes?: number;
    sourceUrlHash?: string | null;
    providerMetadata: Record<string, unknown>;
  },
): Promise<{ assetId: string; locationId: string }> {
  const now = new Date().toISOString();

  const existing = await db
    .select()
    .from(assetLocations)
    .where(
      and(
        eq(assetLocations.providerConnectionId, params.connectionId),
        eq(assetLocations.externalId, params.externalId),
      ),
    )
    .limit(1);

  if (existing[0]) {
    return { assetId: existing[0].assetId, locationId: existing[0].id };
  }

  const assetId = crypto.randomUUID();
  const locationId = crypto.randomUUID();

  await db.insert(assets).values({
    id: assetId,
    assetType: "video",
    title: params.title,
    canonicalStatus: params.canonicalStatus,
    sizeBytes: params.sizeBytes ?? null,
    sourceUrlHash: params.sourceUrlHash ?? null,
    metadataJson: "{}",
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(assetLocations).values({
    id: locationId,
    assetId,
    providerConnectionId: params.connectionId,
    externalId: params.externalId,
    providerMetadataJson: JSON.stringify(params.providerMetadata),
    metadataSchemaVersion: 1,
    syncState: "synced",
    lastSeenAt: now,
  });

  await incrementUsageCounter(db, "d1_rows_written_daily", 2);
  return { assetId, locationId };
}

export async function listAssetsPaginated(
  db: MediaHubDb,
  query: {
    q?: string;
    status?: string;
    collectionId?: string;
    page?: number;
    pageSize?: number;
  },
): Promise<{ items: AssetListItem[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, query.pageSize ?? 24));
  const conditions = [isNull(assets.deletedAt)];

  if (query.status && query.status !== "all") {
    conditions.push(eq(assets.canonicalStatus, query.status));
  }
  if (query.q && query.q.trim() !== "") {
    conditions.push(like(assets.title, `%${query.q.trim()}%`));
  }
  if (query.collectionId && query.collectionId.trim() !== "") {
    conditions.push(
      sql`${assets.id} IN (SELECT ${collectionAssets.assetId} FROM ${collectionAssets} WHERE ${collectionAssets.collectionId} = ${query.collectionId.trim()})`,
    );
  }

  const whereClause = and(...conditions);
  const countRows = await db
    .select({ count: sql<number>`count(*)` })
    .from(assets)
    .where(whereClause);
  const total = Number(countRows[0]?.count ?? 0);

  const assetRows = await db
    .select()
    .from(assets)
    .where(whereClause)
    .orderBy(desc(assets.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  if (assetRows.length === 0) {
    return { items: [], total, page, pageSize };
  }

  const assetIds = assetRows.map((a) => a.id);
  const allConns = await db.select().from(providerConnections);
  const connKeyMap = new Map(allConns.map((c) => [c.id, c.providerKey]));

  const locRows = await db
    .select()
    .from(assetLocations)
    .where(sql`${assetLocations.assetId} IN (${sql.join(assetIds.map((id) => sql`${id}`), sql`, `)})`);

  const thumbRows = await db
    .select()
    .from(thumbnails)
    .where(
      and(
        eq(thumbnails.isActive, true),
        sql`${thumbnails.assetId} IN (${sql.join(assetIds.map((id) => sql`${id}`), sql`, `)})`,
      ),
    );
  const thumbMap = new Map(thumbRows.map((t) => [t.assetId, t.sourceUrl]));

  const items: AssetListItem[] = assetRows.map((row) => ({
    id: row.id,
    assetType: row.assetType,
    title: row.title,
    canonicalStatus: row.canonicalStatus as CanonicalAssetStatus,
    sizeBytes: row.sizeBytes,
    durationSeconds: row.durationSeconds,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    thumbnailUrl: thumbMap.get(row.id) ?? null,
    providers: locRows
      .filter((l) => l.assetId === row.id)
      .map((l) => ({
        connectionId: l.providerConnectionId,
        providerKey: connKeyMap.get(l.providerConnectionId) ?? "unknown",
        externalId: l.externalId,
        externalUrl: l.externalUrl,
        syncState: l.syncState,
      })),
  }));

  return { items, total, page, pageSize };
}

export async function getAssetDetail(db: MediaHubDb, assetId: string) {
  const rows = await db
    .select()
    .from(assets)
    .where(and(eq(assets.id, assetId), isNull(assets.deletedAt)))
    .limit(1);
  if (!rows[0]) return null;

  const [locs, thumbs, conns, relatedActivity, relatedJobs, memberCols] = await Promise.all([
    db.select().from(assetLocations).where(eq(assetLocations.assetId, assetId)),
    db.select().from(thumbnails).where(eq(thumbnails.assetId, assetId)).orderBy(desc(thumbnails.createdAt)),
    db.select().from(providerConnections),
    db
      .select()
      .from(activityLogs)
      .where(eq(activityLogs.entityId, assetId))
      .orderBy(desc(activityLogs.createdAt))
      .limit(30),
    db.select().from(jobs).orderBy(desc(jobs.createdAt)).limit(20),
    db
      .select({
        id: collections.id,
        name: collections.name,
      })
      .from(collectionAssets)
      .innerJoin(collections, eq(collectionAssets.collectionId, collections.id))
      .where(eq(collectionAssets.assetId, assetId)),
  ]);

  const connMap = new Map(conns.map((c) => [c.id, c]));

  return {
    asset: rows[0],
    collections: memberCols,
    locations: locs.map((loc) => {
      const conn = connMap.get(loc.providerConnectionId);
      let parsedMeta: Record<string, unknown> = {};
      try {
        parsedMeta = JSON.parse(loc.providerMetadataJson) as Record<string, unknown>;
      } catch {
        parsedMeta = {};
      }
      return {
        id: loc.id,
        providerConnectionId: loc.providerConnectionId,
        providerKey: conn?.providerKey ?? "unknown",
        connectionStatus: conn?.status ?? "disabled",
        isDefaultConnection: conn?.isDefault ?? false,
        externalId: loc.externalId,
        externalUrl: loc.externalUrl,
        syncState: loc.syncState,
        lastSeenAt: loc.lastSeenAt,
        metadataSchemaVersion: loc.metadataSchemaVersion,
        providerMetadata: parsedMeta,
      };
    }),
    thumbnails: thumbs,
    history: relatedActivity,
    relatedJobs: relatedJobs.filter((j) => (j.resultJson ?? "").includes(assetId) || j.payloadJson.includes(assetId)),
  };
}
