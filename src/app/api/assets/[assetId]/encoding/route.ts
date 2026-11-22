import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireOwnerRequest } from "@/core";
import { getDb } from "@/db/client";
import { assets } from "@/db/schema";
import { getAssetDetail } from "@/db/repositories/assets";
import { transitionJob } from "@/db/repositories/jobs";
import { decryptConnectionCredentials, getConnectionById } from "@/db/repositories/providers";
import { toApiErrorResponse } from "@/lib/api-error";
import { getProviderRegistry } from "@/lib/registry";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ assetId: string }> },
) {
  try {
    await requireOwnerRequest(request, "asset.read");
    const { assetId } = await context.params;
    const { db } = await getDb();
    const detail = await getAssetDetail(db, assetId);

    if (!detail) {
      return NextResponse.json({ error: "Asset not found." }, { status: 404 });
    }

    const loc = detail.locations[0];
    if (!loc) {
      return NextResponse.json({ error: "Asset has no provider location." }, { status: 400 });
    }

    const conn = await getConnectionById(db, loc.providerConnectionId);
    if (!conn) {
      return NextResponse.json({ error: "Provider connection not found." }, { status: 404 });
    }

    const adapter = getProviderRegistry().require(conn.providerKey);
    if (!adapter.meta.capabilities.asyncProcessing || !adapter.getProcessingStatus) {
      return NextResponse.json({ error: "Provider does not support encoding status checks." }, { status: 400 });
    }

    const credentials = await decryptConnectionCredentials(conn);
    const status = await adapter.getProcessingStatus(credentials, loc.externalId);

    const now = new Date().toISOString();
    await db
      .update(assets)
      .set({
        canonicalStatus: status.canonicalStatus,
        updatedAt: now,
      })
      .where(eq(assets.id, assetId));

    // Complete any linked provider_processing jobs only when progress reaches 100% (TC-14)
    for (const job of detail.relatedJobs) {
      if (job.status === "provider_processing") {
        if (status.completed) {
          await transitionJob(db, job.id, {
            status: "completed",
            finished: true,
            nextPollAt: null,
            result: { assetId, externalId: loc.externalId, progressPercent: 100 },
            eventMessage: "Provider encoding reached 100%. Asset is now active.",
          });
        } else {
          await transitionJob(db, job.id, {
            status: "provider_processing",
            nextPollAt: new Date(Date.now() + 30_000).toISOString(),
            result: { assetId, externalId: loc.externalId, progressPercent: status.progressPercent },
            eventMessage: `Encoding progress: ${status.progressPercent}%.`,
          });
        }
      }
    }

    return NextResponse.json({ encoding: status });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
