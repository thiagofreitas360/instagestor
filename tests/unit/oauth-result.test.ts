import { describe, expect, it } from "vitest";
import { InstagramError } from "@/lib/errors";
import { OauthFlowError, oauthFallbackUrl, oauthResultFromError } from "@/lib/oauth-result";

describe("resultado do OAuth", () => {
  it("converte erros em códigos sanitizados sem repassar mensagens da Meta", () => {
    expect(oauthResultFromError(new OauthFlowError("state_expired", "detalhe interno"))).toBe("state_expired");
    expect(oauthResultFromError(new InstagramError("x", "AUTH", "OAUTH_PERMISSIONS_MISSING"))).toBe("permissions_missing");
    expect(oauthResultFromError(new InstagramError("x", "TRANSIENT", "META_TIMEOUT"))).toBe("provider_unavailable");
    expect(oauthResultFromError(new InstagramError("x", "RATE_LIMIT", "META_RATE"))).toBe("provider_unavailable");
    expect(oauthResultFromError(new InstagramError("token inválido", "AUTH", "META_190"))).toBe("connection_failed");
    expect(oauthResultFromError(new Error("payload bruto"))).toBe("connection_failed");
  });

  it("volta para /contas com mensagem fixa", () => {
    expect(oauthFallbackUrl("success")).toMatch(/^\/contas\?ok=/);
    expect(oauthFallbackUrl("cancelled")).toMatch(/^\/contas\?erro=/);
  });
});
