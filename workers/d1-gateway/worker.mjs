/**
 * MediaHub Cloudflare D1 Gateway Worker (Hybrid Vercel + Cloudflare Free).
 * Bridges Vercel Serverless Functions to native Cloudflare D1 binding (`env.DB`)
 * over constant-time Bearer token auth. Phase 4 adds the 1-min cron tick here.
 */

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

const worker = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ ok: true, service: "mediahub-d1-gateway" });
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
};

export default worker;
