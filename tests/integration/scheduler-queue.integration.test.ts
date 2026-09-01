import { describe, expect, it } from "vitest";
import { getSqlClient } from "@/db/client";
import { claimJob, processClaimedJob, recoverStaleJobs } from "@/jobs/queue";
import { resetEnvForTests } from "@/lib/env";
import { createCampaign as createContentCampaign, resolveTargetIds } from "@/server/campaigns";
import { cancelCampaign, pauseCampaign, resumeCampaign, scheduleCampaign } from "@/server/scheduler";
import { assertTestDatabaseUrl } from "./database-safety.mjs";
import { createAccounts, createCampaign, createJobs, createUser } from "./helpers";

describe("proteção do banco de integração", () => {
  it("aceita somente DATABASE_URL cujo banco termine exatamente em _test", () => {
    expect(() => assertTestDatabaseUrl("postgresql://user:secret@localhost:5432/instagestor"))
      .toThrow(/não termina em "_test"/);
    expect(() => assertTestDatabaseUrl("postgresql://user:secret@localhost:5432/contest_production"))
      .toThrow(/não termina em "_test"/);
    expect(assertTestDatabaseUrl("postgresql://user:secret@localhost:5432/instagestor_test"))
      .toContain("instagestor_test");
  });
});

describe("scheduler e snapshot de destinos", () => {
  it("preserva a ordem de contas individuais e depois a ordem dos grupos selecionados", async () => {
    const sql = getSqlClient();
    const accounts = await createAccounts(4, "order");
    const groups = await sql<Array<{ id: string; name: string }>>`
      INSERT INTO account_groups (name) VALUES ('Grupo A'), ('Grupo B') RETURNING id, name
    `;
    const groupA = groups.find((group) => group.name === "Grupo A")!;
    const groupB = groups.find((group) => group.name === "Grupo B")!;
    await sql`
      INSERT INTO account_group_members (group_id, instagram_account_id)
      VALUES (${groupA.id}, ${accounts[0].id}), (${groupB.id}, ${accounts[2].id})
    `;

    await expect(resolveTargetIds({
      accountIds: [accounts[3].id, accounts[1].id],
      groupIds: [groupB.id, groupA.id],
    })).resolves.toEqual([accounts[3].id, accounts[1].id, accounts[2].id, accounts[0].id]);
  });

  it("persiste a ordem escolhida das mídias do Carousel", async () => {
    const sql = getSqlClient();
    const actorUserId = await createUser("carousel-order@example.test");
    const media = await sql<Array<{ id: string }>>`
      INSERT INTO media_assets ${sql(Array.from({ length: 3 }, (_, index) => ({
        original_filename: `carousel-${index}.jpg`,
        storage_provider: "LOCAL",
        storage_key: `carousel/${index}.jpg`,
        mime_type: "image/jpeg",
        media_kind: "IMAGE",
        size_bytes: 1024,
        checksum_sha256: String(index).repeat(64),
        width: 1080,
        height: 1080,
        processing_status: "READY",
      })))}
      RETURNING id
    `;
    const chosenOrder = [media[2].id, media[0].id];
    const campaignId = await createContentCampaign({
      name: "Carousel ordenado",
      publicationType: "CAROUSEL",
      mediaIds: chosenOrder,
      actorUserId,
    });
    const persisted = await sql<Array<{ id: string }>>`
      SELECT media_asset_id AS id FROM campaign_media WHERE campaign_id = ${campaignId} ORDER BY position
    `;
    expect(persisted.map(({ id }) => id)).toEqual(chosenOrder);
  });

  it("bloqueia Story para conta Creator no provider Meta", async () => {
    const sql = getSqlClient();
    const actorUserId = await createUser("story-creator@example.test");
    const [account] = await createAccounts(1, "story_creator");
    const campaignId = await createCampaign(actorUserId);
    await sql`UPDATE instagram_accounts SET account_type = 'MEDIA_CREATOR' WHERE id = ${account.id}`;
    await sql`UPDATE campaigns SET publication_type = 'STORY_IMAGE' WHERE id = ${campaignId}`;

    const previous = {
      provider: process.env.INSTAGRAM_PROVIDER,
      appId: process.env.INSTAGRAM_APP_ID,
      appSecret: process.env.INSTAGRAM_APP_SECRET,
      redirectUri: process.env.INSTAGRAM_REDIRECT_URI,
    };
    process.env.INSTAGRAM_PROVIDER = "meta";
    process.env.INSTAGRAM_APP_ID = "test-app";
    process.env.INSTAGRAM_APP_SECRET = "test-secret";
    process.env.INSTAGRAM_REDIRECT_URI = "http://localhost:3000/api/instagram/oauth/callback";
    resetEnvForTests();
    try {
      await expect(scheduleCampaign({
        campaignId,
        targetIds: [account.id],
        startAt: new Date(),
        timezone: "UTC",
        delay: { mode: "FIXED", fixedSeconds: 0 },
        targetOrder: "SELECTED",
        actorUserId,
      })).rejects.toThrow(/somente para contas Business/);
    } finally {
      if (previous.provider === undefined) delete process.env.INSTAGRAM_PROVIDER;
      else process.env.INSTAGRAM_PROVIDER = previous.provider;
      if (previous.appId === undefined) delete process.env.INSTAGRAM_APP_ID;
      else process.env.INSTAGRAM_APP_ID = previous.appId;
      if (previous.appSecret === undefined) delete process.env.INSTAGRAM_APP_SECRET;
      else process.env.INSTAGRAM_APP_SECRET = previous.appSecret;
      if (previous.redirectUri === undefined) delete process.env.INSTAGRAM_REDIRECT_URI;
      else process.env.INSTAGRAM_REDIRECT_URI = previous.redirectUri;
      resetEnvForTests();
    }
  });

  it("agenda atomicamente 50 contas uma única vez e preserva o snapshot após o grupo mudar", async () => {
    const sql = getSqlClient();
    const actorUserId = await createUser();
    const accounts = await createAccounts(51, "snapshot");
    const selectedAccounts = accounts.slice(0, 50).reverse();
    const campaignId = await createCampaign(actorUserId);
    const [group] = await sql<{ id: string }[]>`
      INSERT INTO account_groups (name) VALUES ('Grupo original') RETURNING id
    `;
    await sql`
      INSERT INTO account_group_members ${sql(
        selectedAccounts.map((account) => ({ group_id: group.id, instagram_account_id: account.id })),
      )}
    `;

    const input = {
      campaignId,
      targetIds: selectedAccounts.map((account) => account.id),
      startAt: new Date(Date.now() - 60_000),
      timezone: "America/Sao_Paulo",
      delay: { mode: "FIXED" as const, fixedSeconds: 0 },
      targetOrder: "USERNAME" as const,
      actorUserId,
    };
    const attempts = await Promise.allSettled([scheduleCampaign(input), scheduleCampaign(input)]);
    const rejectedReasons = attempts
      .filter((attempt): attempt is PromiseRejectedResult => attempt.status === "rejected")
      .map((attempt) => attempt.reason instanceof Error ? attempt.reason.message : String(attempt.reason));

    expect(attempts.filter((attempt) => attempt.status === "fulfilled"), rejectedReasons.join(" | ")).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === "rejected")).toHaveLength(1);
    const [campaign] = await sql<Array<{ status: string; target_count: number; job_count: number; audit_count: number }>>`
      SELECT campaign.status,
        (SELECT count(*)::int FROM campaign_targets WHERE campaign_id = campaign.id) AS target_count,
        (SELECT count(*)::int FROM publication_jobs WHERE campaign_id = campaign.id) AS job_count,
        (SELECT count(*)::int FROM audit_logs WHERE entity_id = campaign.id::text AND event_type = 'CAMPAIGN_SCHEDULED') AS audit_count
      FROM campaigns campaign WHERE campaign.id = ${campaignId}
    `;
    expect(campaign).toEqual({ status: "SCHEDULED", target_count: 50, job_count: 50, audit_count: 1 });

    const originalSnapshot = await sql<Array<{ id: string; username: string; position: number }>>`
      SELECT account.id, account.username, target.position
      FROM campaign_targets target
      JOIN instagram_accounts account ON account.id = target.instagram_account_id
      WHERE target.campaign_id = ${campaignId}
      ORDER BY target.position
    `;
    expect(originalSnapshot).toHaveLength(50);
    expect(originalSnapshot.map((target) => target.username)).toEqual(
      [...selectedAccounts].map((account) => account.username).sort((left, right) => left.localeCompare(right)),
    );

    await sql`DELETE FROM account_group_members WHERE group_id = ${group.id}`;
    await sql`
      INSERT INTO account_group_members (group_id, instagram_account_id)
      VALUES (${group.id}, ${accounts[50].id})
    `;

    const snapshotAfterGroupChange = await sql<Array<{ id: string; position: number }>>`
      SELECT instagram_account_id AS id, position
      FROM campaign_targets WHERE campaign_id = ${campaignId}
      ORDER BY position
    `;
    const [jobCount] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM publication_jobs WHERE campaign_id = ${campaignId}
    `;
    expect(snapshotAfterGroupChange).toEqual(originalSnapshot.map(({ id, position }) => ({ id, position })));
    expect(jobCount.count).toBe(50);
  });

  it("reverte toda a transação quando a criação dos jobs falha", async () => {
    const sql = getSqlClient();
    const actorUserId = await createUser("rollback@example.test");
    const accounts = await createAccounts(2, "rollback");
    const campaignId = await createCampaign(actorUserId);
    await sql`
      INSERT INTO campaign_targets (campaign_id, instagram_account_id, position)
      VALUES (${campaignId}, ${accounts[0].id}, 0)
    `;
    await createJobs(campaignId, [accounts[0]]);

    await expect(scheduleCampaign({
      campaignId,
      targetIds: accounts.map((account) => account.id),
      startAt: new Date(Date.now() - 60_000),
      timezone: "UTC",
      delay: { mode: "FIXED", fixedSeconds: 0 },
      targetOrder: "SELECTED",
      actorUserId,
    })).rejects.toThrow();

    const [state] = await sql<Array<{ status: string; target_count: number; job_count: number; audit_count: number }>>`
      SELECT campaign.status,
        (SELECT count(*)::int FROM campaign_targets WHERE campaign_id = campaign.id) AS target_count,
        (SELECT count(*)::int FROM publication_jobs WHERE campaign_id = campaign.id) AS job_count,
        (SELECT count(*)::int FROM audit_logs WHERE entity_id = campaign.id::text) AS audit_count
      FROM campaigns campaign WHERE campaign.id = ${campaignId}
    `;
    expect(state).toEqual({ status: "DRAFT", target_count: 1, job_count: 1, audit_count: 0 });
  });
});

describe("claim concorrente e recuperação de leases", () => {
  it("distribui 50 jobs entre claims concorrentes sem devolver o mesmo job duas vezes", async () => {
    const sql = getSqlClient();
    const actorUserId = await createUser("claims@example.test");
    const accounts = await createAccounts(50, "claims");
    const campaignId = await createCampaign(actorUserId, "SCHEDULED", "Claims concorrentes");
    await createJobs(campaignId, accounts);

    const claims = await Promise.all(
      Array.from({ length: 100 }, (_, index) => claimJob(`worker-${index.toString().padStart(3, "0")}`)),
    );
    const claimed = claims.filter((claim) => claim !== null);

    expect(claimed).toHaveLength(50);
    expect(new Set(claimed.map((claim) => claim.id))).toHaveLength(50);
    expect(await claimJob("worker-extra")).toBeNull();
    const [state] = await sql<Array<{ claimed_count: number; worker_count: number; min_fence: number; max_fence: number }>>`
      SELECT count(*) FILTER (WHERE status = 'CLAIMED')::int AS claimed_count,
        count(DISTINCT locked_by)::int AS worker_count,
        min(fencing_token)::int AS min_fence,
        max(fencing_token)::int AS max_fence
      FROM publication_jobs WHERE campaign_id = ${campaignId}
    `;
    expect(state).toEqual({ claimed_count: 50, worker_count: 50, min_fence: 1, max_fence: 1 });
  });

  it("recupera somente locks expirados e incrementa seus fencing tokens", async () => {
    const sql = getSqlClient();
    const actorUserId = await createUser("stale@example.test");
    const accounts = await createAccounts(3, "stale");
    const campaignId = await createCampaign(actorUserId, "RUNNING", "Stale locks");
    const expiredAt = new Date(Date.now() - 60_000);
    const activeUntil = new Date(Date.now() + 60_000);
    await createJobs(campaignId, [accounts[0]], {
      status: "CLAIMED", lockedBy: "dead-a", lockExpiresAt: expiredAt, fencingToken: 7,
    });
    await createJobs(campaignId, [accounts[1]], {
      status: "WAITING_FOR_CONTAINER", lockedBy: "dead-b", lockExpiresAt: expiredAt, fencingToken: 2,
    });
    await createJobs(campaignId, [accounts[2]], {
      status: "CLAIMED", lockedBy: "alive", lockExpiresAt: activeUntil, fencingToken: 3,
    });

    await expect(recoverStaleJobs()).resolves.toEqual({ ambiguous: 0, retryable: 2 });
    const jobs = await sql<Array<{
      username: string;
      status: string;
      locked_by: string | null;
      fencing_token: number;
      last_error_code: string | null;
    }>>`
      SELECT account.username, job.status, job.locked_by, job.fencing_token::int, job.last_error_code
      FROM publication_jobs job
      JOIN instagram_accounts account ON account.id = job.instagram_account_id
      WHERE job.campaign_id = ${campaignId}
      ORDER BY account.username
    `;
    expect(jobs).toEqual([
      { username: "stale_000", status: "RETRY_WAIT", locked_by: null, fencing_token: 8, last_error_code: "STALE_LOCK_RECOVERED" },
      { username: "stale_001", status: "RETRY_WAIT", locked_by: null, fencing_token: 3, last_error_code: "STALE_LOCK_RECOVERED" },
      { username: "stale_002", status: "CLAIMED", locked_by: "alive", fencing_token: 3, last_error_code: null },
    ]);
  });

  it("envia PUBLISHING expirado para reconciliação em vez de republicá-lo", async () => {
    const sql = getSqlClient();
    const actorUserId = await createUser("publishing-stale@example.test");
    const accounts = await createAccounts(2, "publishing_stale");
    const campaignId = await createCampaign(actorUserId, "RUNNING", "Publishing stale");
    await createJobs(campaignId, [accounts[0]], {
      status: "PUBLISHING",
      lockedBy: "dead-publisher",
      lockExpiresAt: new Date(Date.now() - 60_000),
      fencingToken: 11,
    });
    await createJobs(campaignId, [accounts[1]], {
      status: "PUBLISHING",
      lockedBy: "active-publisher",
      lockExpiresAt: new Date(Date.now() + 60_000),
      fencingToken: 4,
    });

    await expect(recoverStaleJobs()).resolves.toEqual({ ambiguous: 1, retryable: 0 });
    const jobs = await sql<Array<{
      username: string;
      status: string;
      reconciliation_required: boolean;
      locked_by: string | null;
      fencing_token: number;
      last_error_code: string | null;
      finished: boolean;
    }>>`
      SELECT account.username, job.status, job.reconciliation_required, job.locked_by,
        job.fencing_token::int, job.last_error_code, job.finished_at IS NOT NULL AS finished
      FROM publication_jobs job
      JOIN instagram_accounts account ON account.id = job.instagram_account_id
      WHERE job.campaign_id = ${campaignId}
      ORDER BY account.username
    `;
    expect(jobs).toEqual([
      {
        username: "publishing_stale_000",
        status: "RECONCILIATION_REQUIRED",
        reconciliation_required: true,
        locked_by: null,
        fencing_token: 12,
        last_error_code: "STALE_DURING_PUBLISH",
        finished: true,
      },
      {
        username: "publishing_stale_001",
        status: "PUBLISHING",
        reconciliation_required: false,
        locked_by: "active-publisher",
        fencing_token: 4,
        last_error_code: null,
        finished: false,
      },
    ]);
  });

  it("rejeita a continuação de um worker com fencing token antigo", async () => {
    const sql = getSqlClient();
    const actorUserId = await createUser("fencing@example.test");
    const [account] = await createAccounts(1, "fencing");
    const campaignId = await createCampaign(actorUserId, "SCHEDULED", "Fencing antigo");
    await createJobs(campaignId, [account]);

    const oldClaim = await claimJob("worker-old");
    expect(oldClaim).not.toBeNull();
    await sql`
      UPDATE publication_jobs SET lock_expires_at = now() - interval '1 second'
      WHERE id = ${oldClaim!.id}
    `;
    await expect(recoverStaleJobs()).resolves.toEqual({ ambiguous: 0, retryable: 1 });
    const newClaim = await claimJob("worker-new");
    expect(newClaim).not.toBeNull();
    expect(BigInt(newClaim!.fencing_token)).toBeGreaterThan(BigInt(oldClaim!.fencing_token));

    await processClaimedJob(oldClaim!, "worker-old");

    const [job] = await sql<Array<{ status: string; locked_by: string; fencing_token: number }>>`
      SELECT status, locked_by, fencing_token::int
      FROM publication_jobs WHERE id = ${oldClaim!.id}
    `;
    expect(job).toEqual({ status: "CLAIMED", locked_by: "worker-new", fencing_token: newClaim!.fencing_token });
  });
});

describe("controle de campanha", () => {
  it("pausa claims, retoma a fila e cancela apenas jobs que ainda não começaram", async () => {
    const sql = getSqlClient();
    const actorUserId = await createUser("campaign-control@example.test");
    const accounts = await createAccounts(3, "control");
    const campaignId = await createCampaign(actorUserId, "SCHEDULED", "Pause resume cancel");
    await createJobs(campaignId, accounts);

    await pauseCampaign(campaignId, actorUserId);
    expect(await claimJob("worker-while-paused")).toBeNull();
    const [paused] = await sql<Array<{ status: string; paused: boolean }>>`
      SELECT status, paused_at IS NOT NULL AS paused FROM campaigns WHERE id = ${campaignId}
    `;
    expect(paused).toEqual({ status: "PAUSED", paused: true });

    await resumeCampaign(campaignId, actorUserId);
    const inFlight = await claimJob("worker-in-flight");
    expect(inFlight).not.toBeNull();
    await cancelCampaign(campaignId, actorUserId);

    const [campaign] = await sql<Array<{ status: string; paused: boolean; cancelled: boolean }>>`
      SELECT status, paused_at IS NOT NULL AS paused, cancelled_at IS NOT NULL AS cancelled
      FROM campaigns WHERE id = ${campaignId}
    `;
    const jobs = await sql<Array<{ status: string; count: number }>>`
      SELECT status, count(*)::int AS count
      FROM publication_jobs WHERE campaign_id = ${campaignId}
      GROUP BY status ORDER BY status::text
    `;
    const events = await sql<Array<{ event_type: string }>>`
      SELECT event_type FROM audit_logs
      WHERE entity_id = ${campaignId} AND event_type LIKE 'CAMPAIGN_%'
      ORDER BY created_at, event_type
    `;
    expect(campaign).toEqual({ status: "CANCELLED", paused: false, cancelled: true });
    expect(jobs).toEqual([
      { status: "CANCELLED", count: 2 },
      { status: "CLAIMED", count: 1 },
    ]);
    expect(events.map(({ event_type }) => event_type).sort()).toEqual([
      "CAMPAIGN_CANCELLED",
      "CAMPAIGN_PAUSED",
      "CAMPAIGN_RESUMED",
    ]);
  });
});
