import { expect, test, type Page, type TestInfo } from "@playwright/test";
import sharp from "sharp";
import {
  login,
  makeCampaignRetryImmediately,
  resetPublishingFixture,
  startFakeWorker,
  waitForCampaignJobState,
  type RunningWorker,
} from "./helpers";

test.describe.configure({ mode: "serial" });

async function uploadJpeg(page: Page, testInfo: TestInfo, filename: string) {
  const path = testInfo.outputPath(filename);
  await sharp({
    create: {
      width: 1080,
      height: 1080,
      channels: 3,
      background: { r: 20, g: 122, b: 113 },
    },
  }).jpeg({ quality: 82, chromaSubsampling: "4:2:0" }).toFile(path);

  await page.goto("/midias");
  await expect(page.getByRole("heading", { name: "Mídias" })).toBeVisible();
  await page.locator('input[type="file"][name="file"]').setInputFiles(path);
  await expect(page.getByRole("button", { name: /Enviar mídia/i })).toBeEnabled();
  await page.getByRole("button", { name: /Enviar mídia/i }).click();
  await expect(page.getByRole("heading", { name: filename })).toBeVisible();
  return filename;
}

async function createImageCampaign(page: Page, campaignName: string, mediaFilename: string) {
  await page.goto("/campanhas/nova");
  await page.getByLabel("Nome da campanha").fill(campaignName);
  await page.locator('select[name="publicationType"]').selectOption("FEED_IMAGE");
  const media = page.locator("label.selectable-media").filter({ hasText: mediaFilename });
  await media.getByRole("checkbox").check();
  await page.getByLabel(/Texto da publicação/i).fill(`Validação E2E da campanha ${campaignName}.`);
  await page.getByRole("button", { name: "Salvar e continuar" }).click();
  await expect(page).toHaveURL(/\/campanhas\/[0-9a-f-]+$/i);
  return new URL(page.url()).pathname;
}

async function previewAndConfirmNow(page: Page, expectedTargets: number, randomDelay = false) {
  await page.getByLabel(/Todas as contas disponíveis/i).check();
  await page.getByLabel("Tipo de intervalo").selectOption(randomDelay ? "RANDOM" : "NONE");
  if (randomDelay) {
    await page.getByLabel(/Intervalo mínimo/i).fill("0");
    await page.getByLabel(/Intervalo máximo/i).fill("0");
  }
  await page.getByLabel(/Publicar assim que possível/i).check();
  await page.getByRole("button", { name: /Gerar prévia do cronograma/i }).click();

  await expect(page).toHaveURL(/\?preview=1$/);
  await expect(page.getByRole("heading", { name: `Cronograma de ${expectedTargets} publicações` })).toBeVisible();
  const previewRows = page.locator("section.schedule-preview tbody tr");
  await expect(previewRows).toHaveCount(expectedTargets);
  await expect(previewRows.locator('td[data-label="Intervalo"]').first()).toHaveText(/Início/i);
  if (expectedTargets > 1) {
    await expect(previewRows.locator('td[data-label="Intervalo"]').nth(1)).toHaveText("0 s");
  }

  await page.getByRole("button", { name: `Confirmar e agendar ${expectedTargets} publicações` }).click();
  await expect(page).toHaveURL(/\?ok=agendada$/);
  await expect(page.getByRole("status")).toContainText(/agendada/i);
  await expect(page.locator("table tbody tr")).toHaveCount(expectedTargets);
}

async function createFakeAccounts(page: Page, count: number) {
  await page.goto("/contas");
  await page.getByLabel("Quantidade").fill(String(count));
  await page.getByRole("button", { name: "Criar contas fake" }).click();
  await expect(page.locator("tbody tr")).toHaveCount(count);
}

test("publica 50/50 destinos pelo worker fake real após prévia explícita", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const suffix = `${Date.now()}-${testInfo.workerIndex}`;
  const campaignName = `Escala 50 E2E ${suffix}`;
  let worker: RunningWorker | undefined;

  await resetPublishingFixture();
  try {
    await login(page);
    await test.step("criar 50 contas fake pela interface", async () => {
      await createFakeAccounts(page, 50);
    });

    const filename = await test.step("enviar mídia e criar campanha pela interface", async () => {
      const uploaded = await uploadJpeg(page, testInfo, `escala-50-${suffix}.jpg`);
      await createImageCampaign(page, campaignName, uploaded);
      return uploaded;
    });
    expect(filename).toContain(suffix);

    const campaignUrl = new URL(page.url()).pathname;
    await test.step("usar publicar agora, intervalo zero, revisar 50 destinos e confirmar", async () => {
      await previewAndConfirmNow(page, 50, true);
      const queued = await waitForCampaignJobState(campaignName, (state) => state.total === 50 && state.queued === 50, {
        description: "50 jobs na fila",
      });
      expect(queued.campaignStatus).toBe("SCHEDULED");
    });

    await test.step("processar todos os jobs em subprocesso worker configurado para sucesso", async () => {
      worker = await startFakeWorker("success");
      const completed = await waitForCampaignJobState(
        campaignName,
        (state) => state.total === 50 && state.published === 50 && state.campaignStatus === "COMPLETED",
        { timeoutMs: 90_000, description: "50/50 PUBLISHED e campanha COMPLETED" },
      );
      expect(completed).toMatchObject({ total: 50, published: 50, campaignStatus: "COMPLETED" });

      await page.goto(campaignUrl);
      await expect(page.getByText("Concluída", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("Publicado", { exact: true })).toHaveCount(50);
      await expect(page.getByText("50", { exact: true }).first()).toBeVisible();
    });
  } finally {
    await worker?.stop();
  }
});

