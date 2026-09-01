import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";
import { assertTestDatabaseUrl } from "./tests/integration/database-safety.mjs";

const databaseUrl = assertTestDatabaseUrl(process.env.DATABASE_URL);

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.integration.test.ts"],
    setupFiles: ["./tests/integration/setup.ts"],
    fileParallelism: false,
    maxWorkers: 1,
    clearMocks: true,
    restoreMocks: true,
    hookTimeout: 30_000,
    testTimeout: 30_000,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: databaseUrl,
      DATABASE_POOL_SIZE: "20",
      APP_URL: "http://localhost:3000",
      SESSION_SECRET: "integration-test-session-secret-with-32-characters",
      TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
      INSTAGRAM_PROVIDER: "fake",
      STORAGE_PROVIDER: "local",
      FAKE_PROVIDER_SCENARIO: "success",
      JOB_LOCK_SECONDS: "30",
    },
  },
});
