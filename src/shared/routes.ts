import { z } from "zod";

export const PERMISSION_SCOPES = [
  "dashboard.read",
  "asset.read",
  "asset.write",
  "asset.delete",
  "provider.read",
  "provider.manage",
  "job.create",
  "job.manage",
  "workflow.manage",
  "thumbnail.write",
  "settings.manage",
] as const;

export const PermissionScopeSchema = z.enum(PERMISSION_SCOPES);
export type PermissionScope = z.infer<typeof PermissionScopeSchema>;

export const MODULE_KEYS = [
  "library",
  "import",
  "jobs",
  "thumbnails",
  "automation",
  "analytics",
] as const;

export const ModuleKeySchema = z.enum(MODULE_KEYS);
export type ModuleKey = z.infer<typeof ModuleKeySchema>;

export type TopNavKey =
  | "dashboard"
  | "library"
  | "import"
  | "jobs"
  | "automation"
  | "providers"
  | "settings";

export interface NavItemConfig {
  key: TopNavKey;
  href: string;
  scope: PermissionScope;
  mobilePrimary: boolean;
  moduleKey?: ModuleKey;
  phaseBadge?: "P0" | "P1" | "P2";
}

export const TOP_NAV_ITEMS: readonly NavItemConfig[] = [
  { key: "dashboard", href: "/dashboard", scope: "dashboard.read", mobilePrimary: true },
  { key: "library", href: "/library", scope: "asset.read", mobilePrimary: true, moduleKey: "library" },
  { key: "import", href: "/import", scope: "job.create", mobilePrimary: true, moduleKey: "import" },
  { key: "jobs", href: "/jobs", scope: "job.manage", mobilePrimary: true, moduleKey: "jobs" },
  {
    key: "automation",
    href: "/automation",
    scope: "workflow.manage",
    mobilePrimary: false,
    moduleKey: "automation",
  },
  { key: "providers", href: "/providers", scope: "provider.manage", mobilePrimary: false },
  { key: "settings", href: "/settings", scope: "settings.manage", mobilePrimary: false },
] as const;
