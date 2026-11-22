"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CloudOff, FileSpreadsheet, Link2, ShieldCheck, Upload } from "lucide-react";
import { getMessages } from "@/shared";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/cn";

type ImportTab = "url" | "file" | "bulk" | "cloud";

export function ImportClient() {
  const searchParams = useSearchParams();
  const initialTab = (searchParams.get("tab") as ImportTab | null) ?? "url";
  const activeTab: ImportTab = ["url", "file", "bulk", "cloud"].includes(initialTab)
    ? initialTab
    : "url";

  const t = getMessages("en");
  const [urlValue, setUrlValue] = useState("");
  const [rightsConfirmed, setRightsConfirmed] = useState(false);

  const tabs: Array<{ key: ImportTab; label: string; icon: typeof Link2; disabled?: boolean }> = [
    { key: "url", label: t.importPage.tabUrl, icon: Link2 },
    { key: "file", label: t.importPage.tabFile, icon: Upload },
    { key: "bulk", label: t.importPage.tabBulk, icon: FileSpreadsheet },
    { key: "cloud", label: t.importPage.tabCloud, icon: CloudOff, disabled: true },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={t.importPage.title} subtitle={t.importPage.subtitle} />

      <div className="flex flex-wrap gap-2 border-b border-border pb-3">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          if (tab.disabled) {
            return (
              <span
                key={tab.key}
                title={t.importPage.cloudDisabledReason}
                className="inline-flex cursor-not-allowed items-center gap-2 rounded-lg border border-border bg-surface/50 px-3 py-2 text-xs font-medium text-text-secondary opacity-60"
              >
                <Icon className="h-3.5 w-3.5" />
                {tab.label}
                <StatusBadge label="Unavailable" tone="neutral" />
              </span>
            );
          }

          return (
            <Link
              key={tab.key}
              href={`/import?tab=${tab.key}`}
              className={cn(
                "inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors",
                activeTab === tab.key
                  ? "border-primary/40 bg-primary-subtle text-primary"
                  : "border-border bg-surface text-text-secondary hover:text-text-primary",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </Link>
          );
        })}
      </div>

      <div className="flex items-start gap-2.5 rounded-xl border border-border bg-surface p-4 text-xs text-text-secondary">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <p>{t.importPage.rightsNotice}</p>
      </div>

      {activeTab === "url" ? (
        <section className="max-w-2xl space-y-4 rounded-xl border border-border bg-surface p-5">
          <div className="space-y-1.5">
            <label htmlFor="direct-url-input" className="block text-xs font-medium text-text-primary">
              Direct media URL
            </label>
            <input
              id="direct-url-input"
              type="url"
              value={urlValue}
              onChange={(e) => setUrlValue(e.target.value)}
              placeholder={t.importPage.urlPlaceholder}
              className="h-10 w-full rounded-lg border border-border bg-bg px-3 font-mono text-sm text-text-primary placeholder:text-text-secondary focus:border-primary focus:outline-none"
            />
          </div>

          <label className="flex items-start gap-2.5 text-xs text-text-secondary">
            <input
              type="checkbox"
              checked={rightsConfirmed}
              onChange={(e) => setRightsConfirmed(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-border bg-bg accent-primary"
            />
            <span>I confirm I own or am authorized to manage this media source (logged once per session/batch).</span>
          </label>

          <div className="flex items-center gap-3 pt-1">
            <button
              type="button"
              disabled={!urlValue.trim() || !rightsConfirmed}
              className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-xs font-medium text-primary-foreground hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t.importPage.validateButton}
            </button>
            <span className="text-xs text-text-secondary">
              Server SSRF validation & job creation wire up in Phase 3.
            </span>
          </div>
        </section>
      ) : null}

      {activeTab === "file" ? (
        <EmptyState
          icon={Upload}
          title="Local file staging (R2 presigned PUT/GET spike)"
          body={t.importPage.fileSpikeNotice}
        />
      ) : null}

      {activeTab === "bulk" ? (
        <EmptyState
          icon={FileSpreadsheet}
          title="Bulk import & dry-run preview"
          body={t.importPage.bulkNotice}
        />
      ) : null}
    </div>
  );
}
