import { R2_ITEM_CAPS, redactUrl } from "@/shared";
import { checkUrlSafety } from "./url-validator";

const ACCEPTED_THUMBNAIL_MIMES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
]);

const IMAGE_EXT_PATTERN = /\.(jpe?g|png|gif|webp)$/i;

export interface ThumbnailUrlValidationResult {
  valid: boolean;
  redactedUrl: string;
  contentType?: string;
  contentLength?: number;
  reason: string;
}

/**
 * Validates an authorized direct thumbnail image URL (PRD TH-02, 13.3).
 * Enforces HTTP/HTTPS only, SSRF private-host blocking, image MIME, and <= 5 MiB cap.
 */
export async function validateThumbnailUrl(
  rawUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ThumbnailUrlValidationResult> {
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
        headers: { Range: "bytes=0-0" },
        redirect: "manual",
        cache: "no-store",
        signal: AbortSignal.timeout(8_000),
      });
    }
  } catch {
    return {
      valid: false,
      redactedUrl: redacted,
      reason: "Unable to reach the thumbnail URL within timeout.",
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
          reason: `Thumbnail redirect target blocked: ${hopCheck.reason}`,
        };
      }
    }
  } else if (!res.ok && res.status !== 206) {
    return {
      valid: false,
      redactedUrl: redacted,
      reason: `Thumbnail URL returned HTTP ${res.status}.`,
    };
  }

  const contentType = (res.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  const lenHeader = res.headers.get("content-length");
  const contentLength = lenHeader && /^\d+$/.test(lenHeader) ? Number(lenHeader) : undefined;

  if (contentLength !== undefined && contentLength > R2_ITEM_CAPS.maxCustomThumbnailBytes) {
    return {
      valid: false,
      redactedUrl: redacted,
      contentType: contentType || undefined,
      contentLength,
      reason: `Thumbnail exceeds maximum allowed size (${R2_ITEM_CAPS.maxCustomThumbnailBytes} bytes / 5 MiB).`,
    };
  }

  const isAcceptedMime = ACCEPTED_THUMBNAIL_MIMES.has(contentType);
  const isAcceptedExt = !contentType && IMAGE_EXT_PATTERN.test(safety.parsed.pathname);

  if (!isAcceptedMime && !isAcceptedExt) {
    return {
      valid: false,
      redactedUrl: redacted,
      contentType: contentType || undefined,
      reason: `Unsupported thumbnail format "${contentType || "unknown"}". Use JPG, PNG, GIF, or WebP.`,
    };
  }

  return {
    valid: true,
    redactedUrl: redacted,
    contentType: contentType || "image/jpeg",
    contentLength,
    reason: "Thumbnail image URL validated.",
  };
}
