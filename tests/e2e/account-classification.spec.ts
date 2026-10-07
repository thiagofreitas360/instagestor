import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { login, withE2EDatabase } from "./helpers";

test("classifica 50 contas em lote, combina filtros e altera a chave individual", async ({ page }, testInfo) => {
  const prefix = `classificacao_${randomUUID().slice(0, 8)}`;
  const { groupId, firstId } = await withE2EDatabase(async (sql) => {
    const [organization] = await sql<Array<{ id: string }>>`SELECT id FROM organizations WHERE slug = 'instagestor'`;
    const accounts = await sql<Array<{ id: string }>>`INSERT INTO instagram_accounts ${sql(Array.from({ length: 50 }, (_, index) => ({
      organization_id: organization.id, instagram_user_id: `${prefix}_${index}`, username: `${prefix}_${index}`,
      display_name: `${prefix} ${index}`, status: index < 25 ? "CONNECTED" : "TOKEN_EXPIRING",
    })))} RETURNING id`;
    const [group] = await sql<Array<{ id: string }>>`INSERT INTO account_groups (organization_id, name) VALUES (${organization.id}, ${prefix}) RETURNING id`;
    await sql`INSERT INTO account_group_members ${sql(accounts.slice(0, 10).map((account) => ({
      organization_id: organization.id, group_id: group.id, instagram_account_id: account.id,
    })))}`;
    return { groupId: group.id, firstId: accounts[0].id };
  });

  await login(page);
  await page.goto(`/contas?busca=${prefix}`);
  await expect(page.locator("tbody tr")).toHaveCount(50);
  await page.getByRole("checkbox", { name: "Selecionar todas as 50 contas deste filtro", exact: true }).check();
  await expect(page.getByText("50 contas selecionadas", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Marcar como novas", exact: true }).click();
  await expect(page.getByText("50 contas marcadas como novas", { exact: true })).toBeVisible();
  await expect(page.locator(".new-account-badge")).toHaveCount(50);
  await expect(page.getByRole("button", { name: "Marcar como antigas", exact: true })).toHaveCount(0);
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.getByRole("button", { name: "Selecionar todas as 50 contas deste filtro", exact: true }).click();
    await page.getByRole("button", { name: "Marcar como novas", exact: true }).click();
    await expect(page.getByText("Nenhuma conta precisava ser alterada", { exact: true })).toBeVisible();
    await expect(page.getByText("0 contas selecionadas", { exact: true })).toBeVisible();
  }
  await page.screenshot({ path: testInfo.outputPath("contas-novas-desktop.png") });

  await page.getByRole("combobox", { name: "Tipo de conta", exact: true }).selectOption("novas");
  await page.getByRole("button", { name: "Aplicar filtros", exact: true }).click();
  await page.locator('tbody input[name="accountIds"]').first().check();
  await expect(page.locator("input[data-select-all]")).toHaveJSProperty("indeterminate", true);
  await page.getByRole("link", { name: "Conectadas", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(25);
  await expect(page.getByText("0 contas selecionadas", { exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Nicho / grupo", exact: true }).selectOption(groupId);
  await page.getByRole("button", { name: "Aplicar filtros", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(10);
  await page.getByRole("button", { name: "Selecionar todas as 10 contas deste filtro", exact: true }).click();
  await page.getByRole("button", { name: "Marcar como antigas", exact: true }).click();
  await expect(page.getByText("10 contas marcadas como antigas", { exact: true })).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(0);

  await page.goto(`/contas?busca=${prefix}&tipo=novas`);
  await expect(page.locator("tbody tr")).toHaveCount(40);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Selecionar todas as 40 contas deste filtro", exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath("contas-novas-mobile.png") });
  await page.getByRole("button", { name: "Marcar como antigas", exact: true }).click();
  await expect(page.getByText("40 contas marcadas como antigas", { exact: true })).toBeVisible();
  await expect(page.locator(".new-account-badge")).toHaveCount(0);
  await page.getByRole("combobox", { name: "Tipo de conta", exact: true }).selectOption("antigas");
  await page.getByRole("button", { name: "Aplicar filtros", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(50);

  await page.goto(`/contas/${firstId}`);
  await page.getByRole("switch", { name: "Conta nova — intervalo dobrado nos loops", exact: true }).check();
  await page.getByRole("button", { name: "Salvar classificação", exact: true }).click();
  await expect(page.getByText("1 conta marcada como nova", { exact: true })).toBeVisible();
  await expect(page.locator(".new-account-badge")).toHaveCount(1);
  await page.getByRole("switch", { name: "Conta nova — intervalo dobrado nos loops", exact: true }).uncheck();
  await page.getByRole("button", { name: "Salvar classificação", exact: true }).click();
  await expect(page.getByText("1 conta marcada como antiga", { exact: true })).toBeVisible();
  await expect(page.locator(".new-account-badge")).toHaveCount(0);
});
