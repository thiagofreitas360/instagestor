import { expect, test } from "@playwright/test";
import { adminEmail, adminPassword } from "./helpers";

test("renderiza o login com o layout visual esperado", async ({ page }) => {
  await page.goto("/login");

  await expect(page.locator(".login-shell")).toHaveCSS("display", "grid");
  await expect(page.locator(".login-card")).toHaveCSS("background-color", "rgba(255, 255, 255, 0.96)");
  await expect(page.getByRole("button", { name: "Entrar" })).toHaveCSS("background-color", "rgb(111, 78, 246)");
});

test("protege o painel, autentica o administrador e encerra a sessão", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login(?:[/?#]|$)/);
  await expect(page.getByRole("heading", { name: "Entrar no InstaGestor" })).toBeVisible();

  await page.getByLabel("E-mail").fill(adminEmail);
  await page.getByLabel("Senha").fill(adminPassword);
  await page.getByRole("button", { name: "Entrar" }).click();

  await expect(page).toHaveURL(/\/dashboard(?:[/?#]|$)/);
  await expect(page.getByRole("heading", { name: /Opera.*Instagram/i })).toBeVisible();
  await expect(page.getByRole("navigation", { name: /Navega.*principal/i })).toBeVisible();

  await page.getByRole("button", { name: "Sair da conta" }).click();
  await expect(page).toHaveURL(/\/login(?:[/?#]|$)/);
  await page.goto("/fila");
  await expect(page).toHaveURL(/\/login(?:[/?#]|$)/);
});

test("rejeita credenciais inválidas sem expor detalhes", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(`nao-existe-${Date.now()}@example.test`);
  await page.getByLabel("Senha").fill("credencial-incorreta");
  await page.getByRole("button", { name: "Entrar" }).click();

  await expect(page).toHaveURL(/\/login\?erro=/);
  const credentialAlert = page.locator(".login-card p[role='alert']");
  await expect(credentialAlert).toContainText(/inv.*lid/i);
  await expect(credentialAlert).not.toContainText(/argon|hash|sql|stack/i);
});
