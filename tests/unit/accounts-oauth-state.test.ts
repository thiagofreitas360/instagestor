import { beforeEach, describe, expect, it, vi } from "vitest";
import { encryptToken } from "@/lib/crypto";
import { resetEnvForTests } from "@/lib/env";

const mocks = vi.hoisted(() => ({
  sqlCalls: [] as unknown[][],
  sqlResponses: [] as unknown[],
  exchangeAuthorizationCode: vi.fn(),
  getProfile: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@/db/client", () => {
  const sql = (...args: unknown[]) => {
    mocks.sqlCalls.push(args);
    return Promise.resolve(mocks.sqlResponses.shift() ?? []);
  };
  Object.assign(sql, {
    begin: async (callback: (transaction: typeof sql) => unknown) => callback(sql),
  });
  return { getSqlClient: () => sql };
});

vi.mock("@/providers", () => ({
  getInstagramProvider: vi.fn(),
  MetaInstagramProvider: class {
    exchangeAuthorizationCode = mocks.exchangeAuthorizationCode;
    getProfile = mocks.getProfile;
  },
}));

vi.mock("@/server/auth", () => ({ audit: mocks.audit }));

import { connectFromAuthorizationCode, consumeOauthState, createOauthState } from "@/server/accounts";

beforeEach(() => {
  mocks.sqlCalls.length = 0;
  mocks.sqlResponses.length = 0;
  mocks.exchangeAuthorizationCode.mockReset();
  mocks.getProfile.mockReset();
  mocks.audit.mockReset();
  process.env.INSTAGRAM_PROVIDER = "meta";
  process.env.INSTAGRAM_APP_ID = "app-123";
  process.env.INSTAGRAM_APP_SECRET = "oauth-state-test-secret";
  process.env.INSTAGRAM_REDIRECT_URI = "http://localhost:3000/api/instagram/oauth/callback";
  resetEnvForTests();
});

describe("OAuth state", () => {
  it("persiste somente o hash SHA-256 de um nonce forte", async () => {
    mocks.sqlResponses.push([{ id: "state-row" }]);
    const state = await createOauthState("org-1", "user-1");
    const persistedHash = mocks.sqlCalls[0][3];

    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(persistedHash).toMatch(/^[a-f0-9]{64}$/);
    expect(persistedHash).not.toBe(state);
  });

  it("grava a conta alvo da reconexão e recusa conta fora da organização", async () => {
    mocks.sqlResponses.push([{ id: "state-row" }], []);

    await createOauthState("org-1", "user-1", "account-7");
    expect(mocks.sqlCalls[0]).toContain("account-7");
    expect((mocks.sqlCalls[0][0] as TemplateStringsArray).join(" ")).toContain("organization_id =");

    await expect(createOauthState("org-1", "user-1", "account-de-outro-cliente")).rejects.toThrow("não encontrada");
  });

  it("consome state uma única vez e rejeita ausente, expirado ou reutilizado", async () => {
    mocks.sqlResponses.push(
      [{ id: "state-row", organization_id: "org-1", initiated_by: "user-1" }],
      [],
    );

    await expect(consumeOauthState("nonce-valido")).resolves.toMatchObject({ organization_id: "org-1", initiated_by: "user-1" });
    await expect(consumeOauthState("nonce-valido")).rejects.toThrow("inválido, expirado ou já utilizado");

    expect(mocks.sqlCalls[0][1]).toBe(mocks.sqlCalls[1][1]);
    expect(mocks.sqlCalls[0][1]).not.toBe("nonce-valido");
  });
});

describe("reconexão OAuth", () => {
  it("faz upsert por instagram_user_id e audita uma reconexão", async () => {
    mocks.sqlResponses.push(
      [{ id: "state-row", organization_id: "org-1", initiated_by: "user-1" }],
      [],
      [{ id: "account-7", inserted: false }],
    );
    mocks.exchangeAuthorizationCode.mockResolvedValue({
      appScopedUserId: "app-scoped-7",
      accessToken: "token-meta-secreto",
      expiresIn: 5_184_000,
    });
    mocks.getProfile.mockResolvedValue({
      id: "instagram-professional-7",
      appScopedUserId: "app-scoped-7",
      username: "loja_7",
      accountType: "BUSINESS",
    });

    await expect(connectFromAuthorizationCode("authorization-code", "oauth-state")).resolves.toBe("account-7");

    expect(mocks.exchangeAuthorizationCode).toHaveBeenCalledWith("authorization-code", undefined);
    expect(mocks.getProfile).toHaveBeenCalledWith("token-meta-secreto");
    const upsertSql = (mocks.sqlCalls[2][0] as TemplateStringsArray).join(" ");
    expect(upsertSql).toContain("ON CONFLICT (instagram_user_id) DO UPDATE");
    expect(mocks.sqlCalls[2]).not.toContain("token-meta-secreto");
    expect(mocks.audit).toHaveBeenCalledWith("org-1", "user-1", "ACCOUNT_RECONNECTED", "instagram_account", "account-7");
  });

  it("recusa reconexão quando a Meta devolve outra conta, sem gravar token", async () => {
    mocks.sqlResponses.push(
      [{ id: "state-row", organization_id: "org-1", initiated_by: "user-1", target_instagram_account_id: "account-7" }],
      [{ id: "account-9", organization_id: "org-1" }],
    );
    mocks.exchangeAuthorizationCode.mockResolvedValue({ appScopedUserId: "a9", accessToken: "t9", expiresIn: 1 });
    mocks.getProfile.mockResolvedValue({ id: "ig-9", username: "outra_conta" });

    await expect(connectFromAuthorizationCode("code", "state")).rejects.toMatchObject({ result: "wrong_reconnect_account" });
    expect(mocks.sqlCalls).toHaveLength(2);
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("recusa conta já vinculada a outra organização", async () => {
    mocks.sqlResponses.push(
      [{ id: "state-row", organization_id: "org-1", initiated_by: "user-1", target_instagram_account_id: null }],
      [{ id: "account-x", organization_id: "org-2" }],
    );
    mocks.exchangeAuthorizationCode.mockResolvedValue({ appScopedUserId: "ax", accessToken: "tx", expiresIn: 1 });
    mocks.getProfile.mockResolvedValue({ id: "ig-x", username: "de_outro" });

    await expect(connectFromAuthorizationCode("code", "state")).rejects.toMatchObject({ result: "account_already_claimed" });
    expect(mocks.sqlCalls).toHaveLength(2);
  });

  it("audita conexão inicial quando o upsert insere a conta", async () => {
    mocks.sqlResponses.push(
      [{ id: "state-row", organization_id: "org-1", initiated_by: "user-1" }],
      [],
      [{ id: "account-new", inserted: true }],
    );
    mocks.exchangeAuthorizationCode.mockResolvedValue({
      appScopedUserId: "app-new",
      accessToken: "token-new",
      expiresIn: 5_184_000,
    });
    mocks.getProfile.mockResolvedValue({ id: "ig-new", username: "nova_loja" });

    await connectFromAuthorizationCode("code-new", "state-new");

    expect(mocks.audit).toHaveBeenCalledWith("org-1", "user-1", "ACCOUNT_CONNECTED", "instagram_account", "account-new");
  });

  it("troca o código com o Meta App do state e grava o vínculo na conta", async () => {
    mocks.sqlResponses.push(
      [{ id: "state-row", organization_id: "org-1", initiated_by: "user-1", meta_app_id: "meta-app-1" }],
      [{ app_id: "1234567890123", encrypted_app_secret: encryptToken("secret-do-cliente") }],
      [],
      [{ id: "account-new", inserted: true }],
    );
    mocks.exchangeAuthorizationCode.mockResolvedValue({ appScopedUserId: "a1", accessToken: "t1", expiresIn: 1 });
    mocks.getProfile.mockResolvedValue({ id: "ig-1", username: "via_app" });

    await connectFromAuthorizationCode("code", "state");

    expect(mocks.sqlCalls[1]).toContain("org-1");
    expect(mocks.exchangeAuthorizationCode).toHaveBeenCalledWith("code", {
      appId: "1234567890123", appSecret: "secret-do-cliente",
    });
    expect(mocks.sqlCalls[3]).toContain("meta-app-1");
  });
});
