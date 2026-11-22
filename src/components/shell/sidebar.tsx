"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  FolderKanban,
  LayoutDashboard,
  Link2,
  Play,
  Plug,
  ScrollText,
  Settings,
  Upload,
  Workflow,
} from "lucide-react";
import { getMessages, type TopNavKey } from "@/shared";
import { cn } from "@/lib/cn";
import { useUiStore } from "@/store/ui-store";

export const NAV_ICONS: Record<TopNavKey, typeof LayoutDashboard> = {
  dashboard: LayoutDashboard,
  library: FolderKanban,
  import: Upload,
  jobs: Activity,
  automation: Workflow,
  providers: Plug,
  settings: Settings,
};

interface SidebarStorageInfo {
  defaultConnection?: {
    accountInfo?: {
      storageUsedBytes?: number;
      storageLimitBytes?: number;
    } | null;
  } | null;
}

function formatGiB(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  return `${bytes} B`;
}

export function Sidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = getMessages("en");
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const enabledModules = useUiStore((s) => s.enabledModules);

  // Shares cached dashboard query (zero extra fetch)
  const { data: dash } = useQuery<SidebarStorageInfo>({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const res = await fetch("/api/dashboard");
      if (!res.ok) return {};
      return res.json();
    },
    staleTime: 60_000,
  });

  const usedBytes = dash?.defaultConnection?.accountInfo?.storageUsedBytes ?? 0;
  const limitBytes = dash?.defaultConnection?.accountInfo?.storageLimitBytes ?? 0;
  const storagePct =
    limitBytes > 0 ? Math.min(100, Math.round((usedBytes / limitBytes) * 1000) / 10) : 0;

  const currentTab = searchParams.get("tab");

  const primaryNav = [
    {
      key: "dashboard",
      label: t.nav.dashboard,
      href: "/dashboard",
      icon: LayoutDashboard,
      active: pathname === "/dashboard" && currentTab !== "analytics",
      visible: true,
    },
    {
      key: "library",
      label: "Media Library",
      href: "/library",
      icon: FolderKanban,
      active: pathname === "/library" || pathname.startsWith("/library/"),
      visible: enabledModules.library,
    },
    {
      key: "import",
      label: "Upload Manager",
      href: "/import?tab=url",
      icon: Upload,
      active: pathname === "/import" && currentTab !== "bulk",
      visible: enabledModules.import,
    },
    {
      key: "bulk",
      label: "Bulk Manager",
      href: "/import?tab=bulk",
      icon: FileSpreadsheet,
      active:
        (pathname === "/import" && currentTab === "bulk") ||
        pathname.startsWith("/import/batches"),
      visible: enabledModules.import,
    },
    {
      key: "automation",
      label: t.nav.automation,
      href: "/automation",
      icon: Workflow,
      active: pathname === "/automation" || pathname.startsWith("/automation/"),
      visible: enabledModules.automation,
    },
    {
      key: "analytics",
      label: "Analytics",
      href: "/dashboard?tab=analytics",
      icon: BarChart3,
      active: pathname === "/dashboard" && currentTab === "analytics",
      visible: enabledModules.analytics,
    },
  ].filter((i) => i.visible);

  const opsNav = [
    {
      key: "jobs",
      label: "Job Center",
      href: "/jobs",
      icon: Activity,
      active:
        (pathname === "/jobs" && currentTab !== "activity") ||
        pathname.startsWith("/jobs/"),
      visible: enabledModules.jobs,
    },
    {
      key: "providers",
      label: "Provider Connections",
      href: "/providers",
      icon: Plug,
      active: pathname === "/providers",
      visible: true,
    },
    {
      key: "activity",
      label: "Activity Logs",
      href: "/jobs?tab=activity",
      icon: ScrollText,
      active: pathname === "/jobs" && currentTab === "activity",
      visible: enabledModules.jobs,
    },
    {
      key: "settings",
      label: t.nav.settings,
      href: "/settings",
      icon: Settings,
      active: pathname === "/settings",
      visible: true,
    },
  ].filter((i) => i.visible);

  return (
    <aside
      aria-label="Primary navigation"
      className={cn(
        "hidden shrink-0 flex-col border-r border-border bg-surface/85 md:flex",
        collapsed ? "w-16" : "w-60",
      )}
    >
      <div className="flex h-16 items-center justify-between border-b border-border px-4">
        <Link
          href="/dashboard"
          aria-label={t.app.name}
          className="flex min-w-0 items-center gap-2.5 text-text-primary"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-[var(--shadow-btn-primary)]">
            <Play className="h-4 w-4 fill-current" aria-hidden="true" />
          </span>
          {!collapsed ? (
            <span className="truncate font-display text-base font-semibold tracking-tight">
              {t.app.name}
            </span>
          ) : null}
        </Link>

        <button
          type="button"
          onClick={toggleSidebar}
          aria-label={collapsed ? t.nav.expandSidebar : t.nav.collapseSidebar}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-surface-raised hover:text-text-primary"
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto px-2.5 py-4">
        <nav className="space-y-1">
          {primaryNav.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.key}
                href={item.href}
                title={collapsed ? item.label : undefined}
                className={cn(
                  "relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
                  item.active
                    ? "bg-primary-subtle text-text-primary"
                    : "text-text-secondary hover:bg-surface-raised/70 hover:text-text-primary",
                  collapsed && "justify-center px-0",
                )}
              >
                {item.active && !collapsed ? (
                  <span
                    className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r-full bg-primary"
                    aria-hidden="true"
                  />
                ) : null}
                <Icon
                  className={cn(
                    "h-[17px] w-[17px] shrink-0",
                    item.active ? "text-primary" : "text-text-secondary",
                  )}
                  aria-hidden="true"
                />
                {!collapsed ? <span className="truncate">{item.label}</span> : null}
              </Link>
            );
          })}
        </nav>

        <nav className="space-y-1 border-t border-border pt-4">
          {opsNav.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.key}
                href={item.href}
                title={collapsed ? item.label : undefined}
                className={cn(
                  "relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
                  item.active
                    ? "bg-primary-subtle text-text-primary"
                    : "text-text-secondary hover:bg-surface-raised/70 hover:text-text-primary",
                  collapsed && "justify-center px-0",
                )}
              >
                {item.active && !collapsed ? (
                  <span
                    className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r-full bg-primary"
                    aria-hidden="true"
                  />
                ) : null}
                <Icon
                  className={cn(
                    "h-[17px] w-[17px] shrink-0",
                    item.active ? "text-primary" : "text-text-secondary",
                  )}
                  aria-hidden="true"
                />
                {!collapsed ? <span className="truncate">{item.label}</span> : null}
              </Link>
            );
          })}
        </nav>
      </div>

      {!collapsed ? (
        <div className="space-y-3 border-t border-border p-3.5">
          <div className="space-y-2 rounded-xl border border-border bg-bg/80 p-3 text-xs">
            <div className="font-medium text-text-secondary">Storage Usage</div>
            <div className="flex items-baseline justify-between tabular-nums">
              <span className="font-semibold text-text-primary">
                {formatGiB(usedBytes)}
                {limitBytes > 0 ? ` / ${formatGiB(limitBytes)}` : ""}
              </span>
              {limitBytes > 0 ? (
                <span className="text-text-secondary">{storagePct}%</span>
              ) : null}
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-raised">
              <div
                className="h-full w-full origin-left rounded-full bg-primary transition-transform duration-200"
                style={{ transform: `scaleX(${Math.max(storagePct, usedBytes > 0 ? 4 : 0) / 100})` }}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="px-1 text-xs font-medium text-text-secondary">Quick Actions</div>
            <Link
              href="/import?tab=url"
              className="flex items-center gap-2 rounded-lg border border-border bg-bg/70 px-3 py-2 text-xs font-medium text-text-primary transition-colors hover:border-border-strong hover:bg-surface-raised"
            >
              <Link2 className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
              Import URL
            </Link>
            <Link
              href="/import?tab=bulk"
              className="flex items-center gap-2 rounded-lg border border-border bg-bg/70 px-3 py-2 text-xs font-medium text-text-primary transition-colors hover:border-border-strong hover:bg-surface-raised"
            >
              <FileSpreadsheet className="h-3.5 w-3.5 text-violet" aria-hidden="true" />
              Bulk Import
            </Link>
            <Link
              href="/automation"
              className="flex items-center gap-2 rounded-lg border border-border bg-bg/70 px-3 py-2 text-xs font-medium text-text-primary transition-colors hover:border-border-strong hover:bg-surface-raised"
            >
              <Workflow className="h-3.5 w-3.5 text-success" aria-hidden="true" />
              Create Workflow
            </Link>
          </div>
        </div>
      ) : null}
    </aside>
  );
}
