/**
 * AES-GCM credential encryption using Web Crypto API (PRD 13.2).
 * Works identically on Cloudflare Workers and Node.js 20+.
 * Master key comes from MEDIAHUB_MASTER_KEY (Worker Secret / .env.local).
 */

const ENVELOPE_PREFIX = "mh_v1";

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function deriveAesKey(masterSecret: string): Promise<CryptoKey> {
  if (!masterSecret || masterSecret.trim().length < 16) {
    throw new Error(
      "MEDIAHUB_MASTER_KEY must be configured with at least 16 characters to encrypt credentials.",
    );
  }
  const secretBytes = new TextEncoder().encode(masterSecret);
  const hash = await crypto.subtle.digest("SHA-256", secretBytes);
  return crypto.subtle.importKey("raw", hash, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export function resolveMasterKey(explicitKey?: string): string {
  const key = explicitKey ?? process.env.MEDIAHUB_MASTER_KEY;
  if (key && key.trim().length >= 16) {
    return key.trim();
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("MEDIAHUB_MASTER_KEY Worker Secret is required in production.");
  }
  // Local dev fallback only when .env.local has not yet been initialized.
  return "mediahub-local-dev-only-key-replace-in-env-local";
}

export async function encryptCredentials(
  payload: Record<string, string>,
  options?: { masterKey?: string; keyVersion?: number },
): Promise<{ ciphertext: string; keyVersion: number }> {
  const keyVersion = options?.keyVersion ?? 1;
  const aesKey = await deriveAesKey(resolveMasterKey(options?.masterKey));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(JSON.stringify(payload));

  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, encoded),
  );

  return {
    keyVersion,
    ciphertext: `${ENVELOPE_PREFIX}:${keyVersion}:${toBase64(iv)}:${toBase64(encrypted)}`,
  };
}

export async function decryptCredentials(
  ciphertext: string,
  options?: { masterKey?: string },
): Promise<Record<string, string>> {
  const parts = ciphertext.split(":");
  if (parts.length !== 4 || parts[0] !== ENVELOPE_PREFIX) {
    throw new Error("Invalid encrypted credential envelope format.");
  }

  const iv = fromBase64(parts[2]!);
  const encrypted = fromBase64(parts[3]!);
  const aesKey = await deriveAesKey(resolveMasterKey(options?.masterKey));

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    aesKey,
    encrypted as BufferSource,
  );
  const parsed = JSON.parse(new TextDecoder().decode(decrypted)) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Decrypted credential payload is malformed.");
  }
  return parsed as Record<string, string>;
}
