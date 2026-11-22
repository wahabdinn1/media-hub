import { redactUrl } from "@/shared";

export type UrlClassification =
  | "direct_video_candidate"
  | "web_page"
  | "inaccessible"
  | "unsupported_protocol"
  | "blocked_private_host"
  | "invalid_url";

export interface UrlValidationResult {
  valid: boolean;
  classification: UrlClassification;
  redactedUrl: string;
  sourceUrlHash: string | null;
  httpStatus?: number;
  contentType?: string;
  contentLength?: number;
  inferredTitle?: string;
  reason: string;
}

const MAX_REDIRECTS = 5;
const VIDEO_EXT_PATTERN = /\.(mp4|mkv|webm|mov|m4v|avi|ts|mpeg|mpg)$/i;

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 169 && b === 254) return true; // link-local / AWS & cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmark
  if (a >= 224) return true; // multicast & reserved
  return false;
}

function isBlockedHostname(rawHost: string): boolean {
  const host = rawHost.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, "");

  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "metadata.google.internal" ||
    host === "metadata" ||
    host === "0.0.0.0" ||
    host === "::" ||
    host === "::1"
  ) {
    return true;
  }

  // IPv4 literal (standard dotted decimal or single decimal/hex/octal integer)
  if (/^\d+(\.\d+){3}$/.test(host)) {
    return isPrivateIpv4(host);
  }
  if (/^(0x[0-9a-f]+|0[0-7]+|\d+)$/i.test(host)) {
    return true; // Reject obfuscated integer/octal/hex IP literals
  }

  // IPv6 literals: block loopback, link-local (fe80::/10), unique-local (fc00::/7), multicast (ff00::/8), IPv4-mapped
  if (host.includes(":")) {
    if (
      host.startsWith("fe8") ||
      host.startsWith("fe9") ||
      host.startsWith("fea") ||
      host.startsWith("feb") ||
      host.startsWith("fc") ||
      host.startsWith("fd") ||
      host.startsWith("ff") ||
      host === "::1" ||
      host === "::"
    ) {
      return true;
    }
    const v4Mapped = host.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    if (v4Mapped?.[1] && isPrivateIpv4(v4Mapped[1])) {
      return true;
    }
    // Block hex-encoded IPv4-mapped IPv6 (e.g. ::ffff:7f00:1)
    if (host.startsWith("::ffff:")) {
      return true;
    }
  }

  return false;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function inferTitleFromUrl(parsed: URL): string {
  const seg = parsed.pathname.split("/").filter(Boolean).pop();
  if (!seg) return "Imported video";
  try {
    return decodeURIComponent(seg).replace(/\.[a-z0-9]{2,5}$/i, "").slice(0, 200) || "Imported video";
  } catch {
    return seg.slice(0, 200);
  }
}

export function checkUrlSafety(rawUrl: string):
  | { ok: true; parsed: URL }
  | { ok: false; classification: UrlClassification; reason: string } {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return {
      ok: false,
      classification: "invalid_url",
      reason: "Enter a valid absolute HTTP or HTTPS URL.",
    };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      ok: false,
      classification: "unsupported_protocol",
      reason: `Protocol "${parsed.protocol}" is not permitted. Only http:// and https:// URLs are allowed.`,
    };
  }

  if (parsed.username || parsed.password) {
    return {
      ok: false,
      classification: "invalid_url",
      reason: "URLs with embedded credentials are not accepted.",
    };
  }

  if (isBlockedHostname(parsed.hostname)) {
    return {
      ok: false,
      classification: "blocked_private_host",
      reason: "Loopback, private network, link-local, and metadata addresses are blocked.",
    };
  }

  return { ok: true, parsed };
}

/**
 * Validates and classifies an import URL before any job is created (PRD UP-02, 13.3, TC-01, TC-09).
 * Performs at most one bounded HEAD (or Range GET fallback) per hop with manual redirect validation.
 */
