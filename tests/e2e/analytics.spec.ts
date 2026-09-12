import { expect, test } from "@playwright/test";
import { login, withE2EDatabase } from "./helpers";

const DAY = 86_400_000;

async function seedAnalyticsAccount() {
  return withE2EDatabase(async (sql) => {
    await sql`DELETE FROM account_media`;
    await sql`DELETE FROM account_daily_metrics`;
    await sql`DELETE FROM audit_logs WHERE event_type IN ('ACCOUNT_BANNED', 'ACCOUNT_UNBANNED')`;
    await sql`DELETE FROM instagram_accounts WHERE instagram_user_id LIKE 'e2e_analytics_%'`;
    const [account] = await sql<Array<{ id: string }>>`
      INSERT INTO instagram_accounts (instagram_user_id, username, status, encrypted_access_token, granted_scopes, insights_synced_at, created_at)
      VALUES ('e2e_analytics_1', 'e2e_analytics', 'CONNECTED', 'cifrado',
        ARRAY['instagram_business_basic', 'instagram_business_content_publish', 'instagram_business_manage_insights'],
        now(), now() - interval '20 days')
      RETURNING id
    `;
    const today = new Date();
    for (let offset = 0; offset < 5; offset++) {
      const day = new Date(today.getTime() - offset * DAY).toISOString().slice(0, 10);
      await sql`
        INSERT INTO account_daily_metrics (instagram_account_id, day, followers_count, follower_gains, reach, views, likes)
        VALUES (${account.id}, ${day}::date, ${1000 - offset * 10}, 12, 300, 900, 40)
      `;
    }
    await sql`
      INSERT INTO account_media (id, instagram_account_id, media_type, product_type, posted_at, views, reach, like_count, caption, permalink)
      VALUES ('e2e_reel_1', ${account.id}, 'VIDEO', 'REELS', now() - interval '1 day', 4321, 3000, 50, 'Reel de teste', 'https://www.instagram.com/p/e2e/')
    `;
    return account.id;
  });
}

test.describe("análises", () => {
  test("mostra agregado, filtra por conta e permite banir com histórico", async ({ page }) => {
    const accountId = await seedAnalyticsAccount();
    await login(page);

    await page.goto("/analises");
    await expect(page.getByRole("heading", { name: "Todas as contas" })).toBeVisible();
    await expect(page.getByText("Seguidores ganhos")).toBeVisible();
    await expect(page.getByRole("img", { name: "Seguidores por dia" })).toBeVisible();
    await expect(page.getByRole("link", { name: "@e2e_analytics" }).first()).toBeVisible();
    await expect(page.getByText("Reel de teste")).toBeVisible();

    await page.getByRole("link", { name: "@e2e_analytics" }).first().click();
    await expect(page).toHaveURL(new RegExp(`conta=${accountId}`));
    await expect(page.getByRole("heading", { name: "@e2e_analytics" })).toBeVisible();
    await expect(page.getByText("1.000 seguidores")).toBeVisible();

    await page.getByRole("button", { name: "Atualizar agora" }).click();
    await expect(page.getByText(/Atualização solicitada/)).toBeVisible();

    await page.goto(`/contas/${accountId}`);
    await expect(page.getByRole("heading", { name: "Análises (últimos 30 dias)" })).toBeVisible();
    await page.getByText("Registrar banimento").click();
    await page.getByLabel("Motivo").fill("Suspensa pela Meta no e2e");
    await page.getByRole("button", { name: "Confirmar banimento" }).click();
    await expect(page.getByText("Conta marcada como banida").first()).toBeVisible();
    await expect(page.getByText("Banida", { exact: true })).toBeVisible();

    await page.goto("/analises/banidas");
    await expect(page.getByText("Suspensa pela Meta no e2e")).toBeVisible();
    await expect(page.getByRole("cell", { name: "1.000" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "20", exact: true })).toBeVisible();

    await page.goto(`/contas/${accountId}`);
    await page.getByRole("button", { name: "Desmarcar banimento" }).click();
    await expect(page.getByText("Banimento desmarcado")).toBeVisible();
    await expect(page.getByText("Desconectada", { exact: true })).toBeVisible();
  });
});
