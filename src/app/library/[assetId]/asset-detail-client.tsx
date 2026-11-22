"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Copy,
  ExternalLink,
  Film,
  FolderInput,
  History,
  Image as ImageIcon,
  Layers,
  Loader2,
  Pencil,
  RefreshCw,
  Subtitles,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import {
  getMessages,
  hasCapability,
  type CanonicalAssetStatus,
  type CapabilityDescriptor,
} from "@/shared";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge, type BadgeTone } from "@/components/ui/status-badge";
import { ProviderBadge } from "@/components/ui/provider-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/cn";

type DetailTab = "overview" | "provider" | "thumbnail" | "subtitles" | "history";

interface AssetLocationView {
  id: string;
  providerConnectionId: string;
  providerKey: string;
  providerDisplayName: string;
  connectionStatus: string;
  isDefaultConnection: boolean;
  externalId: string;
  externalUrl: string | null;
  syncState: string;
  lastSeenAt: string | null;
  providerMetadata: Record<string, unknown>;
  capabilities: CapabilityDescriptor | null;
  canMutate: boolean;
  readOnlyReason: string | null;
}

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
  collections: Array<{ id: string; name: string }>;
  subtitles?: Array<{
    id: string;
    language: string;
    format: string;
    sourceUrl: string;
    createdAt: string;
  }>;
  locations: AssetLocationView[];
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

interface ProviderFolderItem {
  id: string;
  providerConnectionId: string;
  externalId: string;
  name: string;
}

interface CollectionItem {
  id: string;
  name: string;
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
  const router = useRouter();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<DetailTab>("overview");
  const [encodingInfo, setEncodingInfo] = useState<{
    progressPercent: number;
    completed: boolean;
  } | null>(null);
  const [actionNotice, setActionNotice] = useState<{
    kind: "success" | "error";
    text: string;
    linkHref?: string;
    linkLabel?: string;
  } | null>(null);

  const [renameDraft, setRenameDraft] = useState<string | null>(null);
  const [moveFolderId, setMoveFolderId] = useState<string>("__unchanged__");
  const [showDeletePanel, setShowDeletePanel] = useState(false);
  const [deleteLocalAlso, setDeleteLocalAlso] = useState(false);
  const [addCollectionId, setAddCollectionId] = useState("");
  const [thumbUrlInput, setThumbUrlInput] = useState("");
  const [subLangInput, setSubLangInput] = useState("en");
  const [subFormatInput, setSubFormatInput] = useState<"srt" | "vtt">("vtt");
  const [subUrlInput, setSubUrlInput] = useState("");

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

