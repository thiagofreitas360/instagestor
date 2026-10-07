import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { login, withE2EDatabase } from "./helpers";

test("move mídia para pasta nova e move ou exclui a seleção em lote", async ({ page }, testInfo) => {
  const suffix = randomUUID().slice(0, 8);
  const sourceName = `Origem ${suffix}`;
  const destinationName = `Destino ${suffix}`;
  const filenames = Array.from({ length: 4 }, (_, index) => `lote-${suffix}-${index}.jpg`);
  const files = filenames.map((filename) => testInfo.outputPath(filename));
  for (const file of files) {
    await sharp({ create: { width: 1080, height: 1080, channels: 3, background: "#8b5cf6" } }).jpeg().toFile(file);
  }

  await login(page);
  await page.goto("/midias");
  await page.getByLabel("Nova pasta", { exact: true }).fill(sourceName);
  await page.getByRole("button", { name: "Criar pasta", exact: true }).click();
  const sourceLink = page.getByRole("link", { name: `${sourceName} (0)`, exact: true });
  await expect(sourceLink).toBeVisible();
  const sourceFolder = new URL((await sourceLink.getAttribute("href"))!, "http://localhost").searchParams.get("pasta")!;
  await page.getByRole("combobox", { name: "Pasta", exact: true }).selectOption(sourceFolder);
  await page.locator('input[type="file"]').setInputFiles(files);
  await page.getByRole("button", { name: "Enviar mídias", exact: true }).click();
  await expect(page.locator(".media-card").filter({ has: page.getByRole("heading", { name: new RegExp(suffix) }) })).toHaveCount(4);
  await page.getByLabel("Nova pasta", { exact: true }).fill(destinationName);
  await page.getByRole("button", { name: "Criar pasta", exact: true }).click();
  const destinationLink = page.getByRole("link", { name: `${destinationName} (0)`, exact: true });
  await expect(destinationLink).toBeVisible();
  const destinationFolder = new URL((await destinationLink.getAttribute("href"))!, "http://localhost").searchParams.get("pasta")!;
  await page.getByRole("link", { name: `${sourceName} (4)`, exact: true }).click();
  const cards = page.locator(".media-card");
  await expect(cards).toHaveCount(4);
  await expect(page.locator('#media-bulk-form input[name="returnTo"]')).toHaveValue(`/midias?pasta=${sourceFolder}`);
  const firstCard = cards.filter({ has: page.getByRole("heading", { name: filenames[0], exact: true }) });
  await firstCard.getByRole("combobox", { name: `Pasta de ${filenames[0]}`, exact: true }).selectOption(destinationFolder);
  await firstCard.getByRole("button", { name: "Mover", exact: true }).click();
  await expect(cards).toHaveCount(3);
  await expect(page.locator(".message-error")).toHaveCount(0);

  await page.getByRole("checkbox", { name: `Selecionar ${filenames[1]}`, exact: true }).check();
  await page.getByRole("checkbox", { name: `Selecionar ${filenames[2]}`, exact: true }).check();
  await expect(page.getByText("2 mídias selecionadas", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Limpar seleção", exact: true }).click();
  await expect(page.locator('input[name="mediaIds"]:checked')).toHaveCount(0);
  await page.getByRole("button", { name: "Selecionar todas (3)", exact: true }).click();
  await page.getByRole("checkbox", { name: `Selecionar ${filenames[3]}`, exact: true }).uncheck();
  await expect(page.getByText("2 mídias selecionadas", { exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Pasta de destino", exact: true }).selectOption(destinationFolder);
  await page.getByRole("button", { name: "Mover selecionadas", exact: true }).click();
  await expect(page.getByText("2 mídias movidas", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`pasta=${sourceFolder}`));
  await expect(cards).toHaveCount(1);
  await expect(page.getByText("0 mídias selecionadas", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Mover selecionadas", exact: true })).toBeDisabled();

  await page.getByRole("link", { name: `${destinationName} (3)`, exact: true }).click();
  await page.getByRole("button", { name: "Selecionar todas (3)", exact: true }).click();
  await expect(page.locator('input[name="mediaIds"]:checked')).toHaveCount(3);
  await page.screenshot({ path: testInfo.outputPath("midias-lote-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath("midias-lote-mobile.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Excluir selecionadas", exact: true }).click();
  await expect(cards).toHaveCount(3);
  await expect(page.getByText("3 mídias selecionadas", { exact: true })).toBeVisible();
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("Excluir 3 mídias selecionadas");
    await dialog.accept();
  });
  await page.getByRole("button", { name: "Excluir selecionadas", exact: true }).click();
  await expect(page.getByText("3 mídias excluídas", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Nenhuma mídia nesta pasta", exact: true })).toBeVisible();
  await expect(cards).toHaveCount(0);

  await page.getByRole("link", { name: `${sourceName} (1)`, exact: true }).click();
  await page.getByRole("button", { name: "Selecionar todas (1)", exact: true }).click();
  await page.getByRole("combobox", { name: "Pasta de destino", exact: true }).selectOption("");
  await page.getByRole("button", { name: "Mover selecionadas", exact: true }).click();
  await expect(page.getByText("1 mídia movida", { exact: true })).toBeVisible();
  await expect(cards).toHaveCount(0);
  const persisted = await withE2EDatabase(async (sql) => sql<Array<{ original_filename: string; folder_id: string | null; deleted_at: Date | null }>>`
    SELECT original_filename, folder_id, deleted_at FROM media_assets WHERE original_filename IN ${sql(filenames)} ORDER BY original_filename
  `);
  expect(persisted.slice(0, 3).every((asset) => asset.deleted_at !== null)).toBe(true);
  expect(persisted[3]).toEqual({ original_filename: filenames[3], folder_id: null, deleted_at: null });
});
