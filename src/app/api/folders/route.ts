import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireOwnerRequest } from "@/core";
import { getDb } from "@/db/client";
import { providerConnections } from "@/db/schema";
import { recordActivity } from "@/db/repositories/activity";
import { insertProviderFolder, listProviderFolders } from "@/db/repositories/folders";
import { decryptConnectionCredentials } from "@/db/repositories/providers";
import { toApiErrorResponse } from "@/lib/api-error";
import { getProviderRegistry } from "@/lib/registry";

const CreateFolderSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

export async function GET(request: NextRequest) {
  try {
    await requireOwnerRequest(request, "asset.read");
    const { db } = await getDb();
    const folders = await listProviderFolders(db);
    return NextResponse.json({ folders });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const principal = await requireOwnerRequest(request, "asset.write");
    const body = CreateFolderSchema.parse(await request.json());
    const { db } = await getDb();

    const conns = await db
      .select()
      .from(providerConnections)
      .where(eq(providerConnections.isDefault, true))
      .limit(1);
    const conn = conns[0];
    if (!conn || conn.status !== "active") {
      return NextResponse.json(
        { error: "No active default provider connection." },
        { status: 400 },
      );
    }

    const adapter = getProviderRegistry().require(conn.providerKey);
    if (adapter.meta.capabilities.folders === "none" || !adapter.createFolder) {
      return NextResponse.json(
        { error: `Provider "${adapter.meta.displayName}" does not support folders.` },
        { status: 400 },
      );
    }

    const credentials = await decryptConnectionCredentials(conn);
    const created = await adapter.createFolder(credentials, body.name);
    const saved = await insertProviderFolder(db, {
      providerConnectionId: conn.id,
      externalId: created.externalId,
      name: created.name,
      parentExternalId: created.parentExternalId,
    });

    await recordActivity(db, {
      actorId: principal.actorId,
      action: "provider_folder.created",
      entityType: "provider_folder",
      entityId: saved?.id ?? created.externalId,
      context: { providerKey: conn.providerKey, name: created.name },
    });

    return NextResponse.json({ folder: saved }, { status: 201 });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
