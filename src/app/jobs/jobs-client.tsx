"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  ScrollText,
  Upload,
  XCircle,
} from "lucide-react";
import { getMessages, type JobStatus } from "@/shared";
import { useVisibilityPolling } from "@/lib/hooks/use-visibility-polling";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge, type BadgeTone } from "@/components/ui/status-badge";
import { cn } from "@/lib/cn";

interface JobsListResponse {
  tab: "jobs";
  items: Array<{
    id: string;
    jobType: string;
    status: string;
    errorCode: string | null;
    attempts: number;
    createdAt: string;
    finishedAt: string | null;
  }>;
  total: number;
  page: number;
  pageSize: number;
}

interface ActivityListResponse {
  tab: "activity";
  items: Array<{
    id: string;
    actorId: string;
    action: string;
    entityType: string;
    entityId: string;
    contextJson: string;
    createdAt: string;
  }>;
  total: number;
  page: number;
  pageSize: number;
}

function toneForJob(status: string): BadgeTone {
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
    case "verifying":
      return "info";
    default:
      return "neutral";
  }
}

export function JobsClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = searchParams.get("tab") === "activity" ? "activity" : "jobs";
  const statusFilter = searchParams.get("status") ?? "all";
  const t = getMessages("en");

  const refetchInterval = useVisibilityPolling(activeTab === "jobs", 8_000, 30_000);

  const { data, isLoading, error } = useQuery<JobsListResponse | ActivityListResponse>({
    queryKey: ["jobs", { tab: activeTab, status: statusFilter }],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("tab", activeTab);
      if (activeTab === "jobs" && statusFilter !== "all") {
        params.set("status", statusFilter);
      }
      const res = await fetch(`/api/jobs?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to load jobs");
      return res.json();
    },
    refetchInterval,
  });

  const statusFilters = [
    { key: "all", label: "All" },
    { key: "provider_processing", label: t.statuses.job.provider_processing },
    { key: "completed", label: t.statuses.job.completed },
    { key: "failed", label: t.statuses.job.failed },
    { key: "unknown", label: t.statuses.job.unknown },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t.jobs.title}
        subtitle={t.jobs.subtitle}
        actions={
          <nav
            aria-label="Jobs views"
            className="inline-flex items-center gap-1 rounded-xl border border-border bg-surface p-1 text-xs"
          >
            <Link
              href="/jobs"
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium whitespace-nowrap transition-colors",
                activeTab === "jobs"
                  ? "bg-primary-subtle text-primary"
                  : "text-text-secondary hover:text-text-primary",
              )}
            >
              <Activity className="h-3.5 w-3.5" aria-hidden="true" />
              {t.jobs.tabJobs}
            </Link>
            <Link
              href="/jobs?tab=activity"
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium whitespace-nowrap transition-colors",
                activeTab === "activity"
                  ? "bg-primary-subtle text-primary"
                  : "text-text-secondary hover:text-text-primary",
              )}
            >
              <ScrollText className="h-3.5 w-3.5" aria-hidden="true" />
              {t.jobs.tabActivity}
            </Link>
          </nav>
        }
      />

      {activeTab === "jobs" ? (
        <div className="dusk-plate flex flex-wrap items-center gap-2 px-4 py-3 text-xs">
          {statusFilters.map((f) => {
            const active = statusFilter === f.key;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() =>
                  router.push(f.key === "all" ? "/jobs" : `/jobs?status=${encodeURIComponent(f.key)}`)
                }
                className={cn(
                  "rounded-full px-3 py-1.5 font-medium transition-colors",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "bg-surface-raised/70 text-text-secondary hover:text-text-primary",
                )}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      ) : null}

      {isLoading ? (
        <div className="dusk-plate flex items-center gap-2.5 p-6 text-sm text-text-secondary">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          Loading…
        </div>
      ) : null}

      {error ? (
        <div className="rounded-2xl bg-danger-subtle p-4 text-sm text-danger">
          {error instanceof Error ? error.message : "Failed to load records."}
        </div>
      ) : null}

      {data && data.tab === "jobs" ? (
        data.items.length > 0 ? (
          <section className="dusk-plate overflow-hidden">
            <div className="flex items-center justify-between border-b border-border/80 px-5 py-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-subtle text-primary">
                  <Activity className="h-4 w-4" aria-hidden="true" />
                </div>
                <h2 className="text-sm font-semibold text-text-primary">
                  Job queue ({data.total})
                </h2>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-border/80 bg-surface-raised/35 text-xs text-text-secondary">
                    <th className="px-5 py-3 font-medium whitespace-nowrap">Job</th>
                    <th className="px-4 py-3 font-medium whitespace-nowrap">Status</th>
                    <th className="px-4 py-3 font-medium whitespace-nowrap">Attempts</th>
                    <th className="px-4 py-3 font-medium whitespace-nowrap">Error</th>
                    <th className="px-5 py-3 font-medium whitespace-nowrap">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70">
                  {data.items.map((job) => {
                    const tone = toneForJob(job.status);
                    return (
                      <tr key={job.id} className="transition-colors hover:bg-surface-raised/35">
                        <td className="px-5 py-3.5">
                          <Link href={`/jobs/${job.id}`} className="flex items-center gap-3">
                            <span
                              className={cn(
                                "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                                tone === "success"
                                  ? "bg-success-subtle text-success"
                                  : tone === "danger"
                                    ? "bg-danger-subtle text-danger"
                                    : tone === "warning"
                                      ? "bg-warning-subtle text-warning"
                                      : "bg-primary-subtle text-primary",
                              )}
                            >
                              {tone === "success" ? (
                                <CheckCircle2 className="h-4 w-4" />
                              ) : tone === "danger" ? (
                                <XCircle className="h-4 w-4" />
                              ) : tone === "warning" ? (
                                <AlertTriangle className="h-4 w-4" />
                              ) : (
                                <Upload className="h-4 w-4" />
                              )}
                            </span>
                            <div>
                              <div className="font-mono text-xs font-medium text-text-primary hover:text-primary">
                                {job.jobType}
                              </div>
                              <div className="font-mono text-xs text-text-secondary">
                                {job.id.slice(0, 12)}
                              </div>
                            </div>
                          </Link>
                        </td>
                        <td className="px-4 py-3.5">
                          <StatusBadge
                            label={t.statuses.job[job.status as JobStatus] ?? job.status}
                            tone={tone}
                            dot
                          />
                        </td>
                        <td className="px-4 py-3.5 tabular-nums text-xs text-text-secondary">
                          {job.attempts}
                        </td>
                        <td className="px-4 py-3.5 font-mono text-xs text-danger">
                          {job.errorCode ?? "None"}
                        </td>
                        <td className="px-5 py-3.5 tabular-nums text-xs text-text-secondary">
                          {new Date(job.createdAt).toLocaleString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ) : (
          <EmptyState icon={Activity} title={t.jobs.emptyTitle} body={t.jobs.emptyBody} />
        )
      ) : null}

      {data && data.tab === "activity" ? (
        data.items.length > 0 ? (
          <section className="dusk-plate overflow-hidden">
            <div className="flex items-center justify-between border-b border-border/80 px-5 py-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-subtle text-violet">
                  <ScrollText className="h-4 w-4" aria-hidden="true" />
                </div>
                <h2 className="text-sm font-semibold text-text-primary">
                  Audit activity ({data.total})
                </h2>
              </div>
            </div>
            <ol className="divide-y divide-border/70 px-5">
              {data.items.map((ev, idx) => {
                const dotColor =
                  idx % 3 === 0 ? "bg-success" : idx % 3 === 1 ? "bg-info" : "bg-violet";
                return (
                  <li
                    key={ev.id}
                    className="flex flex-col gap-1.5 py-3.5 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex items-center gap-3">
                      <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", dotColor)} />
                      <div className="min-w-0">
                        <div className="font-mono text-xs font-medium text-text-primary">
                          {ev.action}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-text-secondary">
                          <span className="font-mono">
                            {ev.entityType}:{ev.entityId.slice(0, 8)}
                          </span>
                          <span>·</span>
                          <span>{ev.actorId}</span>
                        </div>
                      </div>
                    </div>
                    <span className="shrink-0 tabular-nums text-xs text-text-secondary">
                      {new Date(ev.createdAt).toLocaleString()}
                    </span>
                  </li>
                );
              })}
            </ol>
          </section>
        ) : (
          <EmptyState
            icon={ScrollText}
            title={t.jobs.activityEmptyTitle}
            body={t.jobs.activityEmptyBody}
          />
        )
      ) : null}
    </div>
  );
}
