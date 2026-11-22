import { drizzle, type AnyD1Database, type DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "./schema";

export type MediaHubDb = DrizzleD1Database<typeof schema>;
export type DbRuntimeMode = "cloudflare-d1" | "cloudflare-d1-http" | "local-sqlite";

interface LocalD1Meta {
  duration: number;
  size_after: number;
  rows_read: number;
  rows_written: number;
  last_row_id: number;
  changed_db: boolean;
  changes: number;
}

interface LocalD1Result<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta: LocalD1Meta;
}

interface LocalD1PreparedStatement {
  bind(...values: unknown[]): LocalD1PreparedStatement;
  first<T = Record<string, unknown>>(colName?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<LocalD1Result<T>>;
  raw<T = unknown[]>(): Promise<T[]>;
  run(): Promise<LocalD1Result<Record<string, unknown>>>;
}

const BOOTSTRAP_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY NOT NULL,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS module_settings (
    module_key TEXT PRIMARY KEY NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    config_json TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS provider_connections (
    id TEXT PRIMARY KEY NOT NULL,
    service_type TEXT NOT NULL,
    provider_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    is_default INTEGER NOT NULL DEFAULT 0,
    auth_type TEXT NOT NULL,
    encrypted_credentials TEXT NOT NULL,
    credential_schema_version INTEGER NOT NULL DEFAULT 1,
    key_version INTEGER NOT NULL DEFAULT 1,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    last_tested_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_connections_single_default
    ON provider_connections (service_type) WHERE is_default = 1;`,
  `CREATE TABLE IF NOT EXISTS provider_capabilities (
    connection_id TEXT PRIMARY KEY NOT NULL REFERENCES provider_connections(id) ON DELETE CASCADE,
    descriptor_json TEXT NOT NULL,
    descriptor_version TEXT NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY NOT NULL,
    asset_type TEXT NOT NULL DEFAULT 'video',
    title TEXT NOT NULL,
    canonical_status TEXT NOT NULL DEFAULT 'processing',
    size_bytes INTEGER,
    duration_seconds INTEGER,
    source_url_hash TEXT,
    checksum TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );`,
  `CREATE INDEX IF NOT EXISTS idx_assets_title ON assets (title);`,
  `CREATE INDEX IF NOT EXISTS idx_assets_status ON assets (canonical_status);`,
  `CREATE INDEX IF NOT EXISTS idx_assets_created_at ON assets (created_at);`,
  `CREATE TABLE IF NOT EXISTS asset_locations (
    id TEXT PRIMARY KEY NOT NULL,
    asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    provider_connection_id TEXT NOT NULL REFERENCES provider_connections(id),
    external_id TEXT NOT NULL,
    external_url TEXT,
    provider_metadata_json TEXT NOT NULL DEFAULT '{}',
    metadata_schema_version INTEGER NOT NULL DEFAULT 1,
    sync_state TEXT NOT NULL DEFAULT 'synced',
    last_seen_at TEXT,
    content_hash TEXT
  );`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_asset_locations_conn_ext
    ON asset_locations (provider_connection_id, external_id);`,
  `CREATE INDEX IF NOT EXISTS idx_asset_locations_asset ON asset_locations (asset_id);`,
  `CREATE TABLE IF NOT EXISTS collections (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    parent_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS collection_assets (
    collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    added_at TEXT NOT NULL
  );`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_collection_assets_unique
    ON collection_assets (collection_id, asset_id);`,
  `CREATE INDEX IF NOT EXISTS idx_collection_assets_asset
    ON collection_assets (asset_id);`,
  `CREATE TABLE IF NOT EXISTS provider_folders (
    id TEXT PRIMARY KEY NOT NULL,
    provider_connection_id TEXT NOT NULL REFERENCES provider_connections(id) ON DELETE CASCADE,
    external_id TEXT NOT NULL,
    name TEXT NOT NULL,
    parent_external_id TEXT,
    updated_at TEXT NOT NULL
  );`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_folders_conn_ext
    ON provider_folders (provider_connection_id, external_id);`,
  `CREATE TABLE IF NOT EXISTS thumbnails (
    id TEXT PRIMARY KEY NOT NULL,
    asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    source_type TEXT NOT NULL,
    r2_object_key TEXT,
    source_url TEXT,
    is_active INTEGER NOT NULL DEFAULT 0,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_thumbnails_one_active_per_asset
    ON thumbnails (asset_id) WHERE is_active = 1;`,
  `CREATE TABLE IF NOT EXISTS batches (
    id TEXT PRIMARY KEY NOT NULL,
    operation_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    total_count INTEGER NOT NULL DEFAULT 0,
    completed_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY NOT NULL,
    batch_id TEXT REFERENCES batches(id),
    provider_connection_id TEXT REFERENCES provider_connections(id),
    job_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    payload_json TEXT NOT NULL DEFAULT '{}',
    result_json TEXT,
    error_code TEXT,
    idempotency_key TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_poll_at TEXT,
    scheduled_at TEXT,
    started_at TEXT,
    finished_at TEXT,
    created_at TEXT NOT NULL
  );`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_idempotency_key ON jobs (idempotency_key);`,
  `CREATE INDEX IF NOT EXISTS idx_jobs_status_created ON jobs (status, created_at);`,
  `CREATE INDEX IF NOT EXISTS idx_jobs_batch_id ON jobs (batch_id);`,
  `CREATE INDEX IF NOT EXISTS idx_jobs_next_poll_at ON jobs (next_poll_at);`,
  `CREATE TABLE IF NOT EXISTS job_events (
    id TEXT PRIMARY KEY NOT NULL,
    job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    message TEXT NOT NULL,
    data_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );`,
  `CREATE INDEX IF NOT EXISTS idx_job_events_job_id ON job_events (job_id);`,
  `CREATE TABLE IF NOT EXISTS usage_counters (
    day TEXT NOT NULL,
    metric TEXT NOT NULL,
    value INTEGER NOT NULL DEFAULT 0
  );`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_counters_day_metric
    ON usage_counters (day, metric);`,
  `CREATE TABLE IF NOT EXISTS activity_logs (
    id TEXT PRIMARY KEY NOT NULL,
    actor_id TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    context_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );`,
  `CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs (created_at);`,
  `CREATE TABLE IF NOT EXISTS subtitles (
    id TEXT PRIMARY KEY NOT NULL,
    asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    provider_connection_id TEXT REFERENCES provider_connections(id),
    language TEXT NOT NULL,
    format TEXT NOT NULL,
    source_url TEXT NOT NULL,
    created_at TEXT NOT NULL
  );`,
  `CREATE INDEX IF NOT EXISTS idx_subtitles_asset_id ON subtitles (asset_id);`,
  `CREATE TABLE IF NOT EXISTS workflows (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    trigger_type TEXT NOT NULL DEFAULT 'manual',
    steps_json TEXT NOT NULL DEFAULT '[]',
    last_run_at TEXT,
    next_run_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS workflow_runs (
    id TEXT PRIMARY KEY NOT NULL,
    workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'running',
    trigger_source TEXT NOT NULL DEFAULT 'manual',
    step_results_json TEXT NOT NULL DEFAULT '[]',
    error_message TEXT,
    started_at TEXT NOT NULL,
    finished_at TEXT
  );`,
  `CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow_started ON workflow_runs (workflow_id, started_at);`,
];

const EMPTY_META: LocalD1Meta = {
  duration: 0,
  size_after: 0,
  rows_read: 0,
  rows_written: 0,
  last_row_id: 0,
  changed_db: false,
  changes: 0,
};

function normalizeParam(v: unknown): unknown {
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v === undefined) return null;
  return v;
}

/**
 * Cloudflare D1 HTTP API adapter for Hybrid Vercel + Cloudflare deployments.
 * Lets Vercel Serverless Functions run the exact same Drizzle D1 queries against remote Cloudflare D1.
 */
export function createD1HttpClient(
  config:
    | { accountId: string; databaseId: string; token: string }
    | { gatewayUrl: string; token: string },
  fetchImpl: typeof fetch = fetch,
): AnyD1Database {
  const baseUrl =
    "gatewayUrl" in config
      ? config.gatewayUrl.replace(/\/+$/, "")
      : `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/d1/database/${config.databaseId}`;

  async function executeHttp<T>(
    endpoint: "query" | "raw",
    sql: string,
    params: unknown[],
  ): Promise<{ results: T[]; meta: LocalD1Meta }> {
    const res = await fetchImpl(`${baseUrl}/${endpoint}`, {
      method: "POST",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql, params }),
      signal: AbortSignal.timeout(15_000),
    });

