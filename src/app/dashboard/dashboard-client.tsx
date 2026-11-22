"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Film,
  Folder,
  Layers,
  Link2,
  Loader2,
  Play,
  RefreshCw,
  Upload,
  Workflow,
  XCircle,
} from "lucide-react";
import {
  evaluateQuotaState,
  type ProviderAccountInfo,
  type QuotaGuardEvaluation,
} from "@/core";
import { getMessages, type CanonicalAssetStatus, type JobStatus } from "@/shared";
import { useUiStore } from "@/store/ui-store";
import { QuotaMeter } from "@/components/ui/quota-meter";
import { StatusBadge, type BadgeTone } from "@/components/ui/status-badge";
import { cn } from "@/lib/cn";

const AnalyticsPanel = dynamic(
  () => import("@/components/analytics/analytics-panel").then((mod) => mod.AnalyticsPanel),
  {
    ssr: false,
    loading: () => (
      <div className="dusk-well flex items-center gap-2 p-6 text-sm text-text-secondary">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading charts…
      </div>
    ),
  },
);

interface DashboardResponse {
  dbMode: string;
  ownerLabel?: string;
  summary: {
    totalAssets: number;
    totalCollections: number;
    totalFolders: number;
    processingAssets: number;
    dmcaAssets: number;
    removedAssets: number;
    jobsCompleted: number;
    jobsFailed: number;
    jobsInProgress: number;
    jobsUnknown: number;
  };
  defaultConnection: {
    id: string;
    providerKey: string;
    status: string;
    isDefault: boolean;
    accountInfo: ProviderAccountInfo | null;
  } | null;
  recentAssets: Array<{
    id: string;
    title: string;
    canonicalStatus: CanonicalAssetStatus;
    sizeBytes: number | null;
    durationSeconds: number | null;
    createdAt: string;
    thumbnailUrl: string | null;
  }>;
  recentJobs: Array<{
    id: string;
    jobType: string;
    status: string;
    errorCode: string | null;
    createdAt: string;
  }>;
  recentActivity: Array<{
    id: string;
    action: string;
    entityType: string;
    entityId: string;
    createdAt: string;
  }>;
  alerts: Array<{
    id: string;
    severity: "warning" | "danger";
    message: string;
    href: string;
  }>;
  quota: QuotaGuardEvaluation;
}

function assetTone(status: CanonicalAssetStatus): BadgeTone {
  switch (status) {
    case "active":
      return "success";
    case "processing":
      return "info";
    case "removed_remote":
      return "warning";
    default:
      return "danger";
  }
}

