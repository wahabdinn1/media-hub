"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ChevronDown,
  FileSpreadsheet,
  Link2,
  Moon,
  Plus,
  Search,
  Sun,
  Upload,
} from "lucide-react";
import { formatMessage, getMessages } from "@/shared";
import { useUiStore } from "@/store/ui-store";
import { useVisibilityPolling } from "@/lib/hooks/use-visibility-polling";
import { cn } from "@/lib/cn";

interface PocHealthResponse {
  ok: boolean;
  activeJobsCount: number;
}

export function Topbar() {
  const router = useRouter();
  const t = getMessages("en");
  const theme = useUiStore((s) => s.theme);
  const toggleTheme = useUiStore((s) => s.toggleTheme);
  const globalSearch = useUiStore((s) => s.globalSearch);
  const setGlobalSearch = useUiStore((s) => s.setGlobalSearch);

  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const refetchInterval = useVisibilityPolling(false, 5_000, 60_000);
  const { data: health } = useQuery<PocHealthResponse>({
    queryKey: ["poc-health"],
    queryFn: async () => {
      const res = await fetch("/api/poc/health");
      if (!res.ok) throw new Error("Health check failed");
      return res.json();
    },
    refetchInterval,
  });

  useEffect(() => {
    const handleOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setNewMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  const activeJobs = health?.activeJobsCount ?? 0;

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = globalSearch.trim();
    router.push(q ? `/library?q=${encodeURIComponent(q)}` : "/library");
  }

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between gap-4 border-b border-border bg-bg/90 px-4 backdrop-blur-md sm:px-7">
      <div className="flex flex-1 items-center gap-2 max-w-xl">
        <form onSubmit={handleSearchSubmit} className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary"
            aria-hidden="true"
          />
          <input
            type="search"
            value={globalSearch}
            onChange={(e) => setGlobalSearch(e.target.value)}
            placeholder="Search videos, assets, or jobs…"
            aria-label={t.topbar.searchPlaceholder}
            className="h-10 w-full rounded-xl border border-border bg-surface pl-10 pr-4 text-sm text-text-primary placeholder:text-text-secondary transition-colors focus:border-primary focus:outline-none"
          />
        </form>
      </div>

      <div className="flex items-center gap-2.5">
        <Link
          href="/jobs"
          className={cn(
            "inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-xl border px-3 text-xs font-medium tabular-nums transition-colors",
            activeJobs > 0
              ? "border-primary/40 bg-primary-subtle text-primary"
              : "border-border bg-surface text-text-secondary hover:border-border-strong hover:text-text-primary",
          )}
          title="Job Center"
        >
          <Activity className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="hidden sm:inline">
            {activeJobs > 0
              ? formatMessage(t.topbar.jobsActive, { count: activeJobs })
              : t.topbar.jobsIdle}
          </span>
          <span className="sm:hidden">{activeJobs}</span>
        </Link>

        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setNewMenuOpen((o) => !o)}
            aria-expanded={newMenuOpen}
            aria-haspopup="menu"
            className="dusk-btn-primary h-9 px-3.5 text-xs sm:text-sm"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">{t.topbar.newAction}</span>
            <ChevronDown className="h-3.5 w-3.5 opacity-80" aria-hidden="true" />
          </button>

          {newMenuOpen ? (
            <div role="menu" className="dusk-plate absolute right-0 mt-2 w-48 p-1.5">
              <Link
                role="menuitem"
                href="/import?tab=url"
                onClick={() => setNewMenuOpen(false)}
                className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-text-primary transition-colors hover:bg-surface-raised"
              >
                <Link2 className="h-4 w-4 text-primary" />
                {t.topbar.newImportUrl}
              </Link>
              <Link
                role="menuitem"
                href="/import?tab=file"
                onClick={() => setNewMenuOpen(false)}
                className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-text-primary transition-colors hover:bg-surface-raised"
              >
                <Upload className="h-4 w-4 text-text-secondary" />
                {t.topbar.newUploadFile}
              </Link>
              <Link
                role="menuitem"
                href="/import?tab=bulk"
                onClick={() => setNewMenuOpen(false)}
                className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-text-primary transition-colors hover:bg-surface-raised"
              >
                <FileSpreadsheet className="h-4 w-4 text-violet" />
                {t.topbar.newBulkImport}
              </Link>
            </div>
          ) : null}
        </div>

        <button
          type="button"
          onClick={toggleTheme}
          aria-label={theme === "dark" ? t.topbar.themeToLight : t.topbar.themeToDark}
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-surface text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary"
        >
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>

        <Link
          href="/settings"
          className="hidden items-center gap-2.5 rounded-xl border border-border bg-surface px-2.5 py-1.5 transition-colors hover:border-border-strong lg:flex"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary-subtle text-xs font-semibold text-primary">
            MH
          </span>
          <div className="leading-tight">
            <div className="text-xs font-semibold text-text-primary">Owner</div>
            <div className="text-[11px] text-text-secondary">Personal Plan</div>
          </div>
        </Link>
      </div>
    </header>
  );
}
