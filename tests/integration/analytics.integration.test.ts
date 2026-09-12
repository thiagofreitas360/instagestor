import { describe, expect, it } from "vitest";
import { getSqlClient } from "@/db/client";
import { loadAnalytics, loadBanHistory, resolvePeriod } from "@/server/analytics";
import { banAccount } from "@/server/accounts";
import { createAccounts, createUser } from "./helpers";

async function seedMetrics(accountId: string, rows: Array<{ daysAgo: number; followers?: number; gains?: number; reach?: number; views?: number; likes?: number }>) {
  const sql = getSqlClient();
  for (const row of rows) {
    await sql`
      INSERT INTO account_daily_metrics (instagram_account_id, day, followers_count, follower_gains, reach, views, likes)
      VALUES (${accountId}, (now() AT TIME ZONE 'UTC')::date - ${row.daysAgo}::int, ${row.followers ?? null}, ${row.gains ?? null},
        ${row.reach ?? null}, ${row.views ?? null}, ${row.likes ?? null})
    `;
  }
}

describe("loadAnalytics", () => {
  it("agregado soma os individuais e calcula ganhos, perdidos e variação", async () => {
    const sql = getSqlClient();
    const [a, b] = await createAccounts(2, "an");
    await sql`UPDATE instagram_accounts SET granted_scopes = ARRAY['instagram_business_manage_insights'], encrypted_access_token = 'x', insights_synced_at = now()`;
    // Conta A: base 100 antes do período, termina em 130; ganhou 40 → perdeu 10.
    await seedMetrics(a.id, [
      { daysAgo: 8, followers: 100, reach: 5 },
      { daysAgo: 3, followers: 120, gains: 25, reach: 50, views: 100, likes: 4 },
      { daysAgo: 0, followers: 130, gains: 15, reach: 30, views: 80, likes: 6 },
    ]);
    // Conta B: sem linha antes do período; primeira do período vira base (200 → 210).
    await seedMetrics(b.id, [
      { daysAgo: 5, followers: 200, gains: 10, reach: 10, views: 20 },
      { daysAgo: 1, followers: 210, gains: 5, reach: 20, views: 30 },
    ]);
    await sql`
      INSERT INTO account_media (id, instagram_account_id, media_type, product_type, posted_at, views, like_count)
      VALUES ('m1', ${a.id}, 'VIDEO', 'REELS', now() - interval '2 days', 500, 10),
             ('m2', ${b.id}, 'IMAGE', 'FEED', now() - interval '1 day', 300, 20),
             ('m3', ${b.id}, 'IMAGE', 'FEED', now() - interval '40 days', 900, 1)
    `;

    const period = resolvePeriod(7);
    const all = await loadAnalytics({ accountIds: null, period });
    expect(all.totals).toMatchObject({
      followers: 340, netChange: 40, gains: 55, lost: 15, reach: 110, views: 230, likes: 10, mediaCount: 2, mediaByTool: 0,
    });
    expect(all.previous.reach).toBe(5);
    expect(all.series.length).toBe(7);
    expect(all.series[all.series.length - 1].reach).toBe(30);
    expect(all.ranking.map((row) => row.username)).toEqual([a.username, b.username]); // ordem padrão: alcance (80 > 30)
    expect(all.media.map((row) => row.id)).toEqual(["m1", "m2"]);
    expect(all.missingScope).toEqual([]);

    const onlyA = await loadAnalytics({ accountIds: [a.id], period });
    const onlyB = await loadAnalytics({ accountIds: [b.id], period });
    expect(onlyA.totals.reach + onlyB.totals.reach).toBe(all.totals.reach);
    expect(onlyA.totals).toMatchObject({ followers: 130, netChange: 30, gains: 40, lost: 10 });
    expect(onlyB.totals).toMatchObject({ followers: 210, netChange: 10, gains: 15, lost: 5 });
    expect(onlyA.ranking).toHaveLength(1);

    const reels = await loadAnalytics({ accountIds: null, period, mediaType: "REELS" });
    expect(reels.media.map((row) => row.id)).toEqual(["m1"]);
    const byFollowers = await loadAnalytics({ accountIds: null, period, rankingOrder: "followers" });
    expect(byFollowers.ranking[0].username).toBe(b.username);
  });

  it("lista contas sem escopo e com erro de sync", async () => {
    const sql = getSqlClient();
    const [noScope, withError] = await createAccounts(2, "flag");
    await sql`UPDATE instagram_accounts SET encrypted_access_token = 'x'`;
    await sql`UPDATE instagram_accounts SET granted_scopes = ARRAY['instagram_business_manage_insights'], insights_error_code = 'META_4' WHERE id = ${withError.id}`;
    const result = await loadAnalytics({ accountIds: null, period: resolvePeriod(30) });
    expect(result.missingScope.map((row) => row.id)).toEqual([noScope.id]);
    expect(result.syncErrors).toEqual([{ id: withError.id, username: withError.username, code: "META_4" }]);
    expect(result.totals.followers).toBe(0);
    expect(result.syncedAt).toBeNull();
  });
});

describe("loadBanHistory", () => {
  it("lê os eventos de banimento com contexto", async () => {
    const sql = getSqlClient();
    const userId = await createUser();
    const [account] = await createAccounts(1, "hist");
    await sql`UPDATE instagram_accounts SET created_at = now() - interval '45 days' WHERE id = ${account.id}`;
    await sql`INSERT INTO account_daily_metrics (instagram_account_id, day, followers_count) VALUES (${account.id}, current_date, 777)`;
    await banAccount(account.id, "Checkpoint não resolvido", userId);

    const history = await loadBanHistory();
    expect(history.total).toBe(1);
    expect(history.last30).toBe(1);
    expect(history.avgFollowers).toBe(777);
    expect(history.avgDaysAlive).toBe(45);
    expect(history.records[0]).toMatchObject({
      account_id: account.id, username: account.username, status: "BANNED", reason: "Checkpoint não resolvido",
      followers_count: 777, published_by_tool: 0, days_alive: 45,
    });
  });
});
