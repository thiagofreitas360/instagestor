import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getSqlClient } from "@/db/client";
import {
  createLoop, createSchedule, deleteLoop, scheduleNextLoopJob, setLoopStatus, updateLoop, updateSchedule,
} from "@/server/automation";
import { disconnectAccount } from "@/server/accounts";
import { createAccounts, createOrganization, createUser, TEST_ORGANIZATION_ID } from "./helpers";

async function createMedia(kind: "IMAGE" | "VIDEO", count: number, organizationId = TEST_ORGANIZATION_ID) {
  const sql = getSqlClient();
  return sql<Array<{ id: string }>>`
    INSERT INTO media_assets ${sql(Array.from({ length: count }, (_, index) => ({
      organization_id: organizationId,
      original_filename: `${kind.toLowerCase()}-${index}`,
      storage_provider: "LOCAL",
      storage_key: `automation/${randomUUID()}`,
      mime_type: kind === "VIDEO" ? "video/mp4" : "image/jpeg",
      media_kind: kind,
      size_bytes: 1024,
      checksum_sha256: randomUUID().replaceAll("-", "").repeat(2),
      processing_status: "READY",
    })))}
    RETURNING id
  `;
}

describe("loops", () => {
  it("runs a limited pool once per account without repetition", async () => {
    const sql = getSqlClient();
    const actorUserId = await createUser("limited-loop@example.test");
    const [account] = await createAccounts(1, "limited_loop");
    const media = await createMedia("VIDEO", 2);
    const created = await createLoop({
      organizationId: TEST_ORGANIZATION_ID,
      actorUserId,
      name: "Loop limitado",
      minIntervalMinutes: 25,
      maxIntervalMinutes: 25,
      dailyLimitPerAccount: 10,
      autoCommentDelayMinutes: 5,
      tieredLimits: false,
      tierFollowerThreshold: 10000,
      tier1DailyLimit: 10,
      tier1MinIntervalMinutes: 60,
      tier1MaxIntervalMinutes: 120,
      mediaType: "REELS",
      imageEveryN: 1,
      noRepeat: true,
      accountIds: [account.id],
      mediaIds: media.map((asset) => asset.id),
    });
    expect(created.scheduledCount).toBe(1);
    // Reels do loop vão para a aba Reels e também para o feed (a fila lê share_to_feed da campanha).
    const [campaign] = await sql<Array<{ share_to_feed: boolean }>>`
      SELECT campaign.share_to_feed FROM loops JOIN campaigns campaign ON campaign.id = loops.campaign_id
      WHERE loops.id = ${created.loopId}
    `;
    expect(campaign.share_to_feed).toBe(true);

    const first = (await sql<Array<{ id: string; direct_media_asset_id: string }>>`
      SELECT id, direct_media_asset_id FROM publication_jobs WHERE loop_id = ${created.loopId}
    `)[0];
    await sql`UPDATE publication_jobs SET status = 'PUBLISHED', published_at = now() WHERE id = ${first.id}`;
    await scheduleNextLoopJob({ organizationId: TEST_ORGANIZATION_ID, loopId: created.loopId, accountId: account.id, runAt: new Date() });

    const jobs = await sql<Array<{ id: string; direct_media_asset_id: string }>>`
      SELECT id, direct_media_asset_id FROM publication_jobs WHERE loop_id = ${created.loopId} ORDER BY created_at
    `;
    expect(jobs).toHaveLength(2);
    expect(jobs[1].direct_media_asset_id).not.toBe(first.direct_media_asset_id);
    await sql`UPDATE publication_jobs SET status = 'PUBLISHED', published_at = now() WHERE id = ${jobs[1].id}`;
    await expect(scheduleNextLoopJob({
      organizationId: TEST_ORGANIZATION_ID,
      loopId: created.loopId,
      accountId: account.id,
      runAt: new Date(),
    })).resolves.toBeNull();
    const [state] = await sql<Array<{ finished: boolean }>>`
      SELECT finished FROM loop_account_state WHERE loop_id = ${created.loopId} AND instagram_account_id = ${account.id}
    `;
    expect(state.finished).toBe(true);
  });

  it("deletes a paused loop whose account already published more than once, keeping the history", async () => {
    const sql = getSqlClient();
    const actorUserId = await createUser("delete-loop@example.test");
    const [account] = await createAccounts(1, "delete_loop");
    const media = await createMedia("VIDEO", 3);
    const created = await createLoop({
      organizationId: TEST_ORGANIZATION_ID,
      actorUserId,
      name: "Loop para excluir",
      minIntervalMinutes: 25,
      maxIntervalMinutes: 25,
      dailyLimitPerAccount: 10,
      autoCommentDelayMinutes: 5,
      tieredLimits: false,
      tierFollowerThreshold: 10000,
      tier1DailyLimit: 10,
      tier1MinIntervalMinutes: 60,
      tier1MaxIntervalMinutes: 120,
      mediaType: "REELS",
      imageEveryN: 1,
      noRepeat: false,
      accountIds: [account.id],
      mediaIds: media.map((asset) => asset.id),
    });
    for (let round = 0; round < 2; round += 1) {
      await sql`UPDATE publication_jobs SET status = 'PUBLISHED', published_at = now()
        WHERE loop_id = ${created.loopId} AND status = 'QUEUED'`;
      await scheduleNextLoopJob({ organizationId: TEST_ORGANIZATION_ID, loopId: created.loopId, accountId: account.id, runAt: new Date() });
    }
    await setLoopStatus(created.loopId, "PAUSED", actorUserId, TEST_ORGANIZATION_ID);

    await expect(deleteLoop(created.loopId, actorUserId, TEST_ORGANIZATION_ID)).resolves.toBeUndefined();

    const jobs = await sql<Array<{ status: string; loop_id: string | null }>>`
      SELECT status, loop_id FROM publication_jobs WHERE instagram_account_id = ${account.id}
    `;
    expect(jobs.filter((job) => job.status === "PUBLISHED")).toHaveLength(2);
    expect(jobs.every((job) => job.loop_id === null)).toBe(true);
  });

  it("rejects accounts and media from another organization", async () => {
    const otherOrganizationId = await createOrganization();
    const actorUserId = await createUser("tenant-loop@example.test");
    const [foreignAccount] = await createAccounts(1, "foreign_loop", otherOrganizationId);
    const [media] = await createMedia("VIDEO", 1);
    await expect(createLoop({
      organizationId: TEST_ORGANIZATION_ID,
      actorUserId,
      name: "Loop inválido",
      minIntervalMinutes: 25,
      maxIntervalMinutes: 60,
      dailyLimitPerAccount: 10,
      autoCommentDelayMinutes: 5,
      tieredLimits: false,
      tierFollowerThreshold: 10000,
      tier1DailyLimit: 10,
      tier1MinIntervalMinutes: 60,
      tier1MaxIntervalMinutes: 120,
      mediaType: "REELS",
      imageEveryN: 1,
      noRepeat: false,
      accountIds: [foreignAccount.id],
      mediaIds: [media.id],
    })).rejects.toThrow(/outro cliente/);
  });

  it("keeps the loop campaign running when an account is disconnected", async () => {
    const sql = getSqlClient();
    const actorUserId = await createUser("disconnect-loop@example.test");
    const [account] = await createAccounts(1, "disconnect_loop");
    const [media] = await createMedia("VIDEO", 1);
    const created = await createLoop({
      organizationId: TEST_ORGANIZATION_ID,
      actorUserId,
      name: "Loop resiliente",
      minIntervalMinutes: 25,
      maxIntervalMinutes: 60,
      dailyLimitPerAccount: 10,
      autoCommentDelayMinutes: 5,
      tieredLimits: false,
      tierFollowerThreshold: 10000,
      tier1DailyLimit: 10,
      tier1MinIntervalMinutes: 60,
      tier1MaxIntervalMinutes: 120,
      mediaType: "REELS",
      imageEveryN: 1,
      noRepeat: false,
      accountIds: [account.id],
      mediaIds: [media.id],
    });
    await disconnectAccount(account.id, actorUserId, TEST_ORGANIZATION_ID);
    const [campaign] = await sql<Array<{ status: string }>>`
      SELECT campaign.status FROM campaigns campaign
      JOIN loops loop ON loop.campaign_id = campaign.id
      WHERE loop.id = ${created.loopId}
    `;
    expect(campaign.status).toBe("RUNNING");
  });

  it("updates account and media differences without recreating the loop", async () => {
    const sql = getSqlClient();
    const actorUserId = await createUser("update-loop@example.test");
    const accounts = await createAccounts(2, "update_loop");
    const media = await createMedia("VIDEO", 3);
    const created = await createLoop({
      organizationId: TEST_ORGANIZATION_ID,
      actorUserId,
      name: "Loop original",
      minIntervalMinutes: 25,
      maxIntervalMinutes: 60,
      dailyLimitPerAccount: 10,
      autoCommentDelayMinutes: 5,
      tieredLimits: false,
      tierFollowerThreshold: 10000,
      tier1DailyLimit: 10,
      tier1MinIntervalMinutes: 60,
      tier1MaxIntervalMinutes: 120,
      mediaType: "REELS",
      imageEveryN: 1,
      noRepeat: false,
      accountIds: [accounts[0].id],
      mediaIds: [media[0].id, media[1].id],
    });
    await updateLoop(created.loopId, {
      organizationId: TEST_ORGANIZATION_ID,
      actorUserId,
      name: "Loop atualizado",
      minIntervalMinutes: 30,
      maxIntervalMinutes: 45,
      dailyLimitPerAccount: 8,
      autoCommentDelayMinutes: 5,
      tieredLimits: false,
      tierFollowerThreshold: 10000,
      tier1DailyLimit: 10,
      tier1MinIntervalMinutes: 60,
      tier1MaxIntervalMinutes: 120,
      mediaType: "REELS",
      imageEveryN: 1,
      noRepeat: true,
      accountIds: [accounts[1].id],
      mediaIds: [media[1].id, media[2].id],
    });
    const selectedAccounts = await sql<Array<{ id: string }>>`
      SELECT instagram_account_id AS id FROM loop_accounts WHERE loop_id = ${created.loopId}
    `;
    const selectedMedia = await sql<Array<{ id: string }>>`
      SELECT media_asset_id AS id FROM loop_media WHERE loop_id = ${created.loopId} ORDER BY position
    `;
    const jobs = await sql<Array<{ instagram_account_id: string; status: string }>>`
      SELECT instagram_account_id, status FROM publication_jobs WHERE loop_id = ${created.loopId} ORDER BY created_at
    `;
    expect(selectedAccounts.map((row) => row.id)).toEqual([accounts[1].id]);
    expect(selectedMedia.map((row) => row.id)).toEqual([media[1].id, media[2].id]);
    expect(jobs).toEqual([
      { instagram_account_id: accounts[0].id, status: "CANCELLED" },
      { instagram_account_id: accounts[1].id, status: "QUEUED" },
    ]);
  });

  it("applies the small-account interval when follower metrics are in range", async () => {
    const sql = getSqlClient();
    const actorUserId = await createUser("tier-loop@example.test");
    const [account] = await createAccounts(1, "tier_loop");
    const [media] = await createMedia("VIDEO", 1);
    await sql`
      INSERT INTO account_daily_metrics (organization_id, instagram_account_id, day, followers_count)
      VALUES (${TEST_ORGANIZATION_ID}, ${account.id}, current_date, 5000)
    `;
    const created = await createLoop({
      organizationId: TEST_ORGANIZATION_ID,
      actorUserId,
      name: "Loop com faixa",
      autoCommentDelayMinutes: 5,
      minIntervalMinutes: 1,
      maxIntervalMinutes: 1,
      dailyLimitPerAccount: 40,
      tieredLimits: true,
      tierFollowerThreshold: 10000,
      tier1DailyLimit: 10,
      tier1MinIntervalMinutes: 60,
      tier1MaxIntervalMinutes: 60,
      mediaType: "REELS",
      imageEveryN: 1,
      noRepeat: false,
      accountIds: [account.id],
      mediaIds: [media.id],
    });
    const [first] = await sql<Array<{ id: string }>>`
      SELECT id FROM publication_jobs WHERE loop_id = ${created.loopId}
    `;
    const completedAt = new Date();
    await sql`UPDATE publication_jobs SET status = 'PUBLISHED', published_at = now() WHERE id = ${first.id}`;
    await scheduleNextLoopJob({
      organizationId: TEST_ORGANIZATION_ID,
      loopId: created.loopId,
      accountId: account.id,
      completedAt,
    });
    const [next] = await sql<Array<{ scheduled_at: Date }>>`
      SELECT scheduled_at FROM publication_jobs
      WHERE loop_id = ${created.loopId} AND status = 'QUEUED'
    `;
    expect(new Date(next.scheduled_at).getTime() - completedAt.getTime()).toBe(60 * 60_000);
  });
});