function jobTone(status: string): BadgeTone {
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

function formatBytes(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return "0 MB";
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

export function DashboardClient() {
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const activeTab = searchParams.get("tab") === "analytics" ? "analytics" : "overview";
  const t = getMessages("en");
  const killSwitchEnabled = useUiStore((s) => s.killSwitchEnabled);

  const { data, isFetching } = useQuery<DashboardResponse>({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const res = await fetch("/api/dashboard");
      if (!res.ok) throw new Error("Failed to load dashboard");
      return res.json();
    },
  });

  const defaultConn = data?.defaultConnection ?? null;
  const summary = data?.summary;
  const quota = data?.quota
    ? {
        ...data.quota,
        killSwitchEnabled,
        overallLevel: killSwitchEnabled ? ("paused" as const) : data.quota.overallLevel,
      }
    : evaluateQuotaState({}, { killSwitchEnabled });

  const storageUsed = defaultConn?.accountInfo?.storageUsedBytes ?? 0;
  const storageLimit = defaultConn?.accountInfo?.storageLimitBytes ?? 0;
  const storagePercent =
    storageLimit > 0
      ? Math.min(100, Math.round((storageUsed / storageLimit) * 1000) / 10)
      : quota.meters[0]?.percent ?? 0;

  const ringRadius = 46;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const ringOffset = ringCircumference * (1 - Math.min(100, storagePercent) / 100);

  const systemStatusLabel =
    quota.overallLevel === "paused"
      ? "Kill-Switch Active"
      : quota.overallLevel === "degraded"
        ? "Degrade Mode Active"
        : defaultConn?.status === "error"
          ? "Provider Attention Needed"
          : "All Systems Operational";

  const systemStatusColor =
    quota.overallLevel === "paused" || quota.overallLevel === "degraded"
      ? "bg-warning"
      : defaultConn?.status === "error"
        ? "bg-danger"
        : "bg-success";

  return (
    <div className="space-y-6">
      {/* Header Row matching Bento Mockup */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-text-primary sm:text-[1.75rem]">
            {activeTab === "analytics" ? "Analytics" : "Welcome back"}
          </h1>
          <p className="text-sm text-text-secondary">
            {activeTab === "analytics"
              ? "Job telemetry, processing latency, and provider views."
              : "Here is what is happening with your MediaHub workspace today."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3.5 py-2 text-xs">
            <span className={cn("h-2 w-2 rounded-full", systemStatusColor)} aria-hidden="true" />
            <span className="font-medium text-text-primary">{systemStatusLabel}</span>
          </div>

          <button
            type="button"
            onClick={() => void queryClient.invalidateQueries({ queryKey: ["dashboard"] })}
            disabled={isFetching}
            className="dusk-btn-ghost h-9 px-3.5 text-xs disabled:opacity-60"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
            Refresh
          </button>
        </div>
      </div>

      {/* View Switcher (Overview / Analytics) */}
      <nav aria-label="Dashboard views" className="flex items-center gap-5 border-b border-border text-sm">
        <Link
          href="/dashboard"
          className={cn(
            "inline-flex items-center gap-2 border-b-2 pb-2.5 font-medium whitespace-nowrap transition-colors",
            activeTab === "overview"
              ? "border-primary text-text-primary"
              : "border-transparent text-text-secondary hover:text-text-primary",
          )}
        >
          {t.dashboard.tabOverview}
        </Link>
        <Link
          href="/dashboard?tab=analytics"
          className={cn(
            "inline-flex items-center gap-2 border-b-2 pb-2.5 font-medium whitespace-nowrap transition-colors",
            activeTab === "analytics"
              ? "border-primary text-text-primary"
              : "border-transparent text-text-secondary hover:text-text-primary",
          )}
        >
          {t.dashboard.tabAnalytics}
        </Link>
      </nav>

      {activeTab === "analytics" ? (
        <AnalyticsPanel />
      ) : (
        <>
          {/* Row 1: 4 Rich Bento KPI Cards */}
          <section
            aria-label="Key metrics"
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
          >
            <Link
              href="/library"
              className="dusk-plate group flex items-center gap-4 p-5 transition-colors hover:border-border-strong"
            >
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-subtle text-primary">
                <Play className="h-5 w-5 fill-current" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-medium text-text-secondary">Total Videos</div>
                <div className="mt-0.5 font-display text-2xl font-semibold tabular-nums text-text-primary">
                  {new Intl.NumberFormat("en-US").format(summary?.totalAssets ?? 0)}
                </div>
                <div className="mt-0.5 text-xs text-primary">
                  {summary?.processingAssets
                    ? `${summary.processingAssets} encoding`
                    : `${defaultConn?.accountInfo?.videoCount ?? 0} on host`}
                </div>
              </div>
            </Link>

            <Link
              href="/library"
              className="dusk-plate group flex items-center gap-4 p-5 transition-colors hover:border-border-strong"
            >
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-violet-subtle text-violet">
                <Folder className="h-5 w-5" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-medium text-text-secondary">Collections</div>
                <div className="mt-0.5 font-display text-2xl font-semibold tabular-nums text-text-primary">
                  {new Intl.NumberFormat("en-US").format(summary?.totalCollections ?? 0)}
                </div>
                <div className="mt-0.5 text-xs text-text-secondary">
                  {summary?.totalFolders ?? 0} provider folder(s)
                </div>
              </div>
            </Link>

            <Link
              href="/jobs?status=completed"
              className="dusk-plate group flex items-center gap-4 p-5 transition-colors hover:border-border-strong"
            >
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-success-subtle text-success">
                <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-medium text-text-secondary">Completed Jobs</div>
                <div className="mt-0.5 font-display text-2xl font-semibold tabular-nums text-text-primary">
                  {new Intl.NumberFormat("en-US").format(summary?.jobsCompleted ?? 0)}
                </div>
                <div className="mt-0.5 text-xs text-success">
                  {summary?.jobsInProgress ?? 0} active now
                </div>
              </div>
            </Link>

            <Link
              href="/jobs?status=failed"
              className="dusk-plate group flex items-center gap-4 p-5 transition-colors hover:border-border-strong"
            >
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-danger-subtle text-danger">
                <AlertCircle className="h-5 w-5" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-medium text-text-secondary">Failed Jobs</div>
                <div className="mt-0.5 font-display text-2xl font-semibold tabular-nums text-text-primary">
                  {new Intl.NumberFormat("en-US").format(summary?.jobsFailed ?? 0)}
                </div>
                <div className="mt-0.5 text-xs text-danger">
                  {summary?.jobsUnknown ?? 0} need check
                </div>
              </div>
            </Link>
          </section>

          {/* Row 2: Provider Status + Storage Overview (50/50 Bento) */}
          <section className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <div className="dusk-plate flex flex-col justify-between gap-4 p-5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <h2 className="text-base font-semibold text-text-primary">Provider Status</h2>
                  {defaultConn ? (
                    <StatusBadge
                      label={defaultConn.status === "active" ? "Connected" : "Auth error"}
                      tone={defaultConn.status === "active" ? "success" : "danger"}
                    />
                  ) : (
                    <StatusBadge label="Not connected" tone="neutral" />
                  )}
                </div>
                <Link
                  href="/providers"
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  View Details
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </div>

              {defaultConn ? (
                <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-bg/70 p-4">
                  <div className="flex items-center gap-3.5">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-subtle font-display text-base font-bold uppercase text-violet">
                      {defaultConn.providerKey.slice(0, 2)}
                    </div>
                    <div>
                      <div className="text-base font-semibold capitalize text-text-primary">
                        {defaultConn.providerKey}
                      </div>
                      <div className="mt-0.5 text-xs text-text-secondary">
                        <span className="font-medium text-success">
                          {defaultConn.status === "active" ? "Active" : "Error"}
                        </span>
                        {defaultConn.accountInfo?.accountLabel
                          ? ` (${defaultConn.accountInfo.accountLabel})`
                          : ""}
                      </div>
                    </div>
                  </div>

                  <div className="text-right tabular-nums">
                    <div className="text-sm font-semibold text-text-primary">
                      {new Intl.NumberFormat("en-US").format(
                        defaultConn.accountInfo?.videoCount ?? 0,
                      )}{" "}
                      videos
                    </div>
                    <div className="text-xs text-text-secondary">
                      {formatBytes(defaultConn.accountInfo?.storageUsedBytes)}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between rounded-xl border border-dashed border-border-strong bg-bg/60 p-4 text-xs text-text-secondary">
                  <span>No active video host connected yet.</span>
                  <Link href="/providers" className="dusk-btn-primary h-8 px-3 text-xs">
                    Connect provider
                  </Link>
                </div>
              )}

              {data?.alerts && data.alerts.length > 0 ? (
                <div className="space-y-1.5">
                  {data.alerts.map((alert) => (
                    <Link
                      key={alert.id}
                      href={alert.href}
                      className={cn(
                        "flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium",
                        alert.severity === "danger"
                          ? "bg-danger-subtle text-danger"
                          : "bg-warning-subtle text-warning",
                      )}
                    >
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                      <span>{alert.message}</span>
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="dusk-plate flex flex-col justify-between gap-4 p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-text-primary">Storage Overview</h2>
                <Link
                  href="/settings"
                  className="text-xs font-medium text-primary hover:underline"
                >
                  Quota Guard
                </Link>
              </div>

              <div className="flex flex-col items-center gap-6 sm:flex-row">
                <div className="relative flex h-28 w-28 shrink-0 items-center justify-center">
                  <svg className="h-28 w-28 -rotate-90" viewBox="0 0 112 112" aria-hidden="true">
                    <circle
                      cx="56"
                      cy="56"
                      r={ringRadius}
                      fill="none"
                      stroke="var(--color-surface-raised)"
                      strokeWidth="10"
                    />
                    <circle
                      cx="56"
                      cy="56"
                      r={ringRadius}
                      fill="none"
                      stroke="var(--color-primary)"
                      strokeWidth="10"
                      strokeLinecap="round"
                      strokeDasharray={ringCircumference}
                      strokeDashoffset={ringOffset}
                    />
                  </svg>
                  <span className="absolute font-display text-lg font-semibold tabular-nums text-text-primary">
                    {storagePercent}%
                  </span>
                </div>

                <div className="flex-1 space-y-2.5 text-xs">
                  <div>
                    <div className="font-display text-lg font-semibold tabular-nums text-text-primary">
                      {storageLimit > 0
                        ? `${formatBytes(storageUsed)} / ${formatBytes(storageLimit)}`
                        : `${formatBytes(storageUsed)} used`}
                    </div>
                    <div className="text-text-secondary">
                      {storageLimit > 0 ? "Provider account storage" : "Cloudflare D1 & host usage"}
                    </div>
                  </div>
                  <div className="space-y-1.5 pt-1 tabular-nums">
                    <div className="flex items-center justify-between text-text-secondary">
                      <span className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-primary" />
                        Registered videos
                      </span>
                      <span className="font-medium text-text-primary">
                        {summary?.totalAssets ?? 0}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-text-secondary">
                      <span className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-violet" />
                        Collections &amp; folders
                      </span>
                      <span className="font-medium text-text-primary">
                        {(summary?.totalCollections ?? 0) + (summary?.totalFolders ?? 0)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-text-secondary">
                      <span className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-success" />
                        Quota guard level
                      </span>
                      <span className="font-medium capitalize text-text-primary">
                        {quota.overallLevel}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Row 3: Recent Uploads + Recent Jobs (50/50 Bento) */}
          <section className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <div className="dusk-plate space-y-4 p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-text-primary">Recent Uploads</h2>
                <Link
                  href="/library"
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  View All
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </div>

              {data?.recentAssets && data.recentAssets.length > 0 ? (
                <ul className="divide-y divide-border/70">
                  {data.recentAssets.map((item) => (
                    <li key={item.id}>
                      <Link
                        href={`/library/${item.id}`}
                        className="flex items-center justify-between gap-3 py-3 transition-colors hover:opacity-90"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="flex h-11 w-18 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-bg">
                            {item.thumbnailUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={item.thumbnailUrl}
                                alt=""
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <Film className="h-4 w-4 text-text-secondary" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-text-primary">
                              {item.title}
                            </div>
                            <div className="mt-0.5 tabular-nums text-xs text-text-secondary">
                              {new Date(item.createdAt).toLocaleDateString()}
                              {item.sizeBytes ? `, ${formatBytes(item.sizeBytes)}` : ""}
                            </div>
                          </div>
                        </div>
                        <StatusBadge
                          label={t.statuses.asset[item.canonicalStatus]}
                          tone={assetTone(item.canonicalStatus)}
                        />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="flex items-center gap-2.5 rounded-xl bg-bg/70 px-4 py-6 text-xs text-text-secondary">
                  <Film className="h-4 w-4 shrink-0 text-primary" />
                  <span>No videos synced yet. Sync from provider or import a direct URL.</span>
                </div>
              )}
            </div>

            <div className="dusk-plate space-y-4 p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-text-primary">Recent Jobs</h2>
                <Link
                  href="/jobs"
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  View All
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </div>

              {data?.recentJobs && data.recentJobs.length > 0 ? (
                <ul className="divide-y divide-border/70">
                  {data.recentJobs.map((job) => (
                    <li key={job.id}>
                      <Link
                        href={`/jobs/${job.id}`}
                        className="flex items-center justify-between gap-3 py-3 transition-colors hover:opacity-90"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <span
                            className={cn(
                              "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                              job.status === "completed"
                                ? "bg-success-subtle text-success"
                                : job.status === "failed"
                                  ? "bg-danger-subtle text-danger"
                                  : "bg-primary-subtle text-primary",
                            )}
                          >
                            {job.status === "completed" ? (
                              <CheckCircle2 className="h-4 w-4" />
                            ) : job.status === "failed" ? (
                              <XCircle className="h-4 w-4" />
                            ) : (
                              <Upload className="h-4 w-4" />
                            )}
                          </span>
                          <div className="min-w-0">
                            <div className="truncate font-mono text-xs font-medium text-text-primary">
                              {job.jobType}
                            </div>
                            <div className="mt-0.5 tabular-nums text-xs text-text-secondary">
                              {new Date(job.createdAt).toLocaleString()}
                            </div>
                          </div>
                        </div>
                        <StatusBadge
                          label={t.statuses.job[job.status as JobStatus] ?? job.status}
                          tone={jobTone(job.status)}
                        />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="flex items-center gap-2.5 rounded-xl bg-bg/70 px-4 py-6 text-xs text-text-secondary">
                  <Activity className="h-4 w-4 shrink-0 text-primary" />
                  <span>No jobs recorded yet.</span>
                </div>
              )}
            </div>
          </section>

          {/* Row 4: Quick Actions (8 cols) + Recent Activity Timeline (4 cols) */}
          <section className="grid grid-cols-1 gap-5 lg:grid-cols-12">
            <div className="dusk-plate space-y-4 p-5 lg:col-span-8">
              <h2 className="text-base font-semibold text-text-primary">Quick Actions</h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Link
                  href="/import?tab=url"
                  className="flex flex-col items-center justify-center gap-2 rounded-xl border border-border bg-bg/70 px-4 py-5 text-center transition-colors hover:border-primary/50 hover:bg-surface-raised"
                >
                  <Link2 className="h-6 w-6 text-primary" aria-hidden="true" />
                  <div className="text-sm font-medium text-text-primary">Import URL</div>
                  <div className="text-xs text-text-secondary">Direct video link</div>
                </Link>

                <Link
                  href="/import?tab=bulk"
                  className="flex flex-col items-center justify-center gap-2 rounded-xl border border-border bg-bg/70 px-4 py-5 text-center transition-colors hover:border-primary/50 hover:bg-surface-raised"
                >
                  <Layers className="h-6 w-6 text-violet" aria-hidden="true" />
                  <div className="text-sm font-medium text-text-primary">Bulk Operation</div>
                  <div className="text-xs text-text-secondary">Process multiple</div>
                </Link>

                <Link
                  href="/library"
                  className="flex flex-col items-center justify-center gap-2 rounded-xl border border-border bg-bg/70 px-4 py-5 text-center transition-colors hover:border-primary/50 hover:bg-surface-raised"
                >
                  <Folder className="h-6 w-6 text-info" aria-hidden="true" />
                  <div className="text-sm font-medium text-text-primary">Media Library</div>
                  <div className="text-xs text-text-secondary">Folders &amp; collections</div>
                </Link>

                <Link
                  href="/automation"
                  className="flex flex-col items-center justify-center gap-2 rounded-xl border border-border bg-bg/70 px-4 py-5 text-center transition-colors hover:border-primary/50 hover:bg-surface-raised"
                >
                  <Workflow className="h-6 w-6 text-success" aria-hidden="true" />
                  <div className="text-sm font-medium text-text-primary">Create Workflow</div>
                  <div className="text-xs text-text-secondary">Automate tasks</div>
                </Link>
              </div>
            </div>

            <div className="dusk-plate space-y-4 p-5 lg:col-span-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-text-primary">Recent Activity</h2>
                <Link
                  href="/jobs?tab=activity"
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  View All
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </div>

              {data?.recentActivity && data.recentActivity.length > 0 ? (
                <ol className="relative space-y-4 border-l border-border pl-4">
                  {data.recentActivity.map((ev, idx) => (
                    <li key={ev.id} className="relative">
                      <span
                        className={cn(
                          "absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-surface",
                          idx === 0
                            ? "bg-success"
                            : idx === 1
                              ? "bg-primary"
                              : "bg-violet",
                        )}
                        aria-hidden="true"
                      />
                      <div className="font-mono text-xs font-medium text-text-primary">
                        {ev.action}
                      </div>
                      <div className="mt-0.5 tabular-nums text-xs text-text-secondary">
                        {ev.entityType}, {new Date(ev.createdAt).toLocaleTimeString()}
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-xs text-text-secondary">No activity logged yet.</p>
              )}
            </div>
          </section>

          {/* Row 5: Free-Tier Quota Guardrails */}
          <section className="dusk-plate space-y-3 p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold text-text-primary">{t.dashboard.quotaTitle}</h2>
              <p className="text-xs text-text-secondary">{t.dashboard.quotaSubtitle}</p>
            </div>
            <div className="grid grid-cols-1 gap-x-8 divide-y divide-border/70 border-t border-border sm:grid-cols-2 lg:grid-cols-4 lg:divide-y-0">
              {quota.meters.map((meter) => (
                <QuotaMeter key={meter.metric} meter={meter} />
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
