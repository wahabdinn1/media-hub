"use client";

import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { evaluateQuotaState, type QuotaGuardEvaluation } from "@/core";
import { getMessages, MODULE_KEYS, type ModuleKey } from "@/shared";
import { useUiStore } from "@/store/ui-store";
import { PageHeader } from "@/components/ui/page-header";
import { QuotaMeter } from "@/components/ui/quota-meter";
import { StatusBadge } from "@/components/ui/status-badge";

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
    // Sync only when server data updates
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
            <span className="inline-flex items-center gap-1.5 text-xs text-text-secondary">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Syncing with D1...
            </span>
          ) : (
            <StatusBadge label="Persisted in D1" tone="success" dot />
          )
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="space-y-4 rounded-xl border border-border bg-surface p-5">
          <div>
            <h2 className="text-sm font-semibold text-text-primary">{t.settings.modulesTitle}</h2>
            <p className="mt-0.5 text-xs text-text-secondary">{t.settings.modulesHint}</p>
          </div>
          <div className="divide-y divide-border rounded-lg border border-border bg-bg">
            {MODULE_KEYS.map((key) => {
              const enabled = persistedModules[key];
              return (
                <label
                  key={key}
                  className="flex cursor-pointer items-center justify-between gap-3 px-3.5 py-2.5 text-sm"
                >
                  <span className="capitalize text-text-primary">{key}</span>
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
        </section>

        <section className="space-y-4 rounded-xl border border-border bg-surface p-5">
          <div>
            <h2 className="text-sm font-semibold text-text-primary">
              {t.settings.guardrailsTitle}
            </h2>
            <p className="mt-0.5 text-xs text-text-secondary">{t.settings.guardrailsHint}</p>
          </div>

          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-border bg-bg p-3.5 text-sm">
            <span className="font-medium text-text-primary">{t.settings.killSwitchLabel}</span>
            <input
              type="checkbox"
              checked={persistedKillSwitch}
              disabled={patchMutation.isPending}
              onChange={(e) => {
                const next = e.target.checked;
                setKillSwitchLocal(next);
                patchMutation.mutate({ killSwitchEnabled: next });
              }}
              className="h-4 w-4 accent-danger"
            />
          </label>

          <div className="space-y-2 rounded-lg border border-border bg-bg p-3.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-text-primary">{t.settings.languageTitle}</span>
              <StatusBadge label={data?.settings.locale ?? "en"} tone="primary" />
            </div>
            <p className="text-xs text-text-secondary">{t.settings.languageValue}</p>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border bg-bg p-3.5 text-xs">
            <span className="font-medium text-text-primary">Appearance</span>
            <div className="inline-flex rounded-md border border-border bg-surface p-0.5">
              {(["dark", "light"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setTheme(mode)}
                  className={
                    theme === mode
                      ? "rounded bg-surface-raised px-2.5 py-1 font-medium capitalize text-text-primary"
                      : "rounded px-2.5 py-1 capitalize text-text-secondary hover:text-text-primary"
                  }
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-border bg-bg p-3.5 text-xs text-text-secondary">
            <div className="font-medium text-text-primary">{t.settings.backupTitle}</div>
            <p className="mt-1">{t.settings.backupHint}</p>
          </div>
        </section>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-text-primary">{t.dashboard.quotaTitle}</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {quota.meters.map((meter) => (
            <QuotaMeter key={meter.metric} meter={meter} />
          ))}
        </div>
      </section>
    </div>
  );
}
