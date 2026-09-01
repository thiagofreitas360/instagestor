import { expect, type Page } from "@playwright/test";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import postgres from "postgres";
import { assertTestDatabaseUrl } from "../integration/database-safety.mjs";

export const adminEmail = process.env.E2E_ADMIN_EMAIL ?? process.env.ADMIN_EMAIL ?? "admin@example.test";
export const adminPassword =
  process.env.E2E_ADMIN_PASSWORD ?? process.env.ADMIN_PASSWORD ?? "local-admin-password-change-me";

export async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(adminEmail);
  await page.getByLabel("Senha").fill(adminPassword);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/dashboard(?:[/?#]|$)/);
  await expect(page.getByRole("heading", { name: /Opera.*Instagram/i })).toBeVisible();
}

export function futureLocalDateTime(minutesFromNow = 60) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(Date.now() + minutesFromNow * 60_000));
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}T${value.hour}:${value.minute}`;
}

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function databaseUrl() {
  const value = process.env.DATABASE_URL;
  return assertTestDatabaseUrl(value);
}

export async function withE2EDatabase<T>(operation: (sql: postgres.Sql) => Promise<T>) {
  const sql = postgres(databaseUrl(), { max: 2, prepare: false });
  try {
    return await operation(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function resetPublishingFixture() {
  await withE2EDatabase(async (sql) => {
    await sql`
      TRUNCATE TABLE
        worker_heartbeats,
        publication_jobs,
        campaign_targets,
        campaign_media,
        campaigns,
        account_group_members,
        account_groups,
        instagram_accounts,
        media_assets,
        audit_logs
      RESTART IDENTITY CASCADE
    `;
  });
}

export type CampaignJobState = {
  campaignId: string;
  campaignStatus: string;
  total: number;
  queued: number;
  retrying: number;
  failed: number;
  published: number;
  attemptCount: number;
  lastErrorCode: string | null;
};

export async function readCampaignJobState(campaignName: string): Promise<CampaignJobState | null> {
  return withE2EDatabase(async (sql) => {
    const [row] = await sql<Array<{
      campaign_id: string;
      campaign_status: string;
      total: number;
      queued: number;
      retrying: number;
      failed: number;
      published: number;
      attempt_count: number;
      last_error_code: string | null;
    }>>`
      SELECT campaign.id AS campaign_id, campaign.status AS campaign_status,
        count(job.id)::int AS total,
        count(job.id) FILTER (WHERE job.status = 'QUEUED')::int AS queued,
        count(job.id) FILTER (WHERE job.status = 'RETRY_WAIT')::int AS retrying,
        count(job.id) FILTER (WHERE job.status = 'FAILED')::int AS failed,
        count(job.id) FILTER (WHERE job.status = 'PUBLISHED')::int AS published,
        coalesce(max(job.attempt_count), 0)::int AS attempt_count,
        max(job.last_error_code) AS last_error_code
      FROM campaigns campaign
      LEFT JOIN publication_jobs job ON job.campaign_id = campaign.id
      WHERE campaign.name = ${campaignName}
      GROUP BY campaign.id, campaign.status
      ORDER BY campaign.created_at DESC
      LIMIT 1
    `;
    if (!row) return null;
    return {
      campaignId: row.campaign_id,
      campaignStatus: row.campaign_status,
      total: row.total,
      queued: row.queued,
      retrying: row.retrying,
      failed: row.failed,
      published: row.published,
      attemptCount: row.attempt_count,
      lastErrorCode: row.last_error_code,
    };
  });
}

export async function waitForCampaignJobState(
  campaignName: string,
  predicate: (state: CampaignJobState) => boolean,
  options: { timeoutMs?: number; description?: string } = {},
) {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const deadline = Date.now() + timeoutMs;
  let latest: CampaignJobState | null = null;
  while (Date.now() < deadline) {
    latest = await readCampaignJobState(campaignName);
    if (latest && predicate(latest)) return latest;
    await delay(200);
  }
  throw new Error(
    `Tempo esgotado aguardando ${options.description ?? "estado da campanha"} para ${campaignName}. `
      + `Último estado: ${JSON.stringify(latest)}`,
  );
}

export async function makeCampaignRetryImmediately(campaignName: string) {
  await withE2EDatabase(async (sql) => {
    await sql`
      UPDATE publication_jobs job
      SET next_attempt_at = now() - interval '1 second', updated_at = now()
      FROM campaigns campaign
      WHERE campaign.id = job.campaign_id
        AND campaign.name = ${campaignName}
        AND job.status = 'RETRY_WAIT'
    `;
  });
}

type FakeScenario =
  | "success"
  | "http_400"
  | "http_401"
  | "http_403"
  | "http_429"
  | "http_500"
  | "timeout"
  | "transient"
  | "permanent"
  | "ambiguous_publish"
  | "token_expired";

export type RunningWorker = {
  pid: number;
  stop: () => Promise<void>;
};

function waitForExit(child: ChildProcessWithoutNullStreams) {
  return new Promise<number | null>((resolve) => {
    if (child.exitCode !== null) {
      resolve(child.exitCode);
      return;
    }
    child.once("exit", (code) => resolve(code));
  });
}

export async function startFakeWorker(scenario: FakeScenario): Promise<RunningWorker> {
  const child = spawn(process.execPath, ["--import", "tsx", "worker/index.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl(),
      NODE_ENV: "test",
      INSTAGRAM_PROVIDER: "fake",
      ALLOW_FAKE_PROVIDER_IN_PRODUCTION: "true",
      FAKE_PROVIDER_SCENARIO: scenario,
      WORKER_CONCURRENCY: "16",
      DATABASE_POOL_SIZE: "24",
      META_GLOBAL_CONCURRENCY: "16",
      META_ACCOUNT_CONCURRENCY: "1",
      WORKER_POLL_MS: "250",
      CONTAINER_POLL_SECONDS: "1",
      JOB_LOCK_SECONDS: "30",
    },
    stdio: "pipe",
  });
  const pid = child.pid;
  if (!pid) throw new Error("Não foi possível iniciar o subprocesso do worker E2E");

  let output = "";
  const collect = (chunk: Buffer) => {
    output = `${output}${chunk.toString("utf8")}`.slice(-12_000);
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);

  const startupDeadline = Date.now() + 20_000;
  while (Date.now() < startupDeadline) {
    if (child.exitCode !== null) {
      throw new Error(`Worker E2E (${scenario}) encerrou durante a inicialização.\n${output}`);
    }
    const started = await withE2EDatabase(async (sql) => {
      const [row] = await sql<Array<{ online: boolean }>>`
        SELECT true AS online
        FROM worker_heartbeats
        WHERE worker_id LIKE ${`%-${pid}-%`}
          AND last_seen_at >= now() - interval '30 seconds'
        LIMIT 1
      `;
      return Boolean(row?.online);
    });
    if (started) break;
    await delay(100);
  }

  if (Date.now() >= startupDeadline) {
    child.kill("SIGTERM");
    throw new Error(`Worker E2E (${scenario}) não registrou heartbeat.\n${output}`);
  }

  let stopPromise: Promise<void> | undefined;
  return {
    pid,
    stop() {
      if (stopPromise) return stopPromise;
      stopPromise = (async () => {
        if (child.exitCode !== null) {
          if (child.exitCode !== 0) throw new Error(`Worker E2E (${scenario}) encerrou com código ${child.exitCode}.\n${output}`);
          return;
        }
        child.kill("SIGTERM");
        const graceful = await Promise.race([
          waitForExit(child).then((code) => ({ exited: true as const, code })),
          delay(10_000).then(() => ({ exited: false as const, code: null })),
        ]);
        if (!graceful.exited) {
          child.kill("SIGKILL");
          await waitForExit(child);
        }
        await withE2EDatabase(async (sql) => {
          await sql`DELETE FROM worker_heartbeats WHERE worker_id LIKE ${`%-${pid}-%`}`;
        });
        // No Windows, child.kill("SIGTERM") encerra o processo com exitCode null.
        // Como o sinal foi solicitado por este helper, null também é um término esperado.
        if (graceful.exited && graceful.code !== 0 && graceful.code !== null) {
          throw new Error(`Worker E2E (${scenario}) encerrou com código ${graceful.code}.\n${output}`);
        }
      })();
      return stopPromise;
    },
  };
}
