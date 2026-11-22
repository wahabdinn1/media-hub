"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Film,
  Folder,
  FolderKanban,
  FolderPlus,
  Grid2X2,
  Layers,
  List,
  Loader2,
  Plug,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  X,
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

interface ProviderFolderItem {
  id: string;
  providerConnectionId: string;
  providerKey: string;
  externalId: string;
  name: string;
  parentExternalId: string | null;
  updatedAt: string;
}

interface CollectionItem {
  id: string;
  name: string;
  description: string;
  parentId: string | null;
  assetCount: number;
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
  if (!seconds || seconds <= 0) return "None";
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
  const collectionParam = searchParams.get("collectionId") ?? "";
  const pageParam = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);

  const [searchInput, setSearchInput] = useState(qParam);
  const [viewMode, setViewMode] = useState<"grid" | "table">("table");
  const [newFolderName, setNewFolderName] = useState("");
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [confirmDeleteFolderId, setConfirmDeleteFolderId] = useState<string | null>(null);

  const [newCollectionName, setNewCollectionName] = useState("");
  const [showNewCollection, setShowNewCollection] = useState(false);
  const [confirmDeleteColId, setConfirmDeleteColId] = useState<string | null>(null);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [targetCollectionId, setTargetCollectionId] = useState("");

  const [syncNotice, setSyncNotice] = useState<{ kind: "success" | "error"; text: string } | null>(
    null,
  );

  const { data, isLoading, error } = useQuery<AssetsListResponse>({
    queryKey: [
      "assets",
      { q: qParam, status: statusParam, collectionId: collectionParam, page: pageParam },
    ],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (qParam) params.set("q", qParam);
      if (statusParam !== "all") params.set("status", statusParam);
      if (collectionParam) params.set("collectionId", collectionParam);
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

  const { data: foldersData } = useQuery<{ folders: ProviderFolderItem[] }>({
    queryKey: ["provider-folders"],
    queryFn: async () => {
      const res = await fetch("/api/folders");
      if (!res.ok) return { folders: [] };
      return res.json();
    },
  });

  const { data: collectionsData } = useQuery<{ collections: CollectionItem[] }>({
    queryKey: ["collections"],
    queryFn: async () => {
      const res = await fetch("/api/collections");
      if (!res.ok) return { collections: [] };
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
        summary?: {
          created: number;
          updated: number;
          unchanged: number;
          foldersSynced: number;
        };
      };
      if (!res.ok) throw new Error(json.error ?? "Sync failed");
      return json;
    },
    onSuccess: (res) => {
      const s = res.summary;
      setSyncNotice({
        kind: "success",
        text: s
          ? `Sync finished: ${s.created} added, ${s.updated} updated, ${s.unchanged} unchanged, ${s.foldersSynced} folder(s) synced.`
          : "Sync completed.",
      });
      void queryClient.invalidateQueries({ queryKey: ["assets"] });
      void queryClient.invalidateQueries({ queryKey: ["provider-folders"] });
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

  const createFolderMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await fetch("/api/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to create folder");
      return json;
    },
    onSuccess: () => {
      setNewFolderName("");
      setShowNewFolder(false);
      setSyncNotice({ kind: "success", text: "Provider folder created." });
      void queryClient.invalidateQueries({ queryKey: ["provider-folders"] });
    },
    onError: (err) => {
      setSyncNotice({
        kind: "error",
        text: err instanceof Error ? err.message : "Failed to create folder.",
      });
    },
  });

  const deleteFolderMutation = useMutation({
    mutationFn: async (folderId: string) => {
      const res = await fetch(`/api/folders/${folderId}`, { method: "DELETE" });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error ?? "Failed to delete folder");
      }
    },
    onSuccess: () => {
      setSyncNotice({
        kind: "success",
        text: "Folder deleted at provider. Videos inside were kept and moved to root.",
      });
      void queryClient.invalidateQueries({ queryKey: ["provider-folders"] });
    },
    onError: (err) => {
      setSyncNotice({
        kind: "error",
        text: err instanceof Error ? err.message : "Failed to delete folder.",
      });
    },
  });

  const createCollectionMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await fetch("/api/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to create collection");
      return json;
    },
    onSuccess: () => {
      setNewCollectionName("");
      setShowNewCollection(false);
      setSyncNotice({ kind: "success", text: "MediaHub collection created." });
      void queryClient.invalidateQueries({ queryKey: ["collections"] });
    },
    onError: (err) => {
      setSyncNotice({
        kind: "error",
        text: err instanceof Error ? err.message : "Failed to create collection.",
      });
    },
  });

  const deleteCollectionMutation = useMutation({
    mutationFn: async (collectionId: string) => {
      const res = await fetch(`/api/collections/${collectionId}`, { method: "DELETE" });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error ?? "Failed to delete collection");
      }
      return collectionId;
    },
    onSuccess: (deletedId) => {
      setSyncNotice({
        kind: "success",
        text: "Collection removed. All media assets remain untouched.",
      });
      if (collectionParam === deletedId) {
        updateQuery({ collectionId: "" });
      }
      void queryClient.invalidateQueries({ queryKey: ["collections"] });
    },
    onError: (err) => {
      setSyncNotice({
        kind: "error",
        text: err instanceof Error ? err.message : "Failed to delete collection.",
      });
    },
  });

  const bulkAddToCollectionMutation = useMutation({
    mutationFn: async ({ collectionId, assetIds }: { collectionId: string; assetIds: string[] }) => {
      const res = await fetch(`/api/collections/${collectionId}/assets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetIds }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; added?: number };
      if (!res.ok) throw new Error(json.error ?? "Failed to add assets to collection");
      return json;
    },
    onSuccess: (res) => {
      setSelectedIds([]);
      setSyncNotice({
        kind: "success",
        text: `Added ${res.added ?? 0} asset(s) to collection.`,
      });
      void queryClient.invalidateQueries({ queryKey: ["collections"] });
      void queryClient.invalidateQueries({ queryKey: ["assets"] });
    },
    onError: (err) => {
      setSyncNotice({
        kind: "error",
        text: err instanceof Error ? err.message : "Failed to update collection.",
      });
    },
  });

  function updateQuery(next: { q?: string; status?: string; collectionId?: string; page?: number }) {
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
    if (next.collectionId !== undefined) {
      if (next.collectionId) params.set("collectionId", next.collectionId);
      else params.delete("collectionId");
      params.delete("page");
    }
    if (next.page !== undefined) {
      if (next.page <= 1) params.delete("page");
      else params.set("page", String(next.page));
    }
    const qs = params.toString();
    router.push(qs ? `/library?${qs}` : "/library");
  }

  function toggleSelect(assetId: string) {
    setSelectedIds((prev) =>
      prev.includes(assetId) ? prev.filter((id) => id !== assetId) : [...prev, assetId],
    );
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const folders = foldersData?.folders ?? [];
  const collectionsList = collectionsData?.collections ?? [];
  const activeCollection = collectionsList.find((c) => c.id === collectionParam) ?? null;
  const allVisibleSelected =
    Boolean(data?.items.length) && data!.items.every((item) => selectedIds.includes(item.id));

  const filters: Array<{ key: string; label: string }> = [
    { key: "all", label: t.library.filterAll },
    { key: "active", label: t.statuses.asset.active },
    { key: "processing", label: t.statuses.asset.processing },
    { key: "removed_remote", label: t.library.filterRemoved },
    { key: "dmca", label: t.library.filterDmca },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        title={t.library.title}
        subtitle={t.library.subtitle}
        actions={
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => {
                setSyncNotice(null);
                syncMutation.mutate();
              }}
              disabled={syncMutation.isPending}
              className="dusk-btn-ghost h-9 px-3.5 text-xs disabled:opacity-50"
            >
              {syncMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              {syncMutation.isPending ? "Syncing…" : "Sync from provider"}
            </button>

            <Link href="/import?tab=url" className="dusk-btn-primary h-9 px-4 text-xs">
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
            "flex items-center gap-2 rounded-xl px-4 py-3 text-xs font-medium",
            syncNotice.kind === "success"
              ? "bg-success-subtle text-success"
              : "bg-danger-subtle text-danger",
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

      {/* Dusk Organization Well: borderless tinted well with internal hairline divider */}
      <section className="dusk-well grid grid-cols-1 divide-y divide-border/70 p-5 lg:grid-cols-2 lg:divide-x lg:divide-y-0">
        <div className="space-y-3 pb-4 lg:pb-0 lg:pr-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-medium text-text-primary">MediaHub collections</h2>
              <span className="tabular-nums text-xs text-text-secondary">
                ({collectionsList.length})
              </span>
            </div>
            <button
              type="button"
              onClick={() => setShowNewCollection((v) => !v)}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              <Plus className="h-3.5 w-3.5" />
              New collection
            </button>
          </div>

          {showNewCollection ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (newCollectionName.trim()) {
                  createCollectionMutation.mutate(newCollectionName.trim());
                }
              }}
              className="flex flex-wrap items-center gap-2"
            >
              <input
                type="text"
                value={newCollectionName}
                onChange={(e) => setNewCollectionName(e.target.value)}
                placeholder="Collection name…"
                className="h-8 w-56 rounded-lg border border-border bg-bg px-3 text-xs text-text-primary placeholder:text-text-secondary focus:border-primary focus:outline-none"
              />
              <button
                type="submit"
                disabled={!newCollectionName.trim() || createCollectionMutation.isPending}
                className="dusk-btn-primary h-8 px-3.5 text-xs disabled:opacity-50"
              >
                {createCollectionMutation.isPending ? "Creating…" : "Create"}
              </button>
            </form>
          ) : null}

          {collectionsList.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => updateQuery({ collectionId: "" })}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                  !collectionParam
                    ? "bg-primary text-primary-foreground"
                    : "bg-surface-raised/80 text-text-secondary hover:text-text-primary",
                )}
              >
                All assets
              </button>
              {collectionsList.map((col) => (
                <div
                  key={col.id}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs",
                    collectionParam === col.id
                      ? "bg-primary-subtle text-primary"
                      : "bg-surface-raised/80 text-text-primary",
                  )}
                >
                  <button
                    type="button"
                    onClick={() =>
                      updateQuery({ collectionId: collectionParam === col.id ? "" : col.id })
                    }
                    className="inline-flex items-center gap-1.5 font-medium"
                  >
                    <Layers className="h-3 w-3" />
                    <span>{col.name}</span>
                    <span className="tabular-nums opacity-75">({col.assetCount})</span>
                  </button>
                  {confirmDeleteColId === col.id ? (
                    <span className="inline-flex items-center gap-1 pl-1">
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmDeleteColId(null);
                          deleteCollectionMutation.mutate(col.id);
                        }}
                        disabled={deleteCollectionMutation.isPending}
                        className="rounded-full bg-danger px-2 py-0.5 text-xs font-medium text-primary-foreground"
                      >
                        Delete
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteColId(null)}
                        className="text-xs text-text-secondary hover:text-text-primary"
                      >
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      title="Delete collection (assets are kept)"
                      onClick={() => setConfirmDeleteColId(col.id)}
                      className="text-text-secondary hover:text-danger"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-text-secondary">
              Organize videos across providers with MediaHub collections without changing provider
              folders.
            </p>
          )}
        </div>

        <div className="space-y-3 pt-4 lg:pl-6 lg:pt-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-medium text-text-primary">Provider folders</h2>
              <span className="tabular-nums text-xs text-text-secondary">({folders.length})</span>
            </div>
            <button
              type="button"
              onClick={() => setShowNewFolder((v) => !v)}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              <FolderPlus className="h-3.5 w-3.5" />
              New folder
            </button>
          </div>

          {showNewFolder ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (newFolderName.trim()) {
                  createFolderMutation.mutate(newFolderName.trim());
                }
              }}
              className="flex flex-wrap items-center gap-2"
            >
              <input
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="Folder name…"
                className="h-8 w-56 rounded-lg border border-border bg-bg px-3 text-xs text-text-primary placeholder:text-text-secondary focus:border-primary focus:outline-none"
              />
              <button
                type="submit"
                disabled={!newFolderName.trim() || createFolderMutation.isPending}
                className="dusk-btn-primary h-8 px-3.5 text-xs disabled:opacity-50"
              >
                {createFolderMutation.isPending ? "Creating…" : "Create"}
              </button>
            </form>
          ) : null}

          {folders.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {folders.map((folder) => (
                <div
                  key={folder.id}
                  className="inline-flex items-center gap-2 rounded-full bg-surface-raised/80 px-3 py-1 text-xs"
                >
                  <Folder className="h-3.5 w-3.5 text-primary" />
                  <span className="font-medium text-text-primary">{folder.name}</span>
                  <ProviderBadge providerKey={folder.providerKey} />
                  {confirmDeleteFolderId === folder.id ? (
                    <span className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmDeleteFolderId(null);
                          deleteFolderMutation.mutate(folder.id);
                        }}
                        disabled={deleteFolderMutation.isPending}
                        className="rounded-full bg-danger px-2 py-0.5 text-xs font-medium text-primary-foreground"
                      >
                        Delete
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteFolderId(null)}
                        className="text-xs text-text-secondary hover:text-text-primary"
                      >
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      title="Delete folder (videos move to root)"
                      onClick={() => setConfirmDeleteFolderId(folder.id)}
                      className="text-text-secondary hover:text-danger"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-text-secondary">
              No provider folders synced yet. Click &ldquo;Sync from provider&rdquo; to load folders
              from your connected account.
            </p>
          )}
        </div>
      </section>

      {selectedIds.length > 0 ? (
        <div className="dusk-plate flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs">
          <div className="flex items-center gap-2.5 font-medium text-primary">
            <span className="tabular-nums">{selectedIds.length} selected</span>
            <button
              type="button"
              onClick={() => setSelectedIds([])}
              className="inline-flex items-center gap-1 text-text-secondary hover:text-text-primary"
            >
              <X className="h-3.5 w-3.5" />
              Clear
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={targetCollectionId}
              onChange={(e) => setTargetCollectionId(e.target.value)}
              className="h-8 rounded-full border border-border bg-bg px-3 text-xs text-text-primary focus:border-primary focus:outline-none"
            >
              <option value="">Choose collection…</option>
              {collectionsList.map((col) => (
                <option key={col.id} value={col.id}>
                  {col.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!targetCollectionId || bulkAddToCollectionMutation.isPending}
              onClick={() =>
                bulkAddToCollectionMutation.mutate({
                  collectionId: targetCollectionId,
                  assetIds: selectedIds,
                })
              }
              className="dusk-btn-primary h-8 px-3.5 text-xs disabled:opacity-50"
            >
              {bulkAddToCollectionMutation.isPending ? "Adding…" : "Add to collection"}
            </button>
          </div>
        </div>
      ) : null}

      {/* Filter & View Toolbar: Dusk ruled tabs + borderless search */}
      <div className="flex flex-col gap-3 border-b border-border pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-4 text-xs">
          {filters.map((f) => {
            const active = statusParam === f.key;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => updateQuery({ status: f.key })}
                className={cn(
                  "inline-flex items-center gap-1.5 font-medium transition-colors",
                  active ? "text-text-primary" : "text-text-secondary hover:text-text-primary",
                )}
              >
                {active ? (
                  <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />
                ) : null}
                {f.label}
              </button>
            );
          })}
          {activeCollection ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-subtle px-2.5 py-0.5 font-medium text-primary">
              <Layers className="h-3 w-3" />
              {activeCollection.name}
              <button
                type="button"
                aria-label="Clear collection filter"
                onClick={() => updateQuery({ collectionId: "" })}
                className="hover:opacity-75"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              updateQuery({ q: searchInput });
            }}
            className="relative flex-1 sm:w-56"
          >
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-secondary" />
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Filter title…"
              className="h-8 w-full rounded-full border border-border bg-surface pl-8 pr-3 text-xs text-text-primary placeholder:text-text-secondary focus:border-primary focus:outline-none"
            />
          </form>

          <div className="inline-flex items-center gap-1 rounded-full bg-surface p-0.5">
            <button
              type="button"
              onClick={() => setViewMode("grid")}
              aria-label={t.library.viewGrid}
              className={cn(
                "rounded-full p-1.5 transition-colors",
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
                "rounded-full p-1.5 transition-colors",
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
        <div className="dusk-well flex items-center gap-2 p-6 text-sm text-text-secondary">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading catalog…
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl bg-danger-subtle p-4 text-sm text-danger">
          {error instanceof Error ? error.message : "Failed to load catalog."}
        </div>
      ) : null}

      {data && data.items.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title={activeCollection ? `No assets in "${activeCollection.name}"` : t.library.emptyTitle}
          body={
            activeCollection
              ? "Select assets in the library table to add them to this collection."
              : t.library.emptyBody
          }
          action={
            activeCollection ? (
              <button
                type="button"
                onClick={() => updateQuery({ collectionId: "" })}
                className="dusk-btn-ghost h-9 px-4 text-xs"
              >
                Show all assets
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => syncMutation.mutate()}
                  disabled={syncMutation.isPending}
                  className="dusk-btn-primary h-9 px-4 text-xs"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Sync from provider
                </button>
                <Link href="/providers" className="dusk-btn-ghost h-9 px-4 text-xs">
                  <Plug className="h-3.5 w-3.5" />
                  {t.library.ctaConnectProvider}
                </Link>
              </>
            )
          }
        />
      ) : null}

      {/* Full-width borderless hairline table (craft.md § 9) */}
      {data && data.items.length > 0 && viewMode === "table" ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-text-secondary">
                <th className="w-9 py-3 pr-3">
                  <input
                    type="checkbox"
                    aria-label="Select all visible assets"
                    checked={allVisibleSelected}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedIds(data.items.map((i) => i.id));
                      } else {
                        setSelectedIds([]);
                      }
                    }}
                    className="h-3.5 w-3.5 rounded border-border accent-primary"
                  />
                </th>
                <th className="py-3 pr-4 font-medium whitespace-nowrap">Asset</th>
                <th className="py-3 pr-4 font-medium whitespace-nowrap">Status</th>
                <th className="py-3 pr-4 font-medium whitespace-nowrap">Provider</th>
                <th className="py-3 pr-4 font-medium whitespace-nowrap">Duration</th>
                <th className="py-3 font-medium whitespace-nowrap">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/70">
              {data.items.map((item, idx) => (
                <tr key={item.id} className="transition-colors hover:bg-surface/60">
                  <td className="py-3.5 pr-3">
                    <input
                      type="checkbox"
                      aria-label={`Select ${item.title}`}
                      checked={selectedIds.includes(item.id)}
                      onChange={() => toggleSelect(item.id)}
                      className="h-3.5 w-3.5 rounded border-border accent-primary"
                    />
                  </td>
                  <td className="py-3.5 pr-4">
                    <Link href={`/library/${item.id}`} className="flex items-center gap-3.5">
                      <div className="flex h-10 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-raised">
                        {item.thumbnailUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={item.thumbnailUrl}
                            alt=""
                            className="h-full w-full object-cover"
                            loading={idx === 0 ? "eager" : "lazy"}
                            fetchPriority={idx === 0 ? "high" : undefined}
                          />
                        ) : (
                          <Film className="h-4 w-4 text-text-secondary" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate font-medium text-text-primary hover:text-primary">
                          {item.title}
                        </div>
                        <div className="font-mono text-xs text-text-secondary">
                          {item.id.slice(0, 8)}
                        </div>
                      </div>
                    </Link>
                  </td>
                  <td className="py-3.5 pr-4">
                    <StatusBadge
                      label={t.statuses.asset[item.canonicalStatus]}
                      tone={assetStatusTone(item.canonicalStatus)}
                      dot
                    />
                  </td>
                  <td className="py-3.5 pr-4">
                    <div className="flex flex-wrap gap-1.5">
                      {item.providers.map((p) => (
                        <ProviderBadge
                          key={`${p.connectionId}-${p.externalId}`}
                          providerKey={p.providerKey}
                        />
                      ))}
                    </div>
                  </td>
                  <td className="py-3.5 pr-4 tabular-nums text-xs text-text-secondary">
                    {formatDuration(item.durationSeconds)}
                  </td>
                  <td className="py-3.5 tabular-nums text-xs text-text-secondary">
                    {new Date(item.updatedAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {data && data.items.length > 0 && viewMode === "grid" ? (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {data.items.map((item, idx) => (
            <Link key={item.id} href={`/library/${item.id}`} className="group block space-y-2.5">
              <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-xl bg-surface">
                {item.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.thumbnailUrl}
                    alt=""
                    className="h-full w-full object-cover"
                    loading={idx === 0 ? "eager" : "lazy"}
                    fetchPriority={idx === 0 ? "high" : undefined}
                  />
                ) : (
                  <Film className="h-7 w-7 text-text-secondary" />
                )}
                {item.durationSeconds ? (
                  <span className="absolute bottom-2 right-2 rounded-full bg-bg/90 px-2 py-0.5 tabular-nums text-xs text-text-primary">
                    {formatDuration(item.durationSeconds)}
                  </span>
                ) : null}
              </div>
              <div className="space-y-1.5">
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
          <span className="tabular-nums">
            Page {data.page} of {totalPages} ({data.total} assets)
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={data.page <= 1}
              onClick={() => updateQuery({ page: data.page - 1 })}
              className="dusk-btn-ghost h-8 px-3 text-xs disabled:opacity-40"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={data.page >= totalPages}
              onClick={() => updateQuery({ page: data.page + 1 })}
              className="dusk-btn-ghost h-8 px-3 text-xs disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
