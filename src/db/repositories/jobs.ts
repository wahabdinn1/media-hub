import { and, desc, eq, sql } from "drizzle-orm";
import { redactRecord, type JobStatus, type JobType } from "@/shared";
import type { MediaHubDb } from "../client";
import { activityLogs, jobEvents, jobs } from "../schema";

export type JobRow = typeof jobs.$inferSelect;
export type JobEventRow = typeof jobEvents.$inferSelect;
export type ActivityLogRow = typeof activityLogs.$inferSelect;

export async function createIdempotentJob(
  db: MediaHubDb,
  input: {
    idempotencyKey: string;
    jobType: JobType;
    providerConnectionId?: string | null;
    batchId?: string | null;
    payload?: Record<string, unknown>;
    status?: JobStatus;
  },
): Promise<{ job: JobRow; deduplicated: boolean }> {
  const existing = await db
    .select()
    .from(jobs)
    .where(eq(jobs.idempotencyKey, input.idempotencyKey))
    .limit(1);

  if (existing[0]) {
    return { job: existing[0], deduplicated: true };
  }

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const safePayload = redactRecord(input.payload ?? {});

  await db.insert(jobs).values({
    id,
    batchId: input.batchId ?? null,
    providerConnectionId: input.providerConnectionId ?? null,
    jobType: input.jobType,
    status: input.status ?? "pending",
    payloadJson: JSON.stringify(safePayload),
    idempotencyKey: input.idempotencyKey,
    attempts: 0,
    createdAt: now,
  });

  await appendJobEvent(db, {
    jobId: id,
    eventType: "job.created",
    message: `Job created (${input.jobType}).`,
    data: { status: input.status ?? "pending" },
  });

  const created = await db.select().from(jobs).where(eq(jobs.id, id)).limit(1);
  return { job: created[0]!, deduplicated: false };
}

export async function appendJobEvent(
  db: MediaHubDb,
  input: {
    jobId: string;
    eventType: string;
    message: string;
    data?: Record<string, unknown>;
  },
): Promise<void> {
  await db.insert(jobEvents).values({
    id: crypto.randomUUID(),
    jobId: input.jobId,
    eventType: input.eventType,
    message: redactRecord(input.message),
    dataJson: JSON.stringify(redactRecord(input.data ?? {})),
    createdAt: new Date().toISOString(),
  });
}

export async function transitionJob(
  db: MediaHubDb,
  jobId: string,
  update: {
    status: JobStatus;
    result?: Record<string, unknown>;
    errorCode?: string | null;
    nextPollAt?: string | null;
    incrementAttempts?: boolean;
    started?: boolean;
    finished?: boolean;
    eventMessage?: string;
    eventData?: Record<string, unknown>;
  },
): Promise<JobRow> {
  const now = new Date().toISOString();
  const setValues: Record<string, unknown> = {
    status: update.status,
  };
  if (update.result !== undefined) {
    setValues.resultJson = JSON.stringify(redactRecord(update.result));
  }
  if (update.errorCode !== undefined) {
    setValues.errorCode = update.errorCode;
  }
  if (update.nextPollAt !== undefined) {
    setValues.nextPollAt = update.nextPollAt;
  }
  if (update.started) {
    setValues.startedAt = now;
  }
  if (update.finished) {
    setValues.finishedAt = now;
  }
  if (update.incrementAttempts) {
    setValues.attempts = sql`${jobs.attempts} + 1`;
  }

  await db.update(jobs).set(setValues).where(eq(jobs.id, jobId));

  if (update.eventMessage) {
    await appendJobEvent(db, {
      jobId,
      eventType: `job.${update.status}`,
      message: update.eventMessage,
      data: update.eventData,
    });
  }

  const rows = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  return rows[0]!;
}

export async function listJobsPaginated(
  db: MediaHubDb,
  query: {
    status?: string;
    jobType?: string;
    page?: number;
    pageSize?: number;
  },
): Promise<{ items: JobRow[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, query.pageSize ?? 25));
  const conditions = [];
  if (query.status && query.status !== "all") {
    conditions.push(eq(jobs.status, query.status));
  }
  if (query.jobType && query.jobType !== "all") {
    conditions.push(eq(jobs.jobType, query.jobType));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  const countRows = await db
    .select({ count: sql<number>`count(*)` })
    .from(jobs)
    .where(whereClause);
  const total = Number(countRows[0]?.count ?? 0);

  const items = await db
    .select()
    .from(jobs)
    .where(whereClause)
    .orderBy(desc(jobs.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return { items, total, page, pageSize };
}

export async function getJobWithEvents(
  db: MediaHubDb,
  jobId: string,
): Promise<{ job: JobRow; events: JobEventRow[] } | null> {
  const rows = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!rows[0]) return null;
  const events = await db
    .select()
    .from(jobEvents)
    .where(eq(jobEvents.jobId, jobId))
    .orderBy(desc(jobEvents.createdAt))
    .limit(100);
  return { job: rows[0], events };
}

export async function listActivityPaginated(
  db: MediaHubDb,
  query: { page?: number; pageSize?: number },
): Promise<{ items: ActivityLogRow[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, query.pageSize ?? 30));

  const countRows = await db.select({ count: sql<number>`count(*)` }).from(activityLogs);
  const total = Number(countRows[0]?.count ?? 0);

  const items = await db
    .select()
    .from(activityLogs)
    .orderBy(desc(activityLogs.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return { items, total, page, pageSize };
}

export async function countActiveJobs(db: MediaHubDb): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)` })
    .from(jobs)
    .where(
      sql`${jobs.status} IN ('pending', 'validating', 'queued', 'processing', 'provider_processing', 'verifying', 'retry_wait')`,
    );
  return Number(rows[0]?.count ?? 0);
}
