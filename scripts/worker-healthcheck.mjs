import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
const hostname = process.env.HOSTNAME;

if (!databaseUrl || !hostname) process.exit(1);

const sql = postgres(databaseUrl, { max: 1, connect_timeout: 3, idle_timeout: 1, prepare: false });

try {
  const workerPrefix = `${hostname}-%`;
  const rows = await sql`
    SELECT 1
    FROM worker_heartbeats
    WHERE worker_id LIKE ${workerPrefix}
      AND last_seen_at > now() - interval '30 seconds'
    LIMIT 1
  `;
  process.exitCode = rows.length === 1 ? 0 : 1;
} catch {
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 1 });
}
