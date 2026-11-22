"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  CloudOff,
  FileSpreadsheet,
  Link2,
  Loader2,
  ShieldCheck,
  Upload,
  XCircle,
} from "lucide-react";
import type { UrlValidationResult } from "@/core";
import { getMessages } from "@/shared";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { BulkImportPanel } from "@/components/import/bulk-import-panel";
import {
  DestinationSelector,
  type UploadDestinationState,
} from "@/components/import/destination-selector";
import { cn } from "@/lib/cn";

type ImportTab = "url" | "file" | "bulk" | "cloud";

interface ImportCreatedResult {
  job: { id: string; status: string };
  jobs?: Array<{
    connectionId: string;
    providerKey: string;
    job: { id: string; status: string };
    error?: string;
  }>;
  assetId?: string;
  deduplicated?: boolean;
}

export function ImportClient() {
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const initialTab = (searchParams.get("tab") as ImportTab | null) ?? "url";
  const activeTab: ImportTab = ["url", "file", "bulk", "cloud"].includes(initialTab)
    ? initialTab
    : "url";

  const t = getMessages("en");
  const [urlValue, setUrlValue] = useState("");
  const [titleOverride, setTitleOverride] = useState("");
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [destination, setDestination] = useState<UploadDestinationState>({
    providerConnectionIds: [],
    folderByConnectionId: {},
    collectionIds: [],
  });
  const [validation, setValidation] = useState<UrlValidationResult | null>(null);
  const [createdResult, setCreatedResult] = useState<ImportCreatedResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const validateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/import/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: urlValue.trim() }),
      });
      const json = (await res.json().catch(() => ({}))) as UrlValidationResult & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Validation failed.");
      return json;
    },
    onSuccess: (res) => {
      setValidation(res);
      setCreatedResult(null);
      setErrorMsg(null);
      if (res.inferredTitle && !titleOverride) {
        setTitleOverride(res.inferredTitle);
      }
    },
    onError: (err) => {
      setValidation(null);
      setErrorMsg(err instanceof Error ? err.message : "Validation failed.");
    },
  });

  const importMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/import/url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: urlValue.trim(),
          title: titleOverride.trim() || undefined,
          rightsConfirmed,
          providerConnectionIds: destination.providerConnectionIds,
          folderByConnectionId: destination.folderByConnectionId,
          collectionIds: destination.collectionIds,
          idempotencyKey: validation?.sourceUrlHash
            ? `import-url:${validation.sourceUrlHash}`
            : undefined,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as ImportCreatedResult & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Import failed.");
      return json;
    },
    onSuccess: (res) => {
      setCreatedResult(res);
      setErrorMsg(null);
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });
      void queryClient.invalidateQueries({ queryKey: ["assets"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["poc-health"] });
    },
    onError: (err) => {
      setErrorMsg(err instanceof Error ? err.message : "Failed to create import job.");
    },
  });

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
        <section className="max-w-3xl space-y-4 rounded-xl border border-border bg-surface p-5">
          <DestinationSelector value={destination} onChange={setDestination} />

          <div className="space-y-1.5">
            <label htmlFor="direct-url-input" className="block text-xs font-medium text-text-primary">
              Direct media URL
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                id="direct-url-input"
                type="url"
                value={urlValue}
                onChange={(e) => {
                  setUrlValue(e.target.value);
                  setValidation(null);
                  setCreatedResult(null);
                  setErrorMsg(null);
                }}
                placeholder={t.importPage.urlPlaceholder}
                className="h-10 flex-1 rounded-lg border border-border bg-bg px-3 font-mono text-xs text-text-primary placeholder:text-text-secondary focus:border-primary focus:outline-none"
              />
              <button
                type="button"
                onClick={() => validateMutation.mutate()}
                disabled={!urlValue.trim() || validateMutation.isPending}
                className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-border bg-surface-raised px-4 text-xs font-medium text-text-primary hover:border-border-strong disabled:cursor-not-allowed disabled:opacity-50"
              >
                {validateMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : null}
                {t.importPage.validateButton}
              </button>
            </div>
          </div>

          {validation ? (
            <div
              className={cn(
                "space-y-2 rounded-lg border p-3.5 text-xs",
                validation.valid
                  ? "border-success/30 bg-success-subtle text-success"
                  : "border-danger/30 bg-danger-subtle text-danger",
              )}
            >
              <div className="flex items-center justify-between gap-2 font-medium">
                <span className="flex items-center gap-1.5">
                  {validation.valid ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                  ) : (
                    <XCircle className="h-4 w-4 shrink-0" />
                  )}
                  {validation.classification.replace(/_/g, " ")}
                </span>
                {validation.contentType ? (
                  <span className="font-mono">{validation.contentType}</span>
                ) : null}
              </div>
              <p>{validation.reason}</p>
              {validation.valid ? (
                <div className="flex flex-wrap gap-4 tabular-nums text-[11px] opacity-90">
                  <span>
                    URL: <code className="font-mono">{validation.redactedUrl}</code>
                  </span>
                  {validation.contentLength ? (
                    <span>Size: {(validation.contentLength / 1024 ** 2).toFixed(2)} MiB</span>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {validation?.valid ? (
            <>
              <div className="space-y-1.5">
                <label htmlFor="import-title-input" className="block text-xs font-medium text-text-primary">
                  Title (optional)
                </label>
                <input
                  id="import-title-input"
                  type="text"
                  value={titleOverride}
                  onChange={(e) => setTitleOverride(e.target.value)}
                  placeholder="Asset title"
                  className="h-9 w-full rounded-lg border border-border bg-bg px-3 text-sm text-text-primary placeholder:text-text-secondary focus:border-primary focus:outline-none"
                />
              </div>

              <label className="flex items-start gap-2.5 text-xs text-text-secondary">
                <input
                  type="checkbox"
                  checked={rightsConfirmed}
                  onChange={(e) => setRightsConfirmed(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-border bg-bg accent-primary"
                />
                <span>
                  I confirm I own or am authorized to manage this media source (logged to Activity).
                </span>
              </label>

              <div className="flex items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => importMutation.mutate()}
                  disabled={
                    !rightsConfirmed ||
                    destination.providerConnectionIds.length === 0 ||
                    importMutation.isPending
                  }
                  className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-xs font-medium text-primary-foreground hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {importMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : null}
                  {destination.providerConnectionIds.length > 1
                    ? `Start import to ${destination.providerConnectionIds.length} providers`
                    : "Start import job"}
                </button>
              </div>
            </>
          ) : null}

          {errorMsg ? (
            <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-subtle p-3 text-xs text-danger">
              <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          ) : null}

          {createdResult ? (
            <div className="space-y-2 rounded-lg border border-primary/30 bg-primary-subtle p-4 text-xs text-text-primary">
              <div className="font-semibold">
                {createdResult.deduplicated
                  ? "Existing import job reused (idempotency guard)"
                  : "Import job created"}
              </div>
              <div className="font-mono text-text-secondary">
                {createdResult.jobs && createdResult.jobs.length > 1
                  ? `Created ${createdResult.jobs.length} provider jobs for 1 universal asset.`
                  : `Job ID: ${createdResult.job.id} · Status: ${createdResult.job.status}`}
              </div>
              {createdResult.jobs && createdResult.jobs.length > 1 ? (
                <ul className="space-y-1 font-mono text-[11px] text-text-secondary">
                  {createdResult.jobs.map((entry) => (
                    <li key={entry.job.id}>
                      <Link href={`/jobs/${entry.job.id}`} className="text-primary hover:underline">
                        {entry.providerKey} ({entry.job.id.slice(0, 8)})
                      </Link>
                      {": "}
                      {entry.error ? `error: ${entry.error}` : entry.job.status}
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="flex flex-wrap gap-2 pt-1">
                <Link
                  href={`/jobs/${createdResult.job.id}`}
                  className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground hover:bg-primary-hover"
                >
                  Track job
                </Link>
                {createdResult.assetId ? (
                  <Link
                    href={`/library/${createdResult.assetId}`}
                    className="rounded-md border border-border bg-surface px-3 py-1.5 font-medium text-text-primary hover:bg-surface-raised"
                  >
                    Open asset
                  </Link>
                ) : null}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {activeTab === "file" ? (
        <EmptyState
          icon={Upload}
          title="Local file staging (R2 presigned PUT/GET spike)"
          body={t.importPage.fileSpikeNotice}
        />
      ) : null}

      {activeTab === "bulk" ? <BulkImportPanel /> : null}
    </div>
  );
}
