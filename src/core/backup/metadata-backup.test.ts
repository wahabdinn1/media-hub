import { describe, expect, it } from "vitest";
import { MetadataBackupSchema, summarizeBackupCounts } from "./metadata-backup";

describe("MetadataBackupSchema (SYS-04 secret-free export & restore validation)", () => {
  it("accepts a valid secret-free metadata backup snapshot and rejects encryptedCredentials", () => {
    const valid = MetadataBackupSchema.parse({
      schemaVersion: 1,
      exportedAt: "2026-11-22T12:00:00.000Z",
      secretFree: true,
      tables: {
        appSettings: [{ key: "locale", valueJson: '"en"', updatedAt: "2026-11-22T12:00:00.000Z" }],
        moduleSettings: [
          {
            moduleKey: "library",
            enabled: true,
            configJson: "{}",
            updatedAt: "2026-11-22T12:00:00.000Z",
          },
        ],
        providerConnections: [
          {
            id: "conn-1",
            serviceType: "video_host",
            providerKey: "vidara",
            status: "active",
            isDefault: true,
            authType: "api_key",
            metadataJson: "{}",
            createdAt: "2026-11-22T12:00:00.000Z",
            updatedAt: "2026-11-22T12:00:00.000Z",
          },
        ],
        collections: [],
        collectionAssets: [],
        providerFolders: [],
        assets: [
          {
            id: "asset-1",
            assetType: "video",
            title: "Sample",
            canonicalStatus: "active",
            sizeBytes: 1024,
            durationSeconds: 30,
            sourceUrlHash: null,
            checksum: null,
            metadataJson: "{}",
            createdAt: "2026-11-22T12:00:00.000Z",
            updatedAt: "2026-11-22T12:00:00.000Z",
            deletedAt: null,
          },
        ],
        assetLocations: [],
        thumbnails: [],
        subtitles: [],
        workflows: [],
      },
    });

    expect(summarizeBackupCounts(valid).assets).toBe(1);
    expect(JSON.stringify(valid)).not.toContain("encryptedCredentials");

    // Strict schema MUST reject any object containing encryptedCredentials
    expect(() =>
      MetadataBackupSchema.parse({
        ...valid,
        tables: {
          ...valid.tables,
          providerConnections: [
            {
              ...valid.tables.providerConnections[0],
              encryptedCredentials: "mh_v1:1:iv:ct",
            },
          ],
        },
      }),
    ).toThrow();
  });
});
