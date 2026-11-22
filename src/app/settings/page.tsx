"use client";

import { evaluateQuotaState } from "@/core";
import { getMessages, MODULE_KEYS } from "@/shared";
import { useUiStore } from "@/store/ui-store";
import { PageHeader } from "@/components/ui/page-header";
import { QuotaMeter } from "@/components/ui/quota-meter";
import { StatusBadge } from "@/components/ui/status-badge";

export default function SettingsPage() {
  const t = getMessages("en");
  const enabledModules = useUiStore((s) => s.enabledModules);
  const toggleModule = useUiStore((s) => s.toggleModule);
  const killSwitchEnabled = useUiStore((s) => s.killSwitchEnabled);
  const setKillSwitchEnabled = useUiStore((s) => s.setKillSwitchEnabled);
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);

  const quota = evaluateQuotaState({}, { killSwitchEnabled });

  return (
    <div className="space-y-6">
      <PageHeader title={t.settings.title} subtitle={t.settings.subtitle} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="space-y-4 rounded-xl border border-border bg-surface p-5">
          <div>
            <h2 className="text-sm font-semibold text-text-primary">{t.settings.modulesTitle}</h2>
            <p className="mt-0.5 text-xs text-text-secondary">{t.settings.modulesHint}</p>
          </div>
          <div className="divide-y divide-border rounded-lg border border-border bg-bg">
            {MODULE_KEYS.map((key) => {
              const enabled = enabledModules[key];
              return (
                <label
                  key={key}
                  className="flex cursor-pointer items-center justify-between gap-3 px-3.5 py-2.5 text-sm"
                >
                  <span className="capitalize text-text-primary">{key}</span>
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={() => toggleModule(key)}
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
              checked={killSwitchEnabled}
              onChange={(e) => setKillSwitchEnabled(e.target.checked)}
              className="h-4 w-4 accent-danger"
            />
          </label>

          <div className="space-y-2 rounded-lg border border-border bg-bg p-3.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-text-primary">{t.settings.languageTitle}</span>
              <StatusBadge label="en" tone="primary" />
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
                      ? "rounded px-2.5 py-1 font-medium capitalize text-text-primary bg-surface-raised"
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
