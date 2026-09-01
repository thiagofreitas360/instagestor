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
    include: ["tests/db-load/**/*.db-load.test.ts"],
    setupFiles: ["./tests/integration/setup.ts"],
    fileParallelism: false,
    maxWorkers: 1,
    clearMocks: true,
    restoreMocks: true,
    hookTimeout: 60_000,
    testTimeout: 300_000,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: databaseUrl,
      DATABASE_POOL_SIZE: "40",
      APP_URL: "http://localhost:3000",
      SESSION_SECRET: "database-load-test-session-secret-with-32-characters",
      TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 17).toString("base64"),
      INSTAGRAM_PROVIDER: "fake",
      STORAGE_PROVIDER: "local",
      FAKE_PROVIDER_SCENARIO: "success",
      WORKER_CONCURRENCY: "32",
      META_GLOBAL_CONCURRENCY: "32",
      META_ACCOUNT_CONCURRENCY: "1",
      JOB_LOCK_SECONDS: "30",
      CONTAINER_POLL_SECONDS: "1",
    },
  },
});