  const actionMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const res = await fetch(`/api/assets/${assetId}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        action?: string;
        clonedAssetId?: string;
        deletedLocal?: boolean;
      };
      if (!res.ok) throw new Error(json.error ?? "Action failed");
      return json;
    },
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ["asset", assetId] });
      void queryClient.invalidateQueries({ queryKey: ["assets"] });
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });

      if (res.action === "soft_delete_local" || res.deletedLocal) {
        router.push("/library");
        return;
      }
      if (res.action === "rename") {
        setRenameDraft(null);
        setActionNotice({ kind: "success", text: "Asset renamed at provider and synced locally." });
      } else if (res.action === "move") {
        setMoveFolderId("__unchanged__");
        setActionNotice({ kind: "success", text: "Asset moved to target provider folder." });
      } else if (res.action === "clone") {
        setActionNotice({
          kind: "success",
          text: "Asset cloned at provider and registered in MediaHub.",
          linkHref: res.clonedAssetId ? `/library/${res.clonedAssetId}` : undefined,
          linkLabel: "Open cloned asset",
        });
      } else if (res.action === "delete_provider") {
        setShowDeletePanel(false);
        setActionNotice({
          kind: "success",
          text: "Asset deleted at provider and marked removed_remote in MediaHub.",
        });
      }
    },
    onError: (err) => {
      setActionNotice({
        kind: "error",
        text: err instanceof Error ? err.message : "Asset action failed.",
      });
    },
  });

  const addCollectionMutation = useMutation({
    mutationFn: async (collectionId: string) => {
      const res = await fetch(`/api/collections/${collectionId}/assets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetIds: [assetId] }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to add to collection");
    },
    onSuccess: () => {
      setAddCollectionId("");
      void queryClient.invalidateQueries({ queryKey: ["asset", assetId] });
      void queryClient.invalidateQueries({ queryKey: ["collections"] });
    },
    onError: (err) => {
      setActionNotice({
        kind: "error",
        text: err instanceof Error ? err.message : "Failed to update collection.",
      });
    },
  });

  const removeCollectionMutation = useMutation({
    mutationFn: async (collectionId: string) => {
      const res = await fetch(`/api/collections/${collectionId}/assets`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to remove from collection");
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["asset", assetId] });
      void queryClient.invalidateQueries({ queryKey: ["collections"] });
    },
  });

  const applyThumbnailMutation = useMutation({
    mutationFn: async (imageUrl: string) => {
      const res = await fetch(`/api/assets/${assetId}/thumbnail`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to apply custom thumbnail");
      return json;
    },
    onSuccess: () => {
      setThumbUrlInput("");
      setActionNotice({
        kind: "success",
        text: "Custom thumbnail applied at provider. Native thumbnail kept as fallback.",
      });
      void queryClient.invalidateQueries({ queryKey: ["asset", assetId] });
      void queryClient.invalidateQueries({ queryKey: ["assets"] });
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: (err) => {
      setActionNotice({
        kind: "error",
        text: err instanceof Error ? err.message : "Thumbnail update failed.",
      });
    },
  });

  const switchThumbnailMutation = useMutation({
    mutationFn: async (thumbnailId: string) => {
      const res = await fetch(`/api/assets/${assetId}/thumbnail`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ thumbnailId }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        syncedToProvider?: boolean;
      };
      if (!res.ok) throw new Error(json.error ?? "Failed to activate thumbnail");
      return json;
    },
    onSuccess: (res) => {
      setActionNotice({
        kind: "success",
        text: res.syncedToProvider
          ? "Active thumbnail updated in MediaHub and re-applied at provider."
          : "Active thumbnail updated in MediaHub.",
      });
      void queryClient.invalidateQueries({ queryKey: ["asset", assetId] });
      void queryClient.invalidateQueries({ queryKey: ["assets"] });
    },
    onError: (err) => {
      setActionNotice({
        kind: "error",
        text: err instanceof Error ? err.message : "Failed to switch thumbnail.",
      });
    },
  });

  const attachSubtitleMutation = useMutation({
    mutationFn: async (payload: { language: string; format: "srt" | "vtt"; subtitleUrl: string }) => {
      const res = await fetch(`/api/assets/${assetId}/subtitles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to attach subtitle");
      return json;
    },
    onSuccess: () => {
      setSubUrlInput("");
      setActionNotice({
        kind: "success",
        text: "Subtitle attached at provider and logged as a completed job.",
      });
      void queryClient.invalidateQueries({ queryKey: ["asset", assetId] });
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: (err) => {
      setActionNotice({
        kind: "error",
        text: err instanceof Error ? err.message : "Subtitle attachment failed.",
      });
    },
  });

  if (isLoading) {
    return (
      <div className="dusk-well flex items-center gap-2 p-6 text-sm text-text-secondary">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading asset…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-4">
        <Link
          href="/library"
          className="inline-flex items-center gap-1.5 text-xs text-text-secondary hover:text-text-primary"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t.library.title}
        </Link>
        <div className="rounded-xl bg-danger-subtle p-4 text-sm text-danger">
          {error instanceof Error ? error.message : "Asset not found."}
        </div>
      </div>
    );
  }

  const { asset, locations, thumbnails, history, relatedJobs } = data;
  const memberCollections = data.collections ?? [];
  const activeThumb = thumbnails.find((th) => th.isActive) ?? thumbnails[0] ?? null;
  const primaryLoc = locations[0] ?? null;
  const caps = primaryLoc?.capabilities ?? null;
  const canMutateRemote = Boolean(primaryLoc?.canMutate);

  const canRename = Boolean(caps && hasCapability(caps, "rename") && canMutateRemote);
  const canMove = Boolean(caps && hasCapability(caps, "folders") && canMutateRemote);
  const canClone = Boolean(caps && hasCapability(caps, "clone") && canMutateRemote);
  const canDeleteRemote = Boolean(caps && hasCapability(caps, "delete") && canMutateRemote);
  const canThumbUrl = Boolean(caps && hasCapability(caps, "thumbnail.url") && canMutateRemote);
  const canSubtitles = Boolean(caps && hasCapability(caps, "subtitles") && canMutateRemote);
  const assetSubtitles = data.subtitles ?? [];

  const matchingFolders = (foldersData?.folders ?? []).filter(
    (f) => !primaryLoc || f.providerConnectionId === primaryLoc.providerConnectionId,
  );
  const currentFolderExternalId =
    typeof primaryLoc?.providerMetadata?.folderId === "string"
      ? primaryLoc.providerMetadata.folderId
      : typeof primaryLoc?.providerMetadata?.folder_id === "string"
        ? primaryLoc.providerMetadata.folder_id
        : "";

  const availableCollections = (collectionsData?.collections ?? []).filter(
    (col) => !memberCollections.some((m) => m.id === col.id),
  );

  const tabs: Array<{ key: DetailTab; label: string }> = [
    { key: "overview", label: t.library.detailTabs.overview },
    { key: "provider", label: t.library.detailTabs.provider },
    { key: "thumbnail", label: t.library.detailTabs.thumbnail },
    { key: "subtitles", label: t.library.detailTabs.subtitles },
    { key: "history", label: t.library.detailTabs.history },
  ];

  return (
    <div className="space-y-8">
      <Link
        href="/library"
        className="inline-flex items-center gap-1.5 text-xs text-text-secondary hover:text-text-primary"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {t.library.title}
      </Link>

      <PageHeader
        title={asset.title}
        subtitle={`MediaHub ID: ${asset.id}`}
        actions={
          <div className="flex items-center gap-2.5">
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
                className="dusk-btn-ghost h-8 px-3.5 text-xs disabled:opacity-50"
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

      {actionNotice ? (
        <div
          role="status"
          className={cn(
            "flex flex-wrap items-center justify-between gap-2 rounded-xl px-4 py-3 text-xs font-medium",
            actionNotice.kind === "success"
              ? "bg-success-subtle text-success"
              : "bg-danger-subtle text-danger",
          )}
        >
          <span className="inline-flex items-center gap-2">
            {actionNotice.kind === "success" ? (
              <CheckCircle2 className="h-4 w-4 shrink-0" />
            ) : (
              <XCircle className="h-4 w-4 shrink-0" />
            )}
            {actionNotice.text}
          </span>
          {actionNotice.linkHref && actionNotice.linkLabel ? (
            <Link href={actionNotice.linkHref} className="underline">
              {actionNotice.linkLabel}
            </Link>
          ) : null}
        </div>
      ) : null}

      {encodingInfo ? (
        <div className="rounded-xl bg-info-subtle px-4 py-3 text-xs text-info">
          Provider encoding progress:{" "}
          <span className="tabular-nums font-semibold">{encodingInfo.progressPercent}%</span>
          {encodingInfo.completed ? ", completed and marked active." : ", still encoding."}
        </div>
      ) : null}

      {/* Midnight Bento Capsule Tabs */}
      <nav
        aria-label="Asset tabs"
        className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-border bg-surface p-1 text-xs"
      >
        {tabs.map((item) => {
          const active = tab === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              className={cn(
                "rounded-lg px-3.5 py-1.5 font-medium whitespace-nowrap transition-colors",
                active
                  ? "bg-primary-subtle text-primary"
                  : "text-text-secondary hover:text-text-primary",
              )}
            >
              {item.label}
            </button>
          );
        })}
      </nav>

      {tab === "overview" ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
            <div className="dusk-plate overflow-hidden p-3 lg:col-span-5">
              <div className="flex aspect-video items-center justify-center overflow-hidden rounded-xl bg-bg">
                {activeThumb?.sourceUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={activeThumb.sourceUrl}
                    alt=""
                    className="h-full w-full object-cover"
                    fetchPriority="high"
                  />
                ) : (
                  <Film className="h-10 w-10 text-text-secondary" />
                )}
              </div>
            </div>

            <div className="dusk-plate space-y-4 p-6 lg:col-span-7">
              <h2 className="text-base font-semibold text-text-primary">Universal asset metadata</h2>
              <dl className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
                <div className="rounded-xl border border-border/70 bg-bg/45 p-3">
                  <dt className="text-text-secondary">MediaHub Asset ID</dt>
                  <dd className="mt-1 truncate font-mono text-text-primary">{asset.id}</dd>
                </div>
                <div className="rounded-xl border border-border/70 bg-bg/45 p-3">
                  <dt className="text-text-secondary">Canonical status</dt>
                  <dd className="mt-1 font-medium text-text-primary">
                    {t.statuses.asset[asset.canonicalStatus]}
                  </dd>
                </div>
                <div className="rounded-xl border border-border/70 bg-bg/45 p-3">
                  <dt className="text-text-secondary">Duration</dt>
                  <dd className="mt-1 tabular-nums font-medium text-text-primary">
                    {asset.durationSeconds ? `${asset.durationSeconds}s` : "None"}
                  </dd>
                </div>
                <div className="rounded-xl border border-border/70 bg-bg/45 p-3">
                  <dt className="text-text-secondary">File size</dt>
                  <dd className="mt-1 tabular-nums font-medium text-text-primary">
                    {asset.sizeBytes ? `${(asset.sizeBytes / 1024 ** 2).toFixed(2)} MiB` : "None"}
                  </dd>
                </div>
                <div className="rounded-xl border border-border/70 bg-bg/45 p-3">
                  <dt className="text-text-secondary">Registered</dt>
                  <dd className="mt-1 tabular-nums text-text-primary">
                    {new Date(asset.createdAt).toLocaleString()}
                  </dd>
                </div>
                <div className="rounded-xl border border-border/70 bg-bg/45 p-3">
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

          {/* Midnight Bento Operations Card */}
          <section className="dusk-plate space-y-5 p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-text-primary">Asset operations</h2>
              {primaryLoc && !primaryLoc.canMutate ? (
                <span className="rounded-full bg-warning-subtle px-3 py-1 text-xs text-warning">
                  Read-only: {primaryLoc.readOnlyReason}
                </span>
              ) : null}
            </div>

            <div className="divide-y divide-border/70 border-t border-border/80">
              <div className="grid grid-cols-1 gap-3 py-4 lg:grid-cols-12 lg:items-center">
                <div className="flex items-center gap-2 text-xs font-medium text-text-primary lg:col-span-4">
                  <Pencil className="h-3.5 w-3.5 text-primary" />
                  Rename at provider
                </div>
                <div className="space-y-1.5 lg:col-span-8">
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const nextTitle = (renameDraft ?? asset.title).trim();
                      if (!nextTitle || nextTitle === asset.title) return;
                      setActionNotice(null);
                      actionMutation.mutate({ action: "rename", title: nextTitle });
                    }}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <input
                      type="text"
                      value={renameDraft ?? asset.title}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      disabled={!canRename || actionMutation.isPending}
                      className="h-9 flex-1 rounded-lg border border-border bg-surface px-3 text-xs text-text-primary focus:border-primary focus:outline-none disabled:opacity-50"
                    />
                    <button
                      type="submit"
                      disabled={
                        !canRename ||
                        actionMutation.isPending ||
                        !(renameDraft ?? asset.title).trim() ||
                        (renameDraft ?? asset.title).trim() === asset.title
                      }
                      className="dusk-btn-primary h-9 px-4 text-xs disabled:opacity-50"
                    >
                      Rename
                    </button>
                  </form>
                  {!canRename ? (
                    <p className="text-xs text-text-secondary">
                      Unavailable: provider does not declare rename support or connection is
                      read-only.
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 py-4 lg:grid-cols-12 lg:items-center">
                <div className="flex items-center gap-2 text-xs font-medium text-text-primary lg:col-span-4">
                  <FolderInput className="h-3.5 w-3.5 text-primary" />
                  Move to provider folder
                </div>
                <div className="space-y-1.5 lg:col-span-8">
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={
                        moveFolderId === "__unchanged__" ? currentFolderExternalId : moveFolderId
                      }
                      onChange={(e) => setMoveFolderId(e.target.value)}
                      disabled={!canMove || actionMutation.isPending}
                      className="h-9 flex-1 rounded-lg border border-border bg-surface px-3 text-xs text-text-primary focus:border-primary focus:outline-none disabled:opacity-50"
                    >
                      <option value="">Provider Root (no folder)</option>
                      {matchingFolders.map((f) => (
                        <option key={f.id} value={f.externalId}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={
                        !canMove || actionMutation.isPending || moveFolderId === "__unchanged__"
                      }
                      onClick={() => {
                        setActionNotice(null);
                        actionMutation.mutate({
                          action: "move",
                          folderExternalId: moveFolderId ? moveFolderId : null,
                        });
                      }}
                      className="dusk-btn-ghost h-9 px-4 text-xs disabled:opacity-50"
                    >
                      Move
                    </button>
                  </div>
                  {!canMove ? (
                    <p className="text-xs text-text-secondary">
                      Unavailable: provider does not declare folder support or connection is
                      read-only.
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 py-4 lg:grid-cols-12 lg:items-start">
                <div className="flex items-center gap-2 pt-1 text-xs font-medium text-text-primary lg:col-span-4">
                  <Layers className="h-3.5 w-3.5 text-primary" />
                  MediaHub collections
                </div>
                <div className="space-y-2.5 lg:col-span-8">
                  <div className="flex flex-wrap gap-1.5">
                    {memberCollections.length > 0 ? (
                      memberCollections.map((col) => (
                        <span
                          key={col.id}
                          className="inline-flex items-center gap-1.5 rounded-full bg-primary-subtle px-3 py-1 text-xs font-medium text-primary"
                        >
                          {col.name}
                          <button
                            type="button"
                            aria-label={`Remove from ${col.name}`}
                            onClick={() => removeCollectionMutation.mutate(col.id)}
                            className="hover:opacity-75"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))
                    ) : (
                      <span className="text-xs text-text-secondary">Not in any collection yet.</span>
                    )}
                  </div>
                  {availableCollections.length > 0 ? (
                    <div className="flex items-center gap-2">
                      <select
                        value={addCollectionId}
                        onChange={(e) => setAddCollectionId(e.target.value)}
                        className="h-9 flex-1 rounded-lg border border-border bg-surface px-3 text-xs text-text-primary focus:border-primary focus:outline-none"
                      >
                        <option value="">Add to collection…</option>
                        {availableCollections.map((col) => (
                          <option key={col.id} value={col.id}>
                            {col.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={!addCollectionId || addCollectionMutation.isPending}
                        onClick={() => addCollectionMutation.mutate(addCollectionId)}
                        className="dusk-btn-ghost h-9 px-4 text-xs disabled:opacity-50"
                      >
                        Add
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 py-4 lg:grid-cols-12 lg:items-start">
                <div className="pt-1 text-xs font-medium text-text-primary lg:col-span-4">
                  Clone &amp; Delete
                </div>
                <div className="space-y-3 lg:col-span-8">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <button
                      type="button"
                      disabled={!canClone || actionMutation.isPending}
                      onClick={() => {
                        setActionNotice(null);
                        actionMutation.mutate({ action: "clone" });
                      }}
                      className="dusk-btn-ghost h-9 px-4 text-xs disabled:opacity-50"
                    >
                      <Copy className="h-3.5 w-3.5" />
                      Clone at provider
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowDeletePanel((v) => !v)}
                      className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full bg-danger-subtle px-4 text-xs font-medium text-danger transition-opacity hover:opacity-90"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete options
                    </button>
                  </div>

                  {showDeletePanel ? (
                    <div className="dusk-well space-y-3 p-4 text-xs">
                      <div className="flex items-start gap-2 text-danger">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        <div className="space-y-1">
                          <p className="font-semibold">Confirm delete scope</p>
                          {caps && !caps.deleteSemantics.restorable ? (
                            <p>
                              {primaryLoc?.providerDisplayName ?? "This provider"} performs a{" "}
                              <span className="font-mono">{caps.deleteSemantics.mode}</span> delete
                              and offers <strong>NO restore endpoint</strong>. Deleting at the
                              provider cannot be undone through MediaHub.
                            </p>
                          ) : (
                            <p>
                              Choose whether to remove only the MediaHub catalog entry or delete
                              remotely.
                            </p>
                          )}
                        </div>
                      </div>

                      <label className="flex items-center gap-2 text-text-secondary">
                        <input
                          type="checkbox"
                          checked={deleteLocalAlso}
                          onChange={(e) => setDeleteLocalAlso(e.target.checked)}
                          className="h-3.5 w-3.5 rounded border-border accent-danger"
                        />
                        Also hide local MediaHub record after provider delete
                      </label>

                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={actionMutation.isPending}
                          onClick={() => {
                            setActionNotice(null);
                            actionMutation.mutate({ action: "soft_delete_local" });
                          }}
                          className="dusk-btn-ghost h-8 px-3.5 text-xs disabled:opacity-50"
                        >
                          Remove locally
                        </button>
                        {canDeleteRemote ? (
                          <button
                            type="button"
                            disabled={actionMutation.isPending}
                            onClick={() => {
                              setActionNotice(null);
                              actionMutation.mutate({
                                action: "delete_provider",
                                confirmProviderDelete: true,
                                deleteLocalAlso,
                              });
                            }}
                            className="inline-flex h-8 items-center whitespace-nowrap rounded-full bg-danger px-4 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                          >
                            Confirm delete at {primaryLoc?.providerDisplayName ?? "provider"}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => setShowDeletePanel(false)}
                          className="h-8 px-2 text-xs text-text-secondary hover:text-text-primary"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {tab === "provider" ? (
        <div className="space-y-6">
          {locations.map((loc) => (
            <section key={loc.id} className="dusk-plate space-y-4 p-6">
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
                    className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                  >
                    Open at provider
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                ) : null}
              </div>

              <dl className="grid grid-cols-1 gap-4 border-y border-border/70 py-3 text-xs sm:grid-cols-2">
                <div>
                  <dt className="text-text-secondary">External identifier</dt>
                  <dd className="mt-0.5 font-mono text-text-primary">{loc.externalId}</dd>
                </div>
                <div>
                  <dt className="text-text-secondary">Last synced</dt>
                  <dd className="mt-0.5 tabular-nums text-text-primary">
                    {loc.lastSeenAt ? new Date(loc.lastSeenAt).toLocaleString() : "None"}
                  </dd>
                </div>
              </dl>

              <div className="space-y-1.5">
                <div className="text-xs font-medium text-text-secondary">
                  Provider-specific metadata
                </div>
                <pre className="overflow-x-auto rounded-xl bg-bg p-3.5 font-mono text-xs text-text-primary">
                  {JSON.stringify(loc.providerMetadata, null, 2)}
                </pre>
              </div>
            </section>
          ))}
        </div>
      ) : null}

      {tab === "thumbnail" ? (
        <div className="space-y-6">
          <section className="dusk-plate space-y-3 p-6">
            <h2 className="text-base font-semibold text-text-primary">
              Apply custom thumbnail (Direct Image URL)
            </h2>
            {canThumbUrl ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!thumbUrlInput.trim()) return;
                  setActionNotice(null);
                  applyThumbnailMutation.mutate(thumbUrlInput.trim());
                }}
                className="max-w-2xl space-y-2.5"
              >
                <p className="text-xs text-text-secondary">
                  Provide an authorized direct HTTPS image URL (JPEG, PNG, GIF, or WebP, max 5 MiB).
                  The provider&rsquo;s native thumbnail is retained as a fallback.
                </p>
                <div className="flex flex-wrap items-center gap-2.5">
                  <input
                    type="url"
                    value={thumbUrlInput}
                    onChange={(e) => setThumbUrlInput(e.target.value)}
                    placeholder="https://cdn.example.com/posters/video-thumb.webp"
                    required
                    className="h-10 flex-1 rounded-xl border border-border bg-bg px-3.5 text-xs text-text-primary placeholder:text-text-secondary focus:border-primary focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={!thumbUrlInput.trim() || applyThumbnailMutation.isPending}
                    className="dusk-btn-primary h-10 px-4 text-xs disabled:opacity-50"
                  >
                    {applyThumbnailMutation.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ImageIcon className="h-3.5 w-3.5" />
                    )}
                    Apply thumbnail
                  </button>
                </div>
              </form>
            ) : (
              <p className="text-xs text-text-secondary">
                Custom thumbnail updates are disabled because{" "}
                {primaryLoc?.readOnlyReason ??
                  "this provider does not declare URL-based thumbnail support."}
              </p>
            )}
          </section>

          {thumbnails.length > 0 ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {thumbnails.map((th) => (
                <div key={th.id} className="dusk-plate space-y-3 p-3">
                  <div className="flex aspect-video items-center justify-center overflow-hidden rounded-xl bg-bg">
                    {th.sourceUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={th.sourceUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <ImageIcon className="h-6 w-6 text-text-secondary" />
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2 px-1 text-xs">
                    <span className="capitalize font-medium text-text-primary">
                      {th.sourceType.replace("_", " ")} thumbnail
                    </span>
                    {th.isActive ? (
                      <StatusBadge label="Active" tone="success" dot />
                    ) : (
                      <button
                        type="button"
                        disabled={switchThumbnailMutation.isPending}
                        onClick={() => {
                          setActionNotice(null);
                          switchThumbnailMutation.mutate(th.id);
                        }}
                        className="dusk-btn-ghost h-7 px-3 text-xs disabled:opacity-50"
                      >
                        {th.sourceType === "native" ? "Restore native" : "Set active"}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={ImageIcon}
              title="No thumbnails recorded yet"
              body="Sync from your provider to fetch native thumbnails, or apply a custom image URL above."
            />
          )}
        </div>
      ) : null}

      {tab === "subtitles" ? (
        <div className="space-y-6">
          <section className="dusk-plate space-y-3 p-6">
            <h2 className="text-base font-semibold text-text-primary">
              Attach subtitle track (SRT / VTT)
            </h2>
            {canSubtitles ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!subUrlInput.trim() || !subLangInput.trim()) return;
                  setActionNotice(null);
                  attachSubtitleMutation.mutate({
                    language: subLangInput.trim(),
                    format: subFormatInput,
                    subtitleUrl: subUrlInput.trim(),
                  });
                }}
                className="max-w-3xl space-y-2.5"
              >
                <p className="text-xs text-text-secondary">
                  Provide an authorized direct HTTPS subtitle file URL (.srt or .vtt, max 2 MiB) and
                  language code.
                </p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-6">
                  <input
                    type="text"
                    value={subLangInput}
                    onChange={(e) => setSubLangInput(e.target.value)}
                    placeholder="en / id"
                    required
                    className="h-10 rounded-xl border border-border bg-bg px-3 font-mono text-xs text-text-primary focus:border-primary focus:outline-none sm:col-span-1"
                  />
                  <select
                    value={subFormatInput}
                    onChange={(e) => setSubFormatInput(e.target.value as "srt" | "vtt")}
                    className="h-10 rounded-xl border border-border bg-bg px-3 text-xs text-text-primary focus:border-primary focus:outline-none sm:col-span-1"
                  >
                    <option value="vtt">VTT</option>
                    <option value="srt">SRT</option>
                  </select>
                  <input
                    type="url"
                    value={subUrlInput}
                    onChange={(e) => setSubUrlInput(e.target.value)}
                    placeholder="https://cdn.example.com/subs/video-en.vtt"
                    required
                    className="h-10 rounded-xl border border-border bg-bg px-3 text-xs text-text-primary placeholder:text-text-secondary focus:border-primary focus:outline-none sm:col-span-3"
                  />
                  <button
                    type="submit"
                    disabled={!subUrlInput.trim() || attachSubtitleMutation.isPending}
                    className="dusk-btn-primary h-10 px-4 text-xs disabled:opacity-50 sm:col-span-1"
                  >
                    {attachSubtitleMutation.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Subtitles className="h-3.5 w-3.5" />
                    )}
                    Attach
                  </button>
                </div>
              </form>
            ) : (
              <p className="text-xs text-text-secondary">
                Subtitle attachment is unavailable because{" "}
                {primaryLoc?.readOnlyReason ??
                  "this provider does not declare subtitle attachment support."}
              </p>
            )}
          </section>

          {assetSubtitles.length > 0 ? (
            <section className="dusk-plate overflow-hidden">
              <div className="border-b border-border/80 px-5 py-4">
                <h3 className="text-sm font-semibold text-text-primary">
                  Attached subtitles ({assetSubtitles.length})
                </h3>
              </div>
              <ul className="divide-y divide-border/70 px-5">
                {assetSubtitles.map((sub) => (
                  <li
                    key={sub.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-3.5 text-xs"
                  >
                    <div className="flex items-center gap-2.5">
                      <StatusBadge label={sub.language} tone="info" />
                      <span className="rounded-full bg-surface-raised px-2 py-0.5 text-xs text-text-secondary">
                        {sub.format}
                      </span>
                      <a
                        href={sub.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="max-w-xs truncate font-mono text-primary hover:underline sm:max-w-md"
                      >
                        {sub.sourceUrl}
                      </a>
                    </div>
                    <span className="tabular-nums text-text-secondary">
                      {new Date(sub.createdAt).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <EmptyState
              icon={Subtitles}
              title="No subtitles attached yet"
              body="Attach an SRT or VTT subtitle track above to record it at your provider and in MediaHub."
            />
          )}
        </div>
      ) : null}

      {tab === "history" ? (
        <div className="space-y-6">
          {relatedJobs.length > 0 ? (
            <section className="dusk-plate overflow-hidden">
              <div className="border-b border-border/80 px-5 py-4">
                <h3 className="text-sm font-semibold text-text-primary">
                  Related jobs ({relatedJobs.length})
                </h3>
              </div>
              <ul className="divide-y divide-border/70 px-5">
                {relatedJobs.map((j) => (
                  <li key={j.id} className="flex items-center justify-between py-3.5 text-xs">
                    <Link href={`/jobs/${j.id}`} className="font-mono text-primary hover:underline">
                      {j.jobType} ({j.id.slice(0, 8)})
                    </Link>
                    <StatusBadge label={j.status} tone="info" dot />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {history.length > 0 ? (
            <section className="dusk-plate overflow-hidden">
              <div className="border-b border-border/80 px-5 py-4">
                <h3 className="text-sm font-semibold text-text-primary">
                  Audit events ({history.length})
                </h3>
              </div>
              <ul className="divide-y divide-border/70 px-5">
                {history.map((ev, idx) => (
                  <li key={ev.id} className="flex items-center justify-between gap-3 py-3.5 text-xs">
                    <span className="flex items-center gap-2.5 font-mono text-text-primary">
                      <span
                        className={cn(
                          "h-2 w-2 shrink-0 rounded-full",
                          idx % 2 === 0 ? "bg-success" : "bg-info",
                        )}
                      />
                      {ev.action}
                    </span>
                    <span className="tabular-nums text-text-secondary">
                      {new Date(ev.createdAt).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
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
