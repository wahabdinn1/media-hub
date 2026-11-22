import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Drizzle ORM schema for Cloudflare D1 aligned with PRD Section 11 (v1.1).
 * Phase 1 will generate and apply initial SQL migrations from this schema.
 */

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  valueJson: text("value_json").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const moduleSettings = sqliteTable("module_settings", {
  moduleKey: text("module_key").primaryKey(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  configJson: text("config_json").notNull().default("{}"),
  updatedAt: text("updated_at").notNull(),
});

export const providerConnections = sqliteTable(
  "provider_connections",
  {
    id: text("id").primaryKey(),
    serviceType: text("service_type").notNull(),
    providerKey: text("provider_key").notNull(),
    status: text("status").notNull().default("active"),
    isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
    authType: text("auth_type").notNull(),
    encryptedCredentials: text("encrypted_credentials").notNull(),
    credentialSchemaVersion: integer("credential_schema_version").notNull().default(1),
    keyVersion: integer("key_version").notNull().default(1),
    metadataJson: text("metadata_json").notNull().default("{}"),
    lastTestedAt: text("last_tested_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_provider_connections_single_default")
      .on(table.serviceType)
      .where(sql`${table.isDefault} = 1`),
  ],
);

export const providerCapabilities = sqliteTable("provider_capabilities", {
  connectionId: text("connection_id")
    .primaryKey()
    .references(() => providerConnections.id, { onDelete: "cascade" }),
  descriptorJson: text("descriptor_json").notNull(),
  descriptorVersion: text("descriptor_version").notNull(),
});

export const assets = sqliteTable(
  "assets",
  {
    id: text("id").primaryKey(),
    assetType: text("asset_type").notNull().default("video"),
    title: text("title").notNull(),
    canonicalStatus: text("canonical_status").notNull().default("processing"),
    sizeBytes: integer("size_bytes"),
    durationSeconds: integer("duration_seconds"),
    sourceUrlHash: text("source_url_hash"),
    checksum: text("checksum"),
    metadataJson: text("metadata_json").notNull().default("{}"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    index("idx_assets_title").on(table.title),
    index("idx_assets_status").on(table.canonicalStatus),
    index("idx_assets_created_at").on(table.createdAt),
  ],
);

export const assetLocations = sqliteTable(
  "asset_locations",
  {
    id: text("id").primaryKey(),
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    providerConnectionId: text("provider_connection_id")
      .notNull()
      .references(() => providerConnections.id),
    externalId: text("external_id").notNull(),
    externalUrl: text("external_url"),
    providerMetadataJson: text("provider_metadata_json").notNull().default("{}"),
    metadataSchemaVersion: integer("metadata_schema_version").notNull().default(1),
    syncState: text("sync_state").notNull().default("synced"),
    lastSeenAt: text("last_seen_at"),
    contentHash: text("content_hash"),
  },
  (table) => [
    uniqueIndex("idx_asset_locations_conn_ext").on(table.providerConnectionId, table.externalId),
    index("idx_asset_locations_asset").on(table.assetId),
  ],
);

export const collections = sqliteTable("collections", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  parentId: text("parent_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const collectionAssets = sqliteTable(
  "collection_assets",
  {
    collectionId: text("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull().default(0),
    addedAt: text("added_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_collection_assets_unique").on(table.collectionId, table.assetId),
    index("idx_collection_assets_asset").on(table.assetId),
  ],
);

export const providerFolders = sqliteTable(
  "provider_folders",
  {
    id: text("id").primaryKey(),
    providerConnectionId: text("provider_connection_id")
      .notNull()
      .references(() => providerConnections.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    name: text("name").notNull(),
    parentExternalId: text("parent_external_id"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_provider_folders_conn_ext").on(
      table.providerConnectionId,
      table.externalId,
    ),
  ],
);

export const thumbnails = sqliteTable(
  "thumbnails",
  {
    id: text("id").primaryKey(),
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    sourceType: text("source_type").notNull(),
    r2ObjectKey: text("r2_object_key"),
    sourceUrl: text("source_url"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(false),
    metadataJson: text("metadata_json").notNull().default("{}"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_thumbnails_one_active_per_asset")
      .on(table.assetId)
      .where(sql`${table.isActive} = 1`),
  ],
);

export const batches = sqliteTable("batches", {
  id: text("id").primaryKey(),
  operationType: text("operation_type").notNull(),
  status: text("status").notNull().default("pending"),
  totalCount: integer("total_count").notNull().default(0),
  completedCount: integer("completed_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  createdAt: text("created_at").notNull(),
});

export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    batchId: text("batch_id").references(() => batches.id),
    providerConnectionId: text("provider_connection_id").references(() => providerConnections.id),
    jobType: text("job_type").notNull(),
    status: text("status").notNull().default("pending"),
    payloadJson: text("payload_json").notNull().default("{}"),
    resultJson: text("result_json"),
    errorCode: text("error_code"),
    idempotencyKey: text("idempotency_key").notNull(),
    attempts: integer("attempts").notNull().default(0),
    nextPollAt: text("next_poll_at"),
    scheduledAt: text("scheduled_at"),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_jobs_idempotency_key").on(table.idempotencyKey),
    index("idx_jobs_status_created").on(table.status, table.createdAt),
    index("idx_jobs_batch_id").on(table.batchId),
    index("idx_jobs_next_poll_at").on(table.nextPollAt),
  ],
);

export const jobEvents = sqliteTable(
  "job_events",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    message: text("message").notNull(),
    dataJson: text("data_json").notNull().default("{}"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("idx_job_events_job_id").on(table.jobId)],
);

export const usageCounters = sqliteTable(
  "usage_counters",
  {
    day: text("day").notNull(),
    metric: text("metric").notNull(),
    value: integer("value").notNull().default(0),
  },
  (table) => [uniqueIndex("idx_usage_counters_day_metric").on(table.day, table.metric)],
);

export const activityLogs = sqliteTable(
  "activity_logs",
  {
    id: text("id").primaryKey(),
    actorId: text("actor_id").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    contextJson: text("context_json").notNull().default("{}"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("idx_activity_logs_created_at").on(table.createdAt)],
);
