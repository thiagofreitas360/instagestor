import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getSqlClient } from "@/db/client";
import { setAccountsNewStatus } from "@/server/accounts";
import { createLoop, reconcileActiveLoops, scheduleNextLoopJob, setLoopStatus, updateLoop, type LoopInput } from "@/server/automation";
import { claimJob } from "@/jobs/queue";
import { createAccounts, createCampaign, createJobs, createUser, TEST_ORGANIZATION_ID as org } from "./helpers";

async function fixture(count = 2) {
  const actor = await createUser();
  const accounts = await createAccounts(count);
  const sql = getSqlClient();
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
    const [job] = await getSqlClient()<Array<{ scheduled_at: Date }>>`SELECT scheduled_at FROM publication_jobs WHERE loop_id = ${moved.loopId}`;
    expect(new Date(job.scheduled_at).getTime() - publishedAt.getTime()).toBe(120 * 60000);
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
