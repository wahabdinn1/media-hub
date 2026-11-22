import { NextRequest, NextResponse } from "next/server";
import { formatBatchResultsCsv, requireOwnerRequest } from "@/core";
import { getDb } from "@/db/client";
import { getBatchDetail } from "@/db/repositories/batches";
import { toApiErrorResponse } from "@/lib/api-error";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ batchId: string }> },
) {
  try {
    await requireOwnerRequest(request, "job.manage");
    const { batchId } = await context.params;
    const { searchParams } = new URL(request.url);
    const format = searchParams.get("format");

    const { db } = await getDb();
    const detail = await getBatchDetail(db, batchId);
    if (!detail) {
      return NextResponse.json({ error: "Batch not found." }, { status: 404 });
    }

    if (format === "csv") {
      const csv = formatBatchResultsCsv(
        detail.jobs.map((j) => {
          let payload: { title?: string; redactedUrl?: string } = {};
          let result: { assetId?: string } = {};
          try {
            payload = JSON.parse(j.payloadJson) as { title?: string; redactedUrl?: string };
          } catch {}
          try {
            result = j.resultJson ? (JSON.parse(j.resultJson) as { assetId?: string }) : {};
          } catch {}

          return {
            jobId: j.id,
            status: j.status,
            title: payload.title ?? "",
            assetId: result.assetId ?? "",
            errorCode: j.errorCode ?? "",
            redactedUrl: payload.redactedUrl ?? "",
          };
        }),
      );

      return new NextResponse(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="mediahub-batch-${batchId.slice(0, 8)}.csv"`,
        },
      });
    }

    return NextResponse.json(detail);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
