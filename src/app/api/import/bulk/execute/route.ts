import { NextRequest, NextResponse } from "next/server";
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
  providerConnectionIds: z.array(z.string().min(1)).max(10).optional(),
  folderByConnectionId: z.record(z.string(), z.string().nullable()).optional(),
  collectionIds: z.array(z.string().min(1)).max(25).optional(),
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

    const [settings, counters, allConns] = await Promise.all([
      getPersistedSettings(db),
      getCurrentUsageCounters(db),
      db.select().from(providerConnections),
    ]);
    const quota = evaluateQuotaState(counters, { killSwitchEnabled: settings.killSwitchEnabled });
    const gate = canEnqueueJob(quota, "video.upload_url", true);
    if (!gate.allowed) {
      return NextResponse.json({ error: gate.reason, code: "QUOTA_EXCEEDED" }, { status: 429 });
    }

    const registry = getProviderRegistry();
    const activeUploadConns = allConns.filter((c) => {
      if (c.status !== "active") return false;
      const adapter = registry.get(c.providerKey);
      return Boolean(adapter && hasCapability(adapter.meta.capabilities, "upload.url"));
    });

    const defaultConn = activeUploadConns.find((c) => c.isDefault) ?? activeUploadConns[0];
    const selectedConns =
      body.providerConnectionIds && body.providerConnectionIds.length > 0
        ? Array.from(new Set(body.providerConnectionIds))
            .map((id) => activeUploadConns.find((c) => c.id === id))
            .filter((c): c is (typeof activeUploadConns)[number] => Boolean(c))
        : defaultConn
          ? [defaultConn]
          : [];

    if (selectedConns.length === 0) {
      return NextResponse.json(
        { error: "No active upload-capable provider connection selected." },
        { status: 400 },
      );
    }

    const supportedProviders = new Set(activeUploadConns.map((c) => c.providerKey));
    const connByProviderKey = new Map(activeUploadConns.map((c) => [c.providerKey, c]));

    const existingHashes = await listExistingSourceUrlHashes(db);
    const preview = await buildBulkDryRun({
      rawInput: body.rawInput,
      supportedProviders,
      defaultProviderKey: selectedConns[0]!.providerKey,
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

    const collectionIds = Array.from(new Set(body.collectionIds ?? []));
    const expandedItems: Array<{
      rawUrl: string;
      sourceUrlHash: string;
      title?: string;
      providerConnectionId: string;
      folderExternalId: string | null;
      collectionIds: string[];
    }> = [];

    for (const row of validRows) {
      // If CSV explicitly named a different provider column, honor it; otherwise fan out across all selected providers
      const explicitConn =
        row.provider && row.provider !== selectedConns[0]!.providerKey
          ? connByProviderKey.get(row.provider)
          : undefined;
      const targets = explicitConn ? [explicitConn] : selectedConns;

      for (const conn of targets) {
        expandedItems.push({
          rawUrl: row.rawUrl,
          sourceUrlHash: row.sourceUrlHash,
          title: row.title,
          providerConnectionId: conn.id,
          folderExternalId: body.folderByConnectionId?.[conn.id] ?? null,
          collectionIds,
        });
      }
    }

    const { batch, jobs } = await createBulkImportBatch(db, {
      items: expandedItems,
    });

    await incrementUsageCounter(db, "worker_requests_daily", 1);
    await recordActivity(db, {
      actorId: principal.actorId,
      action: "bulk.batch.created",
      entityType: "batch",
      entityId: batch.id,
      context: {
        providers: selectedConns.map((c) => c.providerKey),
        totalValidRows: validRows.length,
        totalJobs: jobs.length,
        collectionCount: collectionIds.length,
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
