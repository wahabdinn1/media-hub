"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Download, Loader2, Play, RotateCcw } from "lucide-react";
import { getMessages, type JobStatus } from "@/shared";
import { useVisibilityPolling } from "@/lib/hooks/use-visibility-polling";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge, type BadgeTone } from "@/components/ui/status-badge";

interface BatchDetailResponse {
  batch: {
    id: string;
    operationType: string;
    status: string;
    totalCount: number;
    completedCount: number;
    failedCount: number;
    createdAt: string;
  };
  jobs: Array<{
    id: string;
    status: string;
    payloadJson: string;
    resultJson: string | null;
    errorCode: string | null;
    attempts: number;
    createdAt: string;
  }>;
}

function statusTone(status: string): BadgeTone {
  switch (status) {
    case "completed":
      return "success";
    case "failed":
    case "partial_failed":
      return "danger";
    case "unknown":
    case "needs_reconciliation":
    case "retry_wait":
      return "warning";
    case "processing":
    case "provider_processing":
    case "running":
      return "info";
    default:
      return "neutral";
  }
}

export function BatchDetailClient({ batchId }: { batchId: string }) {
  const t = getMessages("en");
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery<BatchDetailResponse>({
    queryKey: ["batch", batchId],
    queryFn: async () => {
      const res = await fetch(`/api/import/batches/${batchId}`);
      if (!res.ok) throw new Error("Batch not found.");
      return res.json();
    },
    refetchInterval: useVisibilityPolling(true, 8_000, 30_000),
  });

  const tickMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/jobs/tick?batchId=${encodeURIComponent(batchId)}`, {
        method: "POST",
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? "Tick failed");
      }
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["batch", batchId] });
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });
      void queryClient.invalidateQueries({ queryKey: ["assets"] });
    },
  });

  const retryMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/import/batches/${batchId}/retry`, { method: "POST" });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? "Retry failed");
      }
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["batch", batchId] });
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border bg-surface p-6 text-sm text-text-secondary">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading batch...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-4">
        <Link href="/import?tab=bulk" className="inline-flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary">
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Bulk Import
        </Link>
        <div className="rounded-xl border border-danger/30 bg-danger-subtle p-4 text-sm text-danger">
          {error instanceof Error ? error.message : "Batch not found."}
        </div>
      </div>
    );
  }

  const { batch, jobs } = data;
  const pct =
    batch.totalCount > 0
      ? Math.round(((batch.completedCount + batch.failedCount) / batch.totalCount) * 100)
      : 0;
  const hasQueuedOrPolling = jobs.some(
    (j) => j.status === "queued" || j.status === "provider_processing" || j.status === "retry_wait",
  );
  const hasFailed = jobs.some((j) => j.status === "failed");

  return (
    <div className="space-y-6">
      <Link href="/import?tab=bulk" className="inline-flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary">
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to Bulk Import
      </Link>

      <PageHeader
        title={`Batch ${batch.id.slice(0, 8)}`}
        subtitle={`${batch.completedCount} completed · ${batch.failedCount} failed · ${batch.totalCount} total`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge label={batch.status} tone={statusTone(batch.status)} dot />
            {hasQueuedOrPolling ? (
              <button
                type="button"
                onClick={() => tickMutation.mutate()}
                disabled={tickMutation.isPending}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
              >
                {tickMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Play className="h-3.5 w-3.5" />
                )}
                Process next chunk
              </button>
            ) : null}
            {hasFailed ? (
              <button
                type="button"
                onClick={() => retryMutation.mutate()}
                disabled={retryMutation.isPending}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-medium text-text-primary hover:bg-surface-raised disabled:opacity-50"
              >
                {retryMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="h-3.5 w-3.5" />
                )}
                Retry eligible failures
              </button>
            ) : null}
            <a
              href={`/api/import/batches/${batch.id}?format=csv`}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-medium text-text-primary hover:bg-surface-raised"
            >
              <Download className="h-3.5 w-3.5" />
              Export CSV
            </a>
          </div>
        }
      />

      <div className="space-y-1.5 rounded-xl border border-border bg-surface p-4">
        <div className="flex justify-between text-xs text-text-secondary">
          <span>Batch completion</span>
          <span className="font-mono">{pct}%</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-surface-raised">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full min-w-[640px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-text-secondary">
              <th className="px-4 py-3 font-medium">Item</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Error</th>
              <th className="px-4 py-3 font-medium">Links</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {jobs.map((job) => {
              let payload: { title?: string; redactedUrl?: string } = {};
              let result: { assetId?: string } = {};
              try {
                payload = JSON.parse(job.payloadJson) as { title?: string; redactedUrl?: string };
              } catch {}
              try {
                result = job.resultJson ? (JSON.parse(job.resultJson) as { assetId?: string }) : {};
              } catch {}

              return (
                <tr key={job.id} className="hover:bg-surface-raised/50">
                  <td className="px-4 py-3">
                    <div className="text-xs font-medium text-text-primary">
                      {payload.title || "Imported video"}
                    </div>
                    <div className="font-mono text-[11px] text-text-secondary">
                      {payload.redactedUrl ?? job.id.slice(0, 12)}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge
                      label={t.statuses.job[job.status as JobStatus] ?? job.status}
                      tone={statusTone(job.status)}
                      dot
                    />
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-danger">
                    {job.errorCode ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3 text-xs">
                      <Link href={`/jobs/${job.id}`} className="text-primary hover:underline">
                        Job
                      </Link>
                      {result.assetId ? (
                        <Link
                          href={`/library/${result.assetId}`}
                          className="text-primary hover:underline"
                        >
                          Asset
                        </Link>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
