import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  buildBulkDryRun,
  canEnqueueJob,
  evaluateQuotaState,
  requireOwnerRequest,
} from "@/core";
import { hasCapability } from "@/shared";
import { getDb } from "@/db/client";
import { providerConnections } from "@/db/schema";
import { recordActivity } from "@/db/repositories/activity";
import { createBulkImportBatch } from "@/db/repositories/batches";
import { assertModuleEnabled, getPersistedSettings } from "@/db/repositories/settings";
import {
  executeBoundedTick,
  listExistingSourceUrlHashes,
} from "@/db/repositories/tick-runner";
import { getCurrentUsageCounters, incrementUsageCounter } from "@/db/repositories/usage";
import { toApiErrorResponse } from "@/lib/api-error";
import { getProviderRegistry } from "@/lib/registry";

const ExecuteBulkSchema = z.object({
  rawInput: z.string().min(1).max(200_000),
  rightsConfirmed: z.boolean(),
});

export async function POST(request: NextRequest) {
  try {
    const principal = await requireOwnerRequest(request, "job.create");
    const body = ExecuteBulkSchema.parse(await request.json());

    if (!body.rightsConfirmed) {
      return NextResponse.json(
        { error: "Rights confirmation is required once per batch before execution." },
        { status: 400 },
      );
    }

    const { db } = await getDb();
    if (!(await assertModuleEnabled(db, "import"))) {
      return NextResponse.json(
        { error: "The Import module is disabled in Settings. History stays viewable." },
        { status: 403 },
      );
    }

    const [settings, counters] = await Promise.all([
      getPersistedSettings(db),
      getCurrentUsageCounters(db),
    ]);
    const quota = evaluateQuotaState(counters, { killSwitchEnabled: settings.killSwitchEnabled });
    const gate = canEnqueueJob(quota, "video.upload_url", true);
    if (!gate.allowed) {
      return NextResponse.json({ error: gate.reason, code: "QUOTA_EXCEEDED" }, { status: 429 });
    }

    const conns = await db
      .select()
      .from(providerConnections)
      .where(eq(providerConnections.isDefault, true))
      .limit(1);
    const conn = conns[0];
    if (!conn || conn.status !== "active") {
      return NextResponse.json(
        { error: "No active default provider connection configured." },
        { status: 400 },
      );
    }

    const adapter = getProviderRegistry().require(conn.providerKey);
    if (!hasCapability(adapter.meta.capabilities, "upload.url")) {
      return NextResponse.json(
        { error: `Provider "${adapter.meta.displayName}" does not support direct URL import.` },
        { status: 400 },
      );
    }

    const existingHashes = await listExistingSourceUrlHashes(db);
    const preview = await buildBulkDryRun({
      rawInput: body.rawInput,
      supportedProviders: new Set([conn.providerKey]),
      defaultProviderKey: conn.providerKey,
      existingUrlHashes: existingHashes,
    });

    const validRows = preview.rows.filter(
      (r): r is typeof r & { sourceUrlHash: string } =>
        r.status === "valid" && Boolean(r.sourceUrlHash),
    );
    if (validRows.length === 0) {
      return NextResponse.json(
        { error: "No valid rows to import after dry-run validation.", preview },
        { status: 400 },
      );
    }

    const { batch, jobs } = await createBulkImportBatch(db, {
      providerConnectionId: conn.id,
      items: validRows.map((r) => ({
        rawUrl: r.rawUrl,
        sourceUrlHash: r.sourceUrlHash,
        title: r.title,
      })),
    });

    await incrementUsageCounter(db, "worker_requests_daily", 1);
    await recordActivity(db, {
      actorId: principal.actorId,
      action: "bulk.batch.created",
      entityType: "batch",
      entityId: batch.id,
      context: {
        providerKey: conn.providerKey,
        totalValid: validRows.length,
        rightsConfirmed: true,
      },
    });

    // Dispatch first small chunk immediately (remaining handled by 1-min cron tick or manual chunk)
    const tick = await executeBoundedTick(db, {
      batchId: batch.id,
      maxExternalCalls: 5,
    });

    return NextResponse.json(
      {
        batch,
        jobCount: jobs.length,
        initialTick: tick,
      },
      { status: 201 },
    );
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
