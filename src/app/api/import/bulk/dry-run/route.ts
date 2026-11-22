import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { buildBulkDryRun, requireOwnerRequest } from "@/core";
import { hasCapability } from "@/shared";
import { getDb } from "@/db/client";
import { listSanitizedConnections } from "@/db/repositories/providers";
import { listExistingSourceUrlHashes } from "@/db/repositories/tick-runner";
import { toApiErrorResponse } from "@/lib/api-error";
import { getProviderRegistry } from "@/lib/registry";

const DryRunSchema = z.object({
  rawInput: z.string().min(1).max(200_000),
});

export async function POST(request: NextRequest) {
  try {
    await requireOwnerRequest(request, "job.create");
    const body = DryRunSchema.parse(await request.json());
    const { db } = await getDb();

    const [connections, existingHashes] = await Promise.all([
      listSanitizedConnections(db),
      listExistingSourceUrlHashes(db),
    ]);

    const registry = getProviderRegistry();
    const activeConns = connections.filter((c) => c.status === "active");
    const supportedProviders = new Set<string>();
    for (const c of activeConns) {
      const adapter = registry.get(c.providerKey);
      if (adapter && hasCapability(adapter.meta.capabilities, "upload.url")) {
        supportedProviders.add(c.providerKey);
      }
    }

    const defaultConn = activeConns.find((c) => c.isDefault) ?? activeConns[0];
    const defaultProviderKey = defaultConn?.providerKey ?? "vidara";

    const preview = await buildBulkDryRun({
      rawInput: body.rawInput,
      supportedProviders,
      defaultProviderKey,
      existingUrlHashes: existingHashes,
    });

    return NextResponse.json({
      preview,
      defaultProviderKey,
      hasConnectedProvider: supportedProviders.size > 0,
    });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
