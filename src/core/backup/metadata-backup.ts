import { z } from "zod";

export const MetadataBackupSchema = z.object({
  schemaVersion: z.literal(1),
  exportedAt: z.string().min(1),
  secretFree: z.literal(true),
  tables: z.object({
    appSettings: z.array(
      z.object({
        key: z.string(),
        valueJson: z.string(),
        updatedAt: z.string(),
      }),
    ),
    moduleSettings: z.array(
      z.object({
        moduleKey: z.string(),
        enabled: z.boolean(),
        configJson: z.string(),
        updatedAt: z.string(),
      }),
    ),
    providerConnections: z.array(
      z
        .object({
          id: z.string(),
          serviceType: z.string(),
          providerKey: z.string(),
          status: z.string(),
          isDefault: z.boolean(),
          authType: z.string(),
          metadataJson: z.string(),
          createdAt: z.string(),
          updatedAt: z.string(),
        })
        .strict(),
    ),
    collections: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        description: z.string(),
        parentId: z.string().nullable(),
        createdAt: z.string(),
        updatedAt: z.string(),
      }),
    ),
    collectionAssets: z.array(
      z.object({
        collectionId: z.string(),
        assetId: z.string(),
        sortOrder: z.number().int(),
        addedAt: z.string(),
      }),
    ),
    providerFolders: z.array(
      z.object({
        id: z.string(),
        providerConnectionId: z.string(),
        externalId: z.string(),
        name: z.string(),
        parentExternalId: z.string().nullable(),
        updatedAt: z.string(),
      }),
    ),
    assets: z.array(
      z.object({
        id: z.string(),
        assetType: z.string(),
        title: z.string(),
        canonicalStatus: z.string(),
        sizeBytes: z.number().nullable(),
        durationSeconds: z.number().nullable(),
        sourceUrlHash: z.string().nullable(),
        checksum: z.string().nullable(),
        metadataJson: z.string(),
        createdAt: z.string(),
        updatedAt: z.string(),
        deletedAt: z.string().nullable(),
      }),
    ),
    assetLocations: z.array(
      z.object({
        id: z.string(),
        assetId: z.string(),
        providerConnectionId: z.string(),
        externalId: z.string(),
        externalUrl: z.string().nullable(),
        providerMetadataJson: z.string(),
        metadataSchemaVersion: z.number().int(),
        syncState: z.string(),
        lastSeenAt: z.string().nullable(),
        contentHash: z.string().nullable(),
      }),
    ),
    thumbnails: z.array(
      z.object({
        id: z.string(),
        assetId: z.string(),
        sourceType: z.string(),
        r2ObjectKey: z.string().nullable(),
        sourceUrl: z.string().nullable(),
        isActive: z.boolean(),
        metadataJson: z.string(),
        createdAt: z.string(),
      }),
    ),
    subtitles: z.array(
      z.object({
        id: z.string(),
        assetId: z.string(),
        providerConnectionId: z.string().nullable(),
        language: z.string(),
        format: z.string(),
        sourceUrl: z.string(),
        createdAt: z.string(),
      }),
    ),
    workflows: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        description: z.string(),
        enabled: z.boolean(),
        triggerType: z.string(),
        stepsJson: z.string(),
        lastRunAt: z.string().nullable(),
        nextRunAt: z.string().nullable(),
        createdAt: z.string(),
        updatedAt: z.string(),
      }),
    ),
  }),
});

export type MetadataBackupPayload = z.infer<typeof MetadataBackupSchema>;

export function summarizeBackupCounts(backup: MetadataBackupPayload): Record<string, number> {
  return {
    appSettings: backup.tables.appSettings.length,
    moduleSettings: backup.tables.moduleSettings.length,
    providerConnections: backup.tables.providerConnections.length,
    collections: backup.tables.collections.length,
    collectionAssets: backup.tables.collectionAssets.length,
    providerFolders: backup.tables.providerFolders.length,
    assets: backup.tables.assets.length,
    assetLocations: backup.tables.assetLocations.length,
    thumbnails: backup.tables.thumbnails.length,
    subtitles: backup.tables.subtitles.length,
    workflows: backup.tables.workflows.length,
  };
}
