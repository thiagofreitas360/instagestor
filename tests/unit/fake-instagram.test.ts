import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeInstagramProvider } from "@/providers/fake-instagram";

const containerInput = {
  accountId: "17841400000000000",
  accessToken: "fake:1001:loja_teste",
  publicationType: "FEED_IMAGE" as const,
  mediaUrls: ["https://storage.test/image.jpg"],
  caption: "Publicação de teste",
};

afterEach(() => vi.useRealTimers());

describe("FakeInstagramProvider", () => {
  it("executa o fluxo de sucesso sem credenciais da Meta", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T12:00:00.000Z"));
    const provider = new FakeInstagramProvider("success");

    await expect(provider.getProfile("fake:1001:loja_teste")).resolves.toMatchObject({
      id: "1001",
      username: "loja_teste",
      accountType: "BUSINESS",
    });
    const containerId = await provider.createMediaContainer(containerInput);
    vi.advanceTimersByTime(500);

    await expect(provider.getContainerStatus(containerId, containerInput.accessToken)).resolves.toBe("FINISHED");
    await expect(provider.publishContainer(containerInput.accountId, containerId, containerInput.accessToken)).resolves.toMatch(
      /^fake_media_[a-f0-9]{20}$/,
    );
    await expect(provider.getPublishingLimit(containerInput.accountId, containerInput.accessToken)).resolves.toEqual({
      usage: 3,
      total: 100,
    });
  });

  it("mantém o container em PROCESSING antes do tempo simulado", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T12:00:00.000Z"));
    const provider = new FakeInstagramProvider("success");

    const containerId = await provider.createMediaContainer(containerInput);

    await expect(provider.getContainerStatus(containerId, containerInput.accessToken)).resolves.toBe("PROCESSING");
    vi.advanceTimersByTime(499);
    await expect(provider.getContainerStatus(containerId, containerInput.accessToken)).resolves.toBe("PROCESSING");
    vi.advanceTimersByTime(1);
    await expect(provider.getContainerStatus(containerId, containerInput.accessToken)).resolves.toBe("FINISHED");
  });

  it("classifica timeout ambíguo somente na fase de publicação", async () => {
    const provider = new FakeInstagramProvider("ambiguous_publish");
    const containerId = await provider.createMediaContainer(containerInput);

    await expect(provider.publishContainer(containerInput.accountId, containerId, containerInput.accessToken)).rejects.toMatchObject({
      name: "InstagramError",
      kind: "AMBIGUOUS",
      code: "FAKE_AMBIGUOUS",
    });
  });
});
