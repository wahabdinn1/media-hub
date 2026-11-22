"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ExternalLink,
  Film,
  History,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  Subtitles,
} from "lucide-react";
import { getMessages, type CanonicalAssetStatus } from "@/shared";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge, type BadgeTone } from "@/components/ui/status-badge";
import { ProviderBadge } from "@/components/ui/provider-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/cn";

type DetailTab = "overview" | "provider" | "thumbnail" | "subtitles" | "history";

interface AssetDetailResponse {
  asset: {
    id: string;
    assetType: string;
    title: string;
    canonicalStatus: CanonicalAssetStatus;
    sizeBytes: number | null;
    durationSeconds: number | null;
    sourceUrlHash: string | null;
    createdAt: string;
    updatedAt: string;
  };
  locations: Array<{
    id: string;
    providerConnectionId: string;
    providerKey: string;
    connectionStatus: string;
    isDefaultConnection: boolean;
    externalId: string;
    externalUrl: string | null;
    syncState: string;
    lastSeenAt: string | null;
    providerMetadata: Record<string, unknown>;
  }>;
  thumbnails: Array<{
    id: string;
    sourceType: string;
    sourceUrl: string | null;
    isActive: boolean;
    createdAt: string;
  }>;
  history: Array<{
    id: string;
    action: string;
    actorId: string;
    createdAt: string;
    contextJson: string;
  }>;
  relatedJobs: Array<{
    id: string;
    jobType: string;
    status: string;
    createdAt: string;
  }>;
}

