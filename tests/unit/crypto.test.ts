import { describe, expect, it, vi } from "vitest";
import { decryptToken, encryptToken } from "@/lib/crypto";
import { resetEnvForTests } from "@/lib/env";

function changeBase64UrlCharacter(value: string) {
  return `${value[0] === "A" ? "B" : "A"}${value.slice(1)}`;
}

describe("criptografia de tokens", () => {
  it("faz round-trip com AES-256-GCM e usa IVs únicos", () => {
    const plaintext = "EAAB-token-confidencial";

    const first = encryptToken(plaintext);
    const second = encryptToken(plaintext);
    const [version, iv, tag, ciphertext] = first.split(".");

    expect(version).toBe("v1");
    expect(Buffer.from(iv, "base64url")).toHaveLength(12);
    expect(Buffer.from(tag, "base64url")).toHaveLength(16);
    expect(ciphertext).not.toContain(plaintext);
    expect(first).not.toBe(second);
    expect(decryptToken(first)).toBe(plaintext);
    expect(decryptToken(second)).toBe(plaintext);
  });

  it("rejeita alteração da tag de autenticação", () => {
    const parts = encryptToken("token-original").split(".");
    parts[2] = changeBase64UrlCharacter(parts[2]);

    expect(() => decryptToken(parts.join("."))).toThrow();
  });

  it("rejeita alteração do ciphertext", () => {
    const parts = encryptToken("token-original").split(".");
    parts[3] = changeBase64UrlCharacter(parts[3]);

    expect(() => decryptToken(parts.join("."))).toThrow();
  });

  it("rejeita chave que não possui exatamente 256 bits", () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", Buffer.alloc(16).toString("base64"));
    resetEnvForTests();

    expect(() => encryptToken("token-original")).toThrow(/32 bytes/);
  });
});
