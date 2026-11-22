import { NextRequest, NextResponse } from "next/server";
import { AuthenticationError, AuthorizationError, CsrfError, requireOwnerRequest } from "@/core";
import { getDb } from "@/db/client";
import { recordActivity } from "@/db/repositories/activity";
import {
  decryptConnectionCredentials,
  getConnectionById,
  updateConnectionTestResult,
} from "@/db/repositories/providers";
import { getProviderRegistry } from "@/lib/registry";

export async function POST(
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

    const adapter = getProviderRegistry().get(row.providerKey);
    if (!adapter) {
      return NextResponse.json(
        { error: `Adapter "${row.providerKey}" is not registered.` },
        { status: 400 },
      );
    }

    const credentials = await decryptConnectionCredentials(row);
    try {
      const accountInfo = await adapter.testConnection(credentials);
      const updated = await updateConnectionTestResult(db, row.id, {
        status: "active",
        accountInfo,
      });

      await recordActivity(db, {
        actorId: principal.actorId,
        action: "provider.connection.tested",
        entityType: "provider_connection",
        entityId: row.id,
        context: { providerKey: row.providerKey, outcome: "ok" },
      });

      return NextResponse.json({ ok: true, connection: updated });
    } catch (err) {
      const canonical = adapter.normalizeError(err);
      const updated = await updateConnectionTestResult(db, row.id, {
        status: "error",
        errorCode: canonical.code,
      });

      await recordActivity(db, {
        actorId: principal.actorId,
        action: "provider.connection.tested",
        entityType: "provider_connection",
        entityId: row.id,
        context: { providerKey: row.providerKey, outcome: "failed", errorCode: canonical.code },
      });

      return NextResponse.json(
        { ok: false, error: canonical.message, code: canonical.code, connection: updated },
        { status: canonical.code === "AUTH_FAILED" ? 401 : 502 },
      );
    }
  } catch (err) {
    if (err instanceof AuthenticationError || err instanceof AuthorizationError || err instanceof CsrfError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    return NextResponse.json({ error: "Failed to test provider connection." }, { status: 500 });
  }
}
