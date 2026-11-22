import { NextRequest, NextResponse } from "next/server";
import { requireOwnerRequest, resolveConnectionForOperation, type ProviderConnectionRecord } from "@/core";
import type { ServiceType } from "@/shared";
import { getDb } from "@/db/client";
import { providerConnections } from "@/db/schema";
import { getAssetDetail } from "@/db/repositories/assets";
import { toApiErrorResponse } from "@/lib/api-error";
import { getProviderRegistry } from "@/lib/registry";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ assetId: string }> },
) {
  try {
    await requireOwnerRequest(request, "asset.read");
    const { assetId } = await context.params;
    const { db } = await getDb();
    const [detail, allConns] = await Promise.all([
      getAssetDetail(db, assetId),
      db.select().from(providerConnections),
    ]);
    if (!detail) {
      return NextResponse.json({ error: "Asset not found." }, { status: 404 });
    }

    const registry = getProviderRegistry();
    const connRecords: ProviderConnectionRecord[] = allConns.map((c) => ({
      id: c.id,
      serviceType: c.serviceType as ServiceType,
      providerKey: c.providerKey,
      status: c.status as "active" | "disabled" | "error",
      isDefault: c.isDefault,
    }));

    const enrichedLocations = detail.locations.map((loc) => {
      const adapter = registry.get(loc.providerKey);
      const routing = resolveConnectionForOperation({
        connections: connRecords,
        serviceType: (adapter?.meta.serviceType ?? "video_host") as ServiceType,
        locationConnectionId: loc.providerConnectionId,
        mutation: true,
      });

      return {
        ...loc,
        providerDisplayName: adapter?.meta.displayName ?? loc.providerKey,
        capabilities: adapter?.meta.capabilities ?? null,
        canMutate: routing.allowed,
        readOnlyReason: routing.allowed ? null : routing.reason,
      };
    });

    return NextResponse.json({
      ...detail,
      locations: enrichedLocations,
    });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
