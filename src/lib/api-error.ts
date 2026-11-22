import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthenticationError, AuthorizationError, CsrfError } from "@/core";

export function toApiErrorResponse(err: unknown): NextResponse {
  if (
    err instanceof AuthenticationError ||
    err instanceof AuthorizationError ||
    err instanceof CsrfError
  ) {
    return NextResponse.json({ error: err.message }, { status: err.statusCode });
  }
  if (err instanceof z.ZodError) {
    return NextResponse.json(
      { error: "Invalid request payload.", issues: err.issues },
      { status: 400 },
    );
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
