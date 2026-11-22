import { desc, eq } from "drizzle-orm";
import { encryptCredentials, decryptCredentials } from "@/core";
import { redactUrl } from "@/shared";
import type { MediaHubDb } from "../client";
import { batches, jobs } from "../schema";
import { createIdempotentJob, transitionJob, type JobRow } from "./jobs";
import { incrementUsageCounter } from "./usage";

export type BatchRow = typeof batches.$inferSelect;

export async function createBulkImportBatch(
  db: MediaHubDb,
  params: {
    providerConnectionId: string;
    items: Array<{
      rawUrl: string;
      sourceUrlHash: string;
      title?: string;
    }>;
  },
): Promise<{ batch: BatchRow; jobs: JobRow[] }> {
  const now = new Date().toISOString();
  const batchId = crypto.randomUUID();

  await db.insert(batches).values({
    id: batchId,
    operationType: "video.upload_url",
    status: "queued",
    totalCount: params.items.length,
    completedCount: 0,
    failedCount: 0,
    createdAt: now,
  });

  const createdJobs: JobRow[] = [];
  for (const item of params.items) {
    // Encrypt sensitive URLs inside job payload per PRD 13.5
    const { ciphertext } = await encryptCredentials({ url: item.rawUrl });
    const idempotencyKey = `batch:${batchId}:${item.sourceUrlHash}`;

    const { job } = await createIdempotentJob(db, {
      idempotencyKey,
      jobType: "video.upload_url",
      providerConnectionId: params.providerConnectionId,
      batchId,
      status: "queued",
      payload: {
        redactedUrl: redactUrl(item.rawUrl),
        sourceUrlHash: item.sourceUrlHash,
        title: item.title ?? "Imported video",
        encryptedSource: ciphertext,
      },
    });
    createdJobs.push(job);
  }

  await incrementUsageCounter(db, "d1_rows_written_daily", 1 + createdJobs.length * 2);

  const batchRows = await db.select().from(batches).where(eq(batches.id, batchId)).limit(1);
  return { batch: batchRows[0]!, jobs: createdJobs };
}

export async function extractJobSourceUrl(job: JobRow): Promise<string | null> {
  try {
    const payload = JSON.parse(job.payloadJson) as { encryptedSource?: string };
    if (!payload.encryptedSource) return null;
    const decrypted = await decryptCredentials(payload.encryptedSource);
    return decrypted.url ?? null;
  } catch {
    return null;
  }
}

export async function reconcileBatchStatus(db: MediaHubDb, batchId: string): Promise<BatchRow | null> {
  const itemJobs = await db.select().from(jobs).where(eq(jobs.batchId, batchId));
  if (itemJobs.length === 0) return null;

  let completed = 0;
  let failed = 0;
  let active = 0;
  let unknown = 0;

  for (const j of itemJobs) {
    if (j.status === "completed") completed += 1;
    else if (j.status === "failed" || j.status === "cancelled") failed += 1;
    else if (j.status === "unknown") unknown += 1;
    else active += 1;
  }

  let status = "running";
  if (active === 0 && unknown === 0) {
    if (failed === 0) status = "completed";
    else if (completed === 0) status = "failed";
    else status = "partial_failed";
  } else if (active === 0 && unknown > 0) {
    status = "needs_reconciliation";
  }

  await db
    .update(batches)
    .set({
      totalCount: itemJobs.length,
      completedCount: completed,
      failedCount: failed,
      status,
    })
    .where(eq(batches.id, batchId));

  const rows = await db.select().from(batches).where(eq(batches.id, batchId)).limit(1);
  return rows[0] ?? null;
}

export async function getBatchDetail(db: MediaHubDb, batchId: string) {
  const batch = await reconcileBatchStatus(db, batchId);
  if (!batch) return null;
  const itemJobs = await db
    .select()
    .from(jobs)
    .where(eq(jobs.batchId, batchId))
    .orderBy(desc(jobs.createdAt));

  return { batch, jobs: itemJobs };
}

export async function requeueEligibleBatchFailures(
  db: MediaHubDb,
  batchId: string,
): Promise<{ requeued: number; skippedUnknown: number }> {
  const itemJobs = await db.select().from(jobs).where(eq(jobs.batchId, batchId));
  let requeued = 0;
  let skippedUnknown = 0;

  for (const job of itemJobs) {
    // PRD BULK-04 / TC-04: never blindly retry `unknown` jobs; reconcile first
    if (job.status === "unknown") {
      skippedUnknown += 1;
      continue;
    }
    if (job.status === "failed") {
      await transitionJob(db, job.id, {
        status: "queued",
        errorCode: null,
        eventMessage: "Re-queued eligible failed batch item for retry.",
      });
      requeued += 1;
    }
  }

  await reconcileBatchStatus(db, batchId);
  return { requeued, skippedUnknown };
}