describe("recurring schedules", () => {
  it("assigns media in order and creates each slot for every selected account", async () => {
    const sql = getSqlClient();
    const actorUserId = await createUser("schedule@example.test");
    const accounts = await createAccounts(2, "schedule");
    const media = await createMedia("IMAGE", 2);
    const created = await createSchedule({
      organizationId: TEST_ORGANIZATION_ID,
      actorUserId,
      name: "Escala semanal",
      startDate: "2030-01-07",
      endDate: "2030-01-07",
      times: ["09:00", "18:00"],
      daysOfWeek: [1],
      timezone: "America/Sao_Paulo",
      mediaType: "IMAGE",
      autoCommentDelayMinutes: 5,
      accountIds: accounts.map((account) => account.id),
      mediaIds: media.map((asset) => asset.id),
    });
    expect(created).toMatchObject({ scheduled: 2, jobs: 4, totalSlots: 2, totalMedia: 2 });
    const [campaign] = await sql<Array<{ share_to_feed: boolean }>>`
      SELECT campaign.share_to_feed FROM schedules JOIN campaigns campaign ON campaign.id = schedules.campaign_id
      WHERE schedules.id = ${created.scheduleId}
    `;
    expect(campaign.share_to_feed).toBe(true);
    const jobs = await sql<Array<{ direct_media_asset_id: string; publication_position: number; scheduled_at: Date }>>`
      SELECT direct_media_asset_id, publication_position, scheduled_at
      FROM publication_jobs WHERE schedule_id = ${created.scheduleId}
      ORDER BY publication_position, instagram_account_id
    `;
    expect(jobs.map((job) => job.publication_position)).toEqual([0, 0, 1, 1]);
    expect(jobs.slice(0, 2).every((job) => job.direct_media_asset_id === media[0].id)).toBe(true);
    expect(jobs.slice(2).every((job) => job.direct_media_asset_id === media[1].id)).toBe(true);
    expect(new Date(jobs[0].scheduled_at).toISOString()).toBe("2030-01-07T12:00:00.000Z");
  });

  it("edits future jobs without recreating already published items", async () => {
    const sql = getSqlClient();
    const actorUserId = await createUser("update-schedule@example.test");
    const [account] = await createAccounts(1, "update_schedule");
    const media = await createMedia("IMAGE", 2);
    const created = await createSchedule({
      organizationId: TEST_ORGANIZATION_ID,
      actorUserId,
      name: "Escala original",
      startDate: "2030-01-07",
      endDate: "2030-01-07",
      times: ["09:00", "18:00"],
      daysOfWeek: [1],
      timezone: "America/Sao_Paulo",
      mediaType: "IMAGE",
      autoCommentDelayMinutes: 5,
      accountIds: [account.id],
      mediaIds: media.map((asset) => asset.id),
    });
    const [published] = await sql<Array<{ id: string }>>`
      SELECT id FROM publication_jobs WHERE schedule_id = ${created.scheduleId}
      ORDER BY publication_position LIMIT 1
    `;
    await sql`UPDATE publication_jobs SET status = 'PUBLISHED', published_at = now() WHERE id = ${published.id}`;

    const result = await updateSchedule(created.scheduleId, {
      organizationId: TEST_ORGANIZATION_ID,
      actorUserId,
      name: "Escala atualizada",
      startDate: "2030-01-08",
      endDate: "2030-01-08",
      times: ["10:00", "18:00"],
      daysOfWeek: [2],
      timezone: "America/Sao_Paulo",
      mediaType: "IMAGE",
      autoCommentText: "Confira o link na bio",
      autoCommentDelayMinutes: 15,
      accountIds: [account.id],
      mediaIds: media.map((asset) => asset.id),
    });
    expect(result.rescheduled).toBe(1);
    const jobs = await sql<Array<{
      id: string;
      status: string;
      direct_media_asset_id: string;
      auto_comment_text: string | null;
      scheduled_at: Date;
    }>>`
      SELECT id, status, direct_media_asset_id, auto_comment_text, scheduled_at
      FROM publication_jobs WHERE schedule_id = ${created.scheduleId}
      ORDER BY status DESC
    `;
    expect(jobs).toHaveLength(2);
    expect(jobs.find((job) => job.id === published.id)?.status).toBe("PUBLISHED");
    const queued = jobs.find((job) => job.status === "QUEUED")!;
    expect(queued.direct_media_asset_id).toBe(media[1].id);
    expect(queued.auto_comment_text).toBe("Confira o link na bio");
    expect(new Date(queued.scheduled_at).toISOString()).toBe("2030-01-08T21:00:00.000Z");
  });
});
