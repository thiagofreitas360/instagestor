import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { MEDIA_CONSTRAINTS, validateCampaignMedia, validateMedia } from "@/server/media-constraints";

async function jpeg(width = 320, height = 240) {
  return sharp({
    create: { width, height, channels: 3, background: "#ffffff" },
  })
    .jpeg()
    .toBuffer();
}

describe("validateMedia", () => {
  it("aceita JPEG cujo conteúdo, MIME, extensão e dimensões são compatíveis", async () => {
    const metadata = await validateMedia("campanha.jpeg", "image/jpeg", await jpeg());

    expect(metadata).toEqual({ kind: "IMAGE", mimeType: "image/jpeg", width: 320, height: 240 });
  });

  it("rejeita divergência entre conteúdo, MIME e extensão", async () => {
    const data = await jpeg();

    await expect(validateMedia("campanha.png", "image/jpeg", data)).rejects.toThrow();
    await expect(validateMedia("campanha.jpg", "image/png", data)).rejects.toThrow();
  });

  it("rejeita largura e tamanho acima dos limites da imagem", async () => {
    await expect(validateMedia("estreita.jpg", "image/jpeg", await jpeg(319, 240))).rejects.toThrow();

    const data = await jpeg();
    const oversized = Buffer.concat([data, Buffer.alloc(MEDIA_CONSTRAINTS.IMAGE.maxBytes + 1 - data.length)]);
    await expect(validateMedia("grande.jpg", "image/jpeg", oversized)).rejects.toThrow();
  });
});

describe("validateCampaignMedia", () => {
  it.each(["FEED_IMAGE", "STORY_IMAGE"])("exige exatamente uma imagem para %s", (type) => {
    expect(() => validateCampaignMedia(type, [{ mediaKind: "IMAGE", width: 1080, height: 1080 }])).not.toThrow();
    expect(() => validateCampaignMedia(type, [])).toThrow();
    expect(() => validateCampaignMedia(type, [{ mediaKind: "VIDEO" }])).toThrow();
    expect(() => validateCampaignMedia(type, [{ mediaKind: "IMAGE" }, { mediaKind: "IMAGE" }])).toThrow();
  });

  it.each(["FEED_VIDEO", "REEL", "STORY_VIDEO"])("exige exatamente um vídeo para %s", (type) => {
    expect(() => validateCampaignMedia(type, [{ mediaKind: "VIDEO", width: 1080, height: 1920 }])).not.toThrow();
    expect(() => validateCampaignMedia(type, [])).toThrow();
    expect(() => validateCampaignMedia(type, [{ mediaKind: "IMAGE" }])).toThrow();
    expect(() => validateCampaignMedia(type, [{ mediaKind: "VIDEO" }, { mediaKind: "VIDEO" }])).toThrow();
  });

  it("aceita carousel com 2 a 10 mídias e rejeita quantidades fora dos limites", () => {
    expect(() =>
      validateCampaignMedia("CAROUSEL", [
        { mediaKind: "IMAGE", width: 1080, height: 1080 },
        { mediaKind: "VIDEO", width: 1080, height: 1080 },
      ]),
    ).not.toThrow();
    expect(() =>
      validateCampaignMedia(
        "CAROUSEL",
        Array.from({ length: 10 }, (_, index) => ({
          mediaKind: index % 2 ? ("VIDEO" as const) : ("IMAGE" as const),
          width: 1080,
          height: 1080,
        })),
      ),
    ).not.toThrow();
    expect(() => validateCampaignMedia("CAROUSEL", [{ mediaKind: "IMAGE" }])).toThrow();
    expect(() =>
      validateCampaignMedia(
        "CAROUSEL",
        Array.from({ length: 11 }, () => ({ mediaKind: "IMAGE" as const, width: 1080, height: 1080 })),
      ),
    ).toThrow();
  });
});
