import { beforeEach, describe, expect, it, vi } from "vitest";
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
    const state = await createOauthState();
    const persistedHash = mocks.sqlCalls[0][1];

    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(persistedHash).toMatch(/^[a-f0-9]{64}$/);
    expect(persistedHash).not.toBe(state);
  });

  it("consome state uma única vez e rejeita ausente, expirado ou reutilizado", async () => {
    mocks.sqlResponses.push([{ id: "state-row" }], []);

    await expect(consumeOauthState("nonce-valido")).resolves.toBeUndefined();
    await expect(consumeOauthState("nonce-valido")).rejects.toThrow("inválido, expirado ou já utilizado");

    expect(mocks.sqlCalls[0][1]).toBe(mocks.sqlCalls[1][1]);
    expect(mocks.sqlCalls[0][1]).not.toBe("nonce-valido");
  });
});

describe("reconexão OAuth", () => {
  it("faz upsert por instagram_user_id e audita uma reconexão", async () => {
    mocks.sqlResponses.push([{ id: "state-row" }], [{ id: "account-7", inserted: false }]);
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

    expect(mocks.exchangeAuthorizationCode).toHaveBeenCalledWith("authorization-code");
    expect(mocks.getProfile).toHaveBeenCalledWith("token-meta-secreto");
    const upsertSql = (mocks.sqlCalls[1][0] as TemplateStringsArray).join(" ");
    expect(upsertSql).toContain("ON CONFLICT (instagram_user_id) DO UPDATE");
    expect(mocks.sqlCalls[1]).not.toContain("token-meta-secreto");
    expect(mocks.audit).toHaveBeenCalledWith(null, "ACCOUNT_RECONNECTED", "instagram_account", "account-7");
  });

  it("audita conexão inicial quando o upsert insere a conta", async () => {
    mocks.sqlResponses.push([{ id: "state-row" }], [{ id: "account-new", inserted: true }]);
    mocks.exchangeAuthorizationCode.mockResolvedValue({
      appScopedUserId: "app-new",
      accessToken: "token-new",
      expiresIn: 5_184_000,
    });
    mocks.getProfile.mockResolvedValue({ id: "ig-new", username: "nova_loja" });

    await connectFromAuthorizationCode("code-new", "state-new");

    expect(mocks.audit).toHaveBeenCalledWith(null, "ACCOUNT_CONNECTED", "instagram_account", "account-new");
  });
});
