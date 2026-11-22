import { redactRecord } from "@/shared";
import { activityLogs } from "../schema";
import type { MediaHubDb } from "../client";

export async function recordActivity(
  db: MediaHubDb,
  entry: {
    actorId: string;
    action: string;
    entityType: string;
    entityId: string;
    context?: Record<string, unknown>;
  },
): Promise<void> {
  const safeContext = redactRecord(entry.context ?? {});
  await db.insert(activityLogs).values({
    id: crypto.randomUUID(),
    actorId: entry.actorId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    contextJson: JSON.stringify(safeContext),
    createdAt: new Date().toISOString(),
  });
}
