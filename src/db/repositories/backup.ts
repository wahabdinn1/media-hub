import {
  MetadataBackupSchema,
  summarizeBackupCounts,
  type MetadataBackupPayload,
} from "@/core";
import type { MediaHubDb } from "../client";
import {
  appSettings,
  assetLocations,
  assets,
  collectionAssets,
  collections,
  moduleSettings,
  providerConnections,
  providerFolders,
  subtitles,
  thumbnails,
  workflows,
} from "../schema";

/**
 * Exports a strictly secret-free snapshot of MediaHub metadata (PRD SYS-04).
 * Encrypted credentials are NEVER included; owners re-enter credentials after a full DR restore.
 */
export async function exportSecretFreeMetadata(db: MediaHubDb): Promise<MetadataBackupPayload> {
  const [
    appRows,
    modRows,
    connRows,
    colRows,
    colAssetRows,
    folderRows,
    assetRows,
    locRows,
    thumbRows,
    subRows,
    wfRows,
  ] = await Promise.all([
    db.select().from(appSettings),
    db.select().from(moduleSettings),
    db.select().from(providerConnections),
    db.select().from(collections),
    db.select().from(collectionAssets),
    db.select().from(providerFolders),
    db.select().from(assets),
    db.select().from(assetLocations),
    db.select().from(thumbnails),
    db.select().from(subtitles),
    db.select().from(workflows),
  ]);

  const payload: MetadataBackupPayload = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    secretFree: true,
    tables: {
      appSettings: appRows,
      moduleSettings: modRows.map((m) => ({ ...m, enabled: Boolean(m.enabled) })),
      providerConnections: connRows.map((c) => ({
        id: c.id,
        serviceType: c.serviceType,
        providerKey: c.providerKey,
        status: c.status,
        isDefault: Boolean(c.isDefault),
        authType: c.authType,
        metadataJson: c.metadataJson,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      })),
      collections: colRows,
      collectionAssets: colAssetRows,
      providerFolders: folderRows,
      assets: assetRows,
      assetLocations: locRows,
      thumbnails: thumbRows.map((t) => ({ ...t, isActive: Boolean(t.isActive) })),
      subtitles: subRows,
      workflows: wfRows.map((w) => ({ ...w, enabled: Boolean(w.enabled) })),
    },
  };

  return MetadataBackupSchema.parse(payload);
}

/**
 * Idempotently restores secret-free metadata into an empty or existing database (PRD SYS-04).
 * Provider connections are restored in `disabled` status with a placeholder marker requiring re-authentication.
 */
export async function restoreSecretFreeMetadata(
  db: MediaHubDb,
  rawPayload: unknown,
  options?: { dryRun?: boolean },
): Promise<{ dryRun: boolean; counts: Record<string, number> }> {
  const backup = MetadataBackupSchema.parse(rawPayload);
  const counts = summarizeBackupCounts(backup);
  if (options?.dryRun) {
    return { dryRun: true, counts };
  }

  for (const row of backup.tables.appSettings) {
    await db
      .insert(appSettings)
      .values(row)
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { valueJson: row.valueJson, updatedAt: row.updatedAt },
      });
  }

  for (const row of backup.tables.moduleSettings) {
    await db
      .insert(moduleSettings)
      .values(row)
      .onConflictDoUpdate({
        target: moduleSettings.moduleKey,
        set: { enabled: row.enabled, configJson: row.configJson, updatedAt: row.updatedAt },
      });
  }

  // Restore provider connection skeletons as disabled until owner re-enters credentials
  for (const row of backup.tables.providerConnections) {
    await db
      .insert(providerConnections)
      .values({
        id: row.id,
        serviceType: row.serviceType,
        providerKey: row.providerKey,
        status: "disabled",
        isDefault: false,
        authType: row.authType,
        encryptedCredentials: "REQUIRES_REAUTH_AFTER_RESTORE",
        credentialSchemaVersion: 1,
        keyVersion: 0,
        metadataJson: row.metadataJson,
        lastTestedAt: null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })
      .onConflictDoNothing();
  }

  for (const row of backup.tables.collections) {
    await db.insert(collections).values(row).onConflictDoNothing();
  }

  for (const row of backup.tables.assets) {
    await db.insert(assets).values(row).onConflictDoNothing();
  }

  for (const row of backup.tables.collectionAssets) {
    await db.insert(collectionAssets).values(row).onConflictDoNothing();
  }

  for (const row of backup.tables.providerFolders) {
    await db.insert(providerFolders).values(row).onConflictDoNothing();
  }

  for (const row of backup.tables.assetLocations) {
    await db.insert(assetLocations).values(row).onConflictDoNothing();
  }

  for (const row of backup.tables.thumbnails) {
    await db.insert(thumbnails).values(row).onConflictDoNothing();
  }

  for (const row of backup.tables.subtitles) {
    await db.insert(subtitles).values(row).onConflictDoNothing();
  }

  for (const row of backup.tables.workflows) {
    await db.insert(workflows).values(row).onConflictDoNothing();
  }

  return { dryRun: false, counts };
}
