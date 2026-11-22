"use client";

import { Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { getMessages } from "@/shared";
import { useUiStore } from "@/store/ui-store";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { MobileNav } from "./mobile-nav";

interface HealthBannerData {
  quota?: {
    killSwitchEnabled?: boolean;
    degradeModeActive?: boolean;
  };
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const t = getMessages("en");
  const localKillSwitch = useUiStore((s) => s.killSwitchEnabled);

  const { data: health } = useQuery<HealthBannerData>({
    queryKey: ["poc-health"],
    queryFn: async () => {
      const res = await fetch("/api/poc/health");
      if (!res.ok) return {};
      return res.json();
    },
    staleTime: 30_000,
  });

  const killSwitchEnabled = health?.quota?.killSwitchEnabled ?? localKillSwitch;
  const degradeModeActive = Boolean(health?.quota?.degradeModeActive);

  return (
    <div className="flex min-h-screen w-full bg-bg text-text-primary">
      <Suspense fallback={<aside className="hidden w-60 shrink-0 border-r border-border bg-surface md:block" />}>
        <Sidebar />
      </Suspense>
      <div className="flex min-w-0 flex-1 flex-col">
        <Suspense fallback={<header className="h-14 shrink-0 border-b border-border bg-surface" />}>
          <Topbar />
        </Suspense>

        {killSwitchEnabled ? (
          <div
            role="status"
            className="flex items-center gap-2 border-b border-warning/30 bg-warning-subtle px-4 py-2 text-xs font-medium text-warning"
          >
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{t.quotas.killSwitchBanner}</span>
          </div>
        ) : degradeModeActive ? (
          <div
            role="status"
            className="flex items-center gap-2 border-b border-danger/30 bg-danger-subtle px-4 py-2 text-xs font-medium text-danger"
          >
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{t.quotas.degradeBanner}</span>
          </div>
        ) : null}

        <main className="mx-auto w-full max-w-[1360px] flex-1 px-4 pb-24 pt-6 sm:px-6 md:pb-10">
          {children}
        </main>
      </div>
      <Suspense fallback={null}>
        <MobileNav />
      </Suspense>
    </div>
  );
}
