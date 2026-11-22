import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireOwnerRequest } from "@/core";
import { getDb } from "@/db/client";
import { assetLocations, assets } from "@/db/schema";
import { recordActivity } from "@/db/repositories/activity";
import { registerImportedAsset } from "@/db/repositories/assets";
import { getJobWithEvents, transitionJob } from "@/db/repositories/jobs";
import { decryptConnectionCredentials, getConnectionById } from "@/db/repositories/providers";
import { toApiErrorResponse } from "@/lib/api-error";
import { getProviderRegistry } from "@/lib/registry";

/**
 * Polls encoding status for `provider_processing` jobs (TC-14)
 * or reconciles `unknown` jobs before allowing retry (TC-04, TC-12).
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ jobId: string }> },
) {
  try {
    const principal = await requireOwnerRequest(request, "job.manage");
    const { jobId } = await context.params;
    const { db } = await getDb();
    const record = await getJobWithEvents(db, jobId);
    if (!record) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }

    const { job } = record;
    if (!job.providerConnectionId) {
      return NextResponse.json({ error: "Job has no provider connection." }, { status: 400 });
    }

    const conn = await getConnectionById(db, job.providerConnectionId);
    if (!conn) {
      return NextResponse.json({ error: "Provider connection no longer exists." }, { status: 404 });
    }

    const adapter = getProviderRegistry().require(conn.providerKey);
    const credentials = await decryptConnectionCredentials(conn);

    if (job.status === "provider_processing") {
      const result = JSON.parse(job.resultJson ?? "{}") as {
        assetId?: string;
        externalId?: string;
      };
      if (!result.externalId || !adapter.getProcessingStatus) {
        return NextResponse.json({ error: "Unable to poll processing status for this job." }, { status: 400 });
      }

      const encoding = await adapter.getProcessingStatus(credentials, result.externalId);
      if (result.assetId) {
        await db
          .update(assets)
          .set({
            canonicalStatus: encoding.canonicalStatus,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(assets.id, result.assetId));
      }

      const updated = await transitionJob(db, job.id, {
        status: encoding.completed ? "completed" : "provider_processing",
        finished: encoding.completed,
        nextPollAt: encoding.completed ? null : new Date(Date.now() + 30_000).toISOString(),
        result: { ...result, progressPercent: encoding.progressPercent },
        eventMessage: encoding.completed
          ? "Encoding reached 100%. Job completed."
          : `Encoding still in progress (${encoding.progressPercent}%).`,
      });

      return NextResponse.json({ job: updated, encoding });
    }

    if (job.status === "unknown") {
      const payload = JSON.parse(job.payloadJson ?? "{}") as { title?: string };
      const existingLocs = await db
        .select({ externalId: assetLocations.externalId })
        .from(assetLocations)
        .where(eq(assetLocations.providerConnectionId, conn.id));

      const outcome = await adapter.reconcile(credentials, {
        jobId: job.id,
        jobType: job.jobType,
        expectedTitle: payload.title,
        knownExternalIds: existingLocs.map((l) => l.externalId),
        startedAt: job.startedAt ?? job.createdAt,
      });

      if (outcome.resolved && outcome.externalId) {
        const reg = await registerImportedAsset(db, {
          connectionId: conn.id,
          externalId: outcome.externalId,
          title: payload.title ?? "Reconciled asset",
          canonicalStatus: "active",
          providerMetadata: { reconciledFromJobId: job.id },
        });
        const updated = await transitionJob(db, job.id, {
          status: "completed",
          finished: true,
          errorCode: null,
          result: { assetId: reg.assetId, externalId: outcome.externalId, reconciled: true },
          eventMessage: outcome.reason,
        });
        await recordActivity(db, {
          actorId: principal.actorId,
          action: "job.reconciled",
          entityType: "job",
          entityId: job.id,
          context: { resolved: true, assetId: reg.assetId },
        });
        return NextResponse.json({ job: updated, outcome });
      }

      const updated = await transitionJob(db, job.id, {
        status: "unknown",
        eventMessage: outcome.reason,
      });
      return NextResponse.json({ job: updated, outcome });
    }

    return NextResponse.json(
      { error: `Job in status "${job.status}" does not require polling or reconciliation.` },
      { status: 400 },
    );
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
