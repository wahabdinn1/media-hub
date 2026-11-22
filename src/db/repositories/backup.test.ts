import { describe, expect, it } from "vitest";
import { drizzle, type AnyD1Database } from "drizzle-orm/d1";
import { DatabaseSync } from "node:sqlite";
import * as schema from "../schema";
import { exportSecretFreeMetadata, restoreSecretFreeMetadata } from "./backup";

function createInMemoryD1() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  const ddl = [
    `CREATE TABLE app_settings (key TEXT PRIMARY KEY NOT NULL, value_json TEXT NOT NULL, updated_at TEXT NOT NULL);`,
    `CREATE TABLE module_settings (module_key TEXT PRIMARY KEY NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, config_json TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL);`,
    `CREATE TABLE provider_connections (id TEXT PRIMARY KEY NOT NULL, service_type TEXT NOT NULL, provider_key TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', is_default INTEGER NOT NULL DEFAULT 0, auth_type TEXT NOT NULL, encrypted_credentials TEXT NOT NULL, credential_schema_version INTEGER NOT NULL DEFAULT 1, key_version INTEGER NOT NULL DEFAULT 1, metadata_json TEXT NOT NULL DEFAULT '{}', last_tested_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);`,
    `CREATE TABLE collections (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', parent_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);`,
    `CREATE TABLE assets (id TEXT PRIMARY KEY NOT NULL, asset_type TEXT NOT NULL DEFAULT 'video', title TEXT NOT NULL, canonical_status TEXT NOT NULL DEFAULT 'processing', size_bytes INTEGER, duration_seconds INTEGER, source_url_hash TEXT, checksum TEXT, metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT);`,
    `CREATE TABLE collection_assets (collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE, asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE, sort_order INTEGER NOT NULL DEFAULT 0, added_at TEXT NOT NULL);`,
    `CREATE TABLE provider_folders (id TEXT PRIMARY KEY NOT NULL, provider_connection_id TEXT NOT NULL REFERENCES provider_connections(id) ON DELETE CASCADE, external_id TEXT NOT NULL, name TEXT NOT NULL, parent_external_id TEXT, updated_at TEXT NOT NULL);`,
    `CREATE TABLE asset_locations (id TEXT PRIMARY KEY NOT NULL, asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE, provider_connection_id TEXT NOT NULL REFERENCES provider_connections(id), external_id TEXT NOT NULL, external_url TEXT, provider_metadata_json TEXT NOT NULL DEFAULT '{}', metadata_schema_version INTEGER NOT NULL DEFAULT 1, sync_state TEXT NOT NULL DEFAULT 'synced', last_seen_at TEXT, content_hash TEXT);`,
    `CREATE TABLE thumbnails (id TEXT PRIMARY KEY NOT NULL, asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE, source_type TEXT NOT NULL, r2_object_key TEXT, source_url TEXT, is_active INTEGER NOT NULL DEFAULT 0, metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);`,
    `CREATE TABLE subtitles (id TEXT PRIMARY KEY NOT NULL, asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE, provider_connection_id TEXT REFERENCES provider_connections(id), language TEXT NOT NULL, format TEXT NOT NULL, source_url TEXT NOT NULL, created_at TEXT NOT NULL);`,
    `CREATE TABLE workflows (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 1, trigger_type TEXT NOT NULL DEFAULT 'manual', steps_json TEXT NOT NULL DEFAULT '[]', last_run_at TEXT, next_run_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);`,
  ];
  for (const s of ddl) sqlite.exec(s);

  const norm = (v: unknown) => (typeof v === "boolean" ? (v ? 1 : 0) : v === undefined ? null : v);
  function prep(q: string, bound: unknown[] = []) {
    return {
      bind: (...vals: unknown[]) => prep(q, vals.map(norm)),
      all: async () => ({ results: sqlite.prepare(q).all(...(bound as never[])), success: true, meta: {} }),
      raw: async () =>
        (sqlite.prepare(q).all(...(bound as never[])) as Record<string, unknown>[]).map((r) =>
          Object.values(r),
        ),
      run: async () => {
        sqlite.prepare(q).run(...(bound as never[]));
        return { results: [], success: true, meta: {} };
      },
      first: async () => sqlite.prepare(q).get(...(bound as never[])) ?? null,
    };
  }

  return drizzle({ prepare: (q: string) => prep(q) } as unknown as AnyD1Database, { schema });
}

describe("Secret-free metadata backup & restore drill (PRD SYS-04)", () => {
  it("exports without secrets and restores cleanly into an empty database", async () => {
    const sourceDb = createInMemoryD1();
    const now = "2026-11-22T12:00:00.000Z";

    await sourceDb.insert(schema.providerConnections).values({
      id: "conn-1",
      serviceType: "video_host",
      providerKey: "vidara",
      status: "active",
      isDefault: true,
      authType: "api_key",
      encryptedCredentials: "mh_v1:1:SUPER_SECRET_CIPHERTEXT",
      credentialSchemaVersion: 1,
      keyVersion: 1,
      metadataJson: "{}",
      createdAt: now,
      updatedAt: now,
    });
    await sourceDb.insert(schema.collections).values({
      id: "col-1",
      name: "Featured",
      description: "Top videos",
      parentId: null,
      createdAt: now,
      updatedAt: now,
    });
    await sourceDb.insert(schema.assets).values({
      id: "asset-1",
      assetType: "video",
      title: "Launch Demo",
      canonicalStatus: "active",
      sizeBytes: 123456,
      durationSeconds: 95,
      metadataJson: "{}",
      createdAt: now,
      updatedAt: now,
    });
    await sourceDb.insert(schema.collectionAssets).values({
      collectionId: "col-1",
      assetId: "asset-1",
      sortOrder: 0,
      addedAt: now,
    });
    await sourceDb.insert(schema.subtitles).values({
      id: "sub-1",
      assetId: "asset-1",
      providerConnectionId: "conn-1",
      language: "en",
      format: "vtt",
      sourceUrl: "https://cdn.example.com/en.vtt",
      createdAt: now,
    });
    await sourceDb.insert(schema.workflows).values({
      id: "wf-1",
      name: "Nightly sync",
      description: "",
      enabled: true,
      triggerType: "interval_daily",
      stepsJson: '[{"id":"s1","type":"sync_provider","maxPages":2}]',
      createdAt: now,
      updatedAt: now,
    });

    const exported = await exportSecretFreeMetadata(sourceDb);
    const serialized = JSON.stringify(exported);
    expect(serialized).not.toContain("SUPER_SECRET_CIPHERTEXT");
    expect(serialized).not.toContain("encryptedCredentials");

    // Restore into a brand-new empty DB
    const targetDb = createInMemoryD1();
    const dryRunRes = await restoreSecretFreeMetadata(targetDb, exported, { dryRun: true });
    expect(dryRunRes.counts.assets).toBe(1);
    expect(await targetDb.select().from(schema.assets)).toHaveLength(0);

    const restored = await restoreSecretFreeMetadata(targetDb, exported);
    expect(restored.dryRun).toBe(false);
    expect(await targetDb.select().from(schema.assets)).toHaveLength(1);
    expect(await targetDb.select().from(schema.collections)).toHaveLength(1);
    expect(await targetDb.select().from(schema.subtitles)).toHaveLength(1);
    expect(await targetDb.select().from(schema.workflows)).toHaveLength(1);

    const restoredConns = await targetDb.select().from(schema.providerConnections);
    expect(restoredConns[0]?.status).toBe("disabled");
    expect(restoredConns[0]?.encryptedCredentials).toBe("REQUIRES_REAUTH_AFTER_RESTORE");
  });
});
