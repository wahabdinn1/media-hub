import { and, asc, desc, eq, isNull, lte, sql } from "drizzle-orm";
import {
  computeNextWorkflowRunAt,
  evaluateQuotaState,
  validateImportUrl,
  type CreateWorkflowInput,
  type WorkflowStep,
  type WorkflowTriggerType,
} from "@/core";
import { hasCapability } from "@/shared";
import { getProviderRegistry } from "@/lib/registry";
import type { MediaHubDb } from "../client";
import { assets, providerConnections, workflowRuns, workflows } from "../schema";
import { recordActivity } from "./activity";
import { registerImportedAsset, syncProviderCatalog } from "./assets";
import { addAssetsToCollection } from "./collections";
import { createIdempotentJob, transitionJob } from "./jobs";
import { decryptConnectionCredentials } from "./providers";
import { assertModuleEnabled, getPersistedSettings } from "./settings";
import { getCurrentUsageCounters, incrementUsageCounter } from "./usage";

export interface WorkflowStepOutcome {
  stepId: string;
  type: WorkflowStep["type"];
  status: "completed" | "failed";
  summary: string;
  jobId?: string;
}

export interface WorkflowView {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  triggerType: WorkflowTriggerType;
  steps: WorkflowStep[];
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowRunView {
  id: string;
  workflowId: string;
  status: string;
  triggerSource: string;
  stepResults: WorkflowStepOutcome[];
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
}

function parseSteps(raw: string): WorkflowStep[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as WorkflowStep[]) : [];
  } catch {
    return [];
  }
}

function parseStepResults(raw: string): WorkflowStepOutcome[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as WorkflowStepOutcome[]) : [];
  } catch {
    return [];
  }
}

