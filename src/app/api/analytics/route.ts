import { NextRequest, NextResponse } from "next/server";
import { desc, eq, gte } from "drizzle-orm";
import { computeJobAnalytics, requireOwnerRequest, type ProviderStatsPoint } from "@/core";
import { hasCapability } from "@/shared";
import { getDb } from "@/db/client";
import { jobs, providerConnections } from "@/db/schema";
import { decryptConnectionCredentials } from "@/db/repositories/providers";
import { assertModuleEnabled } from "@/db/repositories/settings";
import { toApiErrorResponse } from "@/lib/api-error";
import { getProviderRegistry } from "@/lib/registry";

export async function GET(request: NextRequest) {
  try {
    await requireOwnerRequest(request, "dashboard.read");
    const { searchParams } = new URL(request.url);
    const daysParam = Number(searchParams.get("days") ?? "14") || 14;
    const days = Math.min(90, Math.max(7, daysParam));

    const { db } = await getDb();
    const enabled = await assertModuleEnabled(db, "analytics");
    if (!enabled) {
      return NextResponse.json({
        enabled: false,
        days,
        jobAnalytics: computeJobAnalytics([]),
        providerStats: { supported: false, points: [] },
      });
    }

    const cutoffIso = new Date(Date.now() - days * 86_400_000).toISOString();
    const [recentJobs, defaultConns] = await Promise.all([
      db
        .select({
          status: jobs.status,
          jobType: jobs.jobType,
          createdAt: jobs.createdAt,
          startedAt: jobs.startedAt,
          finishedAt: jobs.finishedAt,
        })
        .from(jobs)
        .where(gte(jobs.createdAt, cutoffIso))
        .orderBy(desc(jobs.createdAt))
        .limit(1000),
      db
        .select()
        .from(providerConnections)
        .where(eq(providerConnections.isDefault, true))
        .limit(1),
    ]);

    const jobAnalytics = computeJobAnalytics(recentJobs);

    // Provider-specific stats extension slot (PRD PROV-08) — capability-gated
    let providerStats: {
      supported: boolean;
      providerKey?: string;
      providerDisplayName?: string;
      points: ProviderStatsPoint[];
      error?: string;
    } = { supported: false, points: [] };

    const conn = defaultConns[0];
    if (conn && conn.status === "active") {
      const adapter = getProviderRegistry().get(conn.providerKey);
      if (adapter && hasCapability(adapter.meta.capabilities, "stats") && adapter.getStats) {
        providerStats = {
          supported: true,
          providerKey: conn.providerKey,
          providerDisplayName: adapter.meta.displayName,
          points: [],
        };
        try {
          const credentials = await decryptConnectionCredentials(conn);
          const toIso = new Date().toISOString().slice(0, 10);
          const fromIso = new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
          const points = await adapter.getStats(credentials, { from: fromIso, to: toIso });
          providerStats.points = points.sort((a, b) => a.day.localeCompare(b.day));
        } catch (err) {
          const canonical = adapter.normalizeError(err);
          providerStats.error = canonical.message;
        }
      }
    }

    return NextResponse.json({
      enabled: true,
      days,
      jobAnalytics,
      providerStats,
    });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
