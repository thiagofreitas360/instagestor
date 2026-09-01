import { migrate } from "drizzle-orm/postgres-js/migrator";
import { closeDatabase, getDb } from "./client";

async function main() {
  await migrate(getDb(), { migrationsFolder: "db/migrations" });
  await closeDatabase();
}

main().catch(async (error) => {
  console.error("Falha ao executar migrations", error instanceof Error ? error.message : error);
  await closeDatabase();
  process.exitCode = 1;
});