function toWorkflowView(row: typeof workflows.$inferSelect): WorkflowView {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    enabled: Boolean(row.enabled),
    triggerType: row.triggerType as WorkflowTriggerType,
    steps: parseSteps(row.stepsJson),
    lastRunAt: row.lastRunAt,
    nextRunAt: row.nextRunAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toRunView(row: typeof workflowRuns.$inferSelect): WorkflowRunView {
  return {
    id: row.id,
    workflowId: row.workflowId,
    status: row.status,
    triggerSource: row.triggerSource,
    stepResults: parseStepResults(row.stepResultsJson),
    errorMessage: row.errorMessage,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
}

export async function listWorkflows(db: MediaHubDb): Promise<WorkflowView[]> {
  const rows = await db.select().from(workflows).orderBy(desc(workflows.createdAt));
  return rows.map(toWorkflowView);
}

export async function getWorkflowDetail(
  db: MediaHubDb,
  workflowId: string,
): Promise<{ workflow: WorkflowView; runs: WorkflowRunView[] } | null> {
  const rows = await db.select().from(workflows).where(eq(workflows.id, workflowId)).limit(1);
  if (!rows[0]) return null;
  const runRows = await db
    .select()
    .from(workflowRuns)
    .where(eq(workflowRuns.workflowId, workflowId))
    .orderBy(desc(workflowRuns.startedAt))
    .limit(30);

  return {
    workflow: toWorkflowView(rows[0]),
    runs: runRows.map(toRunView),
  };
}

export async function createWorkflow(
  db: MediaHubDb,
  input: CreateWorkflowInput,
): Promise<WorkflowView> {
  const now = new Date();
  const nowIso = now.toISOString();
  const id = crypto.randomUUID();
  const enabled = input.enabled ?? true;
  const nextRunAt = enabled ? computeNextWorkflowRunAt(input.triggerType, now) : null;

  await db.insert(workflows).values({
    id,
    name: input.name.trim(),
    description: (input.description ?? "").trim(),
    enabled,
    triggerType: input.triggerType,
    stepsJson: JSON.stringify(input.steps),
    lastRunAt: null,
    nextRunAt,
    createdAt: nowIso,
    updatedAt: nowIso,
  });
  await incrementUsageCounter(db, "d1_rows_written_daily", 1);

  const created = await db.select().from(workflows).where(eq(workflows.id, id)).limit(1);
  return toWorkflowView(created[0]!);
}

export async function updateWorkflow(
  db: MediaHubDb,
  workflowId: string,
  patch: Partial<{
    name: string;
    description: string;
    enabled: boolean;
    triggerType: WorkflowTriggerType;
    steps: WorkflowStep[];
  }>,
): Promise<WorkflowView | null> {
  const existing = await db.select().from(workflows).where(eq(workflows.id, workflowId)).limit(1);
  const current = existing[0];
  if (!current) return null;

  const now = new Date();
  const nextEnabled = patch.enabled !== undefined ? patch.enabled : Boolean(current.enabled);
  const nextTrigger = (patch.triggerType ?? current.triggerType) as WorkflowTriggerType;
  const nextRunAt = nextEnabled ? computeNextWorkflowRunAt(nextTrigger, now) : null;

  await db
    .update(workflows)
    .set({
      name: patch.name !== undefined ? patch.name.trim() : current.name,
      description: patch.description !== undefined ? patch.description.trim() : current.description,
      enabled: nextEnabled,
      triggerType: nextTrigger,
      stepsJson: patch.steps !== undefined ? JSON.stringify(patch.steps) : current.stepsJson,
      nextRunAt,
      updatedAt: now.toISOString(),
    })
    .where(eq(workflows.id, workflowId));

  await incrementUsageCounter(db, "d1_rows_written_daily", 1);
  const updated = await db.select().from(workflows).where(eq(workflows.id, workflowId)).limit(1);
  return updated[0] ? toWorkflowView(updated[0]) : null;
}

export async function deleteWorkflow(db: MediaHubDb, workflowId: string): Promise<void> {
  await db.delete(workflows).where(eq(workflows.id, workflowId));
  await incrementUsageCounter(db, "d1_rows_written_daily", 1);
}

/**
 * Executes a sequential workflow step-by-step, recording a traceable workflow.execute job and run log (PRD AUTO-02, AUTO-03).
 */
export async function executeWorkflowRun(
  db: MediaHubDb,
  params: {
    workflowId: string;
    actorId: string;
    triggerSource: "manual" | "schedule";
  },
): Promise<{ run: WorkflowRunView; jobId: string }> {
  if (!(await assertModuleEnabled(db, "automation"))) {
    throw new Error("The Automation module is disabled in Settings.");
  }

  const [settings, counters, wfRows] = await Promise.all([
    getPersistedSettings(db),
    getCurrentUsageCounters(db),
    db.select().from(workflows).where(eq(workflows.id, params.workflowId)).limit(1),
  ]);

  const wfRow = wfRows[0];
  if (!wfRow) {
    throw new Error("Workflow not found.");
  }

  const quota = evaluateQuotaState(counters, { killSwitchEnabled: settings.killSwitchEnabled });
  if (quota.killSwitchEnabled || quota.degradeModeActive) {
    throw new Error(
      quota.killSwitchEnabled
        ? "Kill-switch is enabled; workflow execution is paused."
        : "Degrade mode is active (>=90% quota); workflow execution is paused.",
    );
  }

  const wf = toWorkflowView(wfRow);
  const startedAt = new Date();
  const startedIso = startedAt.toISOString();
  const runId = crypto.randomUUID();

  const { job } = await createIdempotentJob(db, {
    idempotencyKey: `workflow.execute:${wf.id}:${runId}`,
    jobType: "workflow.execute",
    payload: {
      workflowId: wf.id,
      workflowName: wf.name,
      triggerSource: params.triggerSource,
      stepCount: wf.steps.length,
    },
    status: "processing",
  });

  await transitionJob(db, job.id, {
    status: "processing",
    started: true,
    incrementAttempts: true,
    eventMessage: `Started workflow "${wf.name}" (${params.triggerSource}).`,
  });

  await db.insert(workflowRuns).values({
    id: runId,
    workflowId: wf.id,
    status: "running",
    triggerSource: params.triggerSource,
    stepResultsJson: "[]",
    errorMessage: null,
    startedAt: startedIso,
    finishedAt: null,
  });

  const stepResults: WorkflowStepOutcome[] = [];
  let failedError: string | null = null;

  for (const step of wf.steps) {
    try {
      if (step.type === "sync_provider") {
        const conns = await db
          .select()
          .from(providerConnections)
          .where(eq(providerConnections.isDefault, true))
          .limit(1);
        const conn = conns[0];
        if (!conn || conn.status !== "active") {
          throw new Error("No active default provider connection.");
        }
        const adapter = getProviderRegistry().require(conn.providerKey);
        const credentials = await decryptConnectionCredentials(conn);
        const summary = await syncProviderCatalog(db, {
          connectionId: conn.id,
          adapter,
          credentials,
          maxPages: step.maxPages,
        });
        stepResults.push({
          stepId: step.id,
          type: step.type,
          status: "completed",
          summary: `Synced ${summary.assetsSeen} asset(s): ${summary.created} created, ${summary.updated} updated, ${summary.foldersSynced} folder(s).`,
        });
      } else if (step.type === "import_url") {
        const validation = await validateImportUrl(step.url);
        if (!validation.valid) {
          throw new Error(validation.reason);
        }
        const conns = await db
          .select()
          .from(providerConnections)
          .where(eq(providerConnections.isDefault, true))
          .limit(1);
        const conn = conns[0];
        if (!conn || conn.status !== "active") {
          throw new Error("No active default provider connection.");
        }
        const adapter = getProviderRegistry().require(conn.providerKey);
        if (!hasCapability(adapter.meta.capabilities, "upload.url") || !adapter.uploadFromUrl) {
          throw new Error(`${adapter.meta.displayName} does not support direct URL import.`);
        }
        const credentials = await decryptConnectionCredentials(conn);
        const uploadRes = await adapter.uploadFromUrl(credentials, step.url, {
          title: step.title || validation.inferredTitle,
        });
        const reg = await registerImportedAsset(db, {
          connectionId: conn.id,
          externalId: uploadRes.externalId,
          title: step.title || uploadRes.title || validation.inferredTitle || "Imported video",
          canonicalStatus: adapter.meta.capabilities.asyncProcessing ? "processing" : "active",
          sizeBytes: uploadRes.sizeBytes ?? validation.contentLength,
          sourceUrlHash: validation.sourceUrlHash,
          providerMetadata: uploadRes.providerMetadata,
        });
        stepResults.push({
          stepId: step.id,
          type: step.type,
          status: "completed",
          summary: `Imported authorized URL into asset ${reg.assetId.slice(0, 8)}.`,
        });
      } else if (step.type === "add_recent_to_collection") {
        const recent = await db
          .select({ id: assets.id })
          .from(assets)
          .where(isNull(assets.deletedAt))
          .orderBy(desc(assets.createdAt))
          .limit(step.limit);
        const ids = recent.map((r) => r.id);
        const added = ids.length > 0 ? await addAssetsToCollection(db, step.collectionId, ids) : 0;
        stepResults.push({
          stepId: step.id,
          type: step.type,
          status: "completed",
          summary: `Organized ${added} recent asset(s) into collection.`,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Workflow step failed.";
      stepResults.push({
        stepId: step.id,
        type: step.type,
        status: "failed",
        summary: msg,
      });
      failedError = `Step ${step.id} (${step.type}) failed: ${msg}`;
      break;
    }
  }

  const finishedDate = new Date();
  const finishedIso = finishedDate.toISOString();
  const finalStatus = failedError ? "failed" : "completed";
  const nextRunAt = wf.enabled ? computeNextWorkflowRunAt(wf.triggerType, finishedDate) : null;

  await db
    .update(workflowRuns)
    .set({
      status: finalStatus,
      stepResultsJson: JSON.stringify(stepResults),
      errorMessage: failedError,
      finishedAt: finishedIso,
    })
    .where(eq(workflowRuns.id, runId));

  await db
    .update(workflows)
    .set({
      lastRunAt: finishedIso,
      nextRunAt,
      updatedAt: finishedIso,
    })
    .where(eq(workflows.id, wf.id));

  await transitionJob(db, job.id, {
    status: finalStatus,
    finished: true,
    errorCode: failedError ? "UNKNOWN_PROVIDER_ERROR" : null,
    result: { workflowId: wf.id, runId, stepsCompleted: stepResults.filter((s) => s.status === "completed").length },
    eventMessage: failedError ?? `Workflow "${wf.name}" completed (${stepResults.length} step(s)).`,
  });

  await recordActivity(db, {
    actorId: params.actorId,
    action: failedError ? "workflow.run_failed" : "workflow.run_completed",
    entityType: "workflow",
    entityId: wf.id,
    context: { runId, jobId: job.id, triggerSource: params.triggerSource },
  });

  await incrementUsageCounter(db, "d1_rows_written_daily", 3);

  const savedRun = await db.select().from(workflowRuns).where(eq(workflowRuns.id, runId)).limit(1);
  return { run: toRunView(savedRun[0]!), jobId: job.id };
}

/**
 * Shared-tick scheduled workflow dispatcher (PRD AUTO-04).
 */
export async function runDueScheduledWorkflows(db: MediaHubDb, limit = 2): Promise<number> {
  if (!(await assertModuleEnabled(db, "automation"))) return 0;
  const nowIso = new Date().toISOString();
  const due = await db
    .select()
    .from(workflows)
    .where(
      and(
        eq(workflows.enabled, true),
        sql`${workflows.triggerType} != 'manual'`,
        lte(workflows.nextRunAt, nowIso),
      ),
    )
    .orderBy(asc(workflows.nextRunAt))
    .limit(limit);

  let executed = 0;
  for (const wf of due) {
    try {
      await executeWorkflowRun(db, {
        workflowId: wf.id,
        actorId: "system:cron",
        triggerSource: "schedule",
      });
      executed += 1;
    } catch {
      // Non-fatal inside shared cron tick
    }
  }
  return executed;
}
