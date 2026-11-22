"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  FolderKanban,
  LayoutDashboard,
  Plug,
  Settings,
  Upload,
  Workflow,
} from "lucide-react";
import { getMessages, TOP_NAV_ITEMS, type TopNavKey } from "@/shared";
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

export function Sidebar() {
  const pathname = usePathname();
  const t = getMessages("en");
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const enabledModules = useUiStore((s) => s.enabledModules);

  const visibleItems = TOP_NAV_ITEMS.filter(
    (item) => !item.moduleKey || enabledModules[item.moduleKey],
  );

  return (
    <aside
      aria-label="Primary navigation"
      className={cn(
        "hidden shrink-0 flex-col border-r border-border bg-surface transition-[width] duration-150 md:flex",
        collapsed ? "w-16" : "w-60",
      )}
    >
      <div className="flex h-14 items-center justify-between border-b border-border px-3">
        <Link
          href="/dashboard"
          className="flex min-w-0 items-center gap-2.5 rounded-md px-1 py-1 text-text-primary"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary font-mono text-xs font-bold text-primary-foreground">
            MH
          </span>
          {!collapsed ? (
            <span className="truncate text-sm font-semibold tracking-tight">
              {t.app.name}
            </span>
          ) : null}
        </Link>

        <button
          type="button"
          onClick={toggleSidebar}
          aria-label={collapsed ? t.nav.expandSidebar : t.nav.collapseSidebar}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-secondary hover:bg-surface-raised hover:text-text-primary"
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>

      <nav className="flex-1 space-y-1 p-2">
        {visibleItems.map((item) => {
          const Icon = NAV_ICONS[item.key];
          const isActive =
            pathname === item.href || pathname.startsWith(`${item.href}/`);

          return (
            <Link
              key={item.key}
              href={item.href}
              title={collapsed ? t.nav[item.key] : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-primary-subtle text-primary"
                  : "text-text-secondary hover:bg-surface-raised hover:text-text-primary",
                collapsed && "justify-center px-0",
              )}
            >
              <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
              {!collapsed ? (
                <span className="flex flex-1 items-center justify-between truncate">
                  <span>{t.nav[item.key]}</span>
                  {item.phaseBadge ? (
                    <span className="rounded bg-surface-raised px-1.5 py-0.5 font-mono text-[10px] text-text-secondary">
                      {item.phaseBadge}
                    </span>
                  ) : null}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      {!collapsed ? (
        <div className="border-t border-border px-3 py-3 text-[11px] text-text-secondary">
          <div className="font-mono text-text-primary">MediaHub v1.0</div>
          <div className="mt-0.5 truncate">Zero-Cost Hybrid Tier</div>
        </div>
      ) : null}
    </aside>
  );
}
