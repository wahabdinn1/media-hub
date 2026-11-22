"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Database,
  Download,
  Gauge,
  Layers,
  Loader2,
  ShieldAlert,
  Upload,
  XCircle,
} from "lucide-react";
import { evaluateQuotaState, type QuotaGuardEvaluation } from "@/core";
import { getMessages, MODULE_KEYS, type ModuleKey } from "@/shared";
import { useUiStore } from "@/store/ui-store";
import { PageHeader } from "@/components/ui/page-header";
import { QuotaMeter } from "@/components/ui/quota-meter";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/cn";

interface SettingsResponse {
  settings: {
    killSwitchEnabled: boolean;
    locale: string;
    enabledModules: Record<ModuleKey, boolean>;
  };
  quota: QuotaGuardEvaluation;
}

export default function SettingsPage() {
  const t = getMessages("en");
  const queryClient = useQueryClient();

  const enabledModules = useUiStore((s) => s.enabledModules);
  const toggleModuleLocal = useUiStore((s) => s.toggleModule);
  const killSwitchEnabled = useUiStore((s) => s.killSwitchEnabled);
  const setKillSwitchLocal = useUiStore((s) => s.setKillSwitchEnabled);
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);

  const [backupNotice, setBackupNotice] = useState<{ kind: "success" | "error"; text: string } | null>(
    null,
  );
  const [pendingBackupJson, setPendingBackupJson] = useState<unknown>(null);
  const [dryRunCounts, setDryRunCounts] = useState<Record<string, number> | null>(null);

  const { data, isLoading } = useQuery<SettingsResponse>({
    queryKey: ["settings"],
    queryFn: async () => {
      const res = await fetch("/api/settings");
      if (!res.ok) throw new Error("Failed to load settings");
      return res.json();
    },
  });

  useEffect(() => {
    if (!data?.settings) return;
    setKillSwitchLocal(data.settings.killSwitchEnabled);
    for (const key of MODULE_KEYS) {
      if (enabledModules[key] !== data.settings.enabledModules[key]) {
        toggleModuleLocal(key);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.settings]);

  const patchMutation = useMutation({
    mutationFn: async (body: {
      killSwitchEnabled?: boolean;
      moduleToggle?: { moduleKey: ModuleKey; enabled: boolean };
    }) => {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to save setting");
      return res.json() as Promise<SettingsResponse>;
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(["settings"], updated);
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["poc-health"] });
    },
  });

  const restoreMutation = useMutation({
    mutationFn: async ({ payload, dryRun }: { payload: unknown; dryRun: boolean }) => {
      const res = await fetch(`/api/settings/backup${dryRun ? "?dryRun=1" : ""}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        dryRun?: boolean;
        counts?: Record<string, number>;
      };
      if (!res.ok) throw new Error(json.error ?? "Backup validation failed");
      return json;
    },
    onSuccess: (res) => {
      if (res.dryRun) {
        setDryRunCounts(res.counts ?? null);
        setBackupNotice({
          kind: "success",
          text: "Backup JSON validated (secret-free schema v1). Review counts below to restore.",
        });
      } else {
        setPendingBackupJson(null);
        setDryRunCounts(null);
        setBackupNotice({
          kind: "success",
          text: "Metadata backup restored cleanly. Re-enter provider credentials in Providers if needed.",
        });
        void queryClient.invalidateQueries();
      }
    },
    onError: (err) => {
      setDryRunCounts(null);
      setBackupNotice({
        kind: "error",
        text: err instanceof Error ? err.message : "Backup restore failed.",
      });
    },
  });

  async function handleBackupFile(file: File | null) {
    if (!file) return;
    setBackupNotice(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      setPendingBackupJson(parsed);
      restoreMutation.mutate({ payload: parsed, dryRun: true });
    } catch {
      setBackupNotice({ kind: "error", text: "Selected file is not valid JSON." });
    }
  }

  const persistedModules = data?.settings.enabledModules ?? enabledModules;
  const persistedKillSwitch = data?.settings.killSwitchEnabled ?? killSwitchEnabled;
  const quota =
    data?.quota ?? evaluateQuotaState({}, { killSwitchEnabled: persistedKillSwitch });

  return (
    <div className="space-y-6">
      <PageHeader
        title={t.settings.title}
        subtitle={t.settings.subtitle}
        actions={
          patchMutation.isPending || isLoading ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-xs text-text-secondary">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
              Syncing with D1…
            </span>
          ) : (
            <StatusBadge label="Persisted in D1" tone="success" dot />
          )
        }
      />

      {/* Row 1: Modules + Guardrails & Appearance */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <section className="dusk-plate flex flex-col justify-between p-6 lg:col-span-5">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-subtle text-violet">
                <Layers className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-text-primary">
                  {t.settings.modulesTitle}
                </h2>
                <p className="text-xs text-text-secondary">{t.settings.modulesHint}</p>
              </div>
            </div>

            <div className="divide-y divide-border/70 rounded-xl border border-border/70 bg-bg/45 px-4">
              {MODULE_KEYS.map((key) => {
                const enabled = persistedModules[key];
                return (
                  <label
                    key={key}
                    className="flex cursor-pointer items-center justify-between gap-3 py-3 text-sm"
                  >
                    <span className="capitalize font-medium text-text-primary">{key}</span>
                    <input
                      type="checkbox"
                      checked={enabled}
                      disabled={patchMutation.isPending}
                      onChange={() => {
                        toggleModuleLocal(key);
                        patchMutation.mutate({ moduleToggle: { moduleKey: key, enabled: !enabled } });
                      }}
                      className="h-4 w-4 accent-primary"
                    />
                  </label>
                );
              })}
            </div>
          </div>
        </section>

        <section className="dusk-plate space-y-5 p-6 lg:col-span-7">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-warning-subtle text-warning">
              <ShieldAlert className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-text-primary">
                {t.settings.guardrailsTitle}
              </h2>
              <p className="text-xs text-text-secondary">{t.settings.guardrailsHint}</p>
            </div>
          </div>

          <div className="space-y-3">
            <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-border/70 bg-bg/45 px-4 py-3.5 text-sm">
              <div>
                <div className="font-medium text-text-primary">{t.settings.killSwitchLabel}</div>
                <p className="mt-0.5 text-xs text-text-secondary">
                  Pauses background jobs, scheduled workflows, and non-essential mutations.
                </p>
              </div>
              <input
                type="checkbox"
                checked={persistedKillSwitch}
                disabled={patchMutation.isPending}
                onChange={(e) => {
                  const next = e.target.checked;
                  setKillSwitchLocal(next);
                  patchMutation.mutate({ killSwitchEnabled: next });
                }}
                className="h-4 w-4 shrink-0 accent-danger"
              />
            </label>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-bg/45 px-4 py-3.5 text-sm">
              <div>
                <div className="font-medium text-text-primary">Appearance</div>
                <p className="mt-0.5 text-xs text-text-secondary">
                  Midnight Navy dark surface or crisp daylight surface.
                </p>
              </div>
              <div className="inline-flex items-center gap-1 rounded-xl border border-border bg-surface p-1 text-xs">
                {(["dark", "light"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setTheme(mode)}
                    className={cn(
                      "rounded-lg px-3 py-1 font-medium capitalize transition-colors",
                      theme === mode
                        ? "bg-primary-subtle text-primary"
                        : "text-text-secondary hover:text-text-primary",
                    )}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-bg/45 px-4 py-3.5 text-sm">
              <div>
                <div className="font-medium text-text-primary">{t.settings.languageTitle}</div>
                <p className="mt-0.5 text-xs text-text-secondary">{t.settings.languageValue}</p>
              </div>
              <StatusBadge label={data?.settings.locale ?? "en"} tone="primary" />
            </div>
          </div>
        </section>
      </div>

      {/* Row 2: Metadata Backup & Restore */}
      <section className="dusk-plate space-y-5 p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-success-subtle text-success">
              <Database className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-text-primary">{t.settings.backupTitle}</h2>
              <p className="text-xs text-text-secondary">
                Download a secret-free JSON metadata snapshot (excludes encrypted credentials) or
                validate and restore a previous export.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <a href="/api/settings/backup" download className="dusk-btn-primary h-9 px-4 text-xs">
              <Download className="h-3.5 w-3.5" />
              Export metadata JSON
            </a>

            <label className="dusk-btn-ghost h-9 cursor-pointer px-4 text-xs">
              <Upload className="h-3.5 w-3.5" />
              Validate / Restore JSON
              <input
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => void handleBackupFile(e.target.files?.[0] ?? null)}
              />
            </label>
          </div>
        </div>

        {backupNotice ? (
          <div
            className={cn(
              "flex items-center gap-2 rounded-xl px-4 py-3 text-xs font-medium",
              backupNotice.kind === "success"
                ? "bg-success-subtle text-success"
                : "bg-danger-subtle text-danger",
            )}
          >
            {backupNotice.kind === "success" ? (
              <CheckCircle2 className="h-4 w-4 shrink-0" />
            ) : (
              <XCircle className="h-4 w-4 shrink-0" />
            )}
            <span>{backupNotice.text}</span>
          </div>
        ) : null}

        {dryRunCounts && pendingBackupJson ? (
          <div className="space-y-3 rounded-xl border border-border bg-bg/60 p-4 text-xs">
            <div className="font-semibold text-text-primary">Dry-run summary</div>
            <div className="grid grid-cols-2 gap-2 tabular-nums text-text-secondary sm:grid-cols-3">
              <span>Assets: {dryRunCounts.assets ?? 0}</span>
              <span>Collections: {dryRunCounts.collections ?? 0}</span>
              <span>Folders: {dryRunCounts.providerFolders ?? 0}</span>
              <span>Workflows: {dryRunCounts.workflows ?? 0}</span>
              <span>Thumbnails: {dryRunCounts.thumbnails ?? 0}</span>
              <span>Subtitles: {dryRunCounts.subtitles ?? 0}</span>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                disabled={restoreMutation.isPending}
                onClick={() => restoreMutation.mutate({ payload: pendingBackupJson, dryRun: false })}
                className="dusk-btn-primary h-8 px-3.5 text-xs disabled:opacity-50"
              >
                Confirm restore
              </button>
              <button
                type="button"
                onClick={() => {
                  setPendingBackupJson(null);
                  setDryRunCounts(null);
                }}
                className="dusk-btn-ghost h-8 px-3 text-xs"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}
      </section>

      {/* Row 3: Free-Tier Quota Guardrails */}
      <section className="dusk-plate space-y-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-info-subtle text-info">
              <Gauge className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-text-primary">
                {t.dashboard.quotaTitle}
              </h2>
              <p className="text-xs text-text-secondary">{t.dashboard.quotaSubtitle}</p>
            </div>
          </div>
          <StatusBadge
            label={quota.degradeModeActive ? "Degrade mode" : "Within free tier"}
            tone={quota.degradeModeActive ? "danger" : "success"}
            dot
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {quota.meters.map((meter) => (
            <div
              key={meter.metric}
              className="rounded-xl border border-border/70 bg-bg/45 px-4 py-1"
            >
              <QuotaMeter meter={meter} />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
