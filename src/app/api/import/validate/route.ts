import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOwnerRequest, validateImportUrl } from "@/core";
import { toApiErrorResponse } from "@/lib/api-error";

const ValidateSchema = z.object({
  url: z.string().min(1).max(2048),
});

export async function POST(request: NextRequest) {
  try {
    await requireOwnerRequest(request, "job.create");
    const body = ValidateSchema.parse(await request.json());
    const result = await validateImportUrl(body.url);
    return NextResponse.json(result);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
