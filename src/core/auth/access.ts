import { NextRequest } from "next/server";
import type { PermissionScope } from "@/shared";
import {
  assertScope,
  createOwnerPrincipal,
  type OwnerPrincipal,
} from "../permissions/guards";

export class AuthenticationError extends Error {
  readonly statusCode = 401;
  constructor(message: string) {
    super(message);
    this.name = "AuthenticationError";
  }
}

export class CsrfError extends Error {
  readonly statusCode = 403;
  constructor(message: string) {
    super(message);
    this.name = "CsrfError";
  }
}

interface AccessJwtPayload {
  aud?: string | string[];
  iss?: string;
  sub?: string;
  email?: string;
  exp?: number;
  nbf?: number;
}

interface JwkKey extends JsonWebKey {
  kid?: string;
}

const jwksCache = new Map<string, { keys: JwkKey[]; fetchedAt: number }>();
const JWKS_TTL_MS = 10 * 60 * 1000;

function base64UrlToUint8Array(input: string): Uint8Array {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(input.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function fetchTeamJwks(teamDomain: string): Promise<JwkKey[]> {
  const normalized = teamDomain.replace(/\/+$/, "");
  const cached = jwksCache.get(normalized);
  if (cached && Date.now() - cached.fetchedAt < JWKS_TTL_MS) {
    return cached.keys;
  }

  const res = await fetch(`${normalized}/cdn-cgi/access/certs`, {
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) {
    throw new AuthenticationError("Unable to fetch Cloudflare Access public keys.");
  }

  const data = (await res.json()) as { keys?: JwkKey[] };
  const keys = data.keys ?? [];
  jwksCache.set(normalized, { keys, fetchedAt: Date.now() });
  return keys;
}

export async function verifyCloudflareAccessJwt(
  token: string,
  config: { expectedAud: string; expectedIssuer: string; jwks?: JwkKey[] },
): Promise<OwnerPrincipal> {
  const segments = token.split(".");
  if (segments.length !== 3) {
    throw new AuthenticationError("Malformed Cloudflare Access JWT.");
  }

  const [headerB64, payloadB64, sigB64] = segments as [string, string, string];
  const header = JSON.parse(new TextDecoder().decode(base64UrlToUint8Array(headerB64))) as {
    alg?: string;
    kid?: string;
  };
  const payload = JSON.parse(
    new TextDecoder().decode(base64UrlToUint8Array(payloadB64)),
  ) as AccessJwtPayload;

  if (header.alg !== "RS256") {
    throw new AuthenticationError("Unsupported Access JWT algorithm.");
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp <= nowSec) {
    throw new AuthenticationError("Cloudflare Access JWT has expired.");
  }
  if (typeof payload.nbf === "number" && payload.nbf > nowSec + 60) {
    throw new AuthenticationError("Cloudflare Access JWT is not yet valid.");
  }

  const normalizedIssuer = config.expectedIssuer.replace(/\/+$/, "");
  const actualIssuer = (payload.iss ?? "").replace(/\/+$/, "");
  if (actualIssuer !== normalizedIssuer) {
    throw new AuthenticationError("Cloudflare Access JWT issuer mismatch.");
  }

  const audList = Array.isArray(payload.aud)
    ? payload.aud
    : typeof payload.aud === "string"
      ? [payload.aud]
      : [];
  if (!audList.includes(config.expectedAud)) {
    throw new AuthenticationError("Cloudflare Access JWT audience mismatch.");
  }

  const keys = config.jwks ?? (await fetchTeamJwks(normalizedIssuer));
  const matchingKey = keys.find((k) => !header.kid || k.kid === header.kid);
  if (!matchingKey) {
    throw new AuthenticationError("No matching Cloudflare Access signing key found.");
  }

  const cryptoKey = await crypto.subtle.importKey(
    "jwk",
    matchingKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );

  const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = base64UrlToUint8Array(sigB64);
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    signature as BufferSource,
    signingInput,
  );
  if (!valid) {
    throw new AuthenticationError("Invalid Cloudflare Access JWT signature.");
  }

  const actorId = payload.sub || payload.email;
  if (!actorId) {
    throw new AuthenticationError("Cloudflare Access JWT missing subject identity.");
  }
  return createOwnerPrincipal(actorId, payload.email ?? actorId);
}

function isLocalhostRequest(request: NextRequest): boolean {
  const host = (request.headers.get("host") ?? "").toLowerCase();
  return (
    host.startsWith("localhost:") ||
    host === "localhost" ||
    host.startsWith("127.0.0.1:") ||
    host === "127.0.0.1"
  );
}

export function assertSameOrigin(request: NextRequest): void {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return;
  }

  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (origin && host) {
    try {
      const originHost = new URL(origin).host.toLowerCase();
      if (originHost !== host.toLowerCase()) {
        throw new CsrfError("Cross-origin state-changing request rejected.");
      }
    } catch (err) {
      if (err instanceof CsrfError) throw err;
      throw new CsrfError("Malformed Origin header.");
    }
  }

  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite && secFetchSite !== "same-origin" && secFetchSite !== "none") {
    throw new CsrfError("Cross-site state-changing request rejected.");
  }
}

/**
 * Authenticates owner requests against Cloudflare Access (PRD 13.1, TC-06, TC-20).
 * Fails closed in production or whenever CF_ACCESS_AUD is set.
 * Localhost development without CF_ACCESS_AUD uses a local owner principal.
 */
export async function requireOwnerRequest(
  request: NextRequest,
  requiredScope: PermissionScope,
): Promise<OwnerPrincipal> {
  assertSameOrigin(request);

  const expectedAud = process.env.CF_ACCESS_AUD?.trim();
  const expectedIssuer = process.env.CF_ACCESS_TEAM_DOMAIN?.trim();

  if (expectedAud && expectedIssuer) {
    const token =
      request.headers.get("cf-access-jwt-assertion") ??
      request.cookies.get("CF_Authorization")?.value;
    if (!token) {
      throw new AuthenticationError("Cloudflare Access token is required.");
    }
    const principal = await verifyCloudflareAccessJwt(token, {
      expectedAud,
      expectedIssuer,
    });
    assertScope(principal, requiredScope);
    return principal;
  }

  if (
    process.env.MEDIAHUB_AUTH_MODE === "vercel-sso" &&
    process.env.VERCEL === "1" &&
    Boolean(request.headers.get("x-vercel-id"))
  ) {
    // Requires Vercel Deployment Protection (ssoProtection: "all") enabled on the project.
    const vercelPrincipal = createOwnerPrincipal("vercel-owner", "owner@vercel");
    assertScope(vercelPrincipal, requiredScope);
    return vercelPrincipal;
  }

  if (process.env.NODE_ENV !== "production" && isLocalhostRequest(request)) {
    const devPrincipal = createOwnerPrincipal("local-owner", "owner@localhost");
    assertScope(devPrincipal, requiredScope);
    return devPrincipal;
  }

  throw new AuthenticationError(
    "Cloudflare Access enforcement is required (CF_ACCESS_AUD and CF_ACCESS_TEAM_DOMAIN missing).",
  );
}