test("recupera HTTP 500 e retry manual de falha permanente pela interface", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const suffix = `${Date.now()}-${testInfo.workerIndex}`;
  const transientCampaign = `HTTP500 E2E ${suffix}`;
  const permanentCampaign = `Permanente E2E ${suffix}`;
  let worker: RunningWorker | undefined;

  await resetPublishingFixture();
  try {
    await login(page);
    await createFakeAccounts(page, 1);
    const filename = await uploadJpeg(page, testInfo, `resiliencia-${suffix}.jpg`);

    await test.step("HTTP 500 entra em RETRY_WAIT e depois publica com worker saudável", async () => {
      await createImageCampaign(page, transientCampaign, filename);
      await previewAndConfirmNow(page, 1);

      worker = await startFakeWorker("http_500");
      const retry = await waitForCampaignJobState(
        transientCampaign,
        (state) => state.retrying === 1 && state.attemptCount === 1 && state.lastErrorCode === "FAKE_500",
        { description: "job em RETRY_WAIT após HTTP 500" },
      );
      expect(retry.campaignStatus).toBe("RUNNING");
      await worker.stop();
      worker = undefined;

      await page.goto("/fila");
      const retryRow = page.locator("tbody tr").filter({ hasText: transientCampaign });
      await expect(retryRow.getByText("Aguardando nova tentativa", { exact: true })).toBeVisible();
      await expect(retryRow).toContainText("FAKE_500");

      await makeCampaignRetryImmediately(transientCampaign);
      worker = await startFakeWorker("success");
      const recovered = await waitForCampaignJobState(
        transientCampaign,
        (state) => state.published === 1 && state.campaignStatus === "COMPLETED",
        { description: "publicação após recuperação do HTTP 500" },
      );
      expect(recovered.published).toBe(1);
      await worker.stop();
      worker = undefined;
    });

    await test.step("falha permanente encerra o job e retry manual pela UI publica com sucesso", async () => {
      await createImageCampaign(page, permanentCampaign, filename);
      await previewAndConfirmNow(page, 1);

      worker = await startFakeWorker("permanent");
      const failed = await waitForCampaignJobState(
        permanentCampaign,
        (state) => state.failed === 1 && state.campaignStatus === "FAILED" && state.lastErrorCode === "FAKE_PERMANENT",
        { description: "job FAILED por erro permanente" },
      );
      expect(failed.attemptCount).toBe(1);
      await worker.stop();
      worker = undefined;

      await page.goto("/fila/historico");
      const failedRow = page.locator("tbody tr").filter({ hasText: permanentCampaign });
      await expect(failedRow.getByText("Falhou", { exact: true })).toBeVisible();
      await expect(failedRow).toContainText("FAKE_PERMANENT");
      await failedRow.getByRole("button", { name: "Tentar novamente" }).click();

      await page.goto("/fila");
      const queuedRow = page.locator("tbody tr").filter({ hasText: permanentCampaign });
      await expect(queuedRow.getByText("Na fila", { exact: true })).toBeVisible();
      await expect(queuedRow).not.toContainText("FAKE_PERMANENT");

      worker = await startFakeWorker("success");
      const recovered = await waitForCampaignJobState(
        permanentCampaign,
        (state) => state.published === 1 && state.campaignStatus === "COMPLETED",
        { description: "publicação após retry manual" },
      );
      expect(recovered).toMatchObject({ published: 1, failed: 0, campaignStatus: "COMPLETED" });

      await page.goto("/fila/historico");
      const publishedRow = page.locator("tbody tr").filter({ hasText: permanentCampaign });
      await expect(publishedRow.getByText("Publicado", { exact: true })).toBeVisible();
      await expect(publishedRow).toContainText(/Meta ID fake_media_/i);
    });
  } finally {
    await worker?.stop();
  }
});