    const envelope = (await res.json()) as {
      success: boolean;
      errors?: Array<{ message: string }>;
      result?: Array<{
        success: boolean;
        results?: T[] | { columns?: string[]; rows?: T[] };
        meta?: Partial<LocalD1Meta>;
      }>;
    };

    if (!res.ok || !envelope.success) {
      const errMsg = envelope.errors?.map((e) => e.message).join("; ") || `HTTP ${res.status}`;
      throw new Error(`Cloudflare D1 HTTP error: ${errMsg}`);
    }

    const first = envelope.result?.[0];
    const rawResults = first?.results;
    const results = Array.isArray(rawResults)
      ? rawResults
      : rawResults && typeof rawResults === "object" && Array.isArray(rawResults.rows)
        ? rawResults.rows
        : [];

    return {
      results,
      meta: { ...EMPTY_META, ...(first?.meta ?? {}) },
    };
  }

  function makePrepared(sql: string, boundValues: unknown[] = []): LocalD1PreparedStatement {
    return {
      bind(...values: unknown[]) {
        return makePrepared(sql, values.map(normalizeParam));
      },
      async first<T = Record<string, unknown>>(colName?: string): Promise<T | null> {
        const { results } = await executeHttp<Record<string, unknown>>("query", sql, boundValues);
        const row = results[0];
        if (!row) return null;
        if (colName) return (row[colName] as T) ?? null;
        return row as T;
      },
      async all<T = Record<string, unknown>>(): Promise<LocalD1Result<T>> {
        const { results, meta } = await executeHttp<T>("query", sql, boundValues);
        return { results, success: true, meta };
      },
      async raw<T = unknown[]>(): Promise<T[]> {
        const { results } = await executeHttp<T>("raw", sql, boundValues);
        return results;
      },
      async run(): Promise<LocalD1Result<Record<string, unknown>>> {
        const { meta } = await executeHttp<Record<string, unknown>>("query", sql, boundValues);
        return { results: [], success: true, meta };
      },
    };
  }

  const client = {
    prepare(sql: string) {
      return makePrepared(sql);
    },
    async batch<T = unknown>(statements: LocalD1PreparedStatement[]): Promise<LocalD1Result<T>[]> {
      const out: LocalD1Result<T>[] = [];
      for (const stmt of statements) {
        out.push((await stmt.all()) as LocalD1Result<T>);
      }
      return out;
    },
    async exec(sql: string): Promise<{ count: number; duration: number }> {
      await executeHttp("query", sql, []);
      return { count: 1, duration: 0 };
    },
    withSession() {
      return client;
    },
    async dump(): Promise<ArrayBuffer> {
      return new ArrayBuffer(0);
    },
  } as unknown as AnyD1Database;

  return client;
}

