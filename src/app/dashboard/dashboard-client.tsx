"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Circle,
  FileSpreadsheet,
  Link2,
  Loader2,
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
    <div className="space-y-10">
      <PageHeader
        title={t.dashboard.title}
        subtitle={t.dashboard.subtitle}
        actions={
          <nav aria-label="Dashboard views" className="flex items-center gap-5 border-b border-border/60 text-sm">
            <Link
              href="/dashboard"
              className={cn(
                "inline-flex items-center gap-2 border-b-2 pb-2 font-medium whitespace-nowrap transition-colors",
                activeTab === "overview"
                  ? "border-primary text-text-primary"
                  : "border-transparent text-text-secondary hover:text-text-primary",
              )}
            >
              {activeTab === "overview" ? (
                <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />
              ) : null}
              {t.dashboard.tabOverview}
            </Link>
            <Link
              href="/dashboard?tab=analytics"
              className={cn(
                "inline-flex items-center gap-2 border-b-2 pb-2 font-medium whitespace-nowrap transition-colors",
                activeTab === "analytics"
                  ? "border-primary text-text-primary"
                  : "border-transparent text-text-secondary hover:text-text-primary",
              )}
            >
              {activeTab === "analytics" ? (
                <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />
              ) : null}
              {t.dashboard.tabAnalytics}
            </Link>
          </nav>
        }
      />

      {activeTab === "analytics" ? (
        <AnalyticsPanel />
      ) : (
        <>
          {/* Dusk Ruled Tally — replaces boxed stat-tile grid */}
          <section
            aria-label="Workspace metrics"
            className="grid grid-cols-1 divide-y divide-border border-b border-border pb-8 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x"
          >
            <Link href="/library" className="group py-3 pr-6 first:pl-0 sm:py-2 lg:py-0">
              <div className="text-xs font-medium text-text-secondary">{t.dashboard.metricAssets}</div>
              <div className="mt-2 font-display text-3xl font-medium tabular-nums text-text-primary group-hover:text-primary">
                {new Intl.NumberFormat("en-US").format(summary?.totalAssets ?? 0)}
              </div>
              {summary && summary.processingAssets > 0 ? (
                <div className="mt-1.5 text-xs text-warning">
                  {summary.processingAssets} encoding
                </div>
              ) : (
                <div className="mt-1.5 text-xs text-text-secondary">Indexed across hosts</div>
              )}
            </Link>

            <Link href="/providers" className="group py-3 sm:py-2 lg:px-6 lg:py-0">
              <div className="text-xs font-medium text-text-secondary">
                {t.dashboard.metricDefaultProvider}
              </div>
              <div className="mt-2.5 flex items-center gap-2">
                {defaultConn ? (
                  <StatusBadge
                    label={`${defaultConn.providerKey}: ${defaultConn.status}`}
                    tone={defaultConn.status === "active" ? "success" : "danger"}
                    dot
                  />
                ) : (
                  <StatusBadge label={t.dashboard.unconnected} tone="neutral" />
                )}
              </div>
              {defaultConn?.accountInfo?.videoCount !== undefined ? (
                <div className="mt-2 tabular-nums text-xs text-text-secondary">
                  {new Intl.NumberFormat("en-US").format(defaultConn.accountInfo.videoCount)} remote
                  videos
                </div>
              ) : null}
            </Link>

            <Link href="/jobs" className="group py-3 sm:py-2 lg:px-6 lg:py-0">
              <div className="text-xs font-medium text-text-secondary">
                {t.dashboard.metricJobsActive}
              </div>
              <div className="mt-2 font-display text-3xl font-medium tabular-nums text-text-primary group-hover:text-primary">
                {summary?.jobsInProgress ?? 0}
              </div>
              <div className="mt-1.5 tabular-nums text-xs text-text-secondary">
                {summary?.jobsCompleted ?? 0} completed, {summary?.jobsFailed ?? 0} failed
              </div>
            </Link>

            <Link href="/settings" className="group py-3 sm:py-2 lg:pl-6 lg:py-0">
              <div className="text-xs font-medium text-text-secondary">
                {t.dashboard.metricQuotaState}
              </div>
              <div className="mt-2.5">
                <StatusBadge label={quotaLabel} tone={quotaTone} dot />
              </div>
              <div className="mt-2 text-xs text-text-secondary">Free-tier guardrails active</div>
            </Link>
          </section>

          {/* Signature Workspace: Smoked-glass Operations Queue + Quiet Action/Setup Column */}
          <section className="grid grid-cols-1 gap-10 lg:grid-cols-12">
            <div className="lg:col-span-7">
              <div className="dusk-plate overflow-hidden">
                <div className="flex items-center justify-between border-b border-border px-5 py-4">
                  <div>
                    <h2 className="text-base font-medium text-text-primary">Operations queue</h2>
                    <p className="mt-0.5 text-xs text-text-secondary">
                      Latest imports, syncs, and background provider jobs.
                    </p>
                  </div>
                  <Link
                    href="/jobs"
                    className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                  >
                    View all
                    <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </Link>
                </div>

                {data?.recentJobs && data.recentJobs.length > 0 ? (
                  <ul className="divide-y divide-border/70">
                    {data.recentJobs.map((job) => (
                      <li key={job.id}>
                        <Link
                          href={`/jobs/${job.id}`}
                          className="flex items-center justify-between gap-4 px-5 py-3.5 text-sm transition-colors hover:bg-surface-raised/45"
                        >
                          <div className="min-w-0">
                            <div className="truncate font-mono text-xs font-medium text-text-primary">
                              {job.jobType}
                            </div>
                            <div className="mt-0.5 tabular-nums text-xs text-text-secondary">
                              <code className="font-mono">{job.id.slice(0, 8)}</code>,{" "}
                              {new Date(job.createdAt).toLocaleString()}
                            </div>
                          </div>
                          <StatusBadge
                            label={t.statuses.job[job.status as JobStatus] ?? job.status}
                            tone={jobStatusTone(job.status)}
                          />
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="flex items-center gap-2.5 px-5 py-8 text-sm text-text-secondary">
                    <Activity className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                    <span>No jobs yet. Sync your library or import a direct URL to start.</span>
                  </div>
                )}

                {data?.alerts && data.alerts.length > 0 ? (
                  <div className="space-y-1 border-t border-warning/25 bg-warning-subtle/70 px-5 py-3">
                    {data.alerts.map((alert) => (
                      <Link
                        key={alert.id}
                        href={alert.href}
                        className={cn(
                          "flex items-center justify-between gap-2 py-1 text-xs font-medium hover:underline",
                          alert.severity === "danger" ? "text-danger" : "text-warning",
                        )}
                      >
                        <span className="flex items-center gap-2">
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          {alert.message}
                        </span>
                        <ArrowUpRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      </Link>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-center gap-2 border-t border-border/70 px-5 py-3 text-xs text-text-secondary">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span>{t.dashboard.noAlerts}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-8 lg:col-span-5">
              <div className="space-y-3">
                <h2 className="text-base font-medium text-text-primary">
                  {t.dashboard.quickActionsTitle}
                </h2>
                <div className="divide-y divide-border border-y border-border">
                  <Link
                    href="/import?tab=url"
                    className="group flex items-center justify-between py-3 text-sm text-text-primary transition-colors hover:text-primary"
                  >
                    <span className="flex items-center gap-2.5 font-medium">
                      <Link2 className="h-4 w-4 text-primary" aria-hidden="true" />
                      {t.topbar.newImportUrl}
                    </span>
                    <ArrowUpRight className="h-4 w-4 text-text-secondary group-hover:text-primary" />
                  </Link>
                  <Link
                    href="/import?tab=file"
                    className="group flex items-center justify-between py-3 text-sm text-text-primary transition-colors hover:text-primary"
                  >
                    <span className="flex items-center gap-2.5 font-medium">
                      <Upload className="h-4 w-4 text-text-secondary" aria-hidden="true" />
                      {t.topbar.newUploadFile}
                    </span>
                    <ArrowUpRight className="h-4 w-4 text-text-secondary group-hover:text-primary" />
                  </Link>
                  <Link
                    href="/import?tab=bulk"
                    className="group flex items-center justify-between py-3 text-sm text-text-primary transition-colors hover:text-primary"
                  >
                    <span className="flex items-center gap-2.5 font-medium">
                      <FileSpreadsheet className="h-4 w-4 text-text-secondary" aria-hidden="true" />
                      {t.topbar.newBulkImport}
                    </span>
                    <ArrowUpRight className="h-4 w-4 text-text-secondary group-hover:text-primary" />
                  </Link>
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <h2 className="text-base font-medium text-text-primary">
                    {t.dashboard.onboardingTitle}
                  </h2>
                  <p className="mt-0.5 text-xs text-text-secondary">
                    {t.dashboard.onboardingSubtitle}
                  </p>
                </div>
                <ul className="divide-y divide-border border-t border-border">
                  {onboardingSteps.map((step) => (
                    <li
                      key={step.id}
                      className="flex items-center justify-between gap-3 py-2.5 text-xs"
                    >
                      <span className="flex items-center gap-2.5 text-text-primary">
                        {step.done ? (
                          <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                        ) : (
                          <Circle className="h-4 w-4 shrink-0 text-text-secondary" />
                        )}
                        {step.label}
                      </span>
                      <span className="shrink-0 text-text-secondary">{step.phase}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>

          {/* Ruled Free-Tier Quota Ledger — zero boxed cards */}
          <section className="space-y-4 border-t border-border pt-8">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-base font-medium text-text-primary">{t.dashboard.quotaTitle}</h2>
              <p className="text-xs text-text-secondary">{t.dashboard.quotaSubtitle}</p>
            </div>
            <div className="grid grid-cols-1 gap-x-10 divide-y divide-border/70 border-t border-border sm:grid-cols-2">
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
