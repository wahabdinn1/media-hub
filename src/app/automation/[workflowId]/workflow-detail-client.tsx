"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Clock, Loader2, Play, XCircle } from "lucide-react";
import type { WorkflowStep, WorkflowTriggerType } from "@/core";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/cn";

interface WorkflowDetailResponse {
  workflow: {
    id: string;
    name: string;
    description: string;
    enabled: boolean;
    triggerType: WorkflowTriggerType;
    steps: WorkflowStep[];
    lastRunAt: string | null;
    nextRunAt: string | null;
  };
  runs: Array<{
    id: string;
    status: string;
    triggerSource: string;
    stepResults: Array<{
      stepId: string;
      type: string;
      status: "completed" | "failed";
      summary: string;
    }>;
    errorMessage: string | null;
    startedAt: string;
    finishedAt: string | null;
  }>;
}

export function WorkflowDetailClient({ workflowId }: { workflowId: string }) {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const { data, isLoading, error } = useQuery<WorkflowDetailResponse>({
    queryKey: ["workflow", workflowId],
    queryFn: async () => {
      const res = await fetch(`/api/workflows/${workflowId}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Workflow not found");
      }
      return res.json();
    },
  });

  const runMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/workflows/${workflowId}/run`, { method: "POST" });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        run?: { status: string; errorMessage: string | null };
      };
      if (!res.ok) throw new Error(json.error ?? "Run failed");
      return json;
    },
    onSuccess: (res) => {
      const failed = res.run?.status === "failed";
      setNotice({
        kind: failed ? "error" : "success",
        text: failed
          ? `Run failed: ${res.run?.errorMessage ?? "Check step details below."}`
          : "Workflow run completed.",
      });
      void queryClient.invalidateQueries({ queryKey: ["workflow", workflowId] });
      void queryClient.invalidateQueries({ queryKey: ["workflows"] });
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: (err) => {
      setNotice({ kind: "error", text: err instanceof Error ? err.message : "Run failed." });
    },
  });

  if (isLoading) {
    return (
      <div className="dusk-well flex items-center gap-2 p-6 text-sm text-text-secondary">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading workflow…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-4">
        <Link
          href="/automation"
          className="inline-flex items-center gap-1.5 text-xs text-text-secondary hover:text-text-primary"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Automation
        </Link>
        <div className="rounded-xl bg-danger-subtle p-4 text-sm text-danger">
          {error instanceof Error ? error.message : "Workflow not found."}
        </div>
      </div>
    );
  }

  const { workflow, runs } = data;

  return (
    <div className="space-y-8">
      <Link
        href="/automation"
        className="inline-flex items-center gap-1.5 text-xs text-text-secondary hover:text-text-primary"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to Automation
      </Link>

      <PageHeader
        title={workflow.name}
        subtitle={workflow.description || `Trigger: ${workflow.triggerType}`}
        actions={
          <div className="flex items-center gap-2.5">
            <StatusBadge
              label={workflow.enabled ? "Enabled" : "Paused"}
              tone={workflow.enabled ? "success" : "neutral"}
              dot
            />
            <button
              type="button"
              disabled={runMutation.isPending}
              onClick={() => {
                setNotice(null);
                runMutation.mutate();
              }}
              className="dusk-btn-primary h-9 px-4 text-xs disabled:opacity-50"
            >
              {runMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              Run now
            </button>
          </div>
        }
      />

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

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-medium text-text-primary">Structured step sequence</h2>
          {workflow.nextRunAt ? (
            <span className="inline-flex items-center gap-1.5 tabular-nums text-xs text-text-secondary">
              <Clock className="h-3.5 w-3.5" />
              Next scheduled: {new Date(workflow.nextRunAt).toLocaleString()}
            </span>
          ) : null}
        </div>
        <ol className="divide-y divide-border/70 border-y border-border">
          {workflow.steps.map((step, i) => (
            <li key={step.id} className="flex items-center justify-between py-3 text-xs">
              <span className="font-mono text-text-primary">
                {i + 1}. {step.type}
              </span>
              <span className="font-mono text-text-secondary">
                {step.type === "sync_provider"
                  ? `maxPages=${step.maxPages}`
                  : step.type === "add_recent_to_collection"
                    ? `limit=${step.limit}`
                    : step.title || "direct URL"}
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section className="space-y-3 border-t border-border pt-6">
        <h2 className="text-base font-medium text-text-primary">Run history ({runs.length})</h2>
        {runs.length === 0 ? (
          <p className="text-xs text-text-secondary">
            No executions recorded yet. Click &ldquo;Run now&rdquo; to execute this workflow.
          </p>
        ) : (
          <div className="divide-y divide-border border-y border-border">
            {runs.map((run) => (
              <div key={run.id} className="space-y-2.5 py-4 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <StatusBadge
                      label={run.status}
                      tone={
                        run.status === "completed"
                          ? "success"
                          : run.status === "failed"
                            ? "danger"
                            : "info"
                      }
                      dot
                    />
                    <span className="tabular-nums text-text-secondary">
                      {run.triggerSource}, {new Date(run.startedAt).toLocaleString()}
                    </span>
                  </div>
                  <span className="font-mono text-xs text-text-secondary">
                    {run.id.slice(0, 8)}
                  </span>
                </div>

                {run.errorMessage ? (
                  <div className="rounded-lg bg-danger-subtle px-3 py-2 text-danger">
                    {run.errorMessage}
                  </div>
                ) : null}

                {run.stepResults.length > 0 ? (
                  <ul className="space-y-1.5 pl-2">
                    {run.stepResults.map((sr) => (
                      <li
                        key={`${run.id}-${sr.stepId}`}
                        className="flex items-center justify-between gap-2 text-text-secondary"
                      >
                        <span>
                          <span className="font-mono text-text-primary">{sr.type}</span>:{" "}
                          {sr.summary}
                        </span>
                        <StatusBadge
                          label={sr.status}
                          tone={sr.status === "completed" ? "success" : "danger"}
                        />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
