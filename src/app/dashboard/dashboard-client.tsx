"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  BarChart3,
  CheckCircle2,
  Circle,
  FileSpreadsheet,
  Link2,
  Upload,
} from "lucide-react";
import { evaluateQuotaState, type ProviderAccountInfo } from "@/core";
import { getMessages } from "@/shared";
import { useUiStore } from "@/store/ui-store";
import { PageHeader } from "@/components/ui/page-header";
import { QuotaMeter } from "@/components/ui/quota-meter";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/cn";

interface DashboardProvidersData {
  connections: Array<{
    id: string;
    providerKey: string;
    status: string;
    isDefault: boolean;
    accountInfo: ProviderAccountInfo | null;
  }>;
}

export function DashboardClient() {
  const searchParams = useSearchParams();
  const activeTab = searchParams.get("tab") === "analytics" ? "analytics" : "overview";
  const t = getMessages("en");
  const killSwitchEnabled = useUiStore((s) => s.killSwitchEnabled);

  const { data: providersData } = useQuery<DashboardProvidersData>({
    queryKey: ["providers"],
    queryFn: async () => {
      const res = await fetch("/api/providers");
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Failed to load providers");
      }
      return res.json();
    },
  });

  const defaultConn =
    providersData?.connections?.find((c) => c.isDefault && c.status === "active") ?? null;

  const quota = evaluateQuotaState({}, { killSwitchEnabled });

  const onboardingSteps = [
    { id: "poc", label: t.dashboard.stepPoc, done: false, phase: "Phase 0" },
    { id: "access", label: t.dashboard.stepAccess, done: true, phase: "Phase 1" },
    { id: "provider", label: t.dashboard.stepProvider, done: Boolean(defaultConn), phase: "Phase 2" },
    { id: "sync", label: t.dashboard.stepSync, done: false, phase: "Phase 3" },
  ];

  const quotaTone =
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
            <div className="rounded-xl border border-border bg-surface p-4">
              <div className="text-xs text-text-secondary">{t.dashboard.metricAssets}</div>
              <div className="mt-2 font-mono text-lg font-semibold text-text-primary">
                {defaultConn?.accountInfo?.videoCount !== undefined
                  ? `${new Intl.NumberFormat("en-US").format(defaultConn.accountInfo.videoCount)} (provider)`
                  : t.dashboard.phase0Zero}
              </div>
            </div>
            <div className="rounded-xl border border-border bg-surface p-4">
              <div className="text-xs text-text-secondary">{t.dashboard.metricDefaultProvider}</div>
              <div className="mt-2 flex items-center gap-2">
                {defaultConn ? (
                  <StatusBadge label={`${defaultConn.providerKey} · active`} tone="success" dot />
                ) : (
                  <Link href="/providers">
                    <StatusBadge label={t.dashboard.unconnected} tone="neutral" />
                  </Link>
                )}
              </div>
            </div>
            <div className="rounded-xl border border-border bg-surface p-4">
              <div className="text-xs text-text-secondary">{t.dashboard.metricJobsActive}</div>
              <div className="mt-2 font-mono text-lg font-semibold text-text-primary">0</div>
            </div>
            <div className="rounded-xl border border-border bg-surface p-4">
              <div className="text-xs text-text-secondary">{t.dashboard.metricQuotaState}</div>
              <div className="mt-2">
                <StatusBadge label={quotaLabel} tone={quotaTone} dot />
              </div>
            </div>
          </section>

          <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="space-y-4 rounded-xl border border-border bg-surface p-5 lg:col-span-2">
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
                <div className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-text-secondary">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-text-secondary" />
                  <p>{t.dashboard.noAlerts}</p>
                </div>
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
