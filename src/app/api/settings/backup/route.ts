import { NextRequest, NextResponse } from "next/server";
import { requireOwnerRequest } from "@/core";
import { getDb } from "@/db/client";
import { recordActivity } from "@/db/repositories/activity";
import { exportSecretFreeMetadata, restoreSecretFreeMetadata } from "@/db/repositories/backup";
import { toApiErrorResponse } from "@/lib/api-error";

export async function GET(request: NextRequest) {
  try {
    const principal = await requireOwnerRequest(request, "settings.manage");
    const { db } = await getDb();
    const payload = await exportSecretFreeMetadata(db);

    await recordActivity(db, {
      actorId: principal.actorId,
      action: "backup.exported",
      entityType: "system",
      entityId: "metadata-backup",
      context: { assets: payload.tables.assets.length, collections: payload.tables.collections.length },
    });

    const dateTag = new Date().toISOString().slice(0, 10);
    return new NextResponse(JSON.stringify(payload, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="mediahub-backup-${dateTag}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const principal = await requireOwnerRequest(request, "settings.manage");
    const { searchParams } = new URL(request.url);
    const dryRun = searchParams.get("dryRun") === "1";
    const body = await request.json();

    const { db } = await getDb();
    const result = await restoreSecretFreeMetadata(db, body, { dryRun });

    if (!dryRun) {
      await recordActivity(db, {
        actorId: principal.actorId,
        action: "backup.restored",
        entityType: "system",
        entityId: "metadata-backup",
        context: result.counts,
      });
    }

    return NextResponse.json(result);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