function statusTone(status: CanonicalAssetStatus): BadgeTone {
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

export function AssetDetailClient({ assetId }: { assetId: string }) {
  const t = getMessages("en");
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<DetailTab>("overview");
  const [encodingInfo, setEncodingInfo] = useState<{ progressPercent: number; completed: boolean } | null>(
    null,
  );

  const { data, isLoading, error } = useQuery<AssetDetailResponse>({
    queryKey: ["asset", assetId],
    queryFn: async () => {
      const res = await fetch(`/api/assets/${assetId}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Asset not found");
      }
      return res.json();
    },
  });

  const encodingMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/assets/${assetId}/encoding`, { method: "POST" });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        encoding?: { progressPercent: number; completed: boolean };
      };
      if (!res.ok) throw new Error(json.error ?? "Encoding status check failed");
      return json.encoding!;
    },
    onSuccess: (enc) => {
      setEncodingInfo(enc);
      void queryClient.invalidateQueries({ queryKey: ["asset", assetId] });
      void queryClient.invalidateQueries({ queryKey: ["assets"] });
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border bg-surface p-6 text-sm text-text-secondary">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading asset...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-4">
        <Link href="/library" className="inline-flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary">
          <ArrowLeft className="h-3.5 w-3.5" />
          {t.library.title}
        </Link>
        <div className="rounded-xl border border-danger/30 bg-danger-subtle p-4 text-sm text-danger">
          {error instanceof Error ? error.message : "Asset not found."}
        </div>
      </div>
    );
  }

  const { asset, locations, thumbnails, history, relatedJobs } = data;
  const activeThumb = thumbnails.find((th) => th.isActive) ?? thumbnails[0] ?? null;

  const tabs: Array<{ key: DetailTab; label: string }> = [
    { key: "overview", label: t.library.detailTabs.overview },
    { key: "provider", label: t.library.detailTabs.provider },
    { key: "thumbnail", label: t.library.detailTabs.thumbnail },
    { key: "subtitles", label: t.library.detailTabs.subtitles },
    { key: "history", label: t.library.detailTabs.history },
  ];

  return (
    <div className="space-y-6">
      <Link href="/library" className="inline-flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary">
        <ArrowLeft className="h-3.5 w-3.5" />
        {t.library.title}
      </Link>

      <PageHeader
        title={asset.title}
        subtitle={`MediaHub ID: ${asset.id}`}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge
              label={t.statuses.asset[asset.canonicalStatus]}
              tone={statusTone(asset.canonicalStatus)}
              dot
            />
            {asset.canonicalStatus === "processing" ? (
              <button
                type="button"
                onClick={() => encodingMutation.mutate()}
                disabled={encodingMutation.isPending}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-medium text-text-primary hover:bg-surface-raised disabled:opacity-50"
              >
                {encodingMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                Check encoding status
              </button>
            ) : null}
          </div>
        }
      />

      {encodingInfo ? (
        <div className="rounded-xl border border-info/30 bg-info-subtle p-3.5 text-xs text-info">
          Provider encoding progress: <span className="font-mono font-semibold">{encodingInfo.progressPercent}%</span>
          {encodingInfo.completed ? " — Completed and marked active." : " — Still encoding."}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-1.5 border-b border-border pb-2">
        {tabs.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              tab === item.key
                ? "bg-primary-subtle text-primary"
                : "text-text-secondary hover:bg-surface-raised hover:text-text-primary",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "overview" ? (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <div className="overflow-hidden rounded-xl border border-border bg-surface">
            <div className="flex aspect-video items-center justify-center bg-bg">
              {activeThumb?.sourceUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={activeThumb.sourceUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <Film className="h-10 w-10 text-text-secondary" />
              )}
            </div>
          </div>

          <div className="rounded-xl border border-border bg-surface p-5 lg:col-span-2">
            <h2 className="text-sm font-semibold text-text-primary">Universal asset metadata</h2>
            <dl className="mt-4 grid grid-cols-1 gap-4 text-xs sm:grid-cols-2">
              <div>
                <dt className="text-text-secondary">MediaHub Asset ID</dt>
                <dd className="mt-1 font-mono text-text-primary">{asset.id}</dd>
              </div>
              <div>
                <dt className="text-text-secondary">Canonical status</dt>
                <dd className="mt-1 text-text-primary">{t.statuses.asset[asset.canonicalStatus]}</dd>
              </div>
              <div>
                <dt className="text-text-secondary">Duration</dt>
                <dd className="mt-1 font-mono text-text-primary">
                  {asset.durationSeconds ? `${asset.durationSeconds}s` : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-text-secondary">File size</dt>
                <dd className="mt-1 font-mono text-text-primary">
                  {asset.sizeBytes
                    ? `${(asset.sizeBytes / 1024 ** 2).toFixed(2)} MiB`
                    : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-text-secondary">Registered</dt>
                <dd className="mt-1 font-mono text-text-primary">
                  {new Date(asset.createdAt).toLocaleString()}
                </dd>
              </div>
              <div>
                <dt className="text-text-secondary">Provider locations</dt>
                <dd className="mt-1 flex flex-wrap gap-1.5">
                  {locations.map((loc) => (
                    <ProviderBadge key={loc.id} providerKey={loc.providerKey} />
                  ))}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      ) : null}

      {tab === "provider" ? (
        <div className="space-y-4">
          {locations.map((loc) => (
            <section
              key={loc.id}
              className="space-y-3 rounded-xl border border-border bg-surface p-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <ProviderBadge providerKey={loc.providerKey} isDefault={loc.isDefaultConnection} />
                  <StatusBadge label={loc.syncState} tone="info" />
                </div>
                {loc.externalUrl ? (
                  <a
                    href={loc.externalUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    Open at provider
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                ) : null}
              </div>

              <dl className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
                <div>
                  <dt className="text-text-secondary">External identifier</dt>
                  <dd className="mt-0.5 font-mono text-text-primary">{loc.externalId}</dd>
                </div>
                <div>
                  <dt className="text-text-secondary">Last synced</dt>
                  <dd className="mt-0.5 font-mono text-text-primary">
                    {loc.lastSeenAt ? new Date(loc.lastSeenAt).toLocaleString() : "—"}
                  </dd>
                </div>
              </dl>

              <div className="rounded-lg border border-border bg-bg p-3">
                <div className="text-[11px] font-medium text-text-secondary">
                  Provider-specific metadata
                </div>
                <pre className="mt-1.5 overflow-x-auto font-mono text-xs text-text-primary">
                  {JSON.stringify(loc.providerMetadata, null, 2)}
                </pre>
              </div>
            </section>
          ))}
        </div>
      ) : null}

      {tab === "thumbnail" ? (
        <div className="space-y-4">
          {thumbnails.length > 0 ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {thumbnails.map((th) => (
                <div key={th.id} className="overflow-hidden rounded-xl border border-border bg-surface">
                  <div className="flex aspect-video items-center justify-center bg-bg">
                    {th.sourceUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={th.sourceUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <ImageIcon className="h-6 w-6 text-text-secondary" />
                    )}
                  </div>
                  <div className="flex items-center justify-between p-3 text-xs">
                    <span className="capitalize text-text-primary">{th.sourceType} thumbnail</span>
                    {th.isActive ? <StatusBadge label="Active" tone="success" /> : null}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={ImageIcon}
              title="No thumbnails recorded yet"
              body="Provider-native thumbnails sync automatically; custom R2 thumbnail upload activates in Phase 5."
            />
          )}
        </div>
      ) : null}

      {tab === "subtitles" ? (
        <EmptyState
          icon={Subtitles}
          title="Subtitle attachment activates in Phase 6"
          body="Attach SRT or VTT subtitles by URL and language as tracked jobs when supported by the provider."
        />
      ) : null}

      {tab === "history" ? (
        <div className="space-y-4">
          {relatedJobs.length > 0 ? (
            <div className="rounded-xl border border-border bg-surface p-4">
              <h3 className="text-xs font-semibold text-text-primary">Related jobs</h3>
              <ul className="mt-2 divide-y divide-border">
                {relatedJobs.map((j) => (
                  <li key={j.id} className="flex items-center justify-between py-2 text-xs">
                    <Link href={`/jobs/${j.id}`} className="font-mono text-primary hover:underline">
                      {j.jobType} ({j.id.slice(0, 8)})
                    </Link>
                    <StatusBadge label={j.status} tone="info" />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {history.length > 0 ? (
            <div className="rounded-xl border border-border bg-surface p-4">
              <h3 className="text-xs font-semibold text-text-primary">Audit events</h3>
              <ul className="mt-2 divide-y divide-border">
                {history.map((ev) => (
                  <li key={ev.id} className="flex items-center justify-between py-2 text-xs">
                    <span className="font-mono text-text-primary">{ev.action}</span>
                    <span className="font-mono text-text-secondary">
                      {new Date(ev.createdAt).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <EmptyState
              icon={History}
              title="No asset history events yet"
              body="Imports, encoding transitions, and metadata edits appear here."
            />
          )}
        </div>
      ) : null}
    </div>
  );
}
