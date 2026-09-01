import { defineConfig, devices } from "@playwright/test";
import { assertTestDatabaseUrl } from "./tests/integration/database-safety.mjs";

assertTestDatabaseUrl(process.env.DATABASE_URL);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? process.env.APP_URL ?? "http://localhost:3000";
const targetURL = new URL(baseURL);
const webHostname = targetURL.hostname;
const webPort = targetURL.port || (targetURL.protocol === "https:" ? "443" : "80");
const webServerCommand = process.env.PLAYWRIGHT_WEB_SERVER_COMMAND
  ?? `pnpm db:migrate && pnpm db:seed && pnpm exec next dev --hostname ${webHostname} --port ${webPort}`;

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "test-results/e2e-artifacts",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: webServerCommand,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "pipe" as const,
    stderr: "pipe" as const,
  },
});
