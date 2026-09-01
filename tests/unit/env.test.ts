import { describe, expect, it, vi } from "vitest";
import { getEnv, resetEnvForTests } from "@/lib/env";

function configureProductionMeta() {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("INSTAGRAM_PROVIDER", "meta");
  vi.stubEnv("APP_URL", "https://gestor.example.test");
  vi.stubEnv("INSTAGRAM_APP_ID", "app-id");
  vi.stubEnv("INSTAGRAM_APP_SECRET", "app-secret");
  vi.stubEnv("INSTAGRAM_REDIRECT_URI", "https://gestor.example.test/api/instagram/oauth/callback");
  resetEnvForTests();
}

describe("validação do ambiente", () => {
  it("bloqueia segredos de exemplo em produção Meta", () => {
    configureProductionMeta();
    vi.stubEnv("SESSION_SECRET", "local-development-session-secret-change-before-production");
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=");
    resetEnvForTests();

    expect(() => getEnv()).toThrow(/de exemplo/);
  });

  it("exige HTTPS para o app e redirect Meta em produção", () => {
    configureProductionMeta();
    vi.stubEnv("APP_URL", "http://gestor.example.test");
    vi.stubEnv("INSTAGRAM_REDIRECT_URI", "http://gestor.example.test/api/instagram/oauth/callback");
    resetEnvForTests();

    expect(() => getEnv()).toThrow(/HTTPS/);
  });

  it("mantém o Compose fake local possível somente com opt-in explícito", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("INSTAGRAM_PROVIDER", "fake");
    vi.stubEnv("ALLOW_FAKE_PROVIDER_IN_PRODUCTION", "true");
    vi.stubEnv("APP_URL", "http://localhost:3000");
    vi.stubEnv("SESSION_SECRET", "local-development-session-secret-change-before-production");
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=");
    resetEnvForTests();

    expect(getEnv().INSTAGRAM_PROVIDER).toBe("fake");
  });

  it("rejeita base64 não canônico e upload acima do teto suportado", () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", `${Buffer.alloc(32, 7).toString("base64")}lixo`);
    vi.stubEnv("UPLOAD_MAX_BYTES", "300000001");
    resetEnvForTests();

    expect(() => getEnv()).toThrow();
  });
});
