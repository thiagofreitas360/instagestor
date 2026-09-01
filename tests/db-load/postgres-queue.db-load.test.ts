import { performance } from "node:perf_hooks";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSqlClient } from "@/db/client";
import { claimJob, processClaimedJob, recoverStaleJobs, type ClaimedJob } from "@/jobs/queue";
import { encryptToken } from "@/lib/crypto";
import { createUser } from "../integration/helpers";

const ACCOUNT_COUNT = 50;
const CLAIM_BATCH_SIZE = 32;

type Delivery = { job: ClaimedJob; workerId: string };

type ClaimTracker = {
  deliveries: number;
  deliveryKeys: Set<string>;
  claimsByJob: Map<string, number>;
};

function createClaimTracker(): ClaimTracker {
  return { deliveries: 0, deliveryKeys: new Set(), claimsByJob: new Map() };
}

function recordDelivery(tracker: ClaimTracker, delivery: Delivery) {
  const key = `${delivery.job.id}:${delivery.job.fencing_token}`;
  expect(tracker.deliveryKeys.has(key), `claim repetido para ${key}`).toBe(false);
  tracker.deliveryKeys.add(key);
  tracker.deliveries++;
  tracker.claimsByJob.set(delivery.job.id, (tracker.claimsByJob.get(delivery.job.id) ?? 0) + 1);
}

async function seedQueue(size: number) {
  const sql = getSqlClient();
  const actorUserId = await createUser(`db-load-${size}@example.test`);
  const jobsPerAccount = size / ACCOUNT_COUNT;
  const now = new Date();
  const dueAt = new Date(now.getTime() - 60_000).toISOString();

  const accounts = await sql<Array<{ id: string; instagram_user_id: string }>>`
    INSERT INTO instagram_accounts ${sql(
      Array.from({ length: ACCOUNT_COUNT }, (_, index) => ({
        instagram_user_id: `db-load-${size}-ig-${index.toString().padStart(2, "0")}`,
        username: `db_load_${size}_${index.toString().padStart(2, "0")}`,
        status: "CONNECTED",
        encrypted_access_token: encryptToken(`fake-token:${size}-${index}:db_load_${index}`),
        publishing_limit_usage: 0,
        publishing_limit_total: jobsPerAccount + 10,
        publishing_limit_checked_at: now.toISOString(),
      })),
    )}
    RETURNING id, instagram_user_id
  `;

  const campaigns = await sql<Array<{ id: string }>>`
    INSERT INTO campaigns ${sql(
      Array.from({ length: jobsPerAccount }, (_, index) => ({
        name: `DB load ${size} / ${index + 1}`,
        publication_type: "FEED_IMAGE",
        status: "SCHEDULED",
        start_at: dueAt,
        timezone: "UTC",
        delay_mode: "FIXED",
        delay_fixed_seconds: 0,
        target_order: "SELECTED",
        created_by: actorUserId,
        scheduled_at: now.toISOString(),
      })),
    )}
    RETURNING id
  `;

  const [asset] = await sql<Array<{ id: string }>>`
    INSERT INTO media_assets (
      original_filename, storage_provider, storage_key, mime_type, media_kind,
      size_bytes, checksum_sha256, width, height, processing_status
    ) VALUES (
      ${`db-load-${size}.jpg`}, 'LOCAL', ${`db-load/${size}.jpg`}, 'image/jpeg', 'IMAGE',
      1024, ${"a".repeat(64)}, 1080, 1080, 'READY'
    )
    RETURNING id
  `;

  await sql`
    INSERT INTO campaign_media ${sql(
      campaigns.map((campaign) => ({ campaign_id: campaign.id, media_asset_id: asset.id, position: 0 })),
    )}
  `;

  const targets = campaigns.flatMap((campaign) =>
    accounts.map((account, position) => ({
      campaign_id: campaign.id,
      instagram_account_id: account.id,
      position,
      scheduled_at: dueAt,
    })),
  );
  await sql`INSERT INTO campaign_targets ${sql(targets)}`;

  const seededJobs = await sql<Array<{ id: string }>>`
    INSERT INTO publication_jobs ${sql(
      targets.map((target) => ({
        campaign_id: target.campaign_id,
        instagram_account_id: target.instagram_account_id,
        scheduled_at: target.scheduled_at,
        status: "QUEUED",
        max_attempts: 5,
      })),
    )}
    RETURNING id
  `;

  return {
    accountIds: accounts.map((account) => account.id),
    campaignIds: campaigns.map((campaign) => campaign.id),
    jobIds: seededJobs.map((job) => job.id),
  };
}

