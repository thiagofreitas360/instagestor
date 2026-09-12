import { describe, expect, it } from "vitest";
import { getSqlClient } from "@/db/client";
import { banAccount, createFakeAccounts, requestInsightsRefresh, unbanAccount } from "@/server/accounts";
import { createAccounts, createCampaign, createJobs, createUser } from "./helpers";

describe("banimento manual", () => {
  it("marca a conta, fecha jobs pendentes e registra contexto na auditoria", async () => {
    const sql = getSqlClient();
    const userId = await createUser();
    const [account] = await createAccounts(1, "ban");
    await sql`
      UPDATE instagram_accounts SET last_error_code = 'META_190', last_error_at = now() - interval '1 day',
        encrypted_access_token = 'cifrado' WHERE id = ${account.id}
    `;
    await sql`
      INSERT INTO account_daily_metrics (instagram_account_id, day, followers_count, media_count)
      VALUES (${account.id}, current_date - 1, 900, 12), (${account.id}, current_date, 950, 13)
    `;
    const campaignId = await createCampaign(userId, "RUNNING");
    const [job] = await createJobs(campaignId, [account]);
    await sql`UPDATE publication_jobs SET status = 'PUBLISHED', published_at = now() WHERE id = ${job.id}`;
    const secondCampaign = await createCampaign(userId, "SCHEDULED", "Pendente");
    const [pending] = await createJobs(secondCampaign, [account]);

    await banAccount(account.id, "  Suspensa pela Meta após checkpoint  ", userId);

    const [row] = await sql<Array<{ status: string; ban_reason: string; banned_at: Date | null; encrypted_access_token: string | null }>>`
      SELECT status, ban_reason, banned_at, encrypted_access_token FROM instagram_accounts WHERE id = ${account.id}
    `;
    expect(row).toMatchObject({ status: "BANNED", ban_reason: "Suspensa pela Meta após checkpoint", encrypted_access_token: null });
    // Deviation from brief: this client returns timestamptz columns as raw strings, not Date
    // instances (drizzle-orm/postgres-js installs a transparent parser on the shared sql client
    // options — see node_modules/drizzle-orm/postgres-js/driver.js), so `toBeInstanceOf(Date)`
    // never passes here. Assert it parses to a real timestamp instead.
    expect(row.banned_at).not.toBeNull();
    expect(Number.isNaN(new Date(row.banned_at as unknown as string).getTime())).toBe(false);

    const [pendingJob] = await sql<Array<{ status: string; last_error_code: string }>>`
      SELECT status, last_error_code FROM publication_jobs WHERE id = ${pending.id}
    `;
    expect(pendingJob).toEqual({ status: "FAILED", last_error_code: "ACCOUNT_BANNED" });
    const [closed] = await sql<Array<{ status: string }>>`SELECT status FROM campaigns WHERE id = ${secondCampaign}`;
    expect(closed.status).toBe("FAILED");

    const [audit] = await sql<Array<{ metadata_json: Record<string, unknown>; actor_user_id: string }>>`
      SELECT metadata_json, actor_user_id FROM audit_logs WHERE event_type = 'ACCOUNT_BANNED' AND entity_id = ${account.id}
    `;
    expect(audit.actor_user_id).toBe(userId);
    expect(audit.metadata_json).toMatchObject({
      reason: "Suspensa pela Meta após checkpoint", followersCount: 950, mediaCount: 13, lastErrorCode: "META_190", publishedByTool: 1,
    });
    expect(typeof audit.metadata_json.lastErrorAt).toBe("string");
  });

  it("rejeita motivo curto e banimento duplicado", async () => {
    const userId = await createUser();
    const [account] = await createAccounts(1, "dup");
    await expect(banAccount(account.id, "ab", userId)).rejects.toThrow(/motivo/i);
    await banAccount(account.id, "Motivo válido", userId);
    await expect(banAccount(account.id, "Outro motivo", userId)).rejects.toThrow(/já está/i);
  });

  it("desmarca voltando para DISCONNECTED e preserva o histórico", async () => {
    const sql = getSqlClient();
    const userId = await createUser();
    const [account] = await createAccounts(1, "unban");
    await banAccount(account.id, "Motivo válido", userId);
    await unbanAccount(account.id, userId);
    const [row] = await sql<Array<{ status: string; banned_at: Date | null; ban_reason: string | null }>>`
      SELECT status, banned_at, ban_reason FROM instagram_accounts WHERE id = ${account.id}
    `;
    expect(row).toEqual({ status: "DISCONNECTED", banned_at: null, ban_reason: null });
    const events = await sql<Array<{ event_type: string }>>`
      SELECT event_type FROM audit_logs WHERE entity_id = ${account.id} ORDER BY created_at
    `;
    expect(events.map((event) => event.event_type)).toEqual(["ACCOUNT_BANNED", "ACCOUNT_UNBANNED"]);
    await expect(unbanAccount(account.id, userId)).rejects.toThrow(/não está/i);
  });
});

describe("escopos e atualização de insights", () => {
  it("contas fake nascem com o escopo de insights e podem pedir sync imediato", async () => {
    const sql = getSqlClient();
    const userId = await createUser();
    await createFakeAccounts(2, userId);
    const accounts = await sql<Array<{ id: string; granted_scopes: string[] }>>`
      SELECT id, granted_scopes FROM instagram_accounts ORDER BY username
    `;
    expect(accounts[0].granted_scopes).toContain("instagram_business_manage_insights");
    await sql`UPDATE instagram_accounts SET insights_synced_at = now()`;

    expect(await requestInsightsRefresh(accounts[0].id)).toBe(1);
    const [first] = await sql<Array<{ insights_synced_at: Date | null }>>`
      SELECT insights_synced_at FROM instagram_accounts WHERE id = ${accounts[0].id}
    `;
    expect(first.insights_synced_at).toBeNull();

    expect(await requestInsightsRefresh()).toBe(2);
  });

  it("não marca conta sem escopo de insights", async () => {
    const sql = getSqlClient();
    const [account] = await createAccounts(1, "noscope");
    await sql`UPDATE instagram_accounts SET encrypted_access_token = 'x', insights_synced_at = now() WHERE id = ${account.id}`;
    expect(await requestInsightsRefresh()).toBe(0);
  });
});