let cachedLocalD1: AnyD1Database | null = null;
let d1Bootstrapped = false;

async function ensureDevD1Schema(d1: AnyD1Database): Promise<void> {
  if (d1Bootstrapped || process.env.NODE_ENV === "production") return;
  const statements = BOOTSTRAP_STATEMENTS.map((sqlText) => d1.prepare(sqlText));
  await d1.batch(statements);
  d1Bootstrapped = true;
}

async function getLocalSqliteAsD1(): Promise<AnyD1Database> {
  if (cachedLocalD1) return cachedLocalD1;

  const sqliteMod =
    typeof process !== "undefined" && typeof process.getBuiltinModule === "function"
      ? (process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite") | undefined)
      : undefined;
  const { DatabaseSync } = sqliteMod ?? (await import(/* webpackIgnore: true */ "node:sqlite"));
  const fs = await import("node:fs");
  const path = await import("node:path");

  const dataDir = path.join(process.cwd(), ".data");
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, "mediahub.db");

  const sqlite = new DatabaseSync(dbPath);
  sqlite.exec("PRAGMA foreign_keys = ON;");
  for (const stmt of BOOTSTRAP_STATEMENTS) {
    sqlite.exec(stmt);
  }

  function makePrepared(query: string, boundValues: unknown[] = []): LocalD1PreparedStatement {
    return {
      bind(...values: unknown[]) {
        return makePrepared(query, values.map(normalizeParam));
      },
      async first<T = Record<string, unknown>>(colName?: string): Promise<T | null> {
        const prepared = sqlite.prepare(query);
        const row = prepared.get(...(boundValues as never[])) as
          | Record<string, unknown>
          | undefined;
        if (!row) return null;
        if (colName) return (row[colName] as T) ?? null;
        return row as T;
      },
      async all<T = Record<string, unknown>>(): Promise<LocalD1Result<T>> {
        const prepared = sqlite.prepare(query);
        const results = prepared.all(...(boundValues as never[])) as T[];
        return {
          results,
          success: true,
          meta: { ...EMPTY_META, rows_read: results.length },
        };
      },
      async raw<T = unknown[]>(): Promise<T[]> {
        const prepared = sqlite.prepare(query);
        const rows = prepared.all(...(boundValues as never[])) as Record<string, unknown>[];
        return rows.map((r) => Object.values(r)) as T[];
      },
      async run(): Promise<LocalD1Result<Record<string, unknown>>> {
        const prepared = sqlite.prepare(query);
        const info = prepared.run(...(boundValues as never[]));
        return {
          results: [],
          success: true,
          meta: {
            ...EMPTY_META,
            rows_written: Number(info.changes ?? 0),
            last_row_id: Number(info.lastInsertRowid ?? 0),
            changed_db: Number(info.changes ?? 0) > 0,
            changes: Number(info.changes ?? 0),
          },
        };
      },
    };
  }

  const d1Shim = {
    prepare(query: string) {
      return makePrepared(query);
    },
    async batch<T = unknown>(statements: LocalD1PreparedStatement[]): Promise<LocalD1Result<T>[]> {
      sqlite.exec("BEGIN");
      try {
        const results: LocalD1Result<T>[] = [];
        for (const stmt of statements) {
          results.push((await stmt.all()) as LocalD1Result<T>);
        }
        sqlite.exec("COMMIT");
        return results;
      } catch (err) {
        sqlite.exec("ROLLBACK");
        throw err;
      }
    },
    async exec(query: string): Promise<{ count: number; duration: number }> {
      sqlite.exec(query);
      return { count: 1, duration: 0 };
    },
    withSession() {
      return d1Shim;
    },
    async dump(): Promise<ArrayBuffer> {
      return new ArrayBuffer(0);
    },
  } as unknown as AnyD1Database;

  cachedLocalD1 = d1Shim;
  return d1Shim;
}

