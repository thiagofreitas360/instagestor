import { afterEach, beforeEach, vi } from "vitest";
import { resetEnvForTests } from "@/lib/env";

const testEnvironment = {
  NODE_ENV: "test",
  DATABASE_URL: "postgres://unit:unit@127.0.0.1:5432/unit_not_connected",
  APP_URL: "http://localhost:3000",
  SESSION_SECRET: "unit-test-session-secret-with-32-characters",
  TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  INSTAGRAM_PROVIDER: "fake",
  STORAGE_PROVIDER: "local",
  FAKE_PROVIDER_SCENARIO: "success",
  UPLOAD_MAX_BYTES: "300000000",
} as const;

beforeEach(() => {
  for (const [name, value] of Object.entries(testEnvironment)) vi.stubEnv(name, value);
  resetEnvForTests();
});

afterEach(() => {
  resetEnvForTests();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
