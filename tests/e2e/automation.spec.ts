import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { login, withE2EDatabase } from "./helpers";

async function seedAutomationMedia() {
  const filename = `automation-${randomUUID()}.jpg`;
  const folderName = `Pasta automação ${randomUUID().slice(0, 8)}`;
  await withE2EDatabase(async (sql) => {
    const [organization] = await sql<Array<{ id: string }>>`
      SELECT id FROM organizations WHERE slug = 'instagestor' LIMIT 1
    `;
    const [folder] = await sql<Array<{ id: string }>>`
      INSERT INTO media_folders (organization_id, name)
      VALUES (${organization.id}, ${folderName})
      RETURNING id
    `;
    await sql`
      INSERT INTO media_assets (
        organization_id, original_filename, storage_provider, storage_key, mime_type,
        media_kind, size_bytes, checksum_sha256, folder_id, processing_status
      ) VALUES (
        ${organization.id}, ${filename}, 'LOCAL', ${`e2e/${randomUUID()}`}, 'image/jpeg',
        'IMAGE', 1024, ${"a".repeat(64)}, ${folder.id}, 'READY'
      )
    `;
  });
  return { filename, folderName };
}

test("cria e edita loop, cria escala e alterna o tema", async ({ page }) => {
  const { filename, folderName } = await seedAutomationMedia();
  const suffix = Date.now();
  const loopName = `Loop E2E ${suffix}`;
  const scheduleName = `Escala E2E ${suffix}`;
  await login(page);

  await page.goto("/loops");
  await expect(page.getByRole("heading", { name: "Loops", exact: true })).toBeVisible();
  // Fechado, só aparecem os cards; o editor abre pelo "Novo loop".
  await expect(page.getByRole("button", { name: "Criar e iniciar loop" })).toHaveCount(0);
  await page.getByRole("link", { name: "Novo loop" }).click();
  const loopForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Criar e iniciar loop" }) });
  await loopForm.getByLabel("Nome do loop").fill(loopName);
  await loopForm.getByText("Imagem", { exact: true }).click();
  await loopForm.getByLabel("Limitado (não repetir mídias)").check();
  await loopForm.getByLabel("Limites por faixa de seguidores").check();
  await loopForm.getByLabel("Limite diário da faixa").fill("7");
  await loopForm.getByLabel("Auto-comentário").fill("Link na bio");
  await loopForm.getByLabel(/Esperar/).fill("2");
  const firstAccount = loopForm.locator(".loop-account").first();
  const assignedUsername = await firstAccount.locator(".loop-account-name").innerText();
  await firstAccount.click();
  await loopForm.getByLabel("Pasta de mídias").selectOption({ label: `${folderName} (1)` });
  await expect(loopForm.getByText(/Mídias atuais no pool \(1\)/)).toBeVisible();
  await loopForm.getByRole("button", { name: "Criar e iniciar loop" }).click();
  await expect(page.getByText(/Loop criado para/)).toBeVisible();

  const loopCard = page.locator("article.loop-card").filter({ hasText: loopName });
  await expect(loopCard).toBeVisible();
  await expect(loopCard).toContainText(folderName);
  await page.getByRole("link", { name: "Novo loop" }).click();
  const newLoopForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Criar e iniciar loop" }) });
  await expect(newLoopForm.locator('input[name="accountIds"]:checked')).toHaveCount(0);
  await expect(newLoopForm.getByText(assignedUsername, { exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Cancelar" }).click();
  await loopCard.getByRole("link", { name: `Editar ${loopName}` }).click();
  const editForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Salvar alterações" }) });
  await editForm.getByLabel("Intervalo mín (min)").fill("30");
  await editForm.getByRole("button", { name: "Salvar alterações" }).click();
  await expect(page.getByText("Loop atualizado")).toBeVisible();

  await page.goto("/escalas");
  const scheduleForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Criar escala" }) });
  await scheduleForm.getByLabel("Nome").fill(scheduleName);
  const future = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const time = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(future);
  await scheduleForm.getByLabel(/Horários/).fill(time);
  await scheduleForm.getByLabel("Tipo de mídia").selectOption("IMAGE");
  await scheduleForm.getByLabel("Auto-comentário").fill("Confira o perfil");
  await scheduleForm.getByLabel("Todas as contas disponíveis").check();
  await scheduleForm.locator("label.selectable-media").filter({ hasText: filename }).getByRole("checkbox").check();
  await scheduleForm.getByRole("button", { name: "Criar escala" }).click();
  const scheduleRow = page.locator("tbody tr").filter({ hasText: scheduleName });
  await expect(scheduleRow).toBeVisible();
  await scheduleRow.getByRole("link", { name: "Editar" }).click();
  const editScheduleForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Salvar e reagendar pendentes" }) });
  await expect(editScheduleForm.getByLabel("Auto-comentário")).toHaveValue("Confira o perfil");
  await editScheduleForm.getByLabel("Esperar após publicar (min)").fill("10");
  await editScheduleForm.getByRole("button", { name: "Salvar e reagendar pendentes" }).click();
  await expect(page.getByText(/publicação\(ões\) pendente\(s\) reagendada\(s\)/)).toBeVisible();

  await page.goto("/configuracoes");
  await page.getByLabel("Aparência").selectOption("DARK");
  await page.getByRole("button", { name: "Salvar preferências" }).click();
  await expect(page.locator(".admin-shell")).toHaveAttribute("data-theme", "DARK");
});
