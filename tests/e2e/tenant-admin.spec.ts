import { expect, test } from "@playwright/test";
import { login, withE2EDatabase } from "./helpers";

const clientEmail = "e2e-client-owner@example.test";
const clientSlug = "e2e-client-tenant";

async function cleanupClient() {
  await withE2EDatabase(async (sql) => {
    await sql`DELETE FROM organizations WHERE slug = ${clientSlug}`;
    await sql`DELETE FROM users WHERE email = ${clientEmail}`;
  });
}

test.describe("administração de clientes", () => {
  test.beforeEach(cleanupClient);
  test.afterEach(cleanupClient);

  test("cria o primeiro acesso, força nova senha e protege o painel da plataforma", async ({ page }) => {
    await login(page);
    await page.goto("/admin/clientes");
    await expect(page.getByRole("heading", { name: "Clientes", level: 1 })).toBeVisible();

    const creationForm = page.locator("form").filter({
      has: page.getByRole("button", { name: "Criar cliente" }),
    });
    await creationForm.getByLabel("Nome da empresa").fill("Cliente E2E");
    await creationForm.getByLabel("Identificador").fill(clientSlug);
    await creationForm.getByLabel("E-mail do proprietário").fill(clientEmail);
    const passwordField = creationForm.getByLabel("Senha temporária");
    const temporaryPassword = await passwordField.inputValue();
    expect(temporaryPassword.length).toBeGreaterThanOrEqual(12);
    await page.getByRole("button", { name: "Criar cliente" }).click();

    await expect(page).toHaveURL(/\/admin\/clientes\?ok=cliente-criado/);
    await expect(page.getByRole("cell", { name: /Cliente E2E/ })).toBeVisible();
    await page.context().clearCookies();

    await page.goto("/login");
    await page.getByLabel("E-mail").fill(clientEmail);
    await page.getByLabel("Senha").fill(temporaryPassword);
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page).toHaveURL(/\/alterar-senha/);

    const permanentPassword = "senha-definitiva-e2e-segura";
    await page.getByLabel("Nova senha", { exact: true }).fill(permanentPassword);
    await page.getByLabel("Confirmar nova senha").fill(permanentPassword);
    await page.getByRole("button", { name: "Salvar nova senha" }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByText("Cliente E2E", { exact: true })).toBeVisible();

    await page.goto("/admin/clientes");
    await expect(page).toHaveURL(/\/dashboard/);
  });
});
