import { NextRequest, NextResponse } from "next/server";
import { desc, isNull, sql } from "drizzle-orm";
import { evaluateQuotaState, requireOwnerRequest } from "@/core";
import { getDb } from "@/db/client";
import { activityLogs, assets, jobs } from "@/db/schema";
import { listSanitizedConnections } from "@/db/repositories/providers";
import { getCurrentUsageCounters } from "@/db/repositories/usage";
import { toApiErrorResponse } from "@/lib/api-error";

export async function GET(request: NextRequest) {
  try {
    await requireOwnerRequest(request, "dashboard.read");
    const { db, mode } = await getDb();

    const [
      assetStatsRows,
      jobStatsRows,
      recentJobs,
      recentActivity,
      connections,
      counters,
    ] = await Promise.all([
      db
        .select({
          status: assets.canonicalStatus,
          count: sql<number>`count(*)`,
        })
        .from(assets)
        .where(isNull(assets.deletedAt))
        .groupBy(assets.canonicalStatus),
      db
        .select({
          status: jobs.status,
          count: sql<number>`count(*)`,
        })
        .from(jobs)
        .groupBy(jobs.status),
      db.select().from(jobs).orderBy(desc(jobs.createdAt)).limit(6),
      db.select().from(activityLogs).orderBy(desc(activityLogs.createdAt)).limit(6),
      listSanitizedConnections(db),
      getCurrentUsageCounters(db),
    ]);

    const assetCounts: Record<string, number> = {};
    let totalAssets = 0;
    for (const row of assetStatsRows) {
      const c = Number(row.count);
      assetCounts[row.status] = c;
      totalAssets += c;
    }

    const jobCounts: Record<string, number> = {};
    for (const row of jobStatsRows) {
      jobCounts[row.status] = Number(row.count);
    }

    const jobsInProgress =
      (jobCounts.pending ?? 0) +
      (jobCounts.validating ?? 0) +
      (jobCounts.queued ?? 0) +
      (jobCounts.processing ?? 0) +
      (jobCounts.provider_processing ?? 0) +
      (jobCounts.verifying ?? 0) +
      (jobCounts.retry_wait ?? 0);

    const defaultConnection = connections.find((c) => c.isDefault) ?? connections[0] ?? null;
    const quota = evaluateQuotaState(counters);

    const alerts: Array<{
      id: string;
      severity: "warning" | "danger";
      message: string;
      href: string;
    }> = [];

    if ((assetCounts.dmca ?? 0) > 0) {
      alerts.push({
        id: "dmca",
        severity: "danger",
        message: `${assetCounts.dmca} asset(s) flagged with a DMCA report.`,
        href: "/library?status=dmca",
      });
    }
    if ((jobCounts.unknown ?? 0) > 0) {
      alerts.push({
        id: "unknown-jobs",
        severity: "warning",
        message: `${jobCounts.unknown} job(s) have an unclear outcome and need reconciliation.`,
        href: "/jobs?status=unknown",
      });
    }
    if (defaultConnection && defaultConnection.status === "error") {
      alerts.push({
        id: "provider-auth",
        severity: "danger",
        message: `Provider "${defaultConnection.providerKey}" reported an authentication or health error.`,
        href: "/providers",
      });
    }

    return NextResponse.json({
      dbMode: mode,
      summary: {
        totalAssets,
        processingAssets: assetCounts.processing ?? 0,
        dmcaAssets: assetCounts.dmca ?? 0,
        removedAssets: assetCounts.removed_remote ?? 0,
        jobsCompleted: jobCounts.completed ?? 0,
        jobsFailed: jobCounts.failed ?? 0,
        jobsInProgress,
        jobsUnknown: jobCounts.unknown ?? 0,
      },
      defaultConnection,
      recentJobs,
      recentActivity,
      alerts,
      quota,
    });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