async function exerciseLeaseRecovery(size: number, tracker: ClaimTracker) {
  const sql = getSqlClient();
  const staleWorkerId = `db-load-${size}-stale-worker`;
  const oldClaim = await claimJob(staleWorkerId);
  expect(oldClaim).not.toBeNull();
  recordDelivery(tracker, { job: oldClaim!, workerId: staleWorkerId });

  await sql`
    UPDATE publication_jobs
    SET lock_expires_at = now() - interval '1 second'
    WHERE id = ${oldClaim!.id}
  `;
  await expect(recoverStaleJobs()).resolves.toEqual({ ambiguous: 0, retryable: 1 });
  await sql`
    UPDATE publication_jobs
    SET next_attempt_at = now() - interval '1 day'
    WHERE id = ${oldClaim!.id}
  `;

  const replacementWorkerId = `db-load-${size}-replacement-worker`;
  const replacementClaim = await claimJob(replacementWorkerId);
  expect(replacementClaim).not.toBeNull();
  expect(replacementClaim!.id).toBe(oldClaim!.id);
  expect(replacementClaim!.fencing_token).toBeGreaterThan(oldClaim!.fencing_token);
  recordDelivery(tracker, { job: replacementClaim!, workerId: replacementWorkerId });

  await processClaimedJob(oldClaim!, staleWorkerId);
  const [stillOwnedByReplacement] = await sql<Array<{
    status: string;
    locked_by: string | null;
    fencing_token: number;
  }>>`
    SELECT status, locked_by, fencing_token::int
    FROM publication_jobs
    WHERE id = ${oldClaim!.id}
  `;
  expect(stillOwnedByReplacement).toEqual({
    status: "CLAIMED",
    locked_by: replacementWorkerId,
    fencing_token: replacementClaim!.fencing_token,
  });

  await processClaimedJob(replacementClaim!, replacementWorkerId);
}

async function claimBatch(size: number, sequence: number) {
  const requests = Array.from({ length: CLAIM_BATCH_SIZE }, (_, index) => ({
    workerId: `db-load-${size}-worker-${sequence}-${index}`,
  }));
  const claims = await Promise.all(requests.map(({ workerId }) => claimJob(workerId)));
  return claims.flatMap((job, index): Delivery[] => job ? [{ job, workerId: requests[index].workerId }] : []);
}

