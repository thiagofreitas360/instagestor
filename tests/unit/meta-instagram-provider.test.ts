import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvForTests } from "@/lib/env";
import { MetaInstagramProvider } from "@/providers/meta-instagram";

function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function fetchMock(...responses: Response[]) {
  const mock = vi.fn<typeof fetch>();
  for (const response of responses) mock.mockResolvedValueOnce(response);
  vi.stubGlobal("fetch", mock);
  return mock;
}

beforeEach(() => {
  process.env.INSTAGRAM_PROVIDER = "meta";
  process.env.INSTAGRAM_APP_ID = "app-123";
  process.env.INSTAGRAM_APP_SECRET = "meta-provider-test-secret";
  process.env.INSTAGRAM_REDIRECT_URI = "http://localhost:3000/api/instagram/oauth/callback";
  process.env.META_API_VERSION = "v26.0";
  resetEnvForTests();
});

describe("MetaInstagramProvider OAuth e ciclo do token", () => {
  it("gera URL OAuth com state, permissões mínimas e reautenticação explícita", () => {
    const url = new URL(new MetaInstagramProvider().authorizationUrl("nonce-imprevisivel"));

    expect(url.origin + url.pathname).toBe("https://www.instagram.com/oauth/authorize");
    expect(url.searchParams.get("state")).toBe("nonce-imprevisivel");
    expect(url.searchParams.get("scope")).toBe("instagram_business_basic,instagram_business_content_publish");
    expect(url.searchParams.get("force_reauth")).toBe("true");
    expect(url.searchParams.get("redirect_uri")).toBe(process.env.INSTAGRAM_REDIRECT_URI);
  });

  it("troca o código curto e depois o token longo sem expor segredo na query da primeira chamada", async () => {
    const mockedFetch = fetchMock(
      jsonResponse({ data: [{
        access_token: "curto",
        user_id: "app-scoped-7",
        permissions: ["instagram_business_basic", "instagram_business_content_publish"],
      }] }),
      jsonResponse({ access_token: "longo", expires_in: 5_184_000 }),
    );

    await expect(new MetaInstagramProvider().exchangeAuthorizationCode("codigo-unico")).resolves.toEqual({
      appScopedUserId: "app-scoped-7",
      accessToken: "longo",
      expiresIn: 5_184_000,
    });

    const [exchangeUrl, exchangeInit] = mockedFetch.mock.calls[0];
    expect(exchangeUrl).toBe("https://api.instagram.com/oauth/access_token");
    expect(exchangeInit?.method).toBe("POST");
    expect(exchangeInit?.body).toBeInstanceOf(FormData);
    expect((exchangeInit?.body as FormData).get("code")).toBe("codigo-unico");
    expect((exchangeInit?.body as FormData).get("client_secret")).toBe(process.env.INSTAGRAM_APP_SECRET);

    const longLivedUrl = new URL(String(mockedFetch.mock.calls[1][0]));
    expect(longLivedUrl.pathname).toBe("/access_token");
    expect(longLivedUrl.searchParams.get("grant_type")).toBe("ig_exchange_token");
    expect(longLivedUrl.searchParams.get("access_token")).toBe("curto");
  });

  it("recusa conexão quando a Meta não confirma os dois escopos obrigatórios", async () => {
    fetchMock(jsonResponse({ data: [{
      access_token: "curto",
      user_id: "app-scoped-7",
      permissions: ["instagram_business_basic"],
    }] }));

    await expect(new MetaInstagramProvider().exchangeAuthorizationCode("codigo-sem-publish"))
      .rejects.toMatchObject({ kind: "AUTH", code: "OAUTH_PERMISSIONS_MISSING" });
  });

  it("renova token longo pelo endpoint correto e retorna a validade informada", async () => {
    const mockedFetch = fetchMock(jsonResponse({ access_token: "token-renovado", expires_in: 5_000_000 }));

    await expect(new MetaInstagramProvider().refreshAccessToken("token-antigo")).resolves.toEqual({
      accessToken: "token-renovado",
      expiresIn: 5_000_000,
    });

    const url = new URL(String(mockedFetch.mock.calls[0][0]));
    expect(url.origin + url.pathname).toBe("https://graph.instagram.com/refresh_access_token");
    expect(url.searchParams.get("grant_type")).toBe("ig_refresh_token");
    expect(url.searchParams.get("access_token")).toBe("token-antigo");
  });
});