export async function validateImportUrl(
  rawUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<UrlValidationResult> {
  const initialCheck = checkUrlSafety(rawUrl);
  const redacted = redactUrl(rawUrl.trim());
  if (!initialCheck.ok) {
    return {
      valid: false,
      classification: initialCheck.classification,
      redactedUrl: redacted,
      sourceUrlHash: null,
      reason: initialCheck.reason,
    };
  }

  let currentUrl = initialCheck.parsed;
  const sourceUrlHash = await sha256Hex(currentUrl.toString());

  let response: Response | null = null;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    try {
      let res = await fetchImpl(currentUrl.toString(), {
        method: "HEAD",
        redirect: "manual",
        cache: "no-store",
        signal: AbortSignal.timeout(8_000),
      });

      if (res.status === 405 || res.status === 501) {
        res = await fetchImpl(currentUrl.toString(), {
          method: "GET",
          headers: { Range: "bytes=0-0" },
          redirect: "manual",
          cache: "no-store",
          signal: AbortSignal.timeout(8_000),
        });
      }

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) {
          return {
            valid: false,
            classification: "inaccessible",
            redactedUrl: redactUrl(currentUrl.toString()),
            sourceUrlHash,
            httpStatus: res.status,
            reason: "Redirect response missing Location header.",
          };
        }
        if (hop === MAX_REDIRECTS) {
          return {
            valid: false,
            classification: "inaccessible",
            redactedUrl: redactUrl(currentUrl.toString()),
            sourceUrlHash,
            httpStatus: res.status,
            reason: `Exceeded maximum redirect limit (${MAX_REDIRECTS}).`,
          };
        }

        const nextUrl = new URL(location, currentUrl).toString();
        const hopCheck = checkUrlSafety(nextUrl);
        if (!hopCheck.ok) {
          return {
            valid: false,
            classification: hopCheck.classification,
            redactedUrl: redactUrl(nextUrl),
            sourceUrlHash,
            reason: `Redirect target blocked: ${hopCheck.reason}`,
          };
        }
        currentUrl = hopCheck.parsed;
        continue;
      }

      response = res;
      break;
    } catch {
      return {
        valid: false,
        classification: "inaccessible",
        redactedUrl: redactUrl(currentUrl.toString()),
        sourceUrlHash,
        reason: "Unable to reach the source URL within the timeout window.",
      };
    }
  }

  if (!response) {
    return {
      valid: false,
      classification: "inaccessible",
      redactedUrl: redactUrl(currentUrl.toString()),
      sourceUrlHash,
      reason: "Could not resolve source URL.",
    };
  }

  const contentTypeRaw = response.headers.get("content-type") ?? "";
  const contentType = contentTypeRaw.split(";")[0]?.trim().toLowerCase() ?? "";
  const contentLengthHeader = response.headers.get("content-length");
  const contentRangeHeader = response.headers.get("content-range");
  let contentLength: number | undefined;
  if (contentRangeHeader) {
    const totalMatch = contentRangeHeader.match(/\/(\d+)$/);
    if (totalMatch?.[1]) contentLength = Number(totalMatch[1]);
  } else if (contentLengthHeader && /^\d+$/.test(contentLengthHeader)) {
    contentLength = Number(contentLengthHeader);
  }

  if (!response.ok && response.status !== 206) {
    return {
      valid: false,
      classification: "inaccessible",
      redactedUrl: redactUrl(currentUrl.toString()),
      sourceUrlHash,
      httpStatus: response.status,
      contentType: contentType || undefined,
      reason: `Source URL returned HTTP ${response.status}.`,
    };
  }

  if (
    contentType === "text/html" ||
    contentType === "application/xhtml+xml" ||
    contentType.startsWith("text/")
  ) {
    return {
      valid: false,
      classification: "web_page",
      redactedUrl: redactUrl(currentUrl.toString()),
      sourceUrlHash,
      httpStatus: response.status,
      contentType,
      reason:
        "This URL points to a web page, not a direct video file. MediaHub does not scrape player pages.",
    };
  }

  const isVideoMime = contentType.startsWith("video/");
  const isBinaryVideoPath =
    (contentType === "application/octet-stream" || contentType === "binary/octet-stream" || !contentType) &&
    VIDEO_EXT_PATTERN.test(currentUrl.pathname);

  if (isVideoMime || isBinaryVideoPath) {
    return {
      valid: true,
      classification: "direct_video_candidate",
      redactedUrl: redactUrl(currentUrl.toString()),
      sourceUrlHash,
      httpStatus: response.status,
      contentType: contentType || "video/mp4",
      contentLength,
      inferredTitle: inferTitleFromUrl(currentUrl),
      reason: "Direct video file verified and ready for provider import.",
    };
  }

  return {
    valid: false,
    classification: "web_page",
    redactedUrl: redactUrl(currentUrl.toString()),
    sourceUrlHash,
    httpStatus: response.status,
    contentType: contentType || undefined,
    reason: `Unsupported content type "${contentType || "unknown"}". Provide a direct video file URL.`,
  };
}
