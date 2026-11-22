"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Circle,
  FileSpreadsheet,
  Link2,
  Upload,
} from "lucide-react";
import {
  evaluateQuotaState,
  type ProviderAccountInfo,
  type QuotaGuardEvaluation,
} from "@/core";
import { getMessages, type JobStatus } from "@/shared";
import { useUiStore } from "@/store/ui-store";
import { PageHeader } from "@/components/ui/page-header";
import { QuotaMeter } from "@/components/ui/quota-meter";
import { StatusBadge, type BadgeTone } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/cn";

interface DashboardResponse {
  dbMode: string;
  summary: {
    totalAssets: number;
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

function jobStatusTone(status: string): BadgeTone {
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

export function DashboardClient() {
  const searchParams = useSearchParams();
  const activeTab = searchParams.get("tab") === "analytics" ? "analytics" : "overview";
  const t = getMessages("en");
  const killSwitchEnabled = useUiStore((s) => s.killSwitchEnabled);

  const { data } = useQuery<DashboardResponse>({
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

  const onboardingSteps = [
    { id: "poc", label: t.dashboard.stepPoc, done: true, phase: "Phase 0" },
    { id: "access", label: t.dashboard.stepAccess, done: true, phase: "Phase 1" },
    {
      id: "provider",
      label: t.dashboard.stepProvider,
      done: Boolean(defaultConn && defaultConn.status === "active"),
      phase: "Phase 2",
    },
    {
      id: "sync",
      label: t.dashboard.stepSync,
      done: (summary?.totalAssets ?? 0) > 0,
      phase: "Phase 3",
    },
  ];

  const quotaTone: BadgeTone =
    quota.overallLevel === "paused" || quota.overallLevel === "warning"
      ? "warning"
      : quota.overallLevel === "degraded"
        ? "danger"
        : "success";

  const quotaLabel =
    quota.overallLevel === "paused"
      ? t.quotas.statusPaused
      : quota.overallLevel === "degraded"
        ? t.quotas.statusDegraded
        : quota.overallLevel === "warning"
          ? t.quotas.statusWarning
          : t.quotas.statusOk;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t.dashboard.title}
        subtitle={t.dashboard.subtitle}
        actions={
          <div className="inline-flex rounded-lg border border-border bg-surface p-0.5 text-xs font-medium">
            <Link
              href="/dashboard"
              className={cn(
                "rounded-md px-3 py-1.5",
                activeTab === "overview"
                  ? "bg-surface-raised text-text-primary"
                  : "text-text-secondary hover:text-text-primary",
              )}
            >
              {t.dashboard.tabOverview}
            </Link>
            <Link
              href="/dashboard?tab=analytics"
              className={cn(
                "rounded-md px-3 py-1.5",
                activeTab === "analytics"
                  ? "bg-surface-raised text-text-primary"
                  : "text-text-secondary hover:text-text-primary",
              )}
            >
              {t.dashboard.tabAnalytics}
            </Link>
          </div>
        }
      />

      {activeTab === "analytics" ? (
        <EmptyState
          icon={BarChart3}
          title={t.dashboard.analyticsEmptyTitle}
          body={t.dashboard.analyticsEmptyBody}
        />
      ) : (
        <>
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Link
              href="/library"
              className="rounded-xl border border-border bg-surface p-4 transition-colors hover:border-border-strong"
            >
              <div className="text-xs text-text-secondary">{t.dashboard.metricAssets}</div>
              <div className="mt-2 font-mono text-xl font-semibold text-text-primary">
                {new Intl.NumberFormat("en-US").format(summary?.totalAssets ?? 0)}
              </div>
              {summary && summary.processingAssets > 0 ? (
                <div className="mt-1 text-xs text-info">
                  {summary.processingAssets} encoding
                </div>
              ) : null}
            </Link>

            <Link
              href="/providers"
              className="rounded-xl border border-border bg-surface p-4 transition-colors hover:border-border-strong"
            >
              <div className="text-xs text-text-secondary">{t.dashboard.metricDefaultProvider}</div>
              <div className="mt-2 flex items-center gap-2">
                {defaultConn ? (
                  <StatusBadge
                    label={`${defaultConn.providerKey} · ${defaultConn.status}`}
                    tone={defaultConn.status === "active" ? "success" : "danger"}
                    dot
                  />
                ) : (
                  <StatusBadge label={t.dashboard.unconnected} tone="neutral" />
                )}
              </div>
              {defaultConn?.accountInfo?.videoCount !== undefined ? (
                <div className="mt-1.5 font-mono text-xs text-text-secondary">
                  {new Intl.NumberFormat("en-US").format(defaultConn.accountInfo.videoCount)} remote videos
                </div>
              ) : null}
            </Link>

            <Link
              href="/jobs"
              className="rounded-xl border border-border bg-surface p-4 transition-colors hover:border-border-strong"
            >
              <div className="text-xs text-text-secondary">{t.dashboard.metricJobsActive}</div>
              <div className="mt-2 font-mono text-xl font-semibold text-text-primary">
                {summary?.jobsInProgress ?? 0}
              </div>
              <div className="mt-1 font-mono text-xs text-text-secondary">
                {summary?.jobsCompleted ?? 0} completed · {summary?.jobsFailed ?? 0} failed
              </div>
            </Link>

            <Link
              href="/settings"
              className="rounded-xl border border-border bg-surface p-4 transition-colors hover:border-border-strong"
            >
              <div className="text-xs text-text-secondary">{t.dashboard.metricQuotaState}</div>
              <div className="mt-2">
                <StatusBadge label={quotaLabel} tone={quotaTone} dot />
              </div>
            </Link>
          </section>

          <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="space-y-4 lg:col-span-2">
              <div className="space-y-3 rounded-xl border border-border bg-surface p-5">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-text-primary">Recent jobs</h2>
                  <Link href="/jobs" className="text-xs text-primary hover:underline">
                    View all
                  </Link>
                </div>

                {data?.recentJobs && data.recentJobs.length > 0 ? (
                  <ul className="divide-y divide-border rounded-lg border border-border bg-bg">
                    {data.recentJobs.map((job) => (
                      <li key={job.id}>
                        <Link
                          href={`/jobs/${job.id}`}
                          className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm hover:bg-surface-raised/60"
                        >
                          <div className="min-w-0">
                            <div className="truncate font-mono text-xs text-text-primary">
                              {job.jobType}
                            </div>
                            <div className="font-mono text-[11px] text-text-secondary">
                              {job.id.slice(0, 8)} · {new Date(job.createdAt).toLocaleString()}
                            </div>
                          </div>
                          <StatusBadge
                            label={
                              t.statuses.job[job.status as JobStatus] ?? job.status
                            }
                            tone={jobStatusTone(job.status)}
                          />
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="flex items-center gap-2 rounded-lg border border-dashed border-border px-4 py-5 text-xs text-text-secondary">
                    <Activity className="h-4 w-4 shrink-0" />
                    <span>No jobs yet. Sync your library or import a direct URL to start.</span>
                  </div>
                )}
              </div>

              <div className="space-y-3 rounded-xl border border-border bg-surface p-5">
                <div>
                  <h2 className="text-sm font-semibold text-text-primary">
                    {t.dashboard.onboardingTitle}
                  </h2>
                  <p className="mt-0.5 text-xs text-text-secondary">
                    {t.dashboard.onboardingSubtitle}
                  </p>
                </div>
                <ul className="divide-y divide-border rounded-lg border border-border bg-bg">
                  {onboardingSteps.map((step) => (
                    <li
                      key={step.id}
                      className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm"
                    >
                      <span className="flex items-center gap-2.5 text-text-primary">
                        {step.done ? (
                          <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                        ) : (
                          <Circle className="h-4 w-4 shrink-0 text-text-secondary" />
                        )}
                        {step.label}
                      </span>
                      <span className="shrink-0 rounded bg-surface-raised px-2 py-0.5 font-mono text-[11px] text-text-secondary">
                        {step.phase}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-xl border border-border bg-surface p-5">
                <h2 className="text-sm font-semibold text-text-primary">
                  {t.dashboard.quickActionsTitle}
                </h2>
                <div className="mt-3 grid grid-cols-1 gap-2">
                  <Link
                    href="/import?tab=url"
                    className="flex items-center gap-2.5 rounded-lg border border-border bg-bg px-3 py-2 text-sm font-medium text-text-primary hover:border-border-strong hover:bg-surface-raised"
                  >
                    <Link2 className="h-4 w-4 text-primary" />
                    {t.topbar.newImportUrl}
                  </Link>
                  <Link
                    href="/import?tab=file"
                    className="flex items-center gap-2.5 rounded-lg border border-border bg-bg px-3 py-2 text-sm font-medium text-text-primary hover:border-border-strong hover:bg-surface-raised"
                  >
                    <Upload className="h-4 w-4 text-primary" />
                    {t.topbar.newUploadFile}
                  </Link>
                  <Link
                    href="/import?tab=bulk"
                    className="flex items-center gap-2.5 rounded-lg border border-border bg-bg px-3 py-2 text-sm font-medium text-text-primary hover:border-border-strong hover:bg-surface-raised"
                  >
                    <FileSpreadsheet className="h-4 w-4 text-primary" />
                    {t.topbar.newBulkImport}
                  </Link>
                </div>
              </div>

              <div className="rounded-xl border border-border bg-surface p-5">
                <h2 className="text-sm font-semibold text-text-primary">
                  {t.dashboard.alertsTitle}
                </h2>
                {data?.alerts && data.alerts.length > 0 ? (
                  <ul className="mt-3 space-y-2">
                    {data.alerts.map((alert) => (
                      <li key={alert.id}>
                        <Link
                          href={alert.href}
                          className={cn(
                            "flex items-start gap-2 rounded-lg border p-2.5 text-xs",
                            alert.severity === "danger"
                              ? "border-danger/30 bg-danger-subtle text-danger"
                              : "border-warning/30 bg-warning-subtle text-warning",
                          )}
                        >
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <span>{alert.message}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-text-secondary">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-text-secondary" />
                    <p>{t.dashboard.noAlerts}</p>
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <div>
              <h2 className="text-sm font-semibold text-text-primary">{t.dashboard.quotaTitle}</h2>
              <p className="mt-0.5 text-xs text-text-secondary">{t.dashboard.quotaSubtitle}</p>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
