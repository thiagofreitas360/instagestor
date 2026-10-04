import { describe, expect, it } from "vitest";
import { InstagramError } from "@/lib/errors";
import {
  OAUTH_MESSAGE_TYPE,
  OauthFlowError,
  oauthFallbackUrl,
  oauthResultFromError,
  parseOauthMessage,
  parseOauthResult,
} from "@/lib/oauth-result";

describe("resultado do OAuth em popup", () => {
  it("aceita somente mensagens com tipo e resultado conhecidos", () => {
    expect(parseOauthMessage({ type: OAUTH_MESSAGE_TYPE, result: "success" })).toBe("success");
    expect(parseOauthMessage({ type: OAUTH_MESSAGE_TYPE, result: "wrong_reconnect_account" })).toBe("wrong_reconnect_account");
    expect(parseOauthMessage({ type: "outro", result: "success" })).toBeNull();
    expect(parseOauthMessage({ type: OAUTH_MESSAGE_TYPE, result: "<script>" })).toBeNull();
    expect(parseOauthMessage({ type: OAUTH_MESSAGE_TYPE, result: "success", token: "x" })).toBeNull();
    expect(parseOauthMessage("success")).toBeNull();
    expect(parseOauthMessage(null)).toBeNull();
    expect(parseOauthMessage([OAUTH_MESSAGE_TYPE, "success"])).toBeNull();
  });

  it("valida o código recebido pela página de conclusão", () => {
    expect(parseOauthResult("cancelled")).toBe("cancelled");
    expect(parseOauthResult("access_token")).toBeNull();
    expect(parseOauthResult(undefined)).toBeNull();
  });

  it("converte erros em códigos sanitizados sem repassar mensagens da Meta", () => {
    expect(oauthResultFromError(new OauthFlowError("state_expired", "detalhe interno"))).toBe("state_expired");
    expect(oauthResultFromError(new InstagramError("x", "AUTH", "OAUTH_PERMISSIONS_MISSING"))).toBe("permissions_missing");
    expect(oauthResultFromError(new InstagramError("x", "TRANSIENT", "META_TIMEOUT"))).toBe("provider_unavailable");
    expect(oauthResultFromError(new InstagramError("x", "RATE_LIMIT", "META_RATE"))).toBe("provider_unavailable");
    expect(oauthResultFromError(new InstagramError("token inválido", "AUTH", "META_190"))).toBe("connection_failed");
    expect(oauthResultFromError(new Error("payload bruto"))).toBe("connection_failed");
  });

  it("monta o fallback da mesma aba com mensagem fixa", () => {
    expect(oauthFallbackUrl("success")).toMatch(/^\/contas\?ok=/);
    expect(oauthFallbackUrl("cancelled")).toMatch(/^\/contas\?erro=/);
  });
});
