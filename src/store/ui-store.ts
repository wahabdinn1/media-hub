"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ModuleKey } from "@/shared";

export type ThemeMode = "dark" | "light";

interface UiState {
  sidebarCollapsed: boolean;
  theme: ThemeMode;
  globalSearch: string;
  killSwitchEnabled: boolean;
  enabledModules: Record<ModuleKey, boolean>;
  toggleSidebar: () => void;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
  setGlobalSearch: (query: string) => void;
  setKillSwitchEnabled: (enabled: boolean) => void;
  toggleModule: (moduleKey: ModuleKey) => void;
}

/**
 * Ephemeral local UI state only (PRD 7.3).
 * Never duplicates server data from D1 or provider APIs.
 */
export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      theme: "dark",
      globalSearch: "",
      killSwitchEnabled: false,
      enabledModules: {
        library: true,
        import: true,
        jobs: true,
        thumbnails: true,
        automation: true,
        analytics: true,
      },
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setTheme: (theme) => set({ theme }),
      toggleTheme: () => set((s) => ({ theme: s.theme === "dark" ? "light" : "dark" })),
      setGlobalSearch: (globalSearch) => set({ globalSearch }),
      setKillSwitchEnabled: (killSwitchEnabled) => set({ killSwitchEnabled }),
      toggleModule: (moduleKey) =>
        set((s) => ({
          enabledModules: {
            ...s.enabledModules,
            [moduleKey]: !s.enabledModules[moduleKey],
          },
        })),
    }),
    {
      name: "mediahub-ui-prefs",
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
        theme: state.theme,
        killSwitchEnabled: state.killSwitchEnabled,
        enabledModules: state.enabledModules,
      }),
    },
  ),
);
