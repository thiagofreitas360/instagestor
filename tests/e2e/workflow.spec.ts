import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { futureLocalDateTime, login } from "./helpers";

test.describe.configure({ mode: "serial" });

test("fluxo fake completo: contas, grupo, mídia, campanha, prévia, fila e cancelamento", async ({ page }, testInfo) => {
  test.slow();
  const suffix = `${Date.now()}-${testInfo.workerIndex}`;
  const groupName = `Grupo E2E ${suffix}`;
  const campaignName = `Campanha E2E ${suffix}`;
  const filename = `midia-e2e-${suffix}.jpg`;
  const jpegPath = testInfo.outputPath(filename);

  await sharp({
    create: {
      width: 1080,
      height: 1080,
      channels: 3,
      background: { r: 118, g: 64, b: 239 },
    },
  })
    .jpeg({ quality: 82, chromaSubsampling: "4:2:0" })
    .toFile(jpegPath);

  await login(page);

  await test.step("criar duas contas exclusivamente no provedor fake", async () => {
    await page.goto("/contas");
    await expect(page.getByRole("heading", { name: /Contas do Instagram/i })).toBeVisible();

    const fakeButton = page.getByRole("button", { name: "Criar contas fake" });
    await expect(
      fakeButton,
      "A suíte E2E é bloqueada quando o servidor não expõe o modo fake de desenvolvimento",
    ).toBeVisible();

    const accountRows = page.locator("tbody tr");
    const countBefore = await accountRows.count();
    await page.getByLabel("Quantidade").fill("2");
    await fakeButton.click();
    await expect(accountRows).toHaveCount(countBefore + 2);
  });

  await test.step("criar grupo e persistir dois membros", async () => {
    await page.goto("/grupos");
    await page.getByLabel("Nome do grupo").fill(groupName);
    await page.getByLabel(/Descri.*opcional/i).fill("Grupo criado pela suíte Playwright");
    await page.getByRole("button", { name: "Criar grupo" }).click();

    const groupCard = page.locator("article.group-card").filter({ has: page.getByRole("heading", { name: groupName }) });
    await expect(groupCard).toBeVisible();
    await groupCard.getByText("Editar membros", { exact: true }).click();
    const memberCheckboxes = groupCard.locator('input[name="accountIds"]');
    await expect(memberCheckboxes.first()).toBeVisible();
    await memberCheckboxes.nth(0).check();
    await memberCheckboxes.nth(1).check();
    await groupCard.getByRole("button", { name: "Salvar membros" }).click();
    await expect(groupCard.locator(".count-pill")).toHaveText("2 contas");
  });

  await test.step("enviar JPEG válido e encontrá-lo na biblioteca", async () => {
    await page.goto("/midias");
    await expect(page.getByRole("heading", { name: "Mídias" })).toBeVisible();
    await page.locator('input[type="file"][name="file"]').setInputFiles(jpegPath);
    await expect(page.getByRole("button", { name: /Enviar m.*dia/i })).toBeEnabled();
    await page.getByRole("button", { name: /Enviar m.*dia/i }).click();
    await expect(page.getByRole("heading", { name: filename })).toBeVisible();
    await expect(page.getByText("Pronta", { exact: true }).first()).toBeVisible();
  });

  let campaignUrl = "";
  await test.step("criar campanha de imagem com a mídia enviada", async () => {
    await page.goto("/campanhas/nova");
    await expect(page.getByRole("heading", { name: /Prepare o conte.*do/i })).toBeVisible();
    await page.getByLabel("Nome da campanha").fill(campaignName);
    await page.locator('select[name="publicationType"]').selectOption("FEED_IMAGE");
    const mediaChoice = page.locator("label.selectable-media").filter({ hasText: filename });
    await mediaChoice.getByRole("checkbox").check();
    await page.getByLabel(/Texto da publica/i).fill("Publicação automatizada pelo fluxo E2E fake.");
    await page.getByRole("button", { name: "Salvar e continuar" }).click();

    await expect(page).toHaveURL(/\/campanhas\/[0-9a-f-]+$/i);
    campaignUrl = new URL(page.url()).pathname;
    await expect(page.getByRole("heading", { name: campaignName })).toBeVisible();
    await expect(page.getByText("Rascunho", { exact: true })).toBeVisible();
  });

  let persistedTimes: string[] = [];
  await test.step("gerar e recarregar prévia aleatória persistida", async () => {
    const groupChoice = page.locator("label.choice-card").filter({ hasText: groupName });
    await groupChoice.getByRole("checkbox").check();
    await page.getByLabel("Início").fill(futureLocalDateTime(60));
    await page.getByLabel(/Fuso hor/i).selectOption("America/Sao_Paulo");
    await page.getByLabel("Tipo de intervalo").selectOption("RANDOM");
    await page.getByLabel("Ordem das contas").selectOption("USERNAME");
    await page.getByLabel(/Intervalo m.*nimo/i).fill("5");
    await page.getByLabel(/Intervalo m.*ximo/i).fill("10");
    await page.getByRole("button", { name: /Gerar pr.*via do cronograma/i }).click();

    await expect(page).toHaveURL(/\?preview=1$/);
    await expect(page.getByRole("heading", { name: /Cronograma de 2 publica/i })).toBeVisible();
    const previewRows = page.locator("section.schedule-preview tbody tr");
    await expect(previewRows).toHaveCount(2);
    await expect(previewRows.nth(0).locator('td[data-label="Intervalo"]')).toHaveText(/In.*cio/i);
    await expect(previewRows.nth(1).locator('td[data-label="Intervalo"]')).toHaveText(/^(?:[5-9]|10) s$/);

    persistedTimes = await previewRows.locator('td[data-label="Publicação prevista"]').allTextContents();
    expect(persistedTimes).toHaveLength(2);
    await page.reload();
    await expect(page.locator("section.schedule-preview tbody tr")).toHaveCount(2);
    await expect(page.locator('td[data-label="Publicação prevista"]')).toHaveText(persistedTimes);
  });

  await test.step("confirmar os mesmos horários e criar dois jobs", async () => {
    await page.getByRole("button", { name: /Confirmar e agendar 2 publica/i }).click();
    await expect(page).toHaveURL(/\?ok=agendada$/);
    await expect(page.getByRole("status")).toContainText(/agendada/i);
    await expect(page.getByText("Agendada", { exact: true }).first()).toBeVisible();

    const campaignJobRows = page.locator("table tbody tr");
    await expect(campaignJobRows).toHaveCount(2);
    const jobTimes = await campaignJobRows.locator('td[data-label="Agendamento"]').allTextContents();
    expect(jobTimes).toEqual(persistedTimes);
  });

  await test.step("exibir os jobs na fila, pausar, retomar e cancelar", async () => {
    await page.goto("/fila");
    const queueRows = page.locator("tbody tr").filter({ hasText: campaignName });
    await expect(queueRows).toHaveCount(2);
    await expect(queueRows.getByText("Na fila", { exact: true })).toHaveCount(2);

    await page.goto(campaignUrl);
    await page.getByRole("button", { name: "Pausar" }).click();
    await expect(page.getByText("Pausada", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Retomar" })).toBeVisible();

    await page.getByRole("button", { name: "Retomar" }).click();
    await expect(page.getByText("Agendada", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Pausar" })).toBeVisible();

    await page.getByRole("button", { name: "Cancelar campanha" }).click();
    await expect(page.getByText("Cancelada", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancelar campanha" })).toHaveCount(0);

    await page.goto("/fila/historico");
    const historyRows = page.locator("tbody tr").filter({ hasText: campaignName });
    await expect(historyRows).toHaveCount(2);
    await expect(historyRows.getByText("Cancelada", { exact: true })).toHaveCount(2);
  });
});
