import { redactUrl } from "@/shared";
import { checkUrlSafety } from "./url-validator";

const MAX_SUBTITLE_BYTES = 2 * 1024 * 1024; // 2 MiB
const SUBTITLE_EXT_PATTERN = /\.(srt|vtt)$/i;
const ACCEPTED_SUBTITLE_MIMES = new Set([
  "text/vtt",
  "text/srt",
  "application/x-subrip",
  "text/plain",
  "application/octet-stream",
]);

export interface SubtitleUrlValidationResult {
  valid: boolean;
  redactedUrl: string;
  detectedFormat?: "srt" | "vtt";
  contentType?: string;
  contentLength?: number;
  reason: string;
}

/**
 * SSRF-hardened validator for direct SRT/VTT subtitle URLs (PRD SUB-01, 13.3).
 */
export async function validateSubtitleUrl(
  rawUrl: string,
  expectedFormat?: "srt" | "vtt",
  fetchImpl: typeof fetch = fetch,
): Promise<SubtitleUrlValidationResult> {
  const safety = checkUrlSafety(rawUrl);
  const redacted = redactUrl(rawUrl.trim());
  if (!safety.ok) {
    return { valid: false, redactedUrl: redacted, reason: safety.reason };
  }

  let res: Response;
  try {
    res = await fetchImpl(safety.parsed.toString(), {
      method: "HEAD",
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (res.status === 405 || res.status === 501) {
      res = await fetchImpl(safety.parsed.toString(), {
        method: "GET",
        headers: { Range: "bytes=0-127" },
        redirect: "manual",
        cache: "no-store",
        signal: AbortSignal.timeout(8_000),
      });
    }
  } catch {
    return {
      valid: false,
      redactedUrl: redacted,
      reason: "Unable to reach the subtitle URL within timeout.",
    };
  }

  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get("location");
    if (loc) {
      const hopCheck = checkUrlSafety(new URL(loc, safety.parsed).toString());
      if (!hopCheck.ok) {
        return {
          valid: false,
          redactedUrl: redacted,
          reason: `Subtitle redirect target blocked: ${hopCheck.reason}`,
        };
      }
    }
  } else if (!res.ok && res.status !== 206) {
    return {
      valid: false,
      redactedUrl: redacted,
      reason: `Subtitle URL returned HTTP ${res.status}.`,
    };
  }

  const contentType =
    (res.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (contentType === "text/html" || contentType === "application/xhtml+xml") {
    return {
      valid: false,
      redactedUrl: redacted,
      contentType,
      reason: "Subtitle URL points to an HTML web page rather than a direct SRT or VTT file.",
    };
  }

  const lenHeader = res.headers.get("content-length");
  const contentLength = lenHeader && /^\d+$/.test(lenHeader) ? Number(lenHeader) : undefined;
  if (contentLength !== undefined && contentLength > MAX_SUBTITLE_BYTES) {
    return {
      valid: false,
      redactedUrl: redacted,
      contentType: contentType || undefined,
      contentLength,
      reason: "Subtitle file exceeds maximum allowed size (2 MiB).",
    };
  }

  const extMatch = safety.parsed.pathname.match(SUBTITLE_EXT_PATTERN);
  const extFormat = extMatch ? (extMatch[1]!.toLowerCase() as "srt" | "vtt") : undefined;
  const mimeFormat =
    contentType === "text/vtt"
      ? "vtt"
      : contentType === "application/x-subrip" || contentType === "text/srt"
        ? "srt"
        : undefined;

  const isAcceptedMime = !contentType || ACCEPTED_SUBTITLE_MIMES.has(contentType);
  if (!isAcceptedMime && !extFormat) {
    return {
      valid: false,
      redactedUrl: redacted,
      contentType,
      reason: `Unsupported subtitle content type "${contentType}". Provide a direct .srt or .vtt file.`,
    };
  }

  const detectedFormat = expectedFormat ?? extFormat ?? mimeFormat ?? "vtt";
  return {
    valid: true,
    redactedUrl: redacted,
    detectedFormat,
    contentType: contentType || (detectedFormat === "vtt" ? "text/vtt" : "application/x-subrip"),
    contentLength,
    reason: "Subtitle URL validated.",
  };
}
