/**
 * MediaHub Cloudflare D1 Gateway + 1-Minute Shared Cron Tick Worker (PRD 14.5).
 * - HTTP fetch: bridges Vercel Serverless Functions to native Cloudflare D1 (`env.DB`)
 * - Cron `* * * * *`: checks kill-switch & degrade mode, polls due `provider_processing`
 *   Vidara jobs (<= 40 external calls/tick), requeues `retry_wait`, and prunes retention hourly.
 */

const VIDARA_BASE = "https://api.vidara.so/v1";
const MAX_EXTERNAL_CALLS_PER_TICK = 40;
const D1_DAILY_WRITE_DEGRADE_THRESHOLD = 63_000; // 90% of 70k budget

function timingSafeEqualString(a, b) {
  const enc = new TextEncoder();
  const aBytes = enc.encode(a);
  const bBytes = enc.encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i += 1) {
    diff |= aBytes[i] ^ bBytes[i];
  }
  return diff === 0;
}

function fromBase64(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function decryptEnvelope(ciphertext, masterSecret) {
  const parts = String(ciphertext || "").split(":");
  if (parts.length !== 4 || parts[0] !== "mh_v1") {
    throw new Error("Invalid credential envelope");
  }
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(masterSecret));
  const key = await crypto.subtle.importKey("raw", hash, { name: "AES-GCM" }, false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(parts[2]) },
    key,
    fromBase64(parts[3]),
  );
  return JSON.parse(new TextDecoder().decode(plain));
}

