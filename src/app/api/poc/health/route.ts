import { NextResponse } from "next/server";
import { evaluateQuotaState } from "@/core";
import { getDb } from "@/db/client";
import { listSanitizedConnections } from "@/db/repositories/providers";
import { getProviderRegistry } from "@/lib/registry";

export async function GET() {
  const started = performance.now();
  const registry = getProviderRegistry();
  const adapters = registry.listMeta().map((meta) => ({
    key: meta.key,
    displayName: meta.displayName,
    serviceType: meta.serviceType,
    authType: meta.authType,
    capabilityVersion: meta.capabilities.version,
  }));

  let dbMode: string = "unbound";
  let connectedProviders = 0;
  try {
    const { db, mode } = await getDb();
    dbMode = mode;
    const conns = await listSanitizedConnections(db);
    connectedProviders = conns.filter((c) => c.status === "active").length;
  } catch {
    dbMode = "error";
  }

  const quota = evaluateQuotaState({});

  return NextResponse.json({
    ok: true,
    phase: "phase-1-2",
    runtime: "nextjs-app-router",
    dbMode,
    connectedProviders,
    activeJobsCount: 0,
    registeredAdapters: adapters,
    quota: {
      overallLevel: quota.overallLevel,
      degradeModeActive: quota.degradeModeActive,
    },
    elapsedMs: Number((performance.now() - started).toFixed(2)),
    timestamp: new Date().toISOString(),
  });
}
