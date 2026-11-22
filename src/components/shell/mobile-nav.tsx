"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { getMessages, TOP_NAV_ITEMS } from "@/shared";
import { cn } from "@/lib/cn";
import { useUiStore } from "@/store/ui-store";
import { NAV_ICONS } from "./sidebar";

export function MobileNav() {
  const pathname = usePathname();
  const t = getMessages("en");
  const enabledModules = useUiStore((s) => s.enabledModules);
  const [moreOpen, setMoreOpen] = useState(false);

  const visibleItems = TOP_NAV_ITEMS.filter(
    (item) => !item.moduleKey || enabledModules[item.moduleKey],
  );
  const primaryItems = visibleItems.filter((item) => item.mobilePrimary);
  const moreItems = visibleItems.filter((item) => !item.mobilePrimary);

  return (
    <>
      {moreOpen ? (
        <div
          className="fixed inset-0 z-40 bg-scrim md:hidden"
          onClick={() => setMoreOpen(false)}
          aria-hidden="true"
        />
      ) : null}

      {moreOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t.nav.more}
          className="fixed inset-x-0 bottom-16 z-50 rounded-t-2xl border-t border-border bg-surface p-4 shadow-xl md:hidden"
        >
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-semibold text-text-primary">{t.nav.more}</span>
            <button
              type="button"
              onClick={() => setMoreOpen(false)}
              aria-label="Close menu"
              className="flex h-8 w-8 items-center justify-center rounded-md text-text-secondary hover:bg-surface-raised hover:text-text-primary"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-1 gap-1.5">
            {moreItems.map((item) => {
              const Icon = NAV_ICONS[item.key];
              const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  onClick={() => setMoreOpen(false)}
                  className={cn(
                    "flex items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium",
                    isActive
                      ? "bg-primary-subtle text-primary"
                      : "text-text-primary hover:bg-surface-raised",
                  )}
                >
                  <span className="flex items-center gap-2.5">
                    <Icon className="h-4 w-4" aria-hidden="true" />
                    {t.nav[item.key]}
                  </span>
                  {item.phaseBadge ? (
                    <span className="rounded bg-surface-raised px-1.5 py-0.5 font-mono text-[10px] text-text-secondary">
                      {item.phaseBadge}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </div>
        </div>
      ) : null}

      <nav
        aria-label="Mobile navigation"
        className="fixed inset-x-0 bottom-0 z-40 grid h-16 grid-cols-5 border-t border-border bg-surface md:hidden"
      >
        {primaryItems.map((item) => {
          const Icon = NAV_ICONS[item.key];
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.key}
              href={item.href}
              className={cn(
                "flex flex-col items-center justify-center gap-1 text-[11px] font-medium",
                isActive ? "text-primary" : "text-text-secondary",
              )}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              <span className="truncate">{t.nav[item.key]}</span>
            </Link>
          );
        })}

        <button
          type="button"
          onClick={() => setMoreOpen((o) => !o)}
          className={cn(
            "flex flex-col items-center justify-center gap-1 text-[11px] font-medium",
            moreOpen ? "text-primary" : "text-text-secondary",
          )}
        >
          <Menu className="h-4 w-4" aria-hidden="true" />
          <span>{t.nav.more}</span>
        </button>
      </nav>
    </>
  );
}
