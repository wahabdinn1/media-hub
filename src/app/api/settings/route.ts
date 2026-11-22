import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { evaluateQuotaState, requireOwnerRequest } from "@/core";
import { ModuleKeySchema } from "@/shared";
import { getDb } from "@/db/client";
import { recordActivity } from "@/db/repositories/activity";
import {
  getPersistedSettings,
  setKillSwitch,
  setModuleEnabled,
} from "@/db/repositories/settings";
import { getCurrentUsageCounters } from "@/db/repositories/usage";
import { toApiErrorResponse } from "@/lib/api-error";

const PatchSettingsSchema = z.object({
  killSwitchEnabled: z.boolean().optional(),
  moduleToggle: z
    .object({
      moduleKey: ModuleKeySchema,
      enabled: z.boolean(),
    })
    .optional(),
});

export async function GET(request: NextRequest) {
  try {
    await requireOwnerRequest(request, "settings.manage");
    const { db } = await getDb();
    const [settings, counters] = await Promise.all([
      getPersistedSettings(db),
      getCurrentUsageCounters(db),
    ]);
    const quota = evaluateQuotaState(counters, {
      killSwitchEnabled: settings.killSwitchEnabled,
    });
    return NextResponse.json({ settings, quota });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const principal = await requireOwnerRequest(request, "settings.manage");
    const body = PatchSettingsSchema.parse(await request.json());
    const { db } = await getDb();

    if (body.killSwitchEnabled !== undefined) {
      await setKillSwitch(db, body.killSwitchEnabled);
      await recordActivity(db, {
        actorId: principal.actorId,
        action: body.killSwitchEnabled ? "system.kill_switch.enabled" : "system.kill_switch.disabled",
        entityType: "settings",
        entityId: "kill_switch_enabled",
        context: { enabled: body.killSwitchEnabled },
      });
    }

    if (body.moduleToggle) {
      await setModuleEnabled(db, body.moduleToggle.moduleKey, body.moduleToggle.enabled);
      await recordActivity(db, {
        actorId: principal.actorId,
        action: "settings.module.toggled",
        entityType: "module",
        entityId: body.moduleToggle.moduleKey,
        context: {
          moduleKey: body.moduleToggle.moduleKey,
          enabled: body.moduleToggle.enabled,
        },
      });
    }

    const [settings, counters] = await Promise.all([
      getPersistedSettings(db),
      getCurrentUsageCounters(db),
    ]);
    const quota = evaluateQuotaState(counters, {
      killSwitchEnabled: settings.killSwitchEnabled,
    });

    return NextResponse.json({ settings, quota });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
