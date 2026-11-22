"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FolderKanban, Grid2X2, List, Plug, Upload } from "lucide-react";
import { getMessages } from "@/shared";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/cn";

type LibraryFilter = "all" | "removed" | "dmca";

export function LibraryClient() {
  const searchParams = useSearchParams();
  const query = searchParams.get("q") ?? "";
  const t = getMessages("en");

  const [viewMode, setViewMode] = useState<"grid" | "table">("table");
  const [filter, setFilter] = useState<LibraryFilter>("all");

  return (
    <div className="space-y-6">
      <PageHeader
        title={t.library.title}
        subtitle={t.library.subtitle}
        actions={
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-lg border border-border bg-surface p-0.5 text-xs font-medium">
              {(["all", "removed", "dmca"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setFilter(tab)}
                  className={cn(
                    "rounded-md px-2.5 py-1.5",
                    filter === tab
                      ? "bg-surface-raised text-text-primary"
                      : "text-text-secondary hover:text-text-primary",
                  )}
                >
                  {tab === "all"
                    ? t.library.filterAll
                    : tab === "removed"
                      ? t.library.filterRemoved
                      : t.library.filterDmca}
                </button>
              ))}
            </div>

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
                <Grid2X2 className="h-4 w-4" />
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
                <List className="h-4 w-4" />
              </button>
            </div>
          </div>
        }
      />

      {query ? (
        <div className="rounded-lg border border-border bg-surface px-3.5 py-2 text-xs text-text-secondary">
          Active search query: <span className="font-mono text-text-primary">{query}</span> (server-side D1 search activates in Phase 3)
        </div>
      ) : null}

      <EmptyState
        icon={FolderKanban}
        title={t.library.emptyTitle}
        body={t.library.emptyBody}
        action={
          <>
            <Link
              href="/providers"
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-xs font-medium text-primary-foreground hover:bg-primary-hover"
            >
              <Plug className="h-3.5 w-3.5" />
              {t.library.ctaConnectProvider}
            </Link>
            <Link
              href="/import?tab=url"
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3.5 py-2 text-xs font-medium text-text-primary hover:bg-surface-raised"
            >
              <Upload className="h-3.5 w-3.5" />
              {t.library.ctaImportUrl}
            </Link>
          </>
        }
      />
    </div>
  );
}
