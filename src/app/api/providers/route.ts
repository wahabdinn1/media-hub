import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AuthenticationError, AuthorizationError, CsrfError, requireOwnerRequest } from "@/core";
import { getDb } from "@/db/client";
import { recordActivity } from "@/db/repositories/activity";
import {
  createOrUpdateProviderConnection,
  listSanitizedConnections,
} from "@/db/repositories/providers";
import { getProviderRegistry } from "@/lib/registry";

const SaveProviderSchema = z.object({
  providerKey: z.string().min(1),
  credentials: z.record(z.string(), z.string()),
  setAsDefault: z.boolean().optional().default(true),
  testBeforeSave: z.boolean().optional().default(true),
});

function handleRouteError(err: unknown): NextResponse {
  if (err instanceof AuthenticationError || err instanceof AuthorizationError || err instanceof CsrfError) {
    return NextResponse.json({ error: err.message }, { status: err.statusCode });
  }
  if (err instanceof z.ZodError) {
    return NextResponse.json({ error: "Invalid request payload.", issues: err.issues }, { status: 400 });
  }
  const detail =
    process.env.NODE_ENV !== "production" && err instanceof Error
      ? `${err.message}${err.cause instanceof Error ? ` | cause: ${err.cause.message}` : ""}`
      : undefined;
  return NextResponse.json(
    { error: detail ? `Internal server error: ${detail}` : "Internal server error." },
    { status: 500 },
  );
}

export async function GET(request: NextRequest) {
  try {
    await requireOwnerRequest(request, "provider.read");
    const { db, mode } = await getDb();
    const connections = await listSanitizedConnections(db);
    const adapters = getProviderRegistry().listMeta();

    return NextResponse.json({
      dbMode: mode,
      adapters,
      connections,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const principal = await requireOwnerRequest(request, "provider.manage");
    const body = SaveProviderSchema.parse(await request.json());

    const adapter = getProviderRegistry().get(body.providerKey);
    if (!adapter) {
      return NextResponse.json(
        { error: `Unknown provider "${body.providerKey}".` },
        { status: 400 },
      );
    }

    for (const field of adapter.meta.credentialFields) {
      const value = body.credentials[field.name]?.trim();
      if (field.required && !value) {
        return NextResponse.json(
          { error: `Field "${field.label}" is required.` },
          { status: 400 },
        );
      }
    }

    let accountInfo = null;
    if (body.testBeforeSave) {
      try {
        accountInfo = await adapter.testConnection(body.credentials);
      } catch (err) {
        const canonical = adapter.normalizeError(err);
        return NextResponse.json(
          {
            error: canonical.message,
            code: canonical.code,
          },
          { status: canonical.code === "AUTH_FAILED" ? 401 : 502 },
        );
      }
    }

    const { db } = await getDb();
    const connection = await createOrUpdateProviderConnection(db, {
      adapter,
      credentials: body.credentials,
      setAsDefault: body.setAsDefault,
      accountInfo,
      status: "active",
    });

    await recordActivity(db, {
      actorId: principal.actorId,
      action: "provider.connection.saved",
      entityType: "provider_connection",
      entityId: connection.id,
      context: {
        providerKey: adapter.meta.key,
        tested: body.testBeforeSave,
        isDefault: connection.isDefault,
      },
    });

    return NextResponse.json({ connection }, { status: 201 });
  } catch (err) {
    return handleRouteError(err);
  }
}
