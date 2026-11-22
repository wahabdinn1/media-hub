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
        "hidden shrink-0 flex-col border-r border-border bg-surface/70 md:flex",
        collapsed ? "w-16" : "w-56",
      )}
    >
      <div className="flex h-14 items-center justify-between border-b border-border px-3.5">
        <Link
          href="/dashboard"
          aria-label={t.app.name}
          className="flex min-w-0 items-center gap-2.5 text-text-primary"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground shadow-[var(--shadow-btn-primary)]">
            MH
          </span>
          {!collapsed ? (
            <span className="truncate font-display text-[15px] font-medium tracking-tight">
              {t.app.name}
            </span>
          ) : null}
        </Link>

        <button
          type="button"
          onClick={toggleSidebar}
          aria-label={collapsed ? t.nav.expandSidebar : t.nav.collapseSidebar}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-surface-raised hover:text-text-primary"
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>

      <nav className="flex-1 space-y-0.5 px-2.5 py-4">
        {visibleItems.map((item) => {
          const Icon = NAV_ICONS[item.key];
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);

          return (
            <Link
              key={item.key}
              href={item.href}
              title={collapsed ? t.nav[item.key] : undefined}
              className={cn(
                "group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm whitespace-nowrap transition-colors",
                isActive
                  ? "bg-primary-subtle font-medium text-text-primary"
                  : "text-text-secondary hover:bg-surface-raised/60 hover:text-text-primary",
                collapsed && "justify-center px-0",
              )}
            >
              <Icon
                className={cn(
                  "h-[17px] w-[17px] shrink-0",
                  isActive ? "text-primary" : "text-text-secondary group-hover:text-text-primary",
                )}
                aria-hidden="true"
              />
              {!collapsed ? (
                <span className="flex flex-1 items-center justify-between truncate">
                  <span>{t.nav[item.key]}</span>
                  {isActive ? (
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                      aria-hidden="true"
                    />
                  ) : null}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      {!collapsed ? (
        <div className="border-t border-border px-4 py-3.5 text-xs text-text-secondary">
          <div className="font-medium text-text-primary">MediaHub v1.0</div>
          <div className="mt-0.5 truncate">Zero-Cost Hybrid Tier</div>
        </div>
      ) : null}
    </aside>
  );
}
