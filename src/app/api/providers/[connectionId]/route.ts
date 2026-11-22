import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AuthenticationError, AuthorizationError, CsrfError, requireOwnerRequest } from "@/core";
import { getDb } from "@/db/client";
import { recordActivity } from "@/db/repositories/activity";
import {
  deleteProviderConnection,
  getConnectionById,
  rotateConnectionCredentials,
  updateConnectionTestResult,
} from "@/db/repositories/providers";
import { getProviderRegistry } from "@/lib/registry";

const RotateSchema = z.object({
  credentials: z.record(z.string(), z.string()),
  testBeforeSave: z.boolean().optional().default(true),
});

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ connectionId: string }> },
) {
  try {
    const principal = await requireOwnerRequest(request, "provider.manage");
    const { connectionId } = await context.params;
    const body = RotateSchema.parse(await request.json());
    const { db } = await getDb();

    const row = await getConnectionById(db, connectionId);
    if (!row) {
      return NextResponse.json({ error: "Provider connection not found." }, { status: 404 });
    }

    const adapter = getProviderRegistry().require(row.providerKey);
    let accountInfo = null;
    if (body.testBeforeSave) {
      try {
        accountInfo = await adapter.testConnection(body.credentials);
      } catch (err) {
        const canonical = adapter.normalizeError(err);
        return NextResponse.json(
          { error: canonical.message, code: canonical.code },
          { status: canonical.code === "AUTH_FAILED" ? 401 : 502 },
        );
      }
    }

    let updated = await rotateConnectionCredentials(db, row.id, body.credentials);
    if (accountInfo) {
      updated = await updateConnectionTestResult(db, row.id, {
        status: "active",
        accountInfo,
      });
    }

    await recordActivity(db, {
      actorId: principal.actorId,
      action: "provider.credentials.rotated",
      entityType: "provider_connection",
      entityId: row.id,
      context: { providerKey: row.providerKey, keyVersion: updated.keyVersion },
    });

    return NextResponse.json({ connection: updated });
  } catch (err) {
    if (err instanceof AuthenticationError || err instanceof AuthorizationError || err instanceof CsrfError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to rotate provider credentials." }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ connectionId: string }> },
) {
  try {
    const principal = await requireOwnerRequest(request, "provider.manage");
    const { connectionId } = await context.params;
    const { db } = await getDb();

    const row = await getConnectionById(db, connectionId);
    if (!row) {
      return NextResponse.json({ error: "Provider connection not found." }, { status: 404 });
    }

    await deleteProviderConnection(db, row.id);
    await recordActivity(db, {
      actorId: principal.actorId,
      action: "provider.connection.disconnected",
      entityType: "provider_connection",
      entityId: row.id,
      context: { providerKey: row.providerKey },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthenticationError || err instanceof AuthorizationError || err instanceof CsrfError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    return NextResponse.json({ error: "Failed to disconnect provider." }, { status: 500 });
  }
}
