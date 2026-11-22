"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, RefreshCw } from "lucide-react";
import { getMessages, type JobStatus } from "@/shared";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge, type BadgeTone } from "@/components/ui/status-badge";

interface JobDetailResponse {
  job: {
    id: string;
    jobType: string;
    status: string;
    payloadJson: string;
    resultJson: string | null;
    errorCode: string | null;
    attempts: number;
    createdAt: string;
    startedAt: string | null;
    finishedAt: string | null;
  };
  events: Array<{
    id: string;
    eventType: string;
    message: string;
    dataJson: string;
    createdAt: string;
  }>;
}

function toneForStatus(status: string): BadgeTone {
  switch (status) {
    case "completed":
      return "success";
    case "failed":
      return "danger";
    case "unknown":
    case "retry_wait":
      return "warning";
    case "processing":
    case "provider_processing":
      return "info";
    default:
      return "neutral";
  }
}

export function JobDetailClient({ jobId }: { jobId: string }) {
  const t = getMessages("en");
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery<JobDetailResponse>({
    queryKey: ["job", jobId],
    queryFn: async () => {
      const res = await fetch(`/api/jobs/${jobId}`);
      if (!res.ok) throw new Error("Job not found");
      return res.json();
    },
  });

  const pollMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/jobs/${jobId}/poll`, { method: "POST" });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Action failed");
      return json;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["job", jobId] });
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });
      void queryClient.invalidateQueries({ queryKey: ["assets"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  if (isLoading) {
    return (
      <div className="dusk-well flex items-center gap-2 p-6 text-sm text-text-secondary">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading job…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-4">
        <Link
          href="/jobs"
          className="inline-flex items-center gap-1.5 text-xs text-text-secondary hover:text-text-primary"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Jobs
        </Link>
        <div className="rounded-xl bg-danger-subtle p-4 text-sm text-danger">
          {error instanceof Error ? error.message : "Job not found."}
        </div>
      </div>
    );
  }

  const { job, events } = data;
  let parsedResult: Record<string, unknown> | null = null;
  try {
    parsedResult = job.resultJson ? (JSON.parse(job.resultJson) as Record<string, unknown>) : null;
  } catch {
    parsedResult = null;
  }

  const linkedAssetId =
    parsedResult && typeof parsedResult.assetId === "string" ? parsedResult.assetId : null;

  return (
    <div className="space-y-8">
      <Link
        href="/jobs"
        className="inline-flex items-center gap-1.5 text-xs text-text-secondary hover:text-text-primary"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to Jobs
      </Link>

      <PageHeader
        title={job.jobType}
        subtitle={`Job ID: ${job.id}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge
              label={t.statuses.job[job.status as JobStatus] ?? job.status}
              tone={toneForStatus(job.status)}
              dot
            />
            {job.status === "provider_processing" ? (
              <button
                type="button"
                onClick={() => pollMutation.mutate()}
                disabled={pollMutation.isPending}
                className="dusk-btn-primary h-8 px-3.5 text-xs disabled:opacity-50"
              >
                {pollMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                Check encoding status
              </button>
            ) : null}
            {job.status === "unknown" ? (
              <button
                type="button"
                onClick={() => pollMutation.mutate()}
                disabled={pollMutation.isPending}
                className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full bg-warning px-3.5 text-xs font-medium text-bg hover:opacity-90 disabled:opacity-50"
              >
                {pollMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                {t.jobs.reconcileAction}
              </button>
            ) : null}
            {linkedAssetId ? (
              <Link href={`/library/${linkedAssetId}`} className="dusk-btn-ghost h-8 px-3.5 text-xs">
                Open asset
              </Link>
            ) : null}
          </div>
        }
      />

      {pollMutation.error ? (
        <div className="rounded-xl bg-danger-subtle p-3.5 text-xs text-danger">
          {pollMutation.error instanceof Error ? pollMutation.error.message : "Action failed."}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <section className="dusk-plate space-y-3 p-5">
          <h2 className="text-sm font-semibold text-text-primary">Redacted payload</h2>
          <pre className="overflow-x-auto rounded-xl border border-border/70 bg-bg/60 p-4 font-mono text-xs text-text-primary">
            {job.payloadJson}
          </pre>
        </section>

        <section className="dusk-plate space-y-3 p-5">
          <h2 className="text-sm font-semibold text-text-primary">Result summary</h2>
          <pre className="overflow-x-auto rounded-xl border border-border/70 bg-bg/60 p-4 font-mono text-xs text-text-primary">
            {job.resultJson ?? "{}"}
          </pre>
        </section>
      </div>

      <section className="dusk-plate overflow-hidden">
        <div className="border-b border-border/80 px-5 py-4">
          <h2 className="text-base font-semibold text-text-primary">
            Event timeline ({events.length})
          </h2>
        </div>
        <ol className="divide-y divide-border/70 px-5">
          {events.map((ev, idx) => (
            <li
              key={ev.id}
              className="flex flex-col gap-1.5 py-3.5 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex items-start gap-3">
                <span
                  className={
                    idx % 2 === 0
                      ? "mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-primary"
                      : "mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-info"
                  }
                />
                <div className="space-y-0.5">
                  <div className="font-mono text-xs font-medium text-text-primary">
                    {ev.eventType}
                  </div>
                  <p className="text-xs text-text-secondary">{ev.message}</p>
                </div>
              </div>
              <span className="shrink-0 tabular-nums text-xs text-text-secondary">
                {new Date(ev.createdAt).toLocaleString()}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
