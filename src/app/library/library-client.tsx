"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Film,
  FolderKanban,
  Grid2X2,
  List,
  Loader2,
  Plug,
  RefreshCw,
  Search,
  Upload,
  XCircle,
} from "lucide-react";
import { getMessages, type CanonicalAssetStatus } from "@/shared";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge, type BadgeTone } from "@/components/ui/status-badge";
import { ProviderBadge } from "@/components/ui/provider-badge";
import { cn } from "@/lib/cn";

interface AssetItem {
  id: string;
  assetType: string;
  title: string;
  canonicalStatus: CanonicalAssetStatus;
  sizeBytes: number | null;
  durationSeconds: number | null;
  createdAt: string;
  updatedAt: string;
  thumbnailUrl: string | null;
  providers: Array<{
    connectionId: string;
    providerKey: string;
    externalId: string;
    externalUrl: string | null;
    syncState: string;
  }>;
}

interface AssetsListResponse {
  items: AssetItem[];
  total: number;
  page: number;
  pageSize: number;
}

function assetStatusTone(status: CanonicalAssetStatus): BadgeTone {
  switch (status) {
    case "active":
      return "success";
    case "processing":
      return "info";
    case "dmca":
    case "error":
    case "blocked":
      return "danger";
    case "removed_remote":
      return "warning";
  }
}

