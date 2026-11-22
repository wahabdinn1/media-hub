import { describe, expect, it } from "vitest";
import { AuthenticationError, verifyCloudflareAccessJwt } from "./access";

function toBase64Url(input: Uint8Array | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function createSignedJwt(
  payload: Record<string, unknown>,
  privateKey: CryptoKey,
  kid = "test-kid-1",
): Promise<string> {
  const headerB64 = toBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT", kid }));
  const payloadB64 = toBase64Url(JSON.stringify(payload));
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      privateKey,
      new TextEncoder().encode(`${headerB64}.${payloadB64}`),
    ),
  );
  return `${headerB64}.${payloadB64}.${toBase64Url(sig)}`;
}

describe("Cloudflare Access JWT validation (PRD 13.1, TC-06, TC-20)", () => {
  it("accepts a validly signed JWT matching aud, iss, and exp", async () => {
    const keyPair = await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"],
    );
    const pubJwk = { ...(await crypto.subtle.exportKey("jwk", keyPair.publicKey)), kid: "test-kid-1" };

    const token = await createSignedJwt(
      {
        aud: ["aud-mediahub-prod"],
        iss: "https://myteam.cloudflareaccess.com",
        sub: "owner-sub-1",
        email: "owner@example.com",
        exp: Math.floor(Date.now() / 1000) + 300,
      },
      keyPair.privateKey,
    );

    const principal = await verifyCloudflareAccessJwt(token, {
      expectedAud: "aud-mediahub-prod",
      expectedIssuer: "https://myteam.cloudflareaccess.com",
      jwks: [pubJwk],
    });
    expect(principal.actorId).toBe("owner-sub-1");
    expect(principal.email).toBe("owner@example.com");
  });

  it("rejects JWT with wrong audience tag (TC-20)", async () => {
    const keyPair = await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"],
    );
    const pubJwk = { ...(await crypto.subtle.exportKey("jwk", keyPair.publicKey)), kid: "test-kid-1" };

    const token = await createSignedJwt(
      {
        aud: ["wrong-aud-tag"],
        iss: "https://myteam.cloudflareaccess.com",
        sub: "owner-sub-1",
        exp: Math.floor(Date.now() / 1000) + 300,
      },
      keyPair.privateKey,
    );

    await expect(
      verifyCloudflareAccessJwt(token, {
        expectedAud: "aud-mediahub-prod",
        expectedIssuer: "https://myteam.cloudflareaccess.com",
        jwks: [pubJwk],
      }),
    ).rejects.toThrow(AuthenticationError);
  });
});
