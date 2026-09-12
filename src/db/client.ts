import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const globalDatabase = globalThis as unknown as {
  sqlClient?: ReturnType<typeof postgres>;
};

export function getSqlClient() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não configurada");

  if (!globalDatabase.sqlClient) {
    globalDatabase.sqlClient = postgres(url, {
      max: Number(process.env.DATABASE_POOL_SIZE ?? 10),
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
      types: {
        // ponytail: jsonb params are always pre-stringified here (`${JSON.stringify(x)}::jsonb`). postgres.js would
        // JSON.stringify them again in production (drizzle's driver already disables that in tests) — send as-is.
        json: { to: 114, from: [114, 3802], serialize: (value: string) => value, parse: (value: string) => JSON.parse(value) },
      },
    });
  }
  return globalDatabase.sqlClient;
}

export function getDb() {
  return drizzle(getSqlClient(), { schema });
}

export async function closeDatabase() {
  if (!globalDatabase.sqlClient) return;
  await globalDatabase.sqlClient.end({ timeout: 5 });
  globalDatabase.sqlClient = undefined;
}
