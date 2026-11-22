"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertCircle, BarChart3, Loader2, TrendingUp } from "lucide-react";
import type { JobAnalyticsSummary, ProviderStatsPoint } from "@/core";
import { EmptyState } from "@/components/ui/empty-state";
import { ProviderBadge } from "@/components/ui/provider-badge";
import { cn } from "@/lib/cn";

interface AnalyticsResponse {
  enabled: boolean;
  days: number;
  jobAnalytics: JobAnalyticsSummary;
  providerStats: {
    supported: boolean;
    providerKey?: string;
    providerDisplayName?: string;
    points: ProviderStatsPoint[];
    error?: string;
  };
}

function formatDurationMs(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function AnalyticsPanel() {
  const [days, setDays] = useState<7 | 14 | 30>(14);

  const { data, isLoading, error } = useQuery<AnalyticsResponse>({
    queryKey: ["analytics", days],
    queryFn: async () => {
      const res = await fetch(`/api/analytics?days=${days}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Failed to load analytics");
      }
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border bg-surface p-6 text-sm text-text-secondary">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading analytics...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-xl border border-danger/30 bg-danger-subtle p-4 text-sm text-danger">
        {error instanceof Error ? error.message : "Failed to load analytics."}
      </div>
    );
  }

  if (!data.enabled) {
    return (
      <EmptyState
        icon={BarChart3}
        title="Analytics module is disabled"
        body="Enable the Analytics module in Settings to view job performance metrics and provider stats."
      />
    );
  }

  const { jobAnalytics, providerStats } = data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-text-secondary">
          Aggregated MediaHub job telemetry and capability-gated provider stats.
        </p>
        <div className="inline-flex rounded-lg border border-border bg-surface p-0.5 text-xs">
          {([7, 14, 30] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              className={cn(
                "rounded-md px-2.5 py-1 font-mono font-medium",
                days === d
                  ? "bg-surface-raised text-text-primary"
                  : "text-text-secondary hover:text-text-primary",
              )}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="text-xs text-text-secondary">Jobs ({days}d)</div>
          <div className="mt-2 font-mono text-xl font-semibold text-text-primary">
            {jobAnalytics.totalJobs}
          </div>
          <div className="mt-1 font-mono text-xs text-text-secondary">
            {jobAnalytics.completedJobs} ok · {jobAnalytics.failedJobs} failed
          </div>
        </div>

        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="text-xs text-text-secondary">Job success rate</div>
          <div className="mt-2 font-mono text-xl font-semibold text-text-primary">
            {jobAnalytics.successRatePercent}%
          </div>
          <div className="mt-1 font-mono text-xs text-text-secondary">
            {jobAnalytics.unknownJobs} unclear outcome
          </div>
        </div>

        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="text-xs text-text-secondary">Median job duration</div>
          <div className="mt-2 font-mono text-xl font-semibold text-text-primary">
            {formatDurationMs(jobAnalytics.medianDurationMs)}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="text-xs text-text-secondary">p95 job duration</div>
          <div className="mt-2 font-mono text-xl font-semibold text-text-primary">
            {formatDurationMs(jobAnalytics.p95DurationMs)}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="space-y-3 rounded-xl border border-border bg-surface p-5">
          <div>
            <h2 className="text-sm font-semibold text-text-primary">Daily job outcomes</h2>
            <p className="text-xs text-text-secondary">
              Completed, failed, and in-progress/other jobs over the last {days} days.
            </p>
          </div>
          {jobAnalytics.byDay.length > 0 ? (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={jobAnalytics.byDay}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis
                    dataKey="day"
                    tick={{ fontSize: 11, fill: "var(--color-text-secondary)" }}
                    tickFormatter={(v: string) => v.slice(5)}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: "var(--color-text-secondary)" }}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "var(--color-surface)",
                      border: "1px solid var(--color-border)",
                      borderRadius: "8px",
                      fontSize: "12px",
                    }}
                  />
                  <Bar dataKey="completed" stackId="a" fill="var(--color-success)" name="Completed" />
                  <Bar dataKey="failed" stackId="a" fill="var(--color-danger)" name="Failed" />
                  <Bar dataKey="other" stackId="a" fill="var(--color-warning)" name="Other" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-border text-xs text-text-secondary">
              No job runs recorded in the selected {days}-day window.
            </div>
          )}
        </div>

        <div className="space-y-3 rounded-xl border border-border bg-surface p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="flex items-center gap-1.5 text-sm font-semibold text-text-primary">
                <TrendingUp className="h-4 w-4 text-primary" />
                Provider stats
              </h2>
              <p className="text-xs text-text-secondary">
                Capability-gated daily views reported by your active default provider.
              </p>
            </div>
            {providerStats.providerKey ? (
              <ProviderBadge providerKey={providerStats.providerKey} isDefault />
            ) : null}
          </div>

          {!providerStats.supported ? (
            <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-border px-4 text-center text-xs text-text-secondary">
              Your active provider does not declare a stats API capability, or no default provider is connected.
            </div>
          ) : providerStats.error ? (
            <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-subtle p-3.5 text-xs text-warning">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Could not fetch provider stats: {providerStats.error}</span>
            </div>
          ) : providerStats.points.length > 0 ? (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={providerStats.points}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis
                    dataKey="day"
                    tick={{ fontSize: 11, fill: "var(--color-text-secondary)" }}
                    tickFormatter={(v: string) => v.slice(5)}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: "var(--color-text-secondary)" }}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "var(--color-surface)",
                      border: "1px solid var(--color-border)",
                      borderRadius: "8px",
                      fontSize: "12px",
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="views"
                    stroke="var(--color-primary)"
                    fill="var(--color-primary-subtle)"
                    strokeWidth={2}
                    name="Views"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-border text-xs text-text-secondary">
              {providerStats.providerDisplayName ?? "Provider"} returned no daily stats points for the last {days} days.
            </div>
          )}
        </div>
      </section>

      {jobAnalytics.byType.length > 0 ? (
        <section className="rounded-xl border border-border bg-surface p-5">
          <h2 className="text-sm font-semibold text-text-primary">Breakdown by job type</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-border text-text-secondary">
                  <th className="py-2 pr-4 font-medium">Job type</th>
                  <th className="py-2 pr-4 font-medium">Total</th>
                  <th className="py-2 font-medium">Failed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border font-mono">
                {jobAnalytics.byType.map((row) => (
                  <tr key={row.jobType}>
                    <td className="py-2 pr-4 text-text-primary">{row.jobType}</td>
                    <td className="py-2 pr-4 text-text-secondary">{row.count}</td>
                    <td className="py-2 text-text-secondary">{row.failed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
