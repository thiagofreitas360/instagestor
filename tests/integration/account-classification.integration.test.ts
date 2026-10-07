import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getSqlClient } from "@/db/client";
import { createFakeAccounts, setAccountsNewStatus } from "@/server/accounts";
import { createLoop, reconcileActiveLoops, scheduleNextLoopJob, setLoopStatus, updateLoop, type LoopInput } from "@/server/automation";
import { claimJob, processClaimedJob } from "@/jobs/queue";
import { encryptToken } from "@/lib/crypto";
import { DAY_MS, type WarmupProfile } from "@/lib/account-warmup";
import { accountWarmupAllowedAt } from "@/server/account-warmup";
import { createAccounts, createCampaign, createJobs, createUser, TEST_ORGANIZATION_ID as org } from "./helpers";

async function fixture(count = 2, profile: WarmupProfile | null = null) {
  const actor = await createUser();
  const accounts = await createAccounts(count);
  const sql = getSqlClient();
  await sql`UPDATE instagram_accounts SET warmup_profile = ${profile}`;
  const [folder] = await sql<Array<{ id: string }>>`INSERT INTO media_folders (organization_id, name) VALUES (${org}, 'Pool') RETURNING id`;
  const [media] = await sql<Array<{ id: string }>>`
    INSERT INTO media_assets (organization_id, original_filename, storage_provider, storage_key, mime_type,
      media_kind, size_bytes, checksum_sha256, folder_id, processing_status)
    VALUES (${org}, 'reel.mp4', 'LOCAL', 'test/reel.mp4', 'video/mp4', 'VIDEO', 1000, ${"a".repeat(64)}, ${folder.id}, 'READY') RETURNING id
  `;
  const input: LoopInput = { organizationId: org, actorUserId: actor, name: "Classificação",
    minIntervalMinutes: 60, maxIntervalMinutes: 60, dailyLimitPerAccount: 24,
    tieredLimits: false, tierFollowerThreshold: 10000, tier1DailyLimit: 10,
    tier1MinIntervalMinutes: 90, tier1MaxIntervalMinutes: 90, autoCommentDelayMinutes: 5,
    mediaType: "REELS", mediaFolderId: folder.id, imageEveryN: 1, noRepeat: false,
    accountIds: accounts.map((account) => account.id), mediaIds: [media.id] };
  const { loopId } = await createLoop(input);
  return { actor, accounts, loopId, input };
}

async function publish(loopId: string, accountId: string, minutesAgo = 20) {
  const publishedAt = new Date(Date.now() - minutesAgo * 60000);
  await getSqlClient()`UPDATE publication_jobs SET status = 'PUBLISHED', published_at = ${publishedAt.toISOString()}
    WHERE loop_id = ${loopId} AND instagram_account_id = ${accountId} AND status = 'QUEUED'`;
  await scheduleNextLoopJob({ organizationId: org, loopId, accountId, completedAt: publishedAt });
  return publishedAt;
}

async function pending(accountId: string) {
  const [job] = await getSqlClient()<Array<{ id: string; status: string; scheduled_at: Date; next_attempt_at: Date | null; direct_media_asset_id: string; attempt_count: number }>>`
    SELECT id, status, scheduled_at, next_attempt_at, direct_media_asset_id, attempt_count FROM publication_jobs
    WHERE instagram_account_id = ${accountId} AND loop_id IS NOT NULL AND status <> 'PUBLISHED' ORDER BY created_at DESC LIMIT 1
  `;
  return { ...job, scheduled_at: new Date(job.scheduled_at), next_attempt_at: job.next_attempt_at ? new Date(job.next_attempt_at) : null };
}