async function resolveD1Binding(): Promise<{ d1: AnyD1Database; mode: DbRuntimeMode }> {
  // 1. Native Cloudflare Workers D1 binding
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const ctx = await getCloudflareContext({ async: true });
    const env = ctx.env as { DB?: AnyD1Database } | undefined;
    if (env?.DB) {
      await ensureDevD1Schema(env.DB);
      return { d1: env.DB, mode: "cloudflare-d1" };
    }
  } catch {
    // Expected on Vercel or plain Node without Workers binding.
  }

  // 2. Hybrid Vercel -> Dedicated Cloudflare D1 Worker Gateway (fastest, no CF API token needed)
  const gatewayUrl = process.env.CLOUDFLARE_D1_GATEWAY_URL?.trim();
  const gatewayToken = process.env.CLOUDFLARE_D1_GATEWAY_TOKEN?.trim();
  if (gatewayUrl && gatewayToken) {
    return {
      d1: createD1HttpClient({ gatewayUrl, token: gatewayToken }),
      mode: "cloudflare-d1-http",
    };
  }

  // 3. Hybrid Vercel -> Cloudflare D1 REST API
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const databaseId = process.env.CLOUDFLARE_DATABASE_ID?.trim();
  const token = process.env.CLOUDFLARE_D1_TOKEN?.trim();
  if (accountId && databaseId && token) {
    return {
      d1: createD1HttpClient({ accountId, databaseId, token }),
      mode: "cloudflare-d1-http",
    };
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Database configuration missing: bind Cloudflare D1 (DB), set CLOUDFLARE_D1_GATEWAY_URL + CLOUDFLARE_D1_GATEWAY_TOKEN, or set CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_DATABASE_ID + CLOUDFLARE_D1_TOKEN.",
    );
  }

  // 3. Local dev SQLite fallback
  const d1 = await getLocalSqliteAsD1();
  return { d1, mode: "local-sqlite" };
}

export async function getDb(): Promise<{ db: MediaHubDb; mode: DbRuntimeMode }> {
  const { d1, mode } = await resolveD1Binding();
  return { db: drizzle(d1, { schema }), mode };
}
