import { afterAll, beforeAll, beforeEach } from "vitest";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { closeDatabase, getDb, getSqlClient } from "@/db/client";
import { resetEnvForTests } from "@/lib/env";
import { assertTestDatabaseUrl } from "./database-safety.mjs";

function assertActiveTestDatabase() {
  return assertTestDatabaseUrl(process.env.DATABASE_URL);
}

async function cleanTestDatabase() {
  assertActiveTestDatabase();
  await getSqlClient()`
    TRUNCATE TABLE
      account_daily_metrics,
      account_media,
      account_group_members,
      account_groups,
      audit_logs,
      campaign_media,
      campaign_targets,
      publication_jobs,
      campaigns,
      instagram_accounts,
      login_attempts,
      media_assets,
      oauth_states,
      settings,
      worker_heartbeats,
      users
    RESTART IDENTITY CASCADE
  `;
}

beforeAll(async () => {
  assertActiveTestDatabase();
  resetEnvForTests();
  await migrate(getDb(), { migrationsFolder: "db/migrations" });
});

beforeEach(async () => {
  resetEnvForTests();
  await cleanTestDatabase();
});

afterAll(async () => {
  await cleanTestDatabase();
  resetEnvForTests();
  await closeDatabase();
});