describe("account classification", () => {
  it("marks and unmarks 50 accounts atomically, counts only changes and does not reschedule a no-op", async () => {
    const actor = await createUser();
    const accounts = await createAccounts(50);
    const ids = accounts.map((account) => account.id);
    expect(await setAccountsNewStatus([...ids, ids[0]], true, actor, org)).toEqual({ changed: 50, unchanged: 0 });
    expect(await setAccountsNewStatus(ids, true, actor, org)).toEqual({ changed: 0, unchanged: 50 });
    expect(await setAccountsNewStatus(ids.slice(0, 1), false, actor, org)).toEqual({ changed: 1, unchanged: 0 });
    expect(await setAccountsNewStatus(ids, false, actor, org)).toEqual({ changed: 49, unchanged: 1 });
    const [{ total }] = await getSqlClient()<Array<{ total: number }>>`SELECT count(*)::int AS total FROM instagram_accounts WHERE is_new_account = true`;
    expect(total).toBe(0);
    const [{ total: audits }] = await getSqlClient()<Array<{ total: number }>>`SELECT count(*)::int AS total FROM audit_logs WHERE event_type = 'ACCOUNT_NEW_STATUS_UPDATED'`;
    expect(audits).toBe(100);
  });

  it("rejects the entire selection when it contains another client's account or an unknown ID", async () => {
    const actor = await createUser();
    const [own] = await createAccounts(1);
    const [foreign] = await createAccounts(1, "foreign", randomUUID());
    for (const invalid of [foreign.id, randomUUID()]) {
      await expect(setAccountsNewStatus([own.id, invalid], true, actor, org)).rejects.toThrow("outro cliente");
    }
    await expect(setAccountsNewStatus([], true, actor, org)).rejects.toThrow();
    const [account] = await getSqlClient()<Array<{ is_new_account: boolean }>>`SELECT is_new_account FROM instagram_accounts WHERE id = ${own.id}`;
    expect(account.is_new_account).toBe(false);
  });

  it("recalculates only selected loop jobs, preserving media, first publication and manual campaigns", async () => {
    const { actor, accounts, loopId } = await fixture(3);
    const publishedAt = await publish(loopId, accounts[0].id);
    await publish(loopId, accounts[1].id);
    const before = await pending(accounts[0].id);
    const untouched = await pending(accounts[1].id);
    const first = await pending(accounts[2].id);
    const campaign = await createCampaign(actor, "SCHEDULED");
    const [manual] = await createJobs(campaign, [accounts[0]], { scheduledAt: new Date(Date.now() + 300000) });
    await setAccountsNewStatus([accounts[0].id, accounts[2].id], true, actor, org);
    const after = await pending(accounts[0].id);
    expect(after.id).toBe(before.id);
    expect(after.direct_media_asset_id).toBe(before.direct_media_asset_id);
    expect(after.scheduled_at.getTime() - publishedAt.getTime()).toBe(120 * 60000);
    expect(await pending(accounts[1].id)).toEqual(untouched);
    expect(await pending(accounts[2].id)).toEqual(first);
    const [{ status }] = await getSqlClient()<Array<{ status: string }>>`SELECT status FROM publication_jobs WHERE id = ${manual.id}`;
    expect(status).toBe("QUEUED");
    await setAccountsNewStatus([accounts[0].id], false, actor, org);
    expect((await pending(accounts[0].id)).scheduled_at.getTime() - publishedAt.getTime()).toBe(60 * 60000);
    const snapshot = await pending(accounts[0].id);
    await setAccountsNewStatus([accounts[0].id], false, actor, org);
    expect(await pending(accounts[0].id)).toEqual(snapshot);
  });

  it("preserves retry backoff and makes the worker wait for the longer interval", async () => {
    const { actor, accounts, loopId } = await fixture(1);
    await publish(loopId, accounts[0].id);
    const job = await pending(accounts[0].id);
    const retryAt = new Date(Date.now() + 180 * 60000);
    await getSqlClient()`UPDATE publication_jobs SET status = 'RETRY_WAIT', attempt_count = 2, next_attempt_at = ${retryAt.toISOString()} WHERE id = ${job.id}`;
    await setAccountsNewStatus([accounts[0].id], true, actor, org);
    expect((await pending(accounts[0].id)).next_attempt_at).toEqual(retryAt);
    await getSqlClient()`UPDATE publication_jobs SET next_attempt_at = now() - interval '1 minute' WHERE id = ${job.id}`;
    await setAccountsNewStatus([accounts[0].id], false, actor, org);
    const next = await pending(accounts[0].id);
    expect(next.next_attempt_at).toEqual(next.scheduled_at);
    expect(next.attempt_count).toBe(2);
    expect(await claimJob("classification-worker")).toBeNull();
  });

  it("does not interrupt a claimed job, and schedules the following one using the new mark", async () => {
    const { actor, accounts, loopId } = await fixture(1);
    const job = await pending(accounts[0].id);
    await getSqlClient()`UPDATE publication_jobs SET status = 'CLAIMED', locked_by = 'worker', lock_expires_at = now() + interval '1 minute' WHERE id = ${job.id}`;
    const claimed = await pending(accounts[0].id);
    await setAccountsNewStatus([accounts[0].id], true, actor, org);
    expect(await pending(accounts[0].id)).toEqual(claimed);
    const publishedAt = new Date();
    await getSqlClient()`UPDATE publication_jobs SET status = 'PUBLISHED', published_at = ${publishedAt.toISOString()}, locked_by = NULL, lock_expires_at = NULL WHERE id = ${job.id}`;
    await scheduleNextLoopJob({ organizationId: org, loopId, accountId: accounts[0].id, completedAt: publishedAt });
    expect((await pending(accounts[0].id)).scheduled_at.getTime() - publishedAt.getTime()).toBe(120 * 60000);
  });

  it("respects publication history after pause, recovery and moving to another loop", async () => {
    const { actor, accounts, loopId, input } = await fixture(1);
    const publishedAt = await publish(loopId, accounts[0].id);
    await setLoopStatus(loopId, "PAUSED", actor, org);
    await setAccountsNewStatus([accounts[0].id], true, actor, org);
    await setLoopStatus(loopId, "ACTIVE", actor, org);
    expect((await pending(accounts[0].id)).scheduled_at.getTime() - publishedAt.getTime()).toBe(120 * 60000);
    await getSqlClient()`DELETE FROM publication_jobs WHERE loop_id = ${loopId} AND status <> 'PUBLISHED'`;
    await reconcileActiveLoops();
    expect((await pending(accounts[0].id)).scheduled_at.getTime() - publishedAt.getTime()).toBe(120 * 60000);
    await setLoopStatus(loopId, "PAUSED", actor, org);
    await getSqlClient()`DELETE FROM loop_accounts WHERE loop_id = ${loopId}`;
    const moved = await createLoop({ ...input, name: "Outro loop" });
    const [job] = await getSqlClient()<Array<{ scheduled_at: Date; joined_at: Date }>>`
      SELECT job.scheduled_at, selected.created_at AS joined_at FROM publication_jobs job
      JOIN loop_accounts selected ON selected.loop_id = job.loop_id AND selected.instagram_account_id = job.instagram_account_id
      WHERE job.loop_id = ${moved.loopId}`;
    expect(new Date(job.scheduled_at).getTime() - new Date(job.joined_at).getTime()).toBe(120 * 60000);
  });

  it("rolls back the classification and job changes if the transaction cannot finish", async () => {
    const { accounts, loopId } = await fixture(1);
    await publish(loopId, accounts[0].id);
    const before = await pending(accounts[0].id);
    await expect(setAccountsNewStatus([accounts[0].id], true, randomUUID(), org)).rejects.toThrow();
    const [account] = await getSqlClient()<Array<{ is_new_account: boolean }>>`SELECT is_new_account FROM instagram_accounts WHERE id = ${accounts[0].id}`;
    expect(account.is_new_account).toBe(false);
    expect(await pending(accounts[0].id)).toEqual(before);
  });

  it("applies the follower tier first and does not publish immediately when unmarked after the normal deadline", async () => {
    const { actor, accounts, loopId } = await fixture(1);
    const publishedAt = await publish(loopId, accounts[0].id, 90);
    await getSqlClient()`UPDATE loops SET tiered_limits = true WHERE id = ${loopId}`;
    await getSqlClient()`INSERT INTO account_daily_metrics (organization_id, instagram_account_id, day, followers_count)
      VALUES (${org}, ${accounts[0].id}, current_date, 500)`;
    await setAccountsNewStatus([accounts[0].id], true, actor, org);
    expect((await pending(accounts[0].id)).scheduled_at.getTime() - publishedAt.getTime()).toBe(180 * 60000);
    await getSqlClient()`UPDATE loops SET tiered_limits = false WHERE id = ${loopId}`;
    const before = Date.now();
    await setAccountsNewStatus([accounts[0].id], false, actor, org);
    const next = (await pending(accounts[0].id)).scheduled_at.getTime();
    expect(next).toBeGreaterThanOrEqual(before + 60 * 60000);
    expect(next).toBeLessThanOrEqual(Date.now() + 60 * 60000);
  });

  it("serializes classification, loop edits and recovery without duplicating or using an outdated interval", async () => {
    const { actor, accounts, loopId, input } = await fixture(1);
    const publishedAt = await publish(loopId, accounts[0].id);
    await getSqlClient()`DELETE FROM publication_jobs WHERE loop_id = ${loopId} AND status <> 'PUBLISHED'`;
    await Promise.all([
      scheduleNextLoopJob({ organizationId: org, loopId, accountId: accounts[0].id }),
      setAccountsNewStatus([accounts[0].id], true, actor, org),
      updateLoop(loopId, input),
      reconcileActiveLoops(),
    ]);
    const [{ total }] = await getSqlClient()<Array<{ total: number }>>`
      SELECT count(*)::int AS total FROM publication_jobs WHERE loop_id = ${loopId} AND status = 'QUEUED'
    `;
    expect(total).toBe(1);
    expect((await pending(accounts[0].id)).scheduled_at.getTime() - publishedAt.getTime()).toBe(120 * 60000);
  });

  it("honors the processing boundary when classification races with worker claim", async () => {
    const { actor, accounts, loopId } = await fixture(1);
    const publishedAt = await publish(loopId, accounts[0].id, 70);
    const [claimed] = await Promise.all([
      claimJob("classification-race"), setAccountsNewStatus([accounts[0].id], true, actor, org),
    ]);
    const job = await pending(accounts[0].id);
    if (claimed) {
      expect(job.id).toBe(claimed.id);
      expect(job.status).toBe("CLAIMED");
    } else {
      expect(job.status).toBe("QUEUED");
      expect(job.scheduled_at.getTime() - publishedAt.getTime()).toBe(120 * 60000);
    }
  });
});

