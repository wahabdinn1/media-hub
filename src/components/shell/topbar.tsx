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
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-surface/95 px-3 backdrop-blur sm:px-5">
      <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-1.5 text-sm lg:flex">
        {breadcrumbs.map((crumb, index) => (
          <div key={crumb.href} className="flex items-center gap-1.5">
            {index > 0 ? <span className="text-text-secondary">/</span> : null}
            <Link
              href={crumb.href}
              className={cn(
                "truncate",
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

      <div className="flex flex-1 items-center gap-2 lg:max-w-md lg:flex-initial">
        <form onSubmit={handleSearchSubmit} className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary"
            aria-hidden="true"
          />
          <input
            type="search"
            value={globalSearch}
            onChange={(e) => setGlobalSearch(e.target.value)}
            placeholder={t.topbar.searchPlaceholder}
            aria-label={t.topbar.searchPlaceholder}
            className="h-9 w-full rounded-lg border border-border bg-bg pl-8 pr-3 text-sm text-text-primary placeholder:text-text-secondary focus:border-primary focus:outline-none"
          />
        </form>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setNewMenuOpen((o) => !o)}
            aria-expanded={newMenuOpen}
            aria-haspopup="menu"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">{t.topbar.newAction}</span>
            <ChevronDown className="h-3.5 w-3.5 opacity-80" aria-hidden="true" />
          </button>

          {newMenuOpen ? (
            <div
              role="menu"
              className="absolute right-0 mt-1.5 w-48 rounded-lg border border-border bg-surface-raised p-1 shadow-lg"
            >
              <Link
                role="menuitem"
                href="/import?tab=url"
                onClick={() => setNewMenuOpen(false)}
                className="flex items-center gap-2 rounded-md px-2.5 py-2 text-sm text-text-primary hover:bg-surface"
              >
                <Link2 className="h-4 w-4 text-text-secondary" />
                {t.topbar.newImportUrl}
              </Link>
              <Link
                role="menuitem"
                href="/import?tab=file"
                onClick={() => setNewMenuOpen(false)}
                className="flex items-center gap-2 rounded-md px-2.5 py-2 text-sm text-text-primary hover:bg-surface"
              >
                <Upload className="h-4 w-4 text-text-secondary" />
                {t.topbar.newUploadFile}
              </Link>
              <Link
                role="menuitem"
                href="/import?tab=bulk"
                onClick={() => setNewMenuOpen(false)}
                className="flex items-center gap-2 rounded-md px-2.5 py-2 text-sm text-text-primary hover:bg-surface"
              >
                <FileSpreadsheet className="h-4 w-4 text-text-secondary" />
                {t.topbar.newBulkImport}
              </Link>
            </div>
          ) : null}
        </div>

        <Link
          href="/jobs"
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-bg px-2.5 text-xs font-medium text-text-secondary hover:border-border-strong hover:text-text-primary"
          title="Job Center"
        >
          <Activity
            className={cn("h-3.5 w-3.5", activeJobs > 0 ? "text-primary" : "text-text-secondary")}
            aria-hidden="true"
          />
          <span className="hidden font-mono sm:inline">
            {activeJobs > 0
              ? formatMessage(t.topbar.jobsActive, { count: activeJobs })
              : t.topbar.jobsIdle}
          </span>
          <span className="font-mono sm:hidden">{activeJobs}</span>
        </Link>

        <button
          type="button"
          onClick={toggleTheme}
          aria-label={theme === "dark" ? t.topbar.themeToLight : t.topbar.themeToDark}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-bg text-text-secondary hover:border-border-strong hover:text-text-primary"
        >
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
      </div>
    </header>
  );
}
