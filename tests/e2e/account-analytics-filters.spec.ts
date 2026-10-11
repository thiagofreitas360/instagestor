import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { login, withE2EDatabase } from "./helpers";

test.use({ actionTimeout: 15_000 });

test("combina contas não vinculadas, pesquisa e loops nas análises", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const prefix = `atividade_${randomUUID().slice(0, 8)}`;
  const fixture = await withE2EDatabase(async (sql) => {
    const [organization] = await sql`SELECT id FROM organizations WHERE slug = 'instagestor'`;
    const [actor] = await sql`SELECT user_id FROM organization_members WHERE organization_id = ${organization.id} LIMIT 1`;
    const accounts = await sql<Array<{ id: string; username: string }>>`INSERT INTO instagram_accounts
      (organization_id, instagram_user_id, username, display_name, status, granted_scopes, insights_synced_at,
        created_at, authorized_at, active_started_at, active_ended_at, active_timing_estimated, banned_at, warmup_profile)
      SELECT ${organization.id}::uuid, ${prefix} || '_' || n, ${prefix} || '_' || n, ${prefix} || ' Loja ' || n,
        CASE WHEN n = 3 THEN 'BANNED'::instagram_account_status ELSE 'CONNECTED'::instagram_account_status END,
        ARRAY['instagram_business_manage_insights'], now(), now() - interval '20 days', now() - interval '8 days',
        now() - interval '8 days', CASE WHEN n = 3 THEN now() - interval '2 days' END, false,
        CASE WHEN n = 3 THEN now() - interval '2 days' END, NULL
      FROM generate_series(0, 3) n RETURNING id, username`;
    const loops: Array<{ id: string; name: string }> = [];
    for (let index = 0; index < 3; index++) {
      const [campaign] = await sql`INSERT INTO campaigns (organization_id, name, publication_type, created_by, origin)
        VALUES (${organization.id}, ${`${prefix} campanha ${index}`}, 'REEL', ${actor.user_id}, 'LOOP') RETURNING id`;
      const [loop] = await sql<Array<{ id: string; name: string }>>`INSERT INTO loops (organization_id, campaign_id, name, status, created_by)
        VALUES (${organization.id}, ${campaign.id}, ${`${prefix} loop ${index}`}, ${index === 1 ? 'PAUSED' : 'ACTIVE'}::loop_status, ${actor.user_id}) RETURNING id, name`;
      loops.push(loop);
    }
    await sql`INSERT INTO loop_accounts ${sql([0, 1, 3].map((index) => ({
      organization_id: organization.id, loop_id: loops[index === 0 ? 0 : 1].id, instagram_account_id: accounts[index].id,
    })))}`;
    const [group] = await sql`INSERT INTO account_groups (organization_id, name) VALUES (${organization.id}, ${prefix}) RETURNING id`;
    await sql`INSERT INTO account_group_members ${sql(accounts.slice(0, 3).map((account) => ({
      organization_id: organization.id, group_id: group.id, instagram_account_id: account.id,
    })))}`;
    for (let index = 0; index < accounts.length; index++) {
      await sql`INSERT INTO account_daily_metrics (organization_id, instagram_account_id, day, followers_count, reach, views)
        VALUES (${organization.id}, ${accounts[index].id}, (now() AT TIME ZONE 'UTC')::date, 1000, ${(index + 1) * 100}, ${(index + 1) * 1000})`;
      await sql`INSERT INTO account_media (id, organization_id, instagram_account_id, media_type, product_type, posted_at, views, caption)
        VALUES (${`${prefix}_${index}_media`}, ${organization.id}, ${accounts[index].id}, 'VIDEO', 'REELS', now(), ${(index + 1) * 1000}, ${`${prefix} Reel ${index}`})`;
    }
    return { accounts, loops, groupId: group.id, organizationId: organization.id };
  });
  await login(page);
  await page.goto(`/contas?busca=${prefix}`);
  await expect(page.locator("tbody tr")).toHaveCount(4);
  await expect(page.getByText("Ativa há 8 dias", { exact: true })).toHaveCount(3);
  await expect(page.getByText("Ficou ativa 6 dias", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("contas-atividade-desktop.png"), fullPage: true });
  await page.getByRole("combobox", { name: "Vínculo com loop", exact: true }).selectOption("nao_vinculadas");
  await page.getByRole("combobox", { name: "Nicho / grupo", exact: true }).selectOption(fixture.groupId);
  await page.getByRole("button", { name: "Aplicar filtros", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody")).toContainText(fixture.accounts[2].username);
  await page.getByRole("link", { name: "Conectadas", exact: true }).click();
  await expect(page).toHaveURL(/vinculo=nao_vinculadas/);
  await expect(page.locator('#account-classification-form input[name="returnTo"]')).toHaveValue(/filtro=conectadas/);
  await page.getByRole("button", { name: "Selecionar todas as 1 contas deste filtro", exact: true }).click();
  await expect(page.getByText("1 conta selecionada", { exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Perfil de aquecimento", exact: true }).selectOption("FAST");
  await page.getByRole("button", { name: "Aplicar perfil", exact: true }).click();
  await expect(page).toHaveURL(/vinculo=nao_vinculadas/);
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.getByText("0 contas selecionadas", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath("contas-atividade-mobile.png"), fullPage: true });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/analises?busca=${prefix}&periodo=7&tipo=REELS&ordem=views&ordem_midia=shares`);
  await page.getByRole("combobox", { name: "Loop inteligente", exact: true }).selectOption(fixture.loops[1].id);
  await page.getByRole("button", { name: "Aplicar", exact: true }).click();
  await expect(page).toHaveURL(/tipo=REELS/);
  await expect(page).toHaveURL(/ordem_midia=shares/);
  const ranking = page.locator("section.panel").filter({ has: page.getByRole("heading", { name: "Ranking de contas", exact: true }) });
  await expect(ranking.locator("tbody tr")).toHaveCount(2);
  await expect(ranking).toContainText(fixture.accounts[1].username);
  await expect(ranking).toContainText(fixture.accounts[3].username);
  await expect(page.getByRole("option", { name: `${fixture.loops[1].name} (pausado)` })).toHaveCount(1);
  await page.getByRole("combobox", { name: "Grupo", exact: true }).selectOption(fixture.groupId);
  await page.getByRole("searchbox", { name: "Buscar conta", exact: true }).fill(` @${fixture.accounts[1].username.toUpperCase()} `);
  await page.getByRole("searchbox", { name: "Buscar conta", exact: true }).press("Enter");
  await expect(ranking.locator("tbody tr")).toHaveCount(1);
  await expect(page.getByText(`${prefix} Reel 1`, { exact: true })).toBeVisible();
  await expect(page.getByText(`${prefix} Reel 3`, { exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("analises-loop-desktop.png"), fullPage: true });
  await ranking.getByRole("link", { name: "Views", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`loop=${fixture.loops[1].id}`));
  await expect(page).toHaveURL(new RegExp(`grupo=${fixture.groupId}`));
  await page.getByRole("link", { name: "@" + fixture.accounts[1].username, exact: true }).first().click();
  await expect(page).toHaveURL(new RegExp(`conta=${fixture.accounts[1].id}`));
  await expect(page).toHaveURL(new RegExp(`loop=${fixture.loops[1].id}`));
  await page.getByRole("button", { name: "Atualizar agora", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`grupo=${fixture.groupId}`));
  await expect(page.getByText(/Atualização solicitada/)).toBeVisible();
  await page.goto(`/analises?loop=${fixture.loops[2].id}`);
  await expect(page.getByRole("heading", { name: "Nenhuma conta encontrada para esses filtros" })).toBeVisible();
  await page.goto(`/analises?loop=${randomUUID()}`);
  await expect(page.getByText("Filtro inválido: conta, grupo ou loop não encontrado.")).toBeVisible();

  await withE2EDatabase(async (sql) => { await sql`UPDATE settings SET theme = 'DARK' WHERE organization_id = ${fixture.organizationId}`; });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/analises?loop=${fixture.loops[1].id}&busca=${prefix}`);
  await expect(page.locator('[data-theme="DARK"]')).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "Buscar conta", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("analises-loop-mobile-dark.png"), fullPage: true });
  await withE2EDatabase(async (sql) => { await sql`UPDATE settings SET theme = 'LIGHT' WHERE organization_id = ${fixture.organizationId}`; });
});
