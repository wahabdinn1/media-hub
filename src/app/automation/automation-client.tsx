"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Clock,
  Loader2,
  Play,
  Plus,
  Trash2,
  Workflow,
  XCircle,
} from "lucide-react";
import type { WorkflowStep, WorkflowTriggerType } from "@/core";
import { getMessages } from "@/shared";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/cn";

interface WorkflowSummary {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  triggerType: WorkflowTriggerType;
  steps: WorkflowStep[];
  lastRunAt: string | null;
  nextRunAt: string | null;
}

interface CollectionOption {
  id: string;
  name: string;
}

function triggerLabel(trigger: WorkflowTriggerType): string {
  switch (trigger) {
    case "manual":
      return "Manual only";
    case "interval_hourly":
      return "Every hour (shared cron tick)";
    case "interval_daily":
      return "Every 24 hours (shared cron tick)";
  }
}

function stepLabel(step: WorkflowStep): string {
  switch (step.type) {
    case "sync_provider":
      return `Sync provider catalog (up to ${step.maxPages} pages)`;
    case "import_url":
      return `Import authorized URL (${step.title || step.url.slice(0, 42)})`;
    case "add_recent_to_collection":
      return `Add latest ${step.limit} assets to collection`;
  }
}

export function AutomationClient() {
  const t = getMessages("en");
  const queryClient = useQueryClient();

  const [showBuilder, setShowBuilder] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [triggerType, setTriggerType] = useState<WorkflowTriggerType>("manual");
  const [steps, setSteps] = useState<WorkflowStep[]>([
    { id: "step-1", type: "sync_provider", maxPages: 3 },
  ]);

  const [newStepType, setNewStepType] = useState<WorkflowStep["type"]>("sync_provider");
  const [stepMaxPages, setStepMaxPages] = useState(3);
  const [stepUrl, setStepUrl] = useState("");
  const [stepTitle, setStepTitle] = useState("");
  const [stepRights, setStepRights] = useState(false);
  const [stepCollectionId, setStepCollectionId] = useState("");
  const [stepLimit, setStepLimit] = useState(10);

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const { data, isLoading, error } = useQuery<{ enabled: boolean; workflows: WorkflowSummary[] }>({
    queryKey: ["workflows"],
    queryFn: async () => {
      const res = await fetch("/api/workflows");
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Failed to load workflows");
      }
      return res.json();
    },
  });

  const { data: collectionsData } = useQuery<{ collections: CollectionOption[] }>({
    queryKey: ["collections"],
    queryFn: async () => {
      const res = await fetch("/api/collections");
      if (!res.ok) return { collections: [] };
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description, triggerType, steps, enabled: true }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to create workflow");
      return json;
    },
    onSuccess: () => {
      setName("");
      setDescription("");
      setTriggerType("manual");
      setSteps([{ id: "step-1", type: "sync_provider", maxPages: 3 }]);
      setShowBuilder(false);
      setNotice({ kind: "success", text: "Workflow created." });
      void queryClient.invalidateQueries({ queryKey: ["workflows"] });
    },
    onError: (err) => {
      setNotice({ kind: "error", text: err instanceof Error ? err.message : "Create failed." });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const res = await fetch(`/api/workflows/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error ?? "Failed to update workflow");
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["workflows"] });
    },
  });

  const runMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/workflows/${id}/run`, { method: "POST" });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        run?: { status: string; errorMessage: string | null };
      };
      if (!res.ok) throw new Error(json.error ?? "Workflow run failed");
      return json;
    },
    onSuccess: (res) => {
      const failed = res.run?.status === "failed";
      setNotice({
        kind: failed ? "error" : "success",
        text: failed
          ? `Workflow run failed: ${res.run?.errorMessage ?? "See run log."}`
          : "Workflow run completed and logged in Jobs.",
      });
      void queryClient.invalidateQueries({ queryKey: ["workflows"] });
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });
      void queryClient.invalidateQueries({ queryKey: ["assets"] });
    },
    onError: (err) => {
      setNotice({ kind: "error", text: err instanceof Error ? err.message : "Run failed." });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/workflows/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete workflow");
    },
    onSuccess: () => {
      setConfirmDeleteId(null);
      setNotice({ kind: "success", text: "Workflow deleted." });
      void queryClient.invalidateQueries({ queryKey: ["workflows"] });
    },
  });

  function addStep() {
    const id = `step-${Date.now().toString(36)}`;
    if (newStepType === "sync_provider") {
      setSteps((prev) => [...prev, { id, type: "sync_provider", maxPages: stepMaxPages }]);
    } else if (newStepType === "import_url") {
      if (!stepUrl.trim() || !stepRights) return;
      setSteps((prev) => [
        ...prev,
        {
          id,
          type: "import_url",
          url: stepUrl.trim(),
          title: stepTitle.trim() || undefined,
          rightsConfirmed: true,
        },
      ]);
      setStepUrl("");
      setStepTitle("");
      setStepRights(false);
    } else if (newStepType === "add_recent_to_collection") {
      if (!stepCollectionId) return;
      setSteps((prev) => [
        ...prev,
        { id, type: "add_recent_to_collection", collectionId: stepCollectionId, limit: stepLimit },
      ]);
    }
  }

  function moveStep(idx: number, dir: -1 | 1) {
    const target = idx + dir;
    if (target < 0 || target >= steps.length) return;
    setSteps((prev) => {
      const copy = [...prev];
      const [item] = copy.splice(idx, 1);
      copy.splice(target, 0, item!);
      return copy;
    });
  }

  const workflows = data?.workflows ?? [];
  const collections = collectionsData?.collections ?? [];

  return (
    <div className="space-y-8">
      <PageHeader
        title={t.automation.title}
        subtitle={t.automation.subtitle}
        actions={
          <button
            type="button"
            onClick={() => setShowBuilder((v) => !v)}
            disabled={data?.enabled === false}
            className="dusk-btn-primary h-9 px-4 text-xs disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
            New workflow
          </button>
        }
      />

      {data?.enabled === false ? (
        <div className="rounded-xl bg-warning-subtle px-4 py-3 text-xs text-warning">
          The Automation module is disabled in Settings. Existing workflows remain viewable, but new
          runs are paused.
        </div>
      ) : null}

      {notice ? (
        <div
          role="status"
          className={cn(
            "flex items-center gap-2 rounded-xl px-4 py-3 text-xs font-medium",
            notice.kind === "success"
              ? "bg-success-subtle text-success"
              : "bg-danger-subtle text-danger",
          )}
        >
          {notice.kind === "success" ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          ) : (
            <XCircle className="h-4 w-4 shrink-0" />
          )}
          <span>{notice.text}</span>
        </div>
      ) : null}

      {showBuilder ? (
        <section className="dusk-plate space-y-5 p-6">
          <h2 className="text-base font-medium text-text-primary">Create sequential workflow</h2>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="text-xs font-medium text-text-secondary">Workflow name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Daily sync and organize"
                className="mt-1.5 h-10 w-full rounded-lg border border-border bg-bg px-3 text-xs text-text-primary focus:border-primary focus:outline-none"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-text-secondary">Schedule trigger</label>
              <select
                value={triggerType}
                onChange={(e) => setTriggerType(e.target.value as WorkflowTriggerType)}
                className="mt-1.5 h-10 w-full rounded-lg border border-border bg-bg px-3 text-xs text-text-primary focus:border-primary focus:outline-none"
              >
                <option value="manual">Manual only</option>
                <option value="interval_hourly">Hourly (shared cron tick)</option>
                <option value="interval_daily">Daily (shared cron tick)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-text-secondary">Description (optional)</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Syncs provider catalog and tags latest uploads."
              className="mt-1.5 h-10 w-full rounded-lg border border-border bg-bg px-3 text-xs text-text-primary focus:border-primary focus:outline-none"
            />
          </div>

          <div className="space-y-3 border-t border-border pt-4">
            <div className="text-xs font-medium text-text-secondary">
              Ordered steps ({steps.length}/10)
            </div>
            <ol className="divide-y divide-border/70 border-y border-border/70">
              {steps.map((step, idx) => (
                <li key={step.id} className="flex items-center justify-between gap-2 py-2.5 text-xs">
                  <span className="flex items-center gap-2.5 text-text-primary">
                    <span className="w-5 tabular-nums text-text-secondary">{idx + 1}.</span>
                    {stepLabel(step)}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => moveStep(idx, -1)}
                      disabled={idx === 0}
                      className="rounded p-1 text-text-secondary hover:text-text-primary disabled:opacity-30"
                      aria-label="Move step up"
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveStep(idx, 1)}
                      disabled={idx === steps.length - 1}
                      className="rounded p-1 text-text-secondary hover:text-text-primary disabled:opacity-30"
                      aria-label="Move step down"
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setSteps((prev) => prev.filter((s) => s.id !== step.id))}
                      disabled={steps.length <= 1}
                      className="rounded p-1 text-text-secondary hover:text-danger disabled:opacity-30"
                      aria-label="Remove step"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ol>

            <div className="space-y-2.5 pt-1">
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={newStepType}
                  onChange={(e) => setNewStepType(e.target.value as WorkflowStep["type"])}
                  className="h-8 rounded-lg border border-border bg-bg px-2.5 text-xs text-text-primary"
                >
                  <option value="sync_provider">Sync provider catalog</option>
                  <option value="import_url">Import authorized direct URL</option>
                  <option value="add_recent_to_collection">Add recent assets to collection</option>
                </select>

                {newStepType === "sync_provider" ? (
                  <input
                    type="number"
                    min={1}
                    max={5}
                    value={stepMaxPages}
                    onChange={(e) => setStepMaxPages(Number(e.target.value) || 3)}
                    className="h-8 w-24 rounded-lg border border-border bg-bg px-2.5 text-xs text-text-primary"
                    title="Max pages per sync"
                  />
                ) : null}

                {newStepType === "add_recent_to_collection" ? (
                  <>
                    <select
                      value={stepCollectionId}
                      onChange={(e) => setStepCollectionId(e.target.value)}
                      className="h-8 rounded-lg border border-border bg-bg px-2.5 text-xs text-text-primary"
                    >
                      <option value="">Choose collection…</option>
                      {collections.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={stepLimit}
                      onChange={(e) => setStepLimit(Number(e.target.value) || 10)}
                      className="h-8 w-20 rounded-lg border border-border bg-bg px-2.5 text-xs text-text-primary"
                    />
                  </>
                ) : null}

                <button
                  type="button"
                  onClick={addStep}
                  disabled={steps.length >= 10}
                  className="dusk-btn-ghost h-8 px-3 text-xs disabled:opacity-50"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add step
                </button>
              </div>

              {newStepType === "import_url" ? (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <input
                    type="url"
                    value={stepUrl}
                    onChange={(e) => setStepUrl(e.target.value)}
                    placeholder="https://cdn.example.com/media/video.mp4"
                    className="h-8 rounded-lg border border-border bg-bg px-2.5 text-xs text-text-primary"
                  />
                  <input
                    type="text"
                    value={stepTitle}
                    onChange={(e) => setStepTitle(e.target.value)}
                    placeholder="Optional title"
                    className="h-8 rounded-lg border border-border bg-bg px-2.5 text-xs text-text-primary"
                  />
                  <label className="col-span-full flex items-center gap-2 text-xs text-text-secondary">
                    <input
                      type="checkbox"
                      checked={stepRights}
                      onChange={(e) => setStepRights(e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-border accent-primary"
                    />
                    I confirm I own or have explicit rights to import this media URL.
                  </label>
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex items-center gap-2.5 pt-1">
            <button
              type="button"
              disabled={!name.trim() || steps.length === 0 || createMutation.isPending}
              onClick={() => createMutation.mutate()}
              className="dusk-btn-primary h-9 px-4 text-xs disabled:opacity-50"
            >
              {createMutation.isPending ? "Saving…" : "Save workflow"}
            </button>
            <button
              type="button"
              onClick={() => setShowBuilder(false)}
              className="h-9 px-3 text-xs text-text-secondary hover:text-text-primary"
            >
              Cancel
            </button>
          </div>
        </section>
      ) : null}

      {isLoading ? (
        <div className="dusk-well flex items-center gap-2 p-6 text-sm text-text-secondary">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading workflows…
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl bg-danger-subtle p-4 text-sm text-danger">
          {error instanceof Error ? error.message : "Failed to load workflows."}
        </div>
      ) : null}

      {!isLoading && workflows.length === 0 ? (
        <EmptyState
          icon={Workflow}
          title={t.automation.emptyTitle}
          body="Create a sequential workflow to sync your provider catalog, import authorized URLs, or organize collections on demand or on the shared cron tick."
          action={
            <button
              type="button"
              onClick={() => setShowBuilder(true)}
              className="dusk-btn-primary h-9 px-4 text-xs"
            >
              <Plus className="h-3.5 w-3.5" />
              Create first workflow
            </button>
          }
        />
      ) : null}

      {/* Midnight Bento Workflow Cards */}
      {workflows.length > 0 ? (
        <div className="grid grid-cols-1 gap-4">
          {workflows.map((wf) => (
            <article
              key={wf.id}
              className="dusk-plate flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between"
            >
              <div className="flex min-w-0 items-start gap-3.5">
                <div
                  className={cn(
                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                    wf.enabled
                      ? "bg-violet-subtle text-violet"
                      : "bg-surface-raised text-text-secondary",
                  )}
                >
                  <Workflow className="h-5 w-5" aria-hidden="true" />
                </div>
                <div className="min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <Link
                      href={`/automation/${wf.id}`}
                      className="text-base font-semibold text-text-primary hover:text-primary"
                    >
                      {wf.name}
                    </Link>
                    <StatusBadge
                      label={wf.enabled ? "Enabled" : "Paused"}
                      tone={wf.enabled ? "success" : "neutral"}
                      dot
                    />
                  </div>
                  {wf.description ? (
                    <p className="text-xs text-text-secondary">{wf.description}</p>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-4 text-xs text-text-secondary">
                    <span className="inline-flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5" />
                      {triggerLabel(wf.triggerType)}
                    </span>
                    <span className="tabular-nums">{wf.steps.length} step(s)</span>
                    {wf.lastRunAt ? (
                      <span className="tabular-nums">
                        Last run: {new Date(wf.lastRunAt).toLocaleString()}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={runMutation.isPending || data?.enabled === false}
                  onClick={() => {
                    setNotice(null);
                    runMutation.mutate(wf.id);
                  }}
                  className="dusk-btn-primary h-8 px-3.5 text-xs disabled:opacity-50"
                >
                  <Play className="h-3.5 w-3.5" />
                  Run now
                </button>
                <button
                  type="button"
                  onClick={() => toggleMutation.mutate({ id: wf.id, enabled: !wf.enabled })}
                  className="dusk-btn-ghost h-8 px-3 text-xs"
                >
                  {wf.enabled ? "Pause" : "Enable"}
                </button>
                <Link href={`/automation/${wf.id}`} className="dusk-btn-ghost h-8 px-3 text-xs">
                  History
                </Link>

                {confirmDeleteId === wf.id ? (
                  <span className="inline-flex items-center gap-1 text-xs">
                    <button
                      type="button"
                      onClick={() => deleteMutation.mutate(wf.id)}
                      className="rounded-full bg-danger px-2.5 py-1 font-medium text-primary-foreground"
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(null)}
                      className="px-1.5 text-text-secondary hover:text-text-primary"
                    >
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteId(wf.id)}
                    aria-label={`Delete ${wf.name}`}
                    className="rounded-full p-1.5 text-text-secondary hover:text-danger"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </div>
  );
}
