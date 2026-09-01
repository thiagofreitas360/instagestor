import { describe, expect, it } from "vitest";
import { FakeInstagramProvider } from "@/providers/fake-instagram";

const input = {
  accountId: "fake-account-1",
  accessToken: "fake-token:1001:loja_teste",
  publicationType: "FEED_IMAGE" as const,
  mediaUrls: ["https://storage.test/image.jpg"],
};

describe("FakeInstagramProvider resiliência", () => {
  it("renova o token de modo estável sem acumular sufixos", async () => {
    const provider = new FakeInstagramProvider("success");
    const first = await provider.refreshAccessToken(input.accessToken);
    const second = await provider.refreshAccessToken(first.accessToken);

    expect(first.expiresIn).toBe(60 * 24 * 60 * 60);
    expect(first.accessToken).toBe(`${input.accessToken}:refreshed`);
    expect(second.accessToken).toBe(first.accessToken);
  });

  it("é idempotente ao publicar novamente o mesmo container", async () => {
    const provider = new FakeInstagramProvider("success");
    const container = await provider.createMediaContainer(input);

    const first = await provider.publishContainer(input.accountId, container, input.accessToken);
    const repeated = await provider.publishContainer(input.accountId, container, input.accessToken);

    expect(repeated).toBe(first);
  });

  it("simula uma falha transitória e se recupera na tentativa seguinte", async () => {
    const provider = new FakeInstagramProvider("transient");

    await expect(provider.getPublishingLimit(input.accountId, input.accessToken)).rejects.toMatchObject({
      kind: "TRANSIENT",
      code: "FAKE_TRANSIENT",
    });
    await expect(provider.getPublishingLimit(input.accountId, input.accessToken)).resolves.toEqual({ usage: 3, total: 100 });
  });

  it.each([
    ["http_400", "VALIDATION", "FAKE_400"],
    ["http_401", "AUTH", "FAKE_401"],
    ["http_403", "AUTH", "FAKE_403"],
    ["http_429", "RATE_LIMIT", "FAKE_429"],
    ["http_500", "TRANSIENT", "FAKE_500"],
    ["http_501", "TRANSIENT", "FAKE_501"],
    ["timeout", "TRANSIENT", "FAKE_TIMEOUT"],
    ["permanent", "PERMANENT", "FAKE_PERMANENT"],
    ["token_expired", "AUTH", "FAKE_TOKEN_EXPIRED"],
  ] as const)("classifica o cenário %s como %s", async (scenario, kind, code) => {
    await expect(new FakeInstagramProvider(scenario).getPublishingLimit(input.accountId, input.accessToken)).rejects.toMatchObject({
      kind,
      code,
    });
  });

  it("sinaliza container inválido como ERROR sem lançar", async () => {
    await expect(new FakeInstagramProvider("success").getContainerStatus("fake_invalido", input.accessToken)).resolves.toBe(
      "ERROR",
    );
  });
});
