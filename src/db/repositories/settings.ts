import { eq } from "drizzle-orm";
import { MODULE_KEYS, type ModuleKey } from "@/shared";
import type { MediaHubDb } from "../client";
import { appSettings, moduleSettings } from "../schema";

export interface PersistedSettings {
  killSwitchEnabled: boolean;
  locale: string;
  enabledModules: Record<ModuleKey, boolean>;
}

const DEFAULT_MODULES: Record<ModuleKey, boolean> = {
  library: true,
  import: true,
  jobs: true,
  thumbnails: true,
  automation: true,
  analytics: true,
};

export async function getPersistedSettings(db: MediaHubDb): Promise<PersistedSettings> {
  const [appRows, modRows] = await Promise.all([
    db.select().from(appSettings),
    db.select().from(moduleSettings),
  ]);

  const appMap = new Map(appRows.map((r) => [r.key, r.valueJson]));
  let killSwitchEnabled = false;
  let locale = "en";

  try {
    const rawKs = appMap.get("kill_switch_enabled");
    if (rawKs) killSwitchEnabled = Boolean(JSON.parse(rawKs));
  } catch {
    killSwitchEnabled = false;
  }

  try {
    const rawLocale = appMap.get("locale");
    if (rawLocale) locale = String(JSON.parse(rawLocale));
  } catch {
    locale = "en";
  }

  const enabledModules: Record<ModuleKey, boolean> = { ...DEFAULT_MODULES };
  for (const row of modRows) {
    if ((MODULE_KEYS as readonly string[]).includes(row.moduleKey)) {
      enabledModules[row.moduleKey as ModuleKey] = Boolean(row.enabled);
    }
  }

  return { killSwitchEnabled, locale, enabledModules };
}

export async function setKillSwitch(db: MediaHubDb, enabled: boolean): Promise<void> {
  const now = new Date().toISOString();
  await db
    .insert(appSettings)
    .values({
      key: "kill_switch_enabled",
      valueJson: JSON.stringify(enabled),
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { valueJson: JSON.stringify(enabled), updatedAt: now },
    });
}

export async function setModuleEnabled(
  db: MediaHubDb,
  moduleKey: ModuleKey,
  enabled: boolean,
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .insert(moduleSettings)
    .values({
      moduleKey,
      enabled,
      configJson: "{}",
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: moduleSettings.moduleKey,
      set: { enabled, updatedAt: now },
    });
}

export async function assertModuleEnabled(db: MediaHubDb, moduleKey: ModuleKey): Promise<boolean> {
  const rows = await db
    .select()
    .from(moduleSettings)
    .where(eq(moduleSettings.moduleKey, moduleKey))
    .limit(1);
  if (!rows[0]) return true;
  return Boolean(rows[0].enabled);
}
