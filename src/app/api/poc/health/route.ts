import { NextResponse } from "next/server";
import { evaluateQuotaState } from "@/core";
import { getDb } from "@/db/client";
import { countActiveJobs } from "@/db/repositories/jobs";
import { listSanitizedConnections } from "@/db/repositories/providers";
import { getCurrentUsageCounters } from "@/db/repositories/usage";
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

  let dbMode = "unbound";
  let connectedProviders = 0;
  let activeJobsCount = 0;
  let quota = evaluateQuotaState({});

  try {
    const { db, mode } = await getDb();
    dbMode = mode;
    const [conns, active, counters] = await Promise.all([
      listSanitizedConnections(db),
      countActiveJobs(db),
      getCurrentUsageCounters(db),
    ]);
    connectedProviders = conns.filter((c) => c.status === "active").length;
    activeJobsCount = active;
    quota = evaluateQuotaState(counters);
  } catch {
    dbMode = "error";
  }

  return NextResponse.json({
    ok: true,
    phase: "phase-3",
    runtime: "nextjs-app-router",
    dbMode,
    connectedProviders,
    activeJobsCount,
    registeredAdapters: adapters,
    quota: {
      overallLevel: quota.overallLevel,
      degradeModeActive: quota.degradeModeActive,
    },
    elapsedMs: Number((performance.now() - started).toFixed(2)),
    timestamp: new Date().toISOString(),
  });
}
