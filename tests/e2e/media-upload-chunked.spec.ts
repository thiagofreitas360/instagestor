import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { login } from "./helpers";

test("envia um arquivo maior que uma parte (5 MB) em duas requisições", async ({ page }, testInfo) => {
  const filename = `grande-${randomUUID().slice(0, 8)}.jpg`;
  const file = testInfo.outputPath(filename);
  // Ruído comprime mal (~2,9 bytes/pixel): 1440×1500 em qualidade máxima dá ~6 MB, entre uma parte (5 MB) e o limite de 8 MB.
  await sharp({ create: { width: 1440, height: 1500, channels: 3, background: "#808080", noise: { type: "gaussian", mean: 128, sigma: 70 } } })
    .jpeg({ quality: 100, chromaSubsampling: "4:4:4" }).toFile(file);
  const { size } = await stat(file);
  expect(size).toBeGreaterThan(5 * 1024 * 1024);
  expect(size).toBeLessThan(8_000_000);

  await login(page);
  await page.goto("/midias");
  const chunkRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/media/upload")) chunkRequests.push(new URL(request.url()).searchParams.get("offset") ?? "");
  });
  await page.locator('input[type="file"]').setInputFiles(file);
  await page.getByRole("button", { name: "Enviar mídias", exact: true }).click();
  await expect(page.getByText("1 de 1 arquivo(s) enviado(s).", { exact: true })).toBeVisible();
  expect(chunkRequests).toEqual(["0", String(5 * 1024 * 1024)]);
  const card = page.locator(".media-card").filter({ has: page.getByRole("heading", { name: filename, exact: true }) });
  await expect(card).toHaveCount(1);
  await expect(card.locator("img.media-real-preview")).toBeVisible();
});
