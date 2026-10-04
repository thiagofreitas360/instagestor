import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSqlClient } from "@/db/client";
import { decryptToken } from "@/lib/crypto";
import { resetEnvForTests } from "@/lib/env";
import { MetaInstagramProvider } from "@/providers/meta-instagram";
import { connectFromAuthorizationCode, consumeOauthState, createOauthState } from "@/server/accounts";
import { createAccounts, createOrganization, createUser, TEST_ORGANIZATION_ID } from "./helpers";

function metaReturns(profileId: string) {
  vi.spyOn(MetaInstagramProvider.prototype, "exchangeAuthorizationCode").mockResolvedValue({
    appScopedUserId: `app-${profileId}`, accessToken: `token-${profileId}`, expiresIn: 5_184_000,
    permissions: ["instagram_business_basic", "instagram_business_content_publish"],
  });
  vi.spyOn(MetaInstagramProvider.prototype, "getProfile").mockResolvedValue({ id: profileId, username: `user_${profileId}` });
}

beforeEach(() => {
  process.env.INSTAGRAM_PROVIDER = "meta";
  process.env.INSTAGRAM_APP_ID = "integration-app-id";
  process.env.INSTAGRAM_APP_SECRET = "integration-oauth-secret";
  process.env.INSTAGRAM_REDIRECT_URI = "http://localhost:3000/api/instagram/oauth/callback";
  resetEnvForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env.INSTAGRAM_PROVIDER = "fake";
  resetEnvForTests();
});

describe("OAuth com reconexão direcionada", () => {
  it("vincula o state à organização, ao ator e à conta alvo", async () => {
    const userId = await createUser();
    const [account] = await createAccounts(1, "alvo");

    const state = await createOauthState(TEST_ORGANIZATION_ID, userId, account.id);
    await expect(consumeOauthState(state)).resolves.toMatchObject({
      organization_id: TEST_ORGANIZATION_ID, initiated_by: userId, target_instagram_account_id: account.id,
    });
    await expect(consumeOauthState(state)).rejects.toMatchObject({ result: "state_expired" });
  });

  it("recusa conta alvo de outra organização", async () => {
    const userId = await createUser();
    const otherOrganization = await createOrganization(randomUUID());
    const [foreign] = await createAccounts(1, "alheia", otherOrganization);

    await expect(createOauthState(TEST_ORGANIZATION_ID, userId, foreign.id)).rejects.toThrow("não encontrada");
  });

  it("reconecta a conta esperada e bloqueia outra conta sem alterar o token", async () => {
    const userId = await createUser();
    const [expected, other] = await createAccounts(2, "reconexao");

    metaReturns(other.instagram_user_id);
    const wrongState = await createOauthState(TEST_ORGANIZATION_ID, userId, expected.id);
    await expect(connectFromAuthorizationCode("code", wrongState)).rejects.toMatchObject({ result: "wrong_reconnect_account" });
    const [untouched] = await getSqlClient()<{ encrypted_access_token: string | null }[]>`
      SELECT encrypted_access_token FROM instagram_accounts WHERE id = ${other.id}
    `;
    expect(untouched.encrypted_access_token).toBeNull();

    metaReturns(expected.instagram_user_id);
    const rightState = await createOauthState(TEST_ORGANIZATION_ID, userId, expected.id);
    await expect(connectFromAuthorizationCode("code", rightState)).resolves.toBe(expected.id);
    const [reconnected] = await getSqlClient()<{ encrypted_access_token: string }[]>`
      SELECT encrypted_access_token FROM instagram_accounts WHERE id = ${expected.id}
    `;
    expect(decryptToken(reconnected.encrypted_access_token)).toBe(`token-${expected.instagram_user_id}`);
  });

  it("permite várias contas na mesma organização e recusa conta de outro cliente", async () => {
    const userId = await createUser();
    for (const profileId of ["multi-1", "multi-2"]) {
      metaReturns(profileId);
      await connectFromAuthorizationCode("code", await createOauthState(TEST_ORGANIZATION_ID, userId));
    }
    const [{ total }] = await getSqlClient()<{ total: number }[]>`
      SELECT count(*)::int AS total FROM instagram_accounts WHERE organization_id = ${TEST_ORGANIZATION_ID}
    `;
    expect(total).toBe(2);

    const otherOrganization = randomUUID();
    const otherUser = await createUser("outro@example.test", otherOrganization);
    metaReturns("multi-1");
    await expect(
      connectFromAuthorizationCode("code", await createOauthState(otherOrganization, otherUser)),
    ).rejects.toMatchObject({ result: "account_already_claimed" });
  });
});
