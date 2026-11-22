"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
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

function buildBreadcrumbs(pathname: string): Array<{ label: string; href: string }> {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return [{ label: "Dashboard", href: "/dashboard" }];

  return segments.map((seg, idx) => {
    const href = `/${segments.slice(0, idx + 1).join("/")}`;
    const label = seg.charAt(0).toUpperCase() + seg.slice(1).replace(/-/g, " ");
    return { label, href };
  });
}

export function Topbar() {
  const pathname = usePathname();
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

  const breadcrumbs = buildBreadcrumbs(pathname);
  const activeJobs = health?.activeJobsCount ?? 0;

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = globalSearch.trim();
    router.push(q ? `/library?q=${encodeURIComponent(q)}` : "/library");
  }

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border bg-bg/85 px-4 backdrop-blur-md sm:px-8">
      <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-1.5 text-sm lg:flex">
        {breadcrumbs.map((crumb, index) => (
          <div key={crumb.href} className="flex items-center gap-1.5">
            {index > 0 ? <span className="text-border-strong">/</span> : null}
            <Link
              href={crumb.href}
              className={cn(
                "truncate whitespace-nowrap transition-colors",
                index === breadcrumbs.length - 1
                  ? "font-medium text-text-primary"
                  : "text-text-secondary hover:text-text-primary",
              )}
            >
              {crumb.label}
            </Link>
          </div>
        ))}
      </nav>

      <div className="flex flex-1 items-center gap-2 lg:max-w-sm lg:flex-initial">
        <form onSubmit={handleSearchSubmit} className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-secondary"
            aria-hidden="true"
          />
          <input
            type="search"
            value={globalSearch}
            onChange={(e) => setGlobalSearch(e.target.value)}
            placeholder={t.topbar.searchPlaceholder}
            aria-label={t.topbar.searchPlaceholder}
            className="h-9 w-full rounded-full border border-border bg-surface pl-9 pr-3.5 text-sm text-text-primary placeholder:text-text-secondary transition-colors focus:border-border-strong focus:outline-none"
          />
        </form>
      </div>

      <div className="flex items-center gap-2">
        <Link
          href="/jobs"
          className={cn(
            "inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-xs font-medium tabular-nums transition-colors",
            activeJobs > 0
              ? "border-warning/40 bg-warning-subtle text-warning"
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
            <div
              role="menu"
              className="dusk-plate absolute right-0 mt-2 w-48 p-1.5"
            >
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
                <FileSpreadsheet className="h-4 w-4 text-text-secondary" />
                {t.topbar.newBulkImport}
              </Link>
            </div>
          ) : null}
        </div>

        <button
          type="button"
          onClick={toggleTheme}
          aria-label={theme === "dark" ? t.topbar.themeToLight : t.topbar.themeToDark}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary"
        >
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
      </div>
    </header>
  );
}
