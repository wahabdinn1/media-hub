import { and, asc, eq } from "drizzle-orm";
import type { ProviderFolder } from "@/core";
import type { MediaHubDb } from "../client";
import { providerConnections, providerFolders } from "../schema";

export interface ProviderFolderView {
  id: string;
  providerConnectionId: string;
  providerKey: string;
  externalId: string;
  name: string;
  parentExternalId: string | null;
  updatedAt: string;
}

export async function syncConnectionFolders(
  db: MediaHubDb,
  connectionId: string,
  remoteFolders: ProviderFolder[],
): Promise<{ synced: number; writes: number }> {
  const now = new Date().toISOString();
  const existing = await db
    .select()
    .from(providerFolders)
    .where(eq(providerFolders.providerConnectionId, connectionId));

  const existingByExt = new Map(existing.map((f) => [f.externalId, f]));
  const seenExtIds = new Set<string>();
  let writes = 0;

  for (const folder of remoteFolders) {
    if (!folder.externalId) continue;
    seenExtIds.add(folder.externalId);
    const prev = existingByExt.get(folder.externalId);
    if (!prev) {
      await db.insert(providerFolders).values({
        id: crypto.randomUUID(),
        providerConnectionId: connectionId,
        externalId: folder.externalId,
        name: folder.name,
        parentExternalId: folder.parentExternalId,
        updatedAt: now,
      });
      writes += 1;
    } else if (prev.name !== folder.name || prev.parentExternalId !== folder.parentExternalId) {
      await db
        .update(providerFolders)
        .set({
          name: folder.name,
          parentExternalId: folder.parentExternalId,
          updatedAt: now,
        })
        .where(eq(providerFolders.id, prev.id));
      writes += 1;
    }
  }

  for (const prev of existing) {
    if (!seenExtIds.has(prev.externalId)) {
      await db.delete(providerFolders).where(eq(providerFolders.id, prev.id));
      writes += 1;
    }
  }

  return { synced: seenExtIds.size, writes };
}

export async function listProviderFolders(db: MediaHubDb): Promise<ProviderFolderView[]> {
  const [folders, conns] = await Promise.all([
    db.select().from(providerFolders).orderBy(asc(providerFolders.name)),
    db.select().from(providerConnections),
  ]);
  const connMap = new Map(conns.map((c) => [c.id, c.providerKey]));

  return folders.map((f) => ({
    id: f.id,
    providerConnectionId: f.providerConnectionId,
    providerKey: connMap.get(f.providerConnectionId) ?? "unknown",
    externalId: f.externalId,
    name: f.name,
    parentExternalId: f.parentExternalId,
    updatedAt: f.updatedAt,
  }));
}

export async function getProviderFolderById(db: MediaHubDb, folderId: string) {
  const rows = await db
    .select()
    .from(providerFolders)
    .where(eq(providerFolders.id, folderId))
    .limit(1);
  return rows[0] ?? null;
}

export async function insertProviderFolder(
  db: MediaHubDb,
  params: {
    providerConnectionId: string;
    externalId: string;
    name: string;
    parentExternalId?: string | null;
  },
) {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await db.insert(providerFolders).values({
    id,
    providerConnectionId: params.providerConnectionId,
    externalId: params.externalId,
    name: params.name,
    parentExternalId: params.parentExternalId ?? null,
    updatedAt: now,
  });
  return getProviderFolderById(db, id);
}

export async function renameLocalProviderFolder(
  db: MediaHubDb,
  folderId: string,
  name: string,
): Promise<void> {
  await db
    .update(providerFolders)
    .set({ name, updatedAt: new Date().toISOString() })
    .where(eq(providerFolders.id, folderId));
}

export async function deleteLocalProviderFolder(
  db: MediaHubDb,
  folderId: string,
  connectionId: string,
): Promise<void> {
  await db
    .delete(providerFolders)
    .where(
      and(
        eq(providerFolders.id, folderId),
        eq(providerFolders.providerConnectionId, connectionId),
      ),
    );
}