async function drainQueue(size: number, tracker: ClaimTracker) {
  const sql = getSqlClient();
  const deadline = Date.now() + 240_000;
  let sequence = 0;
  let idlePolls = 0;

  while (Date.now() < deadline) {
    const [progress] = await sql<Array<{ terminal: number }>>`
      SELECT count(*) FILTER (
        WHERE status IN ('PUBLISHED', 'FAILED', 'CANCELLED', 'RECONCILIATION_REQUIRED')
      )::int AS terminal
      FROM publication_jobs
    `;
    if (progress.terminal === size) return;

    const deliveries = await claimBatch(size, sequence++);
    const idsInBatch = deliveries.map(({ job }) => job.id);
    expect(new Set(idsInBatch).size, "SKIP LOCKED entregou o mesmo job duas vezes no lote").toBe(idsInBatch.length);
    for (const delivery of deliveries) recordDelivery(tracker, delivery);

    if (deliveries.length) {
      idlePolls = 0;
      await Promise.all(deliveries.map(({ job, workerId }) => processClaimedJob(job, workerId)));
    } else {
      idlePolls++;
      expect(idlePolls, "fila deixou de progredir antes do prazo").toBeLessThan(100);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  throw new Error(`Fila de ${size} jobs não terminou em 240 segundos`);
}

async function assertFinalState(
  size: number,
  seeded: Awaited<ReturnType<typeof seedQueue>>,
  tracker: ClaimTracker,
) {
  const sql = getSqlClient();
  await recoverStaleJobs();

  const [jobs] = await sql<Array<{
    total: number;
    published: number;
    failed: number;
    unlocked: number;
    unique_containers: number;
    unique_media: number;
    fence_total: string;
  }>>`
    SELECT count(*)::int AS total,
      count(*) FILTER (WHERE status = 'PUBLISHED')::int AS published,
      count(*) FILTER (WHERE status <> 'PUBLISHED')::int AS failed,
      count(*) FILTER (WHERE locked_by IS NULL AND lock_expires_at IS NULL)::int AS unlocked,
      count(DISTINCT meta_container_id)::int AS unique_containers,
      count(DISTINCT meta_media_id)::int AS unique_media,
      sum(fencing_token)::bigint::text AS fence_total
    FROM publication_jobs
  `;
  expect(jobs).toMatchObject({
    total: size,
    published: size,
    failed: 0,
    unlocked: size,
    unique_containers: size,
    unique_media: size,
  });
  // Um incremento extra vem da recuperação intencional do lease expirado.
  expect(Number(jobs.fence_total)).toBe(tracker.deliveries + 1);

  const [distribution] = await sql<Array<{
    account_count: number;
    min_jobs: number;
    max_jobs: number;
  }>>`
    SELECT count(*)::int AS account_count,
      min(job_count)::int AS min_jobs,
      max(job_count)::int AS max_jobs
    FROM (
      SELECT instagram_account_id, count(*)::int AS job_count
      FROM publication_jobs
      GROUP BY instagram_account_id
    ) account_jobs
  `;
  expect(distribution).toEqual({
    account_count: ACCOUNT_COUNT,
    min_jobs: size / ACCOUNT_COUNT,
    max_jobs: size / ACCOUNT_COUNT,
  });

  const [campaigns] = await sql<Array<{ total: number; completed: number }>>`
    SELECT count(*)::int AS total,
      count(*) FILTER (WHERE status = 'COMPLETED')::int AS completed
    FROM campaigns
  `;
  expect(campaigns).toEqual({ total: size / ACCOUNT_COUNT, completed: size / ACCOUNT_COUNT });

  const [persisted] = await sql<Array<{
    accounts: number;
    campaigns: number;
    targets: number;
    jobs: number;
  }>>`
    SELECT
      (SELECT count(*)::int FROM instagram_accounts WHERE id = ANY(${seeded.accountIds}::uuid[])) AS accounts,
      (SELECT count(*)::int FROM campaigns WHERE id = ANY(${seeded.campaignIds}::uuid[])) AS campaigns,
      (SELECT count(*)::int FROM campaign_targets WHERE campaign_id = ANY(${seeded.campaignIds}::uuid[])) AS targets,
      (SELECT count(*)::int FROM publication_jobs WHERE id = ANY(${seeded.jobIds}::uuid[])) AS jobs
  `;
  expect(persisted).toEqual({
    accounts: ACCOUNT_COUNT,
    campaigns: size / ACCOUNT_COUNT,
    targets: size,
    jobs: size,
  });
  expect(tracker.claimsByJob.size).toBe(size);
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe.each([150, 500, 1_000])("fila PostgreSQL real com %i jobs", (size) => {
  it("persiste, faz claim concorrente com leases/fencing e conclui sem perdas ou duplicatas", async () => {
    const startedAt = performance.now();
    const seeded = await seedQueue(size);
    expect(seeded.jobIds).toHaveLength(size);
    expect(new Set(seeded.jobIds).size).toBe(size);

    const tracker = createClaimTracker();
    await exerciseLeaseRecovery(size, tracker);
    await drainQueue(size, tracker);
    await assertFinalState(size, seeded, tracker);

    const durationSeconds = (performance.now() - startedAt) / 1_000;
    process.stdout.write(
      `[db-load] ${size} jobs / ${ACCOUNT_COUNT} contas: ${tracker.deliveries} claims em ${durationSeconds.toFixed(2)}s\n`,
    );
  });
});
