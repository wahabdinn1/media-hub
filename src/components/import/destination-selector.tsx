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
    <aside className="dusk-plate space-y-5 p-6">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-info-subtle text-info">
              <Plug className="h-4 w-4" aria-hidden="true" />
            </div>
            <h2 className="text-sm font-semibold text-text-primary">Target providers</h2>
          </div>
          <span className="rounded-full bg-primary-subtle px-2.5 py-0.5 tabular-nums text-xs font-medium text-primary">
            {value.providerConnectionIds.length} selected
          </span>
        </div>
        <p className="text-xs leading-relaxed text-text-secondary">
          Choose one or more hosts. Multi-host uploads link to one universal MediaHub asset with
          separate tracked jobs.
        </p>

        {uploadCapableConns.length === 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-warning-subtle px-3.5 py-3 text-xs text-warning">
            <span>No active provider connection ready for URL import.</span>
            <Link href="/providers" className="inline-flex items-center gap-1 font-medium underline">
              <Plug className="h-3.5 w-3.5" />
              Connect provider
            </Link>
          </div>
        ) : (
          <div className="space-y-2.5">
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
                    "space-y-3 rounded-xl border p-3.5 transition-colors",
                    selected
                      ? "border-primary/40 bg-primary-subtle/20"
                      : "border-border/70 bg-bg/45",
                  )}
                >
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={selected}
                    onClick={() => toggleProvider(conn.id)}
                    className="flex w-full items-center justify-between gap-2 text-left"
                  >
                    <div className="flex items-center gap-2.5">
                      <span
                        className={cn(
                          "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
                          selected
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border-strong bg-transparent",
                        )}
                      >
                        {selected ? <Check className="h-3 w-3" /> : null}
                      </span>
                      <div className="flex flex-wrap items-center gap-2">
                        <ProviderBadge providerKey={conn.providerKey} isDefault={conn.isDefault} />
                        {conn.accountInfo?.accountLabel ? (
                          <span className="font-mono text-xs text-text-secondary">
                            {conn.accountInfo.accountLabel}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </button>

                  {selected && supportsFolders ? (
                    <div className="space-y-1.5 pl-6">
                      <div className="flex items-center gap-1.5 text-xs text-text-secondary">
                        <Folder className="h-3 w-3" aria-hidden="true" />
                        <span>Folder</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          onClick={() => selectFolder(conn.id, null)}
                          className={cn(
                            "rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors",
                            activeFolder === null
                              ? "bg-primary text-primary-foreground"
                              : "bg-surface-raised/80 text-text-secondary hover:text-text-primary",
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
                              "rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors",
                              activeFolder === folder.externalId
                                ? "bg-primary text-primary-foreground"
                                : "bg-surface-raised/80 text-text-secondary hover:text-text-primary",
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

      <div className="space-y-3 border-t border-border/80 pt-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-subtle text-violet">
              <Layers className="h-4 w-4" aria-hidden="true" />
            </div>
            <span className="text-sm font-semibold text-text-primary">Collections</span>
          </div>
          {value.collectionIds.length > 0 ? (
            <span className="rounded-full bg-violet-subtle px-2.5 py-0.5 tabular-nums text-xs font-medium text-violet">
              {value.collectionIds.length} selected
            </span>
          ) : (
            <span className="text-xs text-text-secondary">Optional</span>
          )}
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
                    "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors",
                    selected
                      ? "bg-primary-subtle text-primary"
                      : "bg-surface-raised/70 text-text-secondary hover:text-text-primary",
                  )}
                >
                  {selected ? <Check className="h-3 w-3" aria-hidden="true" /> : null}
                  <span>{col.name}</span>
                  <span className="tabular-nums opacity-75">({col.assetCount})</span>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-text-secondary">
            No collections yet. Create one in{" "}
            <Link href="/library" className="text-primary hover:underline">
              Library
            </Link>{" "}
            to auto-organize imports.
          </p>
        )}
      </div>
    </aside>
  );
}
