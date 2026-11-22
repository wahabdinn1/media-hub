"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Activity, Loader2, ScrollText } from "lucide-react";
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
          <div className="inline-flex rounded-lg border border-border bg-surface p-0.5 text-xs font-medium">
            <Link
              href="/jobs"
              className={cn(
                "rounded-md px-3 py-1.5",
                activeTab === "jobs"
                  ? "bg-surface-raised text-text-primary"
                  : "text-text-secondary hover:text-text-primary",
              )}
            >
              {t.jobs.tabJobs}
            </Link>
            <Link
              href="/jobs?tab=activity"
              className={cn(
                "rounded-md px-3 py-1.5",
                activeTab === "activity"
                  ? "bg-surface-raised text-text-primary"
                  : "text-text-secondary hover:text-text-primary",
              )}
            >
              {t.jobs.tabActivity}
            </Link>
          </div>
        }
      />

      {activeTab === "jobs" ? (
        <div className="flex flex-wrap gap-1.5">
          {statusFilters.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() =>
                router.push(f.key === "all" ? "/jobs" : `/jobs?status=${encodeURIComponent(f.key)}`)
              }
              className={cn(
                "rounded-lg border px-2.5 py-1.5 text-xs font-medium",
                statusFilter === f.key
                  ? "border-primary/40 bg-primary-subtle text-primary"
                  : "border-border bg-surface text-text-secondary hover:text-text-primary",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      ) : null}

      {isLoading ? (
        <div className="flex items-center gap-2 rounded-xl border border-border bg-surface p-6 text-sm text-text-secondary">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-danger/30 bg-danger-subtle p-4 text-sm text-danger">
          {error instanceof Error ? error.message : "Failed to load records."}
        </div>
      ) : null}

      {data && data.tab === "jobs" ? (
        data.items.length > 0 ? (
          <div className="overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="w-full min-w-[600px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-text-secondary">
                  <th className="px-4 py-3 font-medium">Job</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Attempts</th>
                  <th className="px-4 py-3 font-medium">Error</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.items.map((job) => (
                  <tr key={job.id} className="hover:bg-surface-raised/50">
                    <td className="px-4 py-3">
                      <Link href={`/jobs/${job.id}`} className="block">
                        <div className="font-mono text-xs font-medium text-text-primary hover:text-primary">
                          {job.jobType}
                        </div>
                        <div className="font-mono text-[11px] text-text-secondary">
                          {job.id.slice(0, 12)}
                        </div>
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge
                        label={t.statuses.job[job.status as JobStatus] ?? job.status}
                        tone={toneForJob(job.status)}
                        dot
                      />
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-text-secondary">
                      {job.attempts}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-danger">
                      {job.errorCode ?? "—"}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-text-secondary">
                      {new Date(job.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={Activity} title={t.jobs.emptyTitle} body={t.jobs.emptyBody} />
        )
      ) : null}

      {data && data.tab === "activity" ? (
        data.items.length > 0 ? (
          <div className="overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="w-full min-w-[600px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-text-secondary">
                  <th className="px-4 py-3 font-medium">Action</th>
                  <th className="px-4 py-3 font-medium">Entity</th>
                  <th className="px-4 py-3 font-medium">Actor</th>
                  <th className="px-4 py-3 font-medium">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.items.map((ev) => (
                  <tr key={ev.id} className="hover:bg-surface-raised/50">
                    <td className="px-4 py-3 font-mono text-xs font-medium text-text-primary">
                      {ev.action}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-text-secondary">
                      {ev.entityType}:{ev.entityId.slice(0, 8)}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-text-secondary">
                      {ev.actorId}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-text-secondary">
                      {new Date(ev.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