describe("automatic warmup", () => {
  it("gives new connections the Balanced profile and preserves dates when changing or disabling 50 accounts", async () => {
    const actor = await createUser();
    const ids = await createFakeAccounts(50, actor, org);
    const before = await getSqlClient()`SELECT id, created_at, warmup_profile FROM instagram_accounts ORDER BY id`;
    expect(before.every((account) => account.warmup_profile === "BALANCED")).toBe(true);
    expect(await setAccountsNewStatus(ids, false, actor, org, "FAST")).toEqual({ changed: 50, unchanged: 0 });
    expect(await setAccountsNewStatus(ids, false, actor, org, "FAST")).toEqual({ changed: 0, unchanged: 50 });
    expect(await setAccountsNewStatus(ids, false, actor, org)).toEqual({ changed: 50, unchanged: 0 });
    const after = await getSqlClient()`SELECT id, created_at, warmup_profile FROM instagram_accounts ORDER BY id`;
    expect(after.map((account) => [account.id, account.created_at])).toEqual(before.map((account) => [account.id, account.created_at]));
    expect(after.every((account) => account.warmup_profile === null)).toBe(true);
  });

  it("waits 50–60 minutes for the first post, keeps the original countdown on recovery and then waits 12 hours", async () => {
    const { actor, accounts, loopId, input } = await fixture(1, "BALANCED");
    const sql = getSqlClient();
    await setLoopStatus(loopId, "PAUSED", actor, org);
    await sql`DELETE FROM loop_accounts WHERE loop_id = ${loopId}`;
    const created = await createLoop({ ...input, name: "Primeira postagem", minIntervalMinutes: 50, maxIntervalMinutes: 60 });
    const [membership] = await sql`SELECT created_at FROM loop_accounts WHERE loop_id = ${created.loopId}`;
    const initial = await pending(accounts[0].id);
    const gap = initial.scheduled_at.getTime() - new Date(membership.created_at).getTime();
    expect(gap).toBeGreaterThanOrEqual(50 * 60000);
    expect(gap).toBeLessThanOrEqual(60 * 60000);
    expect(await claimJob("warmup-first")).toBeNull();
    await reconcileActiveLoops();
    expect(await pending(accounts[0].id)).toEqual(initial);
    // Simula recuperação 20 minutos após a entrada: o relógio continua ancorado na entrada.
    await sql`UPDATE loop_accounts SET created_at = created_at - interval '20 minutes', first_post_at = first_post_at - interval '20 minutes' WHERE loop_id = ${created.loopId}`;
    await sql`DELETE FROM publication_jobs WHERE loop_id = ${created.loopId}`;
    await reconcileActiveLoops();
    expect((await pending(accounts[0].id)).scheduled_at.getTime()).toBe(initial.scheduled_at.getTime() - 20 * 60000);
    const publishedAt = await publish(created.loopId, accounts[0].id, 0);
    expect((await pending(accounts[0].id)).scheduled_at.getTime() - publishedAt.getTime()).toBe(12 * 3_600_000);
  });

  it("advances an already queued job to the next stage and releases it to normal pacing after completion", async () => {
    const { accounts, loopId } = await fixture(1, "BALANCED");
    const sql = getSqlClient();
    const publishedAt = await publish(loopId, accounts[0].id, 20);
    const id = (await pending(accounts[0].id)).id;
    await sql`UPDATE instagram_accounts SET created_at = ${new Date(Date.now() - 2 * DAY_MS).toISOString()}`;
    await reconcileActiveLoops();
    expect((await pending(accounts[0].id)).scheduled_at.getTime() - publishedAt.getTime()).toBe(6 * 3_600_000);
    expect((await pending(accounts[0].id)).id).toBe(id);
    await sql`UPDATE instagram_accounts SET created_at = ${new Date(Date.now() - 10 * DAY_MS).toISOString()}`;
    await reconcileActiveLoops();
    expect((await pending(accounts[0].id)).scheduled_at.getTime() - publishedAt.getTime()).toBe(60 * 60000);
  });

  it("removes a warmup hold before the first loop post without restarting the initial countdown", async () => {
    const { actor, accounts, loopId } = await fixture(1, "BALANCED");
    const sql = getSqlClient();
    const [membership] = await sql`SELECT first_post_at FROM loop_accounts WHERE loop_id = ${loopId}`;
    const manual = await createCampaign(actor, "SCHEDULED");
    const [manualJob] = await createJobs(manual, accounts);
    await sql`UPDATE publication_jobs SET status = 'PUBLISHED', published_at = now() - interval '1 hour' WHERE id = ${manualJob.id}`;
    await setAccountsNewStatus([accounts[0].id], false, actor, org, "CONSERVATIVE");
    expect((await pending(accounts[0].id)).scheduled_at.getTime()).toBeGreaterThan(Date.now() + 10 * 3_600_000);
    await setAccountsNewStatus([accounts[0].id], false, actor, org);
    expect((await pending(accounts[0].id)).scheduled_at.getTime()).toBe(new Date(membership.first_post_at).getTime());
  });

  it("enforces the account budget across manual campaigns and loop jobs in the worker without consuming retries", async () => {
    const { actor, accounts, loopId } = await fixture(1, "BALANCED");
    const sql = getSqlClient();
    await sql`UPDATE instagram_accounts SET encrypted_access_token = ${encryptToken("fake-token:warmup:account")}`;
    const manual = await createCampaign(actor, "SCHEDULED");
    const [manualJob] = await createJobs(manual, accounts);
    await sql`UPDATE publication_jobs SET status = 'PUBLISHED', published_at = now() - interval '1 hour' WHERE id = ${manualJob.id}`;
    await sql`UPDATE publication_jobs SET scheduled_at = now() - interval '1 minute' WHERE loop_id = ${loopId}`;
    const claim = await claimJob("warmup-worker");
    expect(claim).not.toBeNull();
    await processClaimedJob(claim!, "warmup-worker");
    const job = await pending(accounts[0].id);
    expect(job.status).toBe("RETRY_WAIT");
    expect(job.attempt_count).toBe(0);
    expect(job.next_attempt_at!.getTime()).toBeGreaterThan(Date.now() + 10.9 * 3_600_000);
    const [external] = await sql`SELECT meta_container_id, last_error_code FROM publication_jobs WHERE id = ${job.id}`;
    expect(external).toMatchObject({ meta_container_id: null, last_error_code: "ACCOUNT_WARMUP_WAIT" });
    await setAccountsNewStatus([accounts[0].id], false, actor, org);
    expect((await pending(accounts[0].id)).next_attempt_at!.getTime()).toBeLessThan(Date.now() + 61 * 60000);
  });

  it("publishes only once when two campaigns for the same new account run concurrently", async () => {
    const { actor, accounts, loopId } = await fixture(1, "BALANCED");
    const sql = getSqlClient();
    const first = await pending(accounts[0].id);
    const manual = await createCampaign(actor, "SCHEDULED");
    const [manualJob] = await createJobs(manual, accounts);
    const container = `fake_${Buffer.from(JSON.stringify({ id: "warmup-ready", readyAt: 0 })).toString("base64url")}`;
    await sql`UPDATE instagram_accounts SET encrypted_access_token = ${encryptToken("fake-token:warmup:account")}`;
    await sql`UPDATE publication_jobs SET scheduled_at = now() - interval '1 minute', meta_container_id = ${container},
      direct_media_asset_id = ${first.direct_media_asset_id}, publication_type_override = 'REEL'
      WHERE id IN (${first.id}, ${manualJob.id})`;
    const one = await claimJob("warmup-parallel-a");
    const two = await claimJob("warmup-parallel-b");
    await Promise.all([processClaimedJob(one!, "warmup-parallel-a"), processClaimedJob(two!, "warmup-parallel-b")]);
    await sql`UPDATE publication_jobs SET next_attempt_at = now() - interval '1 second' WHERE status = 'RETRY_WAIT'`;
    const retry = await claimJob("warmup-parallel-retry");
    if (retry) await processClaimedJob(retry, "warmup-parallel-retry");
    const [{ total }] = await sql`SELECT count(*)::int AS total FROM publication_jobs WHERE status = 'PUBLISHED'`;
    expect(total).toBe(1);
    const [held] = await sql`SELECT next_attempt_at, attempt_count FROM publication_jobs WHERE id IN (${first.id}, ${manualJob.id}) AND status = 'RETRY_WAIT'`;
    expect(held.attempt_count).toBe(0);
    expect(new Date(held.next_attempt_at).getTime()).toBeGreaterThan(Date.now() + 11.9 * 3_600_000);
    const nextLoop = await pending(accounts[0].id);
    expect(Math.max(nextLoop.scheduled_at.getTime(), nextLoop.next_attempt_at?.getTime() ?? 0)).toBeGreaterThan(Date.now() + 11.9 * 3_600_000);
    const [{ total: loopJobs }] = await sql`SELECT count(*)::int AS total FROM publication_jobs WHERE loop_id = ${loopId}`;
    expect(loopJobs).toBeGreaterThanOrEqual(1);
  });

  it("uses the smaller follower-tier cap for all publication origins and spaces terminal failures", async () => {
    const { actor, accounts, loopId } = await fixture(1, "FAST");
    const sql = getSqlClient();
    await sql`UPDATE instagram_accounts SET created_at = ${new Date(Date.now() - 2 * DAY_MS).toISOString()}`;
    await sql`UPDATE loops SET tiered_limits = true, tier1_daily_limit = 1 WHERE id = ${loopId}`;
    await sql`INSERT INTO account_daily_metrics (organization_id, instagram_account_id, day, followers_count)
      VALUES (${org}, ${accounts[0].id}, current_date, 100)`;
    const campaign = await createCampaign(actor, "SCHEDULED");
    const [job] = await createJobs(campaign, accounts);
    await sql`UPDATE publication_jobs SET status = 'FAILED', started_at = now() - interval '1 hour' WHERE id = ${job.id}`;
    const eligibleAt = await sql.begin((tx) => accountWarmupAllowedAt(tx, {
      organizationId: org, accountId: accounts[0].id, profile: "FAST", connectedAt: new Date(Date.now() - 2 * DAY_MS),
    }));
    expect(eligibleAt.getTime()).toBeGreaterThan(Date.now() + 22.9 * 3_600_000);
  });

  it("releases a manual campaign held only by warmup when the profile is disabled", async () => {
    const actor = await createUser();
    const accounts = await createAccounts(1);
    const sql = getSqlClient();
    await setAccountsNewStatus([accounts[0].id], false, actor, org, "BALANCED");
    const campaign = await createCampaign(actor, "SCHEDULED");
    const [job] = await createJobs(campaign, accounts, { status: "RETRY_WAIT", nextAttemptAt: new Date(Date.now() + 12 * 3_600_000) });
    await sql`UPDATE publication_jobs SET last_error_code = 'ACCOUNT_WARMUP_WAIT' WHERE id = ${job.id}`;
    await setAccountsNewStatus([accounts[0].id], false, actor, org);
    expect((await claimJob("warmup-disabled"))?.id).toBe(job.id);
  });
});
