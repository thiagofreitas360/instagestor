import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { resetEnvForTests } from "@/lib/env";
import { parseMetaSignedRequest } from "@/server/accounts";

const appSecret = "meta-test-app-secret-that-is-long-enough";

function signedRequest(payload: Record<string, unknown>, secret = appSecret) {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(encodedPayload).digest("base64url");
  return `${signature}.${encodedPayload}`;
}

function enableMetaEnvironment() {
  process.env.INSTAGRAM_PROVIDER = "meta";
  process.env.INSTAGRAM_APP_ID = "123456789";
  process.env.INSTAGRAM_APP_SECRET = appSecret;
  process.env.INSTAGRAM_REDIRECT_URI = "http://localhost:3000/api/instagram/oauth/callback";
  resetEnvForTests();
}

describe("parseMetaSignedRequest", () => {
  it("aceita uma assinatura HMAC-SHA256 autêntica e preserva o user_id app-scoped", () => {
    enableMetaEnvironment();
    const issuedAt = Math.floor(Date.now() / 1000);

    expect(
      parseMetaSignedRequest(signedRequest({ user_id: "app-scoped-42", algorithm: "HMAC-SHA256", issued_at: issuedAt })),
    ).toEqual({ user_id: "app-scoped-42", algorithm: "HMAC-SHA256", issued_at: issuedAt });
  });

  it("rejeita payload adulterado mesmo que continue sendo JSON válido", () => {
    enableMetaEnvironment();
    const original = signedRequest({ user_id: "conta-original", algorithm: "HMAC-SHA256" });
    const [signature] = original.split(".");
    const alteredPayload = Buffer.from(JSON.stringify({ user_id: "conta-invasora", algorithm: "HMAC-SHA256" })).toString(
      "base64url",
    );

    expect(() => parseMetaSignedRequest(`${signature}.${alteredPayload}`)).toThrow("Assinatura Meta");
  });

  it("rejeita segredo incorreto, formato incompleto e algoritmo não suportado", () => {
    enableMetaEnvironment();

    expect(() => parseMetaSignedRequest(signedRequest({ user_id: "42" }, "segredo-incorreto"))).toThrow("Assinatura Meta");
    expect(() => parseMetaSignedRequest("somente-uma-parte")).toThrow("signed_request");
    expect(() => parseMetaSignedRequest(signedRequest({ user_id: "42", algorithm: "HMAC-SHA1" }))).toThrow(
      "Algoritmo Meta",
    );
  });

  it("rejeita issued_at antigo e expires vencido", () => {
    enableMetaEnvironment();
    const now = Math.floor(Date.now() / 1000);

    expect(() => parseMetaSignedRequest(signedRequest({
      user_id: "42",
      algorithm: "HMAC-SHA256",
      issued_at: now - 86_401,
    }))).toThrow(/expirado/);
    expect(() => parseMetaSignedRequest(signedRequest({
      user_id: "42",
      algorithm: "HMAC-SHA256",
      issued_at: now - 600,
      expires: now - 301,
    }))).toThrow(/validade/);
  });
});