describe("MetaInstagramProvider publicação, limite e falhas", () => {
  it("usa o limite dinâmico retornado pela Meta e bloqueia schema sem quota total", async () => {
    const mockedFetch = fetchMock(
      jsonResponse({ data: [{ quota_usage: 17, config: { quota_total: 50 } }] }),
      jsonResponse({ data: [{ quota_usage: 4 }] }),
    );
    const provider = new MetaInstagramProvider();

    await expect(provider.getPublishingLimit("ig-1", "token")).resolves.toEqual({ usage: 17, total: 50 });
    await expect(provider.getPublishingLimit("ig-1", "token")).rejects.toMatchObject({
      kind: "RATE_LIMIT",
      code: "PUBLISHING_LIMIT_SCHEMA",
      retryAfterSeconds: 3600,
    });

    expect(new URL(String(mockedFetch.mock.calls[0][0])).pathname).toBe("/v26.0/ig-1/content_publishing_limit");
  });

  it.each([
    [401, { error: { message: "expired", code: 190 } }, "AUTH", "META_190"],
    [403, { error: { message: "forbidden", code: 10 } }, "AUTH", "META_10"],
    [429, { error: { message: "slow down", code: 4 } }, "RATE_LIMIT", "META_4"],
    [500, { error: { message: "temporary", code: 2 } }, "TRANSIENT", "META_2"],
    [400, { error: { message: "invalid", code: 100 } }, "VALIDATION", "META_100"],
  ] as const)("classifica HTTP %i como %s", async (status, body, kind, code) => {
    fetchMock(jsonResponse(body, status, status === 429 ? { "retry-after": "45" } : undefined));

    await expect(new MetaInstagramProvider().getProfile("token")).rejects.toMatchObject({ kind, code });
  });

  it("preserva Retry-After em rate limit", async () => {
    fetchMock(jsonResponse({ error: { message: "slow down", code: 4 } }, 429, { "retry-after": "45" }));

    await expect(new MetaInstagramProvider().getPublishingLimit("ig-1", "token")).rejects.toMatchObject({
      kind: "RATE_LIMIT",
      retryAfterSeconds: 45,
    });
  });

  it("converte timeout ou erro transitório de media_publish em resultado ambíguo", async () => {
    fetchMock(jsonResponse({ error: { message: "upstream", code: 2, is_transient: true } }, 503));

    await expect(new MetaInstagramProvider().publishContainer("ig-1", "container-1", "token")).rejects.toMatchObject({
      kind: "AMBIGUOUS",
      code: "META_PUBLISH_AMBIGUOUS",
    });
  });

  it("não converte rejeição de validação de media_publish em ambígua", async () => {
    fetchMock(jsonResponse({ error: { message: "invalid container", code: 100 } }, 400));

    await expect(new MetaInstagramProvider().publishContainer("ig-1", "container-1", "token")).rejects.toMatchObject({
      kind: "VALIDATION",
      code: "META_100",
    });
  });

  it("monta carousel somente com filhos e não aceita carousel vazio", async () => {
    const provider = new MetaInstagramProvider();
    await expect(
      provider.createMediaContainer({
        accountId: "ig-1",
        accessToken: "token",
        publicationType: "CAROUSEL",
        mediaUrls: [],
        children: [],
      }),
    ).rejects.toMatchObject({ kind: "VALIDATION", code: "CAROUSEL_CHILDREN_MISSING" });

    const mockedFetch = fetchMock(jsonResponse({ id: "parent-container" }));
    await expect(
      provider.createMediaContainer({
        accountId: "ig-1",
        accessToken: "token",
        publicationType: "CAROUSEL",
        mediaUrls: [],
        children: ["child-1", "child-2"],
        caption: "Legenda",
      }),
    ).resolves.toBe("parent-container");

    const requestBody = mockedFetch.mock.calls[0][1]?.body as URLSearchParams;
    expect(requestBody.get("media_type")).toBe("CAROUSEL");
    expect(requestBody.get("children")).toBe("child-1,child-2");
    expect(requestBody.get("caption")).toBe("Legenda");
  });
});