async function runScheduledTick(env) {
  if (!env.DB) return;

  // 1. Check kill-switch in app_settings
  const ksRow = await env.DB.prepare(
    "SELECT value_json FROM app_settings WHERE key = 'kill_switch_enabled' LIMIT 1",
  ).first();
  if (ksRow && ksRow.value_json === "true") {
    return;
  }

  // 2. Check degrade mode (>=90% of daily D1 write budget)
  const today = new Date().toISOString().slice(0, 10);
  const usageRow = await env.DB.prepare(
    "SELECT value FROM usage_counters WHERE day = ? AND metric = 'd1_rows_written_daily' LIMIT 1",
  )
    .bind(today)
    .first();
  const degraded = Number(usageRow?.value ?? 0) >= D1_DAILY_WRITE_DEGRADE_THRESHOLD;

  const nowIso = new Date().toISOString();
  let callsUsed = 0;
  const maxCalls = degraded ? 10 : MAX_EXTERNAL_CALLS_PER_TICK;

  // 3. Move due retry_wait jobs back to queued (D1-only, 0 external calls)
  if (!degraded) {
    await env.DB.prepare(
      "UPDATE jobs SET status = 'queued', next_poll_at = NULL WHERE status = 'retry_wait' AND (next_poll_at IS NULL OR next_poll_at <= ?)",
    )
      .bind(nowIso)
      .run();
  }

  // 4. Poll due provider_processing jobs (Vidara encoding progress)
  if (env.MEDIAHUB_MASTER_KEY) {
    const dueJobsRes = await env.DB.prepare(
      "SELECT id, provider_connection_id, result_json, attempts, created_at, batch_id FROM jobs WHERE status = 'provider_processing' AND (next_poll_at IS NULL OR next_poll_at <= ?) ORDER BY created_at ASC LIMIT ?",
    )
      .bind(nowIso, maxCalls)
      .all();

    const credCache = new Map();
    for (const job of dueJobsRes.results ?? []) {
      if (callsUsed >= maxCalls) break;
      let resultObj = {};
      try {
        resultObj = JSON.parse(job.result_json || "{}");
      } catch {}
      if (!resultObj.externalId || !job.provider_connection_id) continue;

      const createdMs = Date.parse(job.created_at);
      if (Number.isFinite(createdMs) && Date.now() - createdMs >= 6 * 60 * 60 * 1000) {
        await env.DB.prepare(
          "UPDATE jobs SET status = 'unknown', next_poll_at = NULL, error_code = 'TIMEOUT_UNKNOWN' WHERE id = ?",
        )
          .bind(job.id)
          .run();
        continue;
      }

      let apiKey = credCache.get(job.provider_connection_id);
      if (!apiKey) {
        const conn = await env.DB.prepare(
          "SELECT provider_key, encrypted_credentials, status FROM provider_connections WHERE id = ? LIMIT 1",
        )
          .bind(job.provider_connection_id)
          .first();
        if (!conn || conn.status !== "active" || conn.provider_key !== "vidara") continue;
        try {
          const decrypted = await decryptEnvelope(
            conn.encrypted_credentials,
            env.MEDIAHUB_MASTER_KEY,
          );
          apiKey = decrypted.apiKey;
          credCache.set(job.provider_connection_id, apiKey);
        } catch {
          continue;
        }
      }

      callsUsed += 1;
      try {
        const pollUrl = new URL(`${VIDARA_BASE}/video/status`);
        pollUrl.searchParams.set("api_key", apiKey);
        pollUrl.searchParams.set("filecode", resultObj.externalId);

        const res = await fetch(pollUrl.toString(), {
          method: "GET",
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(10_000),
        });
        const raw = await res.json();
        const encodings = raw?.result?.encodings ?? null;
        const active = Array.isArray(encodings)
          ? encodings.find((e) => e.filecode === resultObj.externalId) ?? encodings[0]
          : null;

        const pct = active
          ? Math.min(100, Math.max(0, Number(String(active.progress_percentage || "0").replace("%", "")) || 0))
          : 100;
        const completed = !active || pct >= 100;
        const nextAttempts = Number(job.attempts || 0) + 1;
        const delayMs = nextAttempts <= 2 ? 30_000 : nextAttempts <= 6 ? 120_000 : 600_000;
        const nextPollAt = completed ? null : new Date(Date.now() + delayMs).toISOString();

        if (resultObj.assetId) {
          await env.DB.prepare(
            "UPDATE assets SET canonical_status = ?, updated_at = ? WHERE id = ?",
          )
            .bind(completed ? "active" : "processing", nowIso, resultObj.assetId)
            .run();
        }

        await env.DB.prepare(
          "UPDATE jobs SET status = ?, attempts = ?, next_poll_at = ?, finished_at = COALESCE(finished_at, ?), result_json = ? WHERE id = ?",
        )
          .bind(
            completed ? "completed" : "provider_processing",
            nextAttempts,
            nextPollAt,
            completed ? nowIso : null,
            JSON.stringify({ ...resultObj, progressPercent: pct }),
            job.id,
          )
          .run();

        await env.DB.prepare(
          "INSERT INTO job_events (id, job_id, event_type, message, data_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
          .bind(
            crypto.randomUUID(),
            job.id,
            completed ? "job.completed" : "job.provider_processing",
            completed
              ? "Cron tick confirmed encoding reached 100%."
              : `Cron tick encoding progress: ${pct}%.`,
            JSON.stringify({ progressPercent: pct }),
            nowIso,
          )
          .run();
      } catch {
        // Transient provider error: back off cleanly
        await env.DB.prepare("UPDATE jobs SET next_poll_at = ? WHERE id = ?")
          .bind(new Date(Date.now() + 120_000).toISOString(), job.id)
          .run();
      }
    }
  }

  // 5. Hourly retention pruning (PRD JOB-09: job_events 90d, activity_logs 365d)
  if (new Date().getUTCMinutes() === 0) {
    const eventsCutoff = new Date(Date.now() - 90 * 86_400_000).toISOString();
    const activityCutoff = new Date(Date.now() - 365 * 86_400_000).toISOString();
    await env.DB.prepare("DELETE FROM job_events WHERE created_at <= ?").bind(eventsCutoff).run();
    await env.DB.prepare("DELETE FROM activity_logs WHERE created_at <= ?")
      .bind(activityCutoff)
      .run();
  }
}

const worker = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ ok: true, service: "mediahub-d1-gateway", cron: "* * * * *" });
    }

    const expected = env.GATEWAY_TOKEN || "";
    const authHeader = request.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

    if (!expected || !token || !timingSafeEqualString(token, expected)) {
      return Response.json(
        { success: false, errors: [{ message: "Unauthorized" }] },
        { status: 401 },
      );
    }

    if (request.method !== "POST" || (url.pathname !== "/query" && url.pathname !== "/raw")) {
      return Response.json(
        { success: false, errors: [{ message: "Not found" }] },
        { status: 404 },
      );
    }

    try {
      const body = await request.json();
      const sql = typeof body.sql === "string" ? body.sql : "";
      const params = Array.isArray(body.params) ? body.params : [];
      if (!sql) {
        return Response.json(
          { success: false, errors: [{ message: "Missing SQL statement" }] },
          { status: 400 },
        );
      }

      const stmt = env.DB.prepare(sql).bind(...params);

      if (url.pathname === "/raw") {
        const rows = await stmt.raw();
        return Response.json({
          success: true,
          errors: [],
          result: [{ success: true, results: { rows }, meta: {} }],
        });
      }

      const res = await stmt.all();
      return Response.json({
        success: true,
        errors: [],
        result: [{ success: true, results: res.results ?? [], meta: res.meta ?? {} }],
      });
    } catch (err) {
      return Response.json(
        {
          success: false,
          errors: [{ message: err instanceof Error ? err.message : "D1 query error" }],
        },
        { status: 500 },
      );
    }
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(runScheduledTick(env));
  },
};

export default worker;
