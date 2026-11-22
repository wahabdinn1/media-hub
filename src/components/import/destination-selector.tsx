"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Check, Folder, Layers, Plug } from "lucide-react";
import { hasCapability, type CapabilityDescriptor } from "@/shared";
import { ProviderBadge } from "@/components/ui/provider-badge";
import { cn } from "@/lib/cn";

interface ProviderAdapterView {
  key: string;
  displayName: string;
  capabilities: CapabilityDescriptor;
}

interface ProviderConnectionView {
  id: string;
  providerKey: string;
  status: string;
  isDefault: boolean;
  accountInfo: { accountLabel?: string } | null;
}

interface ProviderFolderView {
  id: string;
  providerConnectionId: string;
  externalId: string;
  name: string;
}

interface CollectionView {
  id: string;
  name: string;
  assetCount: number;
}

export interface UploadDestinationState {
  providerConnectionIds: string[];
  folderByConnectionId: Record<string, string | null>;
  collectionIds: string[];
}

export function DestinationSelector({
  value,
  onChange,
}: {
  value: UploadDestinationState;
  onChange: (next: UploadDestinationState) => void;
}) {
  const { data: providersData } = useQuery<{
    adapters: ProviderAdapterView[];
    connections: ProviderConnectionView[];
  }>({
    queryKey: ["providers"],
    queryFn: async () => {
      const res = await fetch("/api/providers");
      if (!res.ok) return { adapters: [], connections: [] };
      return res.json();
    },
  });

  const { data: foldersData } = useQuery<{ folders: ProviderFolderView[] }>({
    queryKey: ["provider-folders"],
    queryFn: async () => {
      const res = await fetch("/api/folders");
      if (!res.ok) return { folders: [] };
      return res.json();
    },
  });

  const { data: collectionsData } = useQuery<{ collections: CollectionView[] }>({
    queryKey: ["collections"],
    queryFn: async () => {
      const res = await fetch("/api/collections");
      if (!res.ok) return { collections: [] };
      return res.json();
    },
  });

  const adapterMap = new Map((providersData?.adapters ?? []).map((a) => [a.key, a]));
  const uploadCapableConns = (providersData?.connections ?? []).filter((c) => {
    if (c.status !== "active") return false;
    const adapter = adapterMap.get(c.providerKey);
    return Boolean(adapter && hasCapability(adapter.capabilities, "upload.url"));
  });

  // Auto-select default active provider once connections load
  useEffect(() => {
    if (value.providerConnectionIds.length > 0 || uploadCapableConns.length === 0) return;
    const def = uploadCapableConns.find((c) => c.isDefault) ?? uploadCapableConns[0]!;
    onChange({
      ...value,
      providerConnectionIds: [def.id],
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadCapableConns.length]);

  const folders = foldersData?.folders ?? [];
  const collections = collectionsData?.collections ?? [];

  function toggleProvider(connectionId: string) {
    const exists = value.providerConnectionIds.includes(connectionId);
    const nextIds = exists
      ? value.providerConnectionIds.filter((id) => id !== connectionId)
      : [...value.providerConnectionIds, connectionId];
    onChange({ ...value, providerConnectionIds: nextIds });
  }

  function selectFolder(connectionId: string, folderExternalId: string | null) {
    onChange({
      ...value,
      folderByConnectionId: {
        ...value.folderByConnectionId,
        [connectionId]: folderExternalId,
      },
    });
  }

  function toggleCollection(collectionId: string) {
    const exists = value.collectionIds.includes(collectionId);
    const nextCols = exists
      ? value.collectionIds.filter((id) => id !== collectionId)
      : [...value.collectionIds, collectionId];
    onChange({ ...value, collectionIds: nextCols });
  }

  return (
    <div className="space-y-4 rounded-xl border border-border bg-bg p-4">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-xs font-semibold text-text-primary">
              Target providers (multi-select)
            </div>
            <p className="text-[11px] text-text-secondary">
              Select one or more active hosts. Multi-provider uploads keep one universal asset in MediaHub with separate tracked jobs per host.
            </p>
          </div>
          <span className="rounded bg-surface-raised px-2 py-0.5 font-mono text-[11px] text-text-secondary">
            {value.providerConnectionIds.length} selected
          </span>
        </div>

        {uploadCapableConns.length === 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning/30 bg-warning-subtle px-3 py-2.5 text-xs text-warning">
            <span>No active provider connection ready for URL import.</span>
            <Link href="/providers" className="inline-flex items-center gap-1 font-medium underline">
              <Plug className="h-3.5 w-3.5" />
              Connect provider
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {uploadCapableConns.map((conn) => {
              const selected = value.providerConnectionIds.includes(conn.id);
              const adapter = adapterMap.get(conn.providerKey);
              const supportsFolders = Boolean(
                adapter && hasCapability(adapter.capabilities, "folders"),
              );
              const connFolders = folders.filter((f) => f.providerConnectionId === conn.id);
              const activeFolder = value.folderByConnectionId[conn.id] ?? null;

              return (
                <div
                  key={conn.id}
                  className={cn(
                    "space-y-2.5 rounded-lg border p-3 transition-colors",
                    selected
                      ? "border-primary/50 bg-primary-subtle/40"
                      : "border-border bg-surface hover:border-border-strong",
                  )}
                >
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={selected}
                    onClick={() => toggleProvider(conn.id)}
                    className="flex w-full items-center justify-between gap-2 text-left"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                          selected
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-bg",
                        )}
                      >
                        {selected ? <Check className="h-3 w-3" /> : null}
                      </span>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <ProviderBadge providerKey={conn.providerKey} isDefault={conn.isDefault} />
                        </div>
                        {conn.accountInfo?.accountLabel ? (
                          <div className="mt-0.5 font-mono text-[11px] text-text-secondary">
                            {conn.accountInfo.accountLabel}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </button>

                  {selected && supportsFolders ? (
                    <div className="space-y-1.5 border-t border-border/70 pt-2">
                      <div className="flex items-center gap-1 text-[11px] text-text-secondary">
                        <Folder className="h-3 w-3" />
                        Provider folder:
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          onClick={() => selectFolder(conn.id, null)}
                          className={cn(
                            "rounded-md border px-2 py-1 text-[11px] font-medium transition-colors",
                            activeFolder === null
                              ? "border-primary/50 bg-primary text-primary-foreground"
                              : "border-border bg-bg text-text-secondary hover:text-text-primary",
                          )}
                        >
                          Root
                        </button>
                        {connFolders.map((folder) => (
                          <button
                            key={folder.id}
                            type="button"
                            onClick={() => selectFolder(conn.id, folder.externalId)}
                            className={cn(
                              "rounded-md border px-2 py-1 text-[11px] font-medium transition-colors",
                              activeFolder === folder.externalId
                                ? "border-primary/50 bg-primary text-primary-foreground"
                                : "border-border bg-bg text-text-secondary hover:text-text-primary",
                            )}
                          >
                            {folder.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="space-y-2 border-t border-border pt-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-text-primary">
            <Layers className="h-3.5 w-3.5 text-primary" />
            Add to MediaHub collections (multi-select, optional)
          </div>
          {value.collectionIds.length > 0 ? (
            <span className="rounded bg-primary-subtle px-2 py-0.5 font-mono text-[11px] text-primary">
              {value.collectionIds.length} selected
            </span>
          ) : null}
        </div>

        {collections.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {collections.map((col) => {
              const selected = value.collectionIds.includes(col.id);
              return (
                <button
                  key={col.id}
                  type="button"
                  role="checkbox"
                  aria-checked={selected}
                  onClick={() => toggleCollection(col.id)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors",
                    selected
                      ? "border-primary/50 bg-primary-subtle text-primary"
                      : "border-border bg-surface text-text-secondary hover:text-text-primary",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-3.5 w-3.5 items-center justify-center rounded border",
                      selected
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-bg",
                    )}
                  >
                    {selected ? <Check className="h-2.5 w-2.5" /> : null}
                  </span>
                  <span>{col.name}</span>
                  <span className="font-mono text-[11px] opacity-70">({col.assetCount})</span>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="text-[11px] text-text-secondary">
            No collections created yet. Create one in{" "}
            <Link href="/library" className="text-primary hover:underline">
              Library
            </Link>{" "}
            to auto-organize imports.
          </p>
        )}
      </div>
    </div>
  );
}
