import { createHmac, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getSqlClient } from "@/db/client";
import { encryptToken } from "@/lib/crypto";
import { resetEnvForTests } from "@/lib/env";
import { deauthorizeBySignedRequest, deleteDataBySignedRequest } from "@/server/accounts";
import { createCampaign, createUser } from "./helpers";

const appSecret = "integration-meta-callback-secret";

function signDeauthorization(userId: string, issuedAt: number) {
  const payload = Buffer.from(
    JSON.stringify({ user_id: userId, algorithm: "HMAC-SHA256", issued_at: issuedAt }),
  ).toString("base64url");
  const signature = createHmac("sha256", appSecret).update(payload).digest("base64url");
  return `${signature}.${payload}`;
}

beforeEach(() => {
  process.env.INSTAGRAM_PROVIDER = "meta";
  process.env.INSTAGRAM_APP_ID = "integration-app-id";
  process.env.INSTAGRAM_APP_SECRET = appSecret;
  process.env.INSTAGRAM_REDIRECT_URI = "http://localhost:3000/api/instagram/oauth/callback";
  resetEnvForTests();
});

afterEach(() => {
  process.env.INSTAGRAM_PROVIDER = "fake";
  resetEnvForTests();
});

describe("callbacks Meta concorrentes", () => {
  it("ignora um signed_request anterior à reconexão OAuth", async () => {
    const appScopedId = `app-${randomUUID()}`;
    const [account] = await getSqlClient()<{ id: string }[]>`
      INSERT INTO instagram_accounts (
        instagram_user_id, app_scoped_user_id, username, encrypted_access_token, authorized_at
      ) VALUES (
        ${`ig-${randomUUID()}`}, ${appScopedId}, 'reconnected_account', ${encryptToken("new-token")},
        now() + interval '1 minute'
      ) RETURNING id
    `;
    const request = signDeauthorization(appScopedId, Math.floor(Date.now() / 1000));

    await deauthorizeBySignedRequest(request);

    const [result] = await getSqlClient()<Array<{ status: string; encrypted_access_token: string | null }>>`
      SELECT status, encrypted_access_token FROM instagram_accounts WHERE id = ${account.id}
    `;
    const [audit] = await getSqlClient()<Array<{ event_type: string; reason: string }>>`
      SELECT event_type, metadata_json->>'reason' AS reason FROM audit_logs WHERE entity_id = ${account.id}
    `;
    expect(result.status).toBe("CONNECTED");
    expect(result.encrypted_access_token).not.toBeNull();
    expect(audit).toEqual({ event_type: "ACCOUNT_DEAUTHORIZATION_IGNORED", reason: "stale_after_reconnect" });
  });

  it("não confunde refresh automático com reconexão e processa a repetição uma única vez", async () => {
    const sql = getSqlClient();
    const actorId = await createUser(`callback-${randomUUID()}@example.test`);
    const campaignId = await createCampaign(actorId, "SCHEDULED", "Callback Meta");
    const appScopedId = `app-${randomUUID()}`;
    const [account] = await sql<{ id: string }[]>`
      INSERT INTO instagram_accounts (
        instagram_user_id, app_scoped_user_id, username, encrypted_access_token,
        authorized_at, token_last_refreshed_at
      ) VALUES (
        ${`ig-${randomUUID()}`}, ${appScopedId}, 'refreshed_account', ${encryptToken("refreshed-token")},
        now() - interval '1 day', now()
      ) RETURNING id
    `;
    await sql`
      INSERT INTO publication_jobs (campaign_id, instagram_account_id, scheduled_at)
      VALUES (${campaignId}, ${account.id}, now() + interval '1 hour')
    `;
    const request = signDeauthorization(appScopedId, Math.floor(Date.now() / 1000) - 5);

    await deauthorizeBySignedRequest(request);
    await deauthorizeBySignedRequest(request);

    const [result] = await sql<Array<{
      account_status: string;
      encrypted_access_token: string | null;
      job_status: string;
      campaign_status: string;
    }>>`
      SELECT account.status AS account_status, account.encrypted_access_token,
        job.status AS job_status, campaign.status AS campaign_status
      FROM instagram_accounts account
      JOIN publication_jobs job ON job.instagram_account_id = account.id
      JOIN campaigns campaign ON campaign.id = job.campaign_id
      WHERE account.id = ${account.id}
    `;
    const [auditCount] = await sql<Array<{ count: number }>>`
      SELECT count(*)::int AS count FROM audit_logs
      WHERE entity_id = ${account.id} AND event_type = 'ACCOUNT_DEAUTHORIZED'
    `;
    expect(result).toEqual({
      account_status: "DISCONNECTED",
      encrypted_access_token: null,
      job_status: "FAILED",
      campaign_status: "FAILED",
    });
    expect(auditCount.count).toBe(1);
  });

  it("torna cada evento de exclusão idempotente sem ignorar um novo pedido após reconexão", async () => {
    const sql = getSqlClient();
    const appScopedId = `app-${randomUUID()}`;
    await sql`
      INSERT INTO instagram_accounts (instagram_user_id, app_scoped_user_id, username, encrypted_access_token)
      VALUES (${`ig-${randomUUID()}`}, ${appScopedId}, 'before_deletion', ${encryptToken("old-token")})
    `;
    const issuedAt = Math.floor(Date.now() / 1000);
    const firstRequest = signDeauthorization(appScopedId, issuedAt);
    const first = await deleteDataBySignedRequest(firstRequest);

    const [reconnected] = await sql<{ id: string }[]>`
      INSERT INTO instagram_accounts (instagram_user_id, app_scoped_user_id, username, encrypted_access_token)
      VALUES (${`ig-${randomUUID()}`}, ${appScopedId}, 'after_reconnect', ${encryptToken("new-token")})
      RETURNING id
    `;
    const replay = await deleteDataBySignedRequest(firstRequest);
    const [afterReplay] = await sql<Array<{ status: string; app_scoped_user_id: string | null }>>`
      SELECT status, app_scoped_user_id FROM instagram_accounts WHERE id = ${reconnected.id}
    `;
    expect(replay.confirmationCode).toBe(first.confirmationCode);
    expect(afterReplay).toEqual({ status: "CONNECTED", app_scoped_user_id: appScopedId });

    const second = await deleteDataBySignedRequest(signDeauthorization(appScopedId, issuedAt + 1));
    const [afterNewRequest] = await sql<Array<{ status: string; app_scoped_user_id: string | null }>>`
      SELECT status, app_scoped_user_id FROM instagram_accounts WHERE id = ${reconnected.id}
    `;
    expect(second.confirmationCode).not.toBe(first.confirmationCode);
    expect(afterNewRequest).toEqual({ status: "DISCONNECTED", app_scoped_user_id: null });
  });

  it("apaga métricas e mídias da conta ao processar exclusão de dados", async () => {
    const sql = getSqlClient();
    const appScopedId = `app-${randomUUID()}`;
    const [account] = await sql<{ id: string }[]>`
      INSERT INTO instagram_accounts (
        instagram_user_id, app_scoped_user_id, username, encrypted_access_token,
        granted_scopes, biography, website
      ) VALUES (
        ${`ig-${randomUUID()}`}, ${appScopedId}, 'com_dados', ${encryptToken("old-token")},
        ARRAY['instagram_business_manage_insights'], 'Bio da loja', 'https://loja.example'
      ) RETURNING id
    `;
    await sql`
      INSERT INTO account_daily_metrics (instagram_account_id, day, followers_count)
      VALUES (${account.id}, current_date, 100)
    `;
    await sql`
      INSERT INTO account_media (id, instagram_account_id, media_type, product_type, posted_at)
      VALUES (${`media-${randomUUID()}`}, ${account.id}, 'IMAGE', 'FEED', now())
    `;
    const request = signDeauthorization(appScopedId, Math.floor(Date.now() / 1000));

    await deleteDataBySignedRequest(request);

    const [[metricsCount], [mediaCount]] = await Promise.all([
      sql<Array<{ count: number }>>`SELECT count(*)::int AS count FROM account_daily_metrics WHERE instagram_account_id = ${account.id}`,
      sql<Array<{ count: number }>>`SELECT count(*)::int AS count FROM account_media WHERE instagram_account_id = ${account.id}`,
    ]);
    expect(metricsCount.count).toBe(0);
    expect(mediaCount.count).toBe(0);

    const [row] = await sql<Array<{
      biography: string | null; website: string | null; granted_scopes: string[] | null; insights_synced_at: Date | null;
    }>>`
      SELECT biography, website, granted_scopes, insights_synced_at FROM instagram_accounts WHERE id = ${account.id}
    `;
    expect(row).toEqual({ biography: null, website: null, granted_scopes: null, insights_synced_at: null });
  });
});
