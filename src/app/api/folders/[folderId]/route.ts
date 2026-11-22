import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOwnerRequest } from "@/core";
import { getDb } from "@/db/client";
import { recordActivity } from "@/db/repositories/activity";
import {
  deleteLocalProviderFolder,
  getProviderFolderById,
  renameLocalProviderFolder,
} from "@/db/repositories/folders";
import { decryptConnectionCredentials, getConnectionById } from "@/db/repositories/providers";
import { toApiErrorResponse } from "@/lib/api-error";
import { getProviderRegistry } from "@/lib/registry";

const RenameFolderSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ folderId: string }> },
) {
  try {
    const principal = await requireOwnerRequest(request, "asset.write");
    const { folderId } = await context.params;
    const body = RenameFolderSchema.parse(await request.json());
    const { db } = await getDb();

    const folder = await getProviderFolderById(db, folderId);
    if (!folder) {
      return NextResponse.json({ error: "Folder not found." }, { status: 404 });
    }
    const conn = await getConnectionById(db, folder.providerConnectionId);
    if (!conn) {
      return NextResponse.json({ error: "Provider connection not found." }, { status: 404 });
    }

    const adapter = getProviderRegistry().require(conn.providerKey);
    if (!adapter.renameFolder) {
      return NextResponse.json({ error: "Provider does not support renaming folders." }, { status: 400 });
    }

    const credentials = await decryptConnectionCredentials(conn);
    await adapter.renameFolder(credentials, folder.externalId, body.name);
    await renameLocalProviderFolder(db, folder.id, body.name);

    await recordActivity(db, {
      actorId: principal.actorId,
      action: "provider_folder.renamed",
      entityType: "provider_folder",
      entityId: folder.id,
      context: { providerKey: conn.providerKey, name: body.name },
    });

    return NextResponse.json({ ok: true, id: folder.id, name: body.name });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ folderId: string }> },
) {
  try {
    const principal = await requireOwnerRequest(request, "asset.write");
    const { folderId } = await context.params;
    const { db } = await getDb();

    const folder = await getProviderFolderById(db, folderId);
    if (!folder) {
      return NextResponse.json({ error: "Folder not found." }, { status: 404 });
    }
    const conn = await getConnectionById(db, folder.providerConnectionId);
    if (!conn) {
      return NextResponse.json({ error: "Provider connection not found." }, { status: 404 });
    }

    const adapter = getProviderRegistry().require(conn.providerKey);
    if (!adapter.deleteFolder) {
      return NextResponse.json({ error: "Provider does not support deleting folders." }, { status: 400 });
    }

    const credentials = await decryptConnectionCredentials(conn);
    await adapter.deleteFolder(credentials, folder.externalId);
    await deleteLocalProviderFolder(db, folder.id, conn.id);

    await recordActivity(db, {
      actorId: principal.actorId,
      action: "provider_folder.deleted",
      entityType: "provider_folder",
      entityId: folder.id,
      context: { providerKey: conn.providerKey, name: folder.name },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
