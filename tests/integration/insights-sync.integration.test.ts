import { describe, expect, it } from "vitest";
import { getSqlClient } from "@/db/client";
import { runInsightsSync } from "@/jobs/insights-sync";
import { resetEnvForTests } from "@/lib/env";
import { resetInstagramProviderForTests } from "@/providers";
import { createFakeAccounts } from "@/server/accounts";
import { createAccounts, createUser } from "./helpers";

async function fakeAccounts(count: number) {
  const userId = await createUser();
  await createFakeAccounts(count, userId);
  return getSqlClient()<Array<{ id: string; instagram_user_id: string }>>`
    SELECT id, instagram_user_id FROM instagram_accounts ORDER BY username
  `;
}

describe("runInsightsSync", () => {
  it("grava snapshot diário, mídias e vincula jobs publicados", async () => {
    const sql = getSqlClient();
    const [account] = await fakeAccounts(1);
    const userId = (await sql<Array<{ id: string }>>`SELECT id FROM users LIMIT 1`)[0].id;
    const [campaign] = await sql<Array<{ id: string }>>`
      INSERT INTO campaigns (name, publication_type, status, delay_mode, delay_fixed_seconds, target_order, created_by)
      VALUES ('c', 'REEL', 'COMPLETED', 'FIXED', 0, 'SELECTED', ${userId}) RETURNING id
    `;
    const [job] = await sql<Array<{ id: string }>>`
      INSERT INTO publication_jobs (campaign_id, instagram_account_id, scheduled_at, status, meta_media_id, published_at)
      VALUES (${campaign.id}, ${account.id}, now(), 'PUBLISHED', ${`fake_media_${account.instagram_user_id}_0`}, now())
      RETURNING id
    `;

    const result = await runInsightsSync("worker-test");
    expect(result).toEqual({ synced: 1, failed: 0 });

    const days = await sql<Array<{ day: string; followers_count: number | null; reach: number | null }>>`
      SELECT to_char(day, 'YYYY-MM-DD') AS day, followers_count, reach FROM account_daily_metrics
      WHERE instagram_account_id = ${account.id} ORDER BY day DESC
    `;
    expect(days).toHaveLength(3);
    expect(days[0].followers_count).toBeGreaterThan(0);
    expect(days[1].followers_count).toBeNull();
    expect(days.every((day) => day.reach !== null)).toBe(true);

    const media = await sql<Array<{ id: string; product_type: string; views: number | null; published_job_id: string | null; expires_at: Date | null }>>`
      SELECT id, product_type, views, published_job_id, expires_at FROM account_media WHERE instagram_account_id = ${account.id} ORDER BY id
    `;
    expect(media.length).toBeGreaterThanOrEqual(6);
    expect(media.every((item) => item.views !== null)).toBe(true);
    const story = media.find((item) => item.product_type === "STORY");
    expect(story?.expires_at).not.toBeNull();
    expect(Number.isNaN(new Date(story?.expires_at as unknown as string).getTime())).toBe(false);
    expect(media.find((item) => item.id === `fake_media_${account.instagram_user_id}_0`)?.published_job_id).toBe(job.id);

    const [row] = await sql<Array<{ insights_synced_at: Date | null; insights_error_code: string | null; biography: string | null }>>`
      SELECT insights_synced_at, insights_error_code, biography FROM instagram_accounts WHERE id = ${account.id}
    `;
    expect(row.insights_synced_at).not.toBeNull();
    expect(Number.isNaN(new Date(row.insights_synced_at as unknown as string).getTime())).toBe(false);
    expect(row.insights_error_code).toBeNull();
    expect(row.biography).toContain("Bio");
  });

  it("não reprocessa conta sincronizada dentro do intervalo nem conta sem escopo", async () => {
    const sql = getSqlClient();
    await fakeAccounts(1);
    await createAccounts(1, "semescopo");
    await sql`UPDATE instagram_accounts SET encrypted_access_token = 'x' WHERE username LIKE 'semescopo%'`;
    expect(await runInsightsSync("w")).toEqual({ synced: 1, failed: 0 });
    expect(await runInsightsSync("w")).toEqual({ synced: 0, failed: 0 });
    const [{ count }] = await sql<Array<{ count: number }>>`SELECT count(*)::int AS count FROM account_daily_metrics`;
    expect(count).toBe(3);
  });

  it("segunda passada reescreve só os três últimos dias e mantém histórico antigo", async () => {
    const sql = getSqlClient();
    const [account] = await fakeAccounts(1);
    await sql`
      INSERT INTO account_daily_metrics (instagram_account_id, day, followers_count, reach)
      VALUES (${account.id}, current_date - 10, 111, 222)
    `;
    await runInsightsSync("w");
    await sql`UPDATE instagram_accounts SET insights_synced_at = now() - interval '2 hours'`;
    await runInsightsSync("w");
    const [old] = await sql<Array<{ followers_count: number; reach: number }>>`
      SELECT followers_count, reach FROM account_daily_metrics WHERE instagram_account_id = ${account.id} AND day = current_date - 10
    `;
    expect(old).toEqual({ followers_count: 111, reach: 222 });
    const [{ count }] = await sql<Array<{ count: number }>>`SELECT count(*)::int AS count FROM account_daily_metrics`;
    expect(count).toBe(4);
  });

  it("erro AUTH leva a REAUTH_REQUIRED; rate limit adia a conta", async () => {
    const sql = getSqlClient();
    const [account] = await fakeAccounts(1);

    process.env.FAKE_PROVIDER_SCENARIO = "http_401";
    resetEnvForTests();
    resetInstagramProviderForTests();
    expect(await runInsightsSync("w")).toEqual({ synced: 0, failed: 1 });
    const [auth] = await sql<Array<{ status: string }>>`SELECT status FROM instagram_accounts WHERE id = ${account.id}`;
    expect(auth.status).toBe("REAUTH_REQUIRED");

    await sql`UPDATE instagram_accounts SET status = 'CONNECTED', insights_synced_at = NULL WHERE id = ${account.id}`;
    process.env.FAKE_PROVIDER_SCENARIO = "http_429";
    resetEnvForTests();
    resetInstagramProviderForTests();
    expect(await runInsightsSync("w")).toEqual({ synced: 0, failed: 1 });
    const [limited] = await sql<Array<{ status: string; insights_error_code: string | null; future: boolean }>>`
      SELECT status, insights_error_code, insights_synced_at > now() + interval '10 minutes' AS future
      FROM instagram_accounts WHERE id = ${account.id}
    `;
    expect(limited).toEqual({ status: "CONNECTED", insights_error_code: "FAKE_429", future: true });

    await sql`UPDATE instagram_accounts SET status = 'CONNECTED', insights_synced_at = NULL WHERE id = ${account.id}`;
    process.env.FAKE_PROVIDER_SCENARIO = "http_403";
    resetEnvForTests();
    resetInstagramProviderForTests();
    expect(await runInsightsSync("w")).toEqual({ synced: 0, failed: 1 });
    const [permissionDenied] = await sql<Array<{ status: string; insights_error_code: string | null }>>`
      SELECT status, insights_error_code FROM instagram_accounts WHERE id = ${account.id}
    `;
    expect(permissionDenied).toEqual({ status: "CONNECTED", insights_error_code: "FAKE_403" });

    process.env.FAKE_PROVIDER_SCENARIO = "success";
    resetEnvForTests();
    resetInstagramProviderForTests();
  });
});
