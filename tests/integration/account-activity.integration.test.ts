import { afterEach, describe, expect, it, vi } from "vitest";
import { getSqlClient } from "@/db/client";
import { markAccountUnavailableIfCurrent } from "@/jobs/account-availability";
import { refreshExpiringTokens } from "@/jobs/token-maintenance";
import { accountActivity, type AccountActivityDates } from "@/lib/account-activity";
import { encryptToken } from "@/lib/crypto";
import { resetEnvForTests } from "@/lib/env";
import { getInstagramProvider, MetaInstagramProvider } from "@/providers";
import { banAccount, connectFromAuthorizationCode, createOauthState, disconnectAccount, unbanAccount, verifyAccount } from "@/server/accounts";
import { loadBanHistory } from "@/server/analytics";
import { createAccounts, createUser, TEST_ORGANIZATION_ID } from "./helpers";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  resetEnvForTests();
});

async function activityRow(id: string) {
  const [row] = await getSqlClient()<AccountActivityDates[]>`SELECT *, now() AS activity_observed_at FROM instagram_accounts WHERE id = ${id}`;
  return row;
}

function mockOAuth(profileId: string) {
  vi.stubEnv("INSTAGRAM_PROVIDER", "meta");
  vi.stubEnv("INSTAGRAM_APP_ID", "activity-app");
  vi.stubEnv("INSTAGRAM_APP_SECRET", "activity-oauth-secret");
  vi.stubEnv("INSTAGRAM_REDIRECT_URI", "http://localhost:3000/api/instagram/oauth/callback");
  resetEnvForTests();
  vi.spyOn(MetaInstagramProvider.prototype, "exchangeAuthorizationCode").mockResolvedValue({
    appScopedUserId: `app-${profileId}`, accessToken: `token-${profileId}`, expiresIn: 5_184_000,
    permissions: ["instagram_business_basic", "instagram_business_content_publish"],
  });
  vi.spyOn(MetaInstagramProvider.prototype, "getProfile").mockResolvedValue({ id: profileId, username: profileId });
}

