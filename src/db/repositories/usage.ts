import { and, eq, sql } from "drizzle-orm";
import type { QuotaMetric } from "@/shared";
import type { MediaHubDb } from "../client";
import { usageCounters } from "../schema";

function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function utcMonthKey(): string {
  return `${new Date().toISOString().slice(0, 7)}-00`;
}

export async function incrementUsageCounter(
  db: MediaHubDb,
  metric: QuotaMetric,
  delta = 1,
): Promise<void> {
  if (delta <= 0) return;
  const bucket = metric.endsWith("_monthly")
    ? utcMonthKey()
    : metric.startsWith("r2_") && metric.endsWith("_bytes")
      ? "current"
      : utcToday();

  await db
    .insert(usageCounters)
    .values({ day: bucket, metric, value: delta })
    .onConflictDoUpdate({
      target: [usageCounters.day, usageCounters.metric],
      set: { value: sql`${usageCounters.value} + ${delta}` },
    });
}

export async function getCurrentUsageCounters(
  db: MediaHubDb,
): Promise<Partial<Record<QuotaMetric, number>>> {
  const today = utcToday();
  const month = utcMonthKey();
  const rows = await db
    .select()
    .from(usageCounters)
    .where(
      sql`${usageCounters.day} IN (${today}, ${month}, 'current')`,
    );

  const out: Partial<Record<QuotaMetric, number>> = {};
  for (const row of rows) {
    out[row.metric as QuotaMetric] = row.value;
  }
  return out;
}

export async function setUsageCounterValue(
  db: MediaHubDb,
  metric: QuotaMetric,
  value: number,
): Promise<void> {
  const bucket = metric.endsWith("_monthly")
    ? utcMonthKey()
    : metric.startsWith("r2_") && metric.endsWith("_bytes")
      ? "current"
      : utcToday();

  const existing = await db
    .select()
    .from(usageCounters)
    .where(and(eq(usageCounters.day, bucket), eq(usageCounters.metric, metric)))
    .limit(1);

  if (existing[0]) {
    await db
      .update(usageCounters)
      .set({ value })
      .where(and(eq(usageCounters.day, bucket), eq(usageCounters.metric, metric)));
  } else {
    await db.insert(usageCounters).values({ day: bucket, metric, value });
  }
}
