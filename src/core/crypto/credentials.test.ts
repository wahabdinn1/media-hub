import { describe, expect, it } from "vitest";
import { decryptCredentials, encryptCredentials } from "./credentials";

describe("AES-GCM credential encryption (PRD 13.2)", () => {
  const masterKey = "test-master-secret-key-32-chars-minimum!!";

  it("encrypts and decrypts credentials cleanly with unique IVs", async () => {
    const first = await encryptCredentials({ apiKey: "vidara_fake_key_001" }, { masterKey });
    const second = await encryptCredentials({ apiKey: "vidara_fake_key_001" }, { masterKey });

    expect(first.ciphertext).not.toContain("vidara_fake_key_001");
    expect(first.ciphertext).not.toBe(second.ciphertext);

    const decoded = await decryptCredentials(first.ciphertext, { masterKey });
    expect(decoded).toEqual({ apiKey: "vidara_fake_key_001" });
  });

  it("fails decryption with wrong master key or tampered ciphertext", async () => {
    const { ciphertext } = await encryptCredentials({ apiKey: "secret_abc" }, { masterKey });

    await expect(
      decryptCredentials(ciphertext, { masterKey: "wrong-master-secret-key-32-chars-!!" }),
    ).rejects.toThrow();

    const tampered = `${ciphertext.slice(0, -2)}AA`;
    await expect(decryptCredentials(tampered, { masterKey })).rejects.toThrow();
  });
});