describe("períodos de atividade", () => {
  it("congela desconexões repetidas e não estende atividade ao banir depois", async () => {
    const sql = getSqlClient();
    const actor = await createUser();
    const [account] = await createAccounts(1, "activity");
    await sql`UPDATE instagram_accounts SET active_started_at = now() - interval '10 days' WHERE id = ${account.id}`;
    await disconnectAccount(account.id, actor, TEST_ORGANIZATION_ID);
    const closed = await activityRow(account.id);
    await disconnectAccount(account.id, actor, TEST_ORGANIZATION_ID);
    expect((await activityRow(account.id)).active_ended_at).toEqual(closed.active_ended_at);
    expect((await activityRow(account.id)).disconnected_at).toEqual(closed.disconnected_at);
    await sql`UPDATE instagram_accounts SET active_ended_at = active_started_at + interval '7 days',
      disconnected_at = active_started_at + interval '7 days' WHERE id = ${account.id}`;
    await banAccount(account.id, "Banimento registrado depois", actor, TEST_ORGANIZATION_ID);
    expect(accountActivity(await activityRow(account.id)).days).toBe(7);
    const history = await loadBanHistory(TEST_ORGANIZATION_ID);
    expect(history.records[0]).toMatchObject({ active_days: 7, activity_estimated: false });
    expect(history.avgActiveDays).toBe(7);
    await unbanAccount(account.id, actor, TEST_ORGANIZATION_ID);
    expect(accountActivity(await activityRow(account.id)).days).toBe(7);
  });

  it("preserva atividade na reautorização e abre outro período após reconectar", async () => {
    const sql = getSqlClient();
    const actor = await createUser();
    mockOAuth("activity-oauth");
    const id = await connectFromAuthorizationCode("code", await createOauthState(TEST_ORGANIZATION_ID, actor));
    expect(await activityRow(id)).toMatchObject({ active_timing_estimated: false, active_ended_at: null });
    await sql`UPDATE instagram_accounts SET active_started_at = now() - interval '7 days' WHERE id = ${id}`;
    const first = await activityRow(id);
    await connectFromAuthorizationCode("code", await createOauthState(TEST_ORGANIZATION_ID, actor, id));
    expect((await activityRow(id)).active_started_at).toEqual(first.active_started_at);
    await disconnectAccount(id, actor, TEST_ORGANIZATION_ID);
    await connectFromAuthorizationCode("code", await createOauthState(TEST_ORGANIZATION_ID, actor, id));
    const reconnected = await activityRow(id);
    expect(reconnected.created_at).toEqual(first.created_at);
    expect(accountActivity(reconnected)).toMatchObject({ active: true, days: 0, estimated: false, endedAt: null });
    const [event] = await sql`SELECT metadata_json FROM audit_logs WHERE entity_id = ${id} AND event_type = 'ACCOUNT_DISCONNECTED'`;
    expect(event.metadata_json.activity).toMatchObject({ days: 7, estimated: false });
  });

  it("preserva a referência e a indicação de estimativa em reautorizações legadas", async () => {
    const sql = getSqlClient();
    const actor = await createUser();
    const [account] = await createAccounts(1, "legacy");
    await sql`UPDATE instagram_accounts SET active_started_at = NULL, active_timing_estimated = true,
      authorized_at = now() - interval '9 days' WHERE id = ${account.id}`;
    mockOAuth(account.instagram_user_id);
    await connectFromAuthorizationCode("code", await createOauthState(TEST_ORGANIZATION_ID, actor, account.id));
    expect(accountActivity(await activityRow(account.id))).toMatchObject({ days: 9, estimated: true });
    await banAccount(account.id, "Banimento legado", actor, TEST_ORGANIZATION_ID);
    expect((await loadBanHistory(TEST_ORGANIZATION_ID)).avgActiveDays).toBeNull();
  });

  it("descarta falha antiga, congela indisponibilidade e registra recuperação por verificação", async () => {
    const sql = getSqlClient();
    const [account] = await createAccounts(1, "unavailable");
    const token = encryptToken(`fake-token:${account.instagram_user_id}:${account.username}`);
    await sql`UPDATE instagram_accounts SET encrypted_access_token = ${token}, active_started_at = now() - interval '3 days' WHERE id = ${account.id}`;
    const input = { organizationId: TEST_ORGANIZATION_ID, accountId: account.id, expectedEncryptedToken: token,
      expectedStatus: "CONNECTED", nextStatus: "REAUTH_REQUIRED" as const, errorCode: "META_190", errorKind: "AUTH" as const, errorMessage: "Token inválido" };
    expect(await markAccountUnavailableIfCurrent({ ...input, expectedEncryptedToken: "old-token" })).toBe(false);
    expect((await activityRow(account.id)).active_ended_at).toBeNull();
    expect(await markAccountUnavailableIfCurrent(input)).toBe(true);
    const closed = await activityRow(account.id);
    expect(accountActivity(closed)).toMatchObject({ days: 3, active: false });
    await markAccountUnavailableIfCurrent({ ...input, expectedStatus: "REAUTH_REQUIRED" });
    expect((await activityRow(account.id)).active_ended_at).toEqual(closed.active_ended_at);
    vi.spyOn(getInstagramProvider(), "getProfile").mockResolvedValue({ id: account.instagram_user_id, username: account.username });
    expect(await verifyAccount(account.id, TEST_ORGANIZATION_ID)).toBe(true);
    expect(accountActivity(await activityRow(account.id))).toMatchObject({ days: 0, active: true, estimated: false });
    const [events] = await sql`SELECT count(*)::int AS count FROM audit_logs WHERE entity_id = ${account.id} AND event_type = 'ACCOUNT_UNAVAILABLE'`;
    expect(events.count).toBe(1);
  });

  it("renova token sem reiniciar o período ativo", async () => {
    const sql = getSqlClient();
    const [account] = await createAccounts(1, "refresh_activity");
    await sql`UPDATE instagram_accounts SET encrypted_access_token = ${encryptToken(`fake-token:${account.instagram_user_id}:${account.username}`)},
      active_started_at = now() - interval '4 days', status = 'TOKEN_EXPIRING', token_expires_at = now() + interval '1 day' WHERE id = ${account.id}`;
    const before = await activityRow(account.id);
    await refreshExpiringTokens("activity-worker");
    const after = await activityRow(account.id);
    expect(after.status).toBe("CONNECTED");
    expect(after.active_started_at).toEqual(before.active_started_at);
    expect(after.active_ended_at).toBeNull();
  });
});