function formatDuration(seconds: number | null): string {
  if (!seconds || seconds <= 0) return "—";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function LibraryClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const t = getMessages("en");

  const qParam = searchParams.get("q") ?? "";
  const statusParam = searchParams.get("status") ?? "all";
  const pageParam = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);

  const [searchInput, setSearchInput] = useState(qParam);
  const [viewMode, setViewMode] = useState<"grid" | "table">("table");
  const [syncNotice, setSyncNotice] = useState<{ kind: "success" | "error"; text: string } | null>(
    null,
  );

  const { data, isLoading, error } = useQuery<AssetsListResponse>({
    queryKey: ["assets", { q: qParam, status: statusParam, page: pageParam }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (qParam) params.set("q", qParam);
      if (statusParam !== "all") params.set("status", statusParam);
      params.set("page", String(pageParam));
      params.set("pageSize", "24");
      const res = await fetch(`/api/assets?${params.toString()}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Failed to load library");
      }
      return res.json();
    },
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/assets/sync", {
        method: "POST",
        headers: { "idempotency-key": `sync-ui-${Date.now()}` },
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        summary?: { created: number; updated: number; unchanged: number };
      };
      if (!res.ok) throw new Error(json.error ?? "Sync failed");
      return json;
    },
    onSuccess: (res) => {
      const s = res.summary;
      setSyncNotice({
        kind: "success",
        text: s
          ? `Sync finished: ${s.created} added, ${s.updated} updated, ${s.unchanged} unchanged.`
          : "Sync completed.",
      });
      void queryClient.invalidateQueries({ queryKey: ["assets"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: (err) => {
      setSyncNotice({
        kind: "error",
        text: err instanceof Error ? err.message : "Sync failed.",
      });
    },
  });

  function updateQuery(next: { q?: string; status?: string; page?: number }) {
    const params = new URLSearchParams(searchParams.toString());
    if (next.q !== undefined) {
      if (next.q.trim()) params.set("q", next.q.trim());
      else params.delete("q");
      params.delete("page");
    }
    if (next.status !== undefined) {
      if (next.status === "all") params.delete("status");
      else params.set("status", next.status);
      params.delete("page");
    }
    if (next.page !== undefined) {
      if (next.page <= 1) params.delete("page");
      else params.set("page", String(next.page));
    }
    const qs = params.toString();
    router.push(qs ? `/library?${qs}` : "/library");
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  const filters: Array<{ key: string; label: string }> = [
    { key: "all", label: t.library.filterAll },
    { key: "active", label: t.statuses.asset.active },
    { key: "processing", label: t.statuses.asset.processing },
    { key: "removed_remote", label: t.library.filterRemoved },
    { key: "dmca", label: t.library.filterDmca },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title={t.library.title}
        subtitle={t.library.subtitle}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setSyncNotice(null);
                syncMutation.mutate();
              }}
              disabled={syncMutation.isPending}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-medium text-text-primary hover:bg-surface-raised disabled:opacity-50"
            >
              {syncMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              {syncMutation.isPending ? "Syncing..." : "Sync from provider"}
            </button>

            <Link
              href="/import?tab=url"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary-hover"
            >
              <Upload className="h-3.5 w-3.5" />
              {t.library.ctaImportUrl}
            </Link>
          </div>
        }
      />

      {syncNotice ? (
        <div
          role="status"
          className={cn(
            "flex items-center gap-2 rounded-lg border px-3.5 py-2.5 text-xs",
            syncNotice.kind === "success"
              ? "border-success/30 bg-success-subtle text-success"
              : "border-danger/30 bg-danger-subtle text-danger",
          )}
        >
          {syncNotice.kind === "success" ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          ) : (
            <XCircle className="h-4 w-4 shrink-0" />
          )}
          <span>{syncNotice.text}</span>
        </div>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-1.5">
          {filters.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => updateQuery({ status: f.key })}
              className={cn(
                "rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors",
                statusParam === f.key
                  ? "border-primary/40 bg-primary-subtle text-primary"
                  : "border-border bg-surface text-text-secondary hover:text-text-primary",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              updateQuery({ q: searchInput });
            }}
            className="relative flex-1 sm:w-56"
          >
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-secondary" />
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Filter title..."
              className="h-8 w-full rounded-lg border border-border bg-surface pl-8 pr-2.5 text-xs text-text-primary placeholder:text-text-secondary focus:border-primary focus:outline-none"
            />
          </form>

          <div className="inline-flex rounded-lg border border-border bg-surface p-0.5">
            <button
              type="button"
              onClick={() => setViewMode("grid")}
              aria-label={t.library.viewGrid}
              className={cn(
                "rounded-md p-1.5",
                viewMode === "grid"
                  ? "bg-surface-raised text-text-primary"
                  : "text-text-secondary hover:text-text-primary",
              )}
            >
              <Grid2X2 className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode("table")}
              aria-label={t.library.viewTable}
              className={cn(
                "rounded-md p-1.5",
                viewMode === "table"
                  ? "bg-surface-raised text-text-primary"
                  : "text-text-secondary hover:text-text-primary",
              )}
            >
              <List className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 rounded-xl border border-border bg-surface p-6 text-sm text-text-secondary">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading catalog...
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-danger/30 bg-danger-subtle p-4 text-sm text-danger">
          {error instanceof Error ? error.message : "Failed to load catalog."}
        </div>
      ) : null}

      {data && data.items.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title={t.library.emptyTitle}
          body={t.library.emptyBody}
          action={
            <>
              <button
                type="button"
                onClick={() => syncMutation.mutate()}
                disabled={syncMutation.isPending}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-xs font-medium text-primary-foreground hover:bg-primary-hover"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Sync from provider
              </button>
              <Link
                href="/providers"
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3.5 py-2 text-xs font-medium text-text-primary hover:bg-surface-raised"
              >
                <Plug className="h-3.5 w-3.5" />
                {t.library.ctaConnectProvider}
              </Link>
            </>
          }
        />
      ) : null}

      {data && data.items.length > 0 && viewMode === "table" ? (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full min-w-[640px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-text-secondary">
                <th className="px-4 py-3 font-medium">Asset</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Provider</th>
                <th className="px-4 py-3 font-medium">Duration</th>
                <th className="px-4 py-3 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.items.map((item) => (
                <tr key={item.id} className="hover:bg-surface-raised/50">
                  <td className="px-4 py-3">
                    <Link href={`/library/${item.id}`} className="flex items-center gap-3">
                      <div className="flex h-10 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-bg">
                        {item.thumbnailUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={item.thumbnailUrl}
                            alt=""
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <Film className="h-4 w-4 text-text-secondary" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate font-medium text-text-primary hover:text-primary">
                          {item.title}
                        </div>
                        <div className="font-mono text-[11px] text-text-secondary">
                          {item.id.slice(0, 8)}
                        </div>
                      </div>
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge
                      label={t.statuses.asset[item.canonicalStatus]}
                      tone={assetStatusTone(item.canonicalStatus)}
                      dot
                    />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {item.providers.map((p) => (
                        <ProviderBadge key={`${p.connectionId}-${p.externalId}`} providerKey={p.providerKey} />
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-text-secondary">
                    {formatDuration(item.durationSeconds)}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-text-secondary">
                    {new Date(item.updatedAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {data && data.items.length > 0 && viewMode === "grid" ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {data.items.map((item) => (
            <Link
              key={item.id}
              href={`/library/${item.id}`}
              className="group overflow-hidden rounded-xl border border-border bg-surface transition-colors hover:border-border-strong"
            >
              <div className="relative flex aspect-video items-center justify-center overflow-hidden border-b border-border bg-bg">
                {item.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.thumbnailUrl}
                    alt=""
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <Film className="h-7 w-7 text-text-secondary" />
                )}
                {item.durationSeconds ? (
                  <span className="absolute bottom-2 right-2 rounded bg-bg/90 px-1.5 py-0.5 font-mono text-[11px] text-text-primary">
                    {formatDuration(item.durationSeconds)}
                  </span>
                ) : null}
              </div>
              <div className="space-y-2 p-3.5">
                <div className="line-clamp-2 text-sm font-medium text-text-primary group-hover:text-primary">
                  {item.title}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <StatusBadge
                    label={t.statuses.asset[item.canonicalStatus]}
                    tone={assetStatusTone(item.canonicalStatus)}
                    dot
                  />
                  {item.providers[0] ? (
                    <ProviderBadge providerKey={item.providers[0].providerKey} />
                  ) : null}
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : null}

      {data && data.total > data.pageSize ? (
        <div className="flex items-center justify-between border-t border-border pt-4 text-xs text-text-secondary">
          <span className="font-mono">
            Page {data.page} of {totalPages} ({data.total} assets)
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={data.page <= 1}
              onClick={() => updateQuery({ page: data.page - 1 })}
              className="rounded-md border border-border bg-surface px-3 py-1.5 text-text-primary hover:bg-surface-raised disabled:opacity-40"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={data.page >= totalPages}
              onClick={() => updateQuery({ page: data.page + 1 })}
              className="rounded-md border border-border bg-surface px-3 py-1.5 text-text-primary hover:bg-surface-raised disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
