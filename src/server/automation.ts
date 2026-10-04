import { randomInt } from "node:crypto";
import { DateTime } from "luxon";
import type { TransactionSql } from "postgres";
import { getSqlClient } from "@/db/client";
import { getEnv } from "@/lib/env";

type AutomatedMediaType = "REELS" | "IMAGE" | "MIXED";

export type LoopInput = {
  organizationId: string;
  actorUserId: string;
  name: string;
  defaultCaption?: string;
  autoCommentText?: string;
  autoCommentDelayMinutes: number;
  minIntervalMinutes: number;
  maxIntervalMinutes: number;
  dailyLimitPerAccount: number;
  tieredLimits: boolean;
  tierFollowerThreshold: number;
  tier1DailyLimit: number;
  tier1MinIntervalMinutes: number;
  tier1MaxIntervalMinutes: number;
  mediaType: AutomatedMediaType;
  imageEveryN: number;
  noRepeat: boolean;
  accountIds: string[];
  mediaIds: string[];
};

export type ScheduleInput = {
  organizationId: string;
  actorUserId: string;
  name: string;
  startDate: string;
  endDate: string;
  times: string[];
  daysOfWeek: number[];
  timezone: string;
  mediaType: "REELS" | "IMAGE";
  defaultCaption?: string;
  autoCommentText?: string;
  autoCommentDelayMinutes: number;
  accountIds: string[];
  mediaIds: string[];
};

type Asset = { id: string; media_kind: "IMAGE" | "VIDEO" };
type LoopMediaRow = { id: string; media_asset_id: string; media_kind: "IMAGE" | "VIDEO"; position: number };

const ACTIVE_JOB_STATUSES = [
  "DRAFT",
  "QUEUED",
  "CLAIMED",
  "CREATING_CONTAINER",
  "WAITING_FOR_CONTAINER",
  "READY_TO_PUBLISH",
  "PUBLISHING",
  "RETRY_WAIT",
] as const;

function unique(values: string[]) {
  return [...new Set(values)];
}

function validateLoopInput(input: LoopInput) {
  const name = input.name.trim();
  validateAutoComment(input.autoCommentText, input.autoCommentDelayMinutes);
  if (!name || name.length > 160) throw new Error("Informe um nome de loop válido");
  if (input.defaultCaption && input.defaultCaption.length > 2200) throw new Error("A legenda deve ter até 2.200 caracteres");
  if (!Number.isInteger(input.minIntervalMinutes) || input.minIntervalMinutes < 1 || input.minIntervalMinutes > 1440) {
    throw new Error("O intervalo mínimo deve ficar entre 1 e 1.440 minutos");
  }
  if (!Number.isInteger(input.maxIntervalMinutes) || input.maxIntervalMinutes < input.minIntervalMinutes || input.maxIntervalMinutes > 1440) {
    throw new Error("O intervalo máximo deve ser maior ou igual ao mínimo e ter até 1.440 minutos");
  }
  if (!Number.isInteger(input.dailyLimitPerAccount) || input.dailyLimitPerAccount < 1 || input.dailyLimitPerAccount > 200) {
    throw new Error("O limite diário deve ficar entre 1 e 200");
  }
  if (!Number.isInteger(input.tierFollowerThreshold) || input.tierFollowerThreshold < 0 || input.tierFollowerThreshold > 100_000_000) {
    throw new Error("A faixa de seguidores deve ficar entre 0 e 100.000.000");
  }
  if (!Number.isInteger(input.tier1DailyLimit) || input.tier1DailyLimit < 1 || input.tier1DailyLimit > 200) {
    throw new Error("O limite diário da faixa deve ficar entre 1 e 200");
  }
  if (!Number.isInteger(input.tier1MinIntervalMinutes) || input.tier1MinIntervalMinutes < 1 || input.tier1MinIntervalMinutes > 1440) {
    throw new Error("O intervalo mínimo da faixa deve ficar entre 1 e 1.440 minutos");
  }
  if (!Number.isInteger(input.tier1MaxIntervalMinutes) || input.tier1MaxIntervalMinutes < input.tier1MinIntervalMinutes || input.tier1MaxIntervalMinutes > 1440) {
    throw new Error("O intervalo máximo da faixa deve ser maior ou igual ao mínimo e ter até 1.440 minutos");
  }
  if (input.mediaType === "MIXED" && (!Number.isInteger(input.imageEveryN) || input.imageEveryN < 1 || input.imageEveryN > 100)) {
    throw new Error("A frequência de imagens deve ficar entre 1 e 100");
  }
}

function validateAutoComment(text: string | undefined, delayMinutes: number) {
  if (text && text.length > 2200) throw new Error("O comentário deve ter até 2.200 caracteres");
  if (!Number.isInteger(delayMinutes) || delayMinutes < 0 || delayMinutes > 10080) {
    throw new Error("O atraso do comentário deve ficar entre 0 e 10.080 minutos");
  }
}

async function loadAvailableAccounts(
  sql: TransactionSql,
  organizationId: string,
  accountIds: string[],
) {
  const ids = unique(accountIds);
  if (!ids.length) throw new Error("Selecione ao menos uma conta");
  const accounts = await sql<Array<{ id: string }>>`
    SELECT id FROM instagram_accounts
    WHERE organization_id = ${organizationId} AND id = ANY(${ids}::uuid[])
      AND status IN ('CONNECTED', 'TOKEN_EXPIRING')
  `;
  if (accounts.length !== ids.length) throw new Error("Uma ou mais contas estão desconectadas ou pertencem a outro cliente");
  return ids;
}

async function loadReadyAssets(
  sql: TransactionSql,
  organizationId: string,
  mediaIds: string[],
  mediaType: AutomatedMediaType,
) {
  const ids = unique(mediaIds);
  if (!ids.length) throw new Error("Selecione ao menos uma mídia");
  const assets = await sql<Asset[]>`
    SELECT id, media_kind FROM media_assets
    WHERE organization_id = ${organizationId} AND id = ANY(${ids}::uuid[])
      AND processing_status = 'READY' AND deleted_at IS NULL
  `;
  if (assets.length !== ids.length) throw new Error("Uma ou mais mídias não estão prontas ou pertencem a outro cliente");
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const ordered = ids.map((id) => byId.get(id)!);
  if (mediaType === "REELS" && ordered.some((asset) => asset.media_kind !== "VIDEO")) {
    throw new Error("Loops de Reels aceitam somente vídeos");
  }
  if (mediaType === "IMAGE" && ordered.some((asset) => asset.media_kind !== "IMAGE")) {
    throw new Error("Loops de imagem aceitam somente imagens");
  }
  return ordered;
}

function publicationTypeFor(asset: Pick<Asset, "media_kind">) {
  return asset.media_kind === "VIDEO" ? "REEL" : "FEED_IMAGE";
}

function randomMinutes(minimum: number, maximum: number) {
  return minimum === maximum ? minimum : randomInt(minimum, maximum + 1);
}

export function nextLoopScheduleAt(input: {
  completedAt: Date;
  timezone: string;
  publishedToday: number;
  dailyLimit: number;
  minIntervalMinutes: number;
  maxIntervalMinutes: number;
  random?: (minimum: number, maximum: number) => number;
}) {
  const minutes = (input.random ?? randomMinutes)(input.minIntervalMinutes, input.maxIntervalMinutes);
  if (input.publishedToday >= input.dailyLimit) {
    return DateTime.fromJSDate(input.completedAt, { zone: "utc" })
      .setZone(input.timezone)
      .plus({ days: 1 })
      .startOf("day")
      .plus({ minutes })
      .toUTC()
      .toJSDate();
  }
  return new Date(input.completedAt.getTime() + minutes * 60_000);
}

export function effectiveLoopLimits(input: {
  followerCount: number | null;
  tieredLimits: boolean;
  tierFollowerThreshold: number;
  dailyLimitPerAccount: number;
  minIntervalMinutes: number;
  maxIntervalMinutes: number;
  tier1DailyLimit: number;
  tier1MinIntervalMinutes: number;
  tier1MaxIntervalMinutes: number;
}) {
  const useTier = input.tieredLimits && input.followerCount !== null
    && input.followerCount <= input.tierFollowerThreshold;
  return useTier ? {
    dailyLimit: input.tier1DailyLimit,
    minIntervalMinutes: input.tier1MinIntervalMinutes,
    maxIntervalMinutes: input.tier1MaxIntervalMinutes,
  } : {
    dailyLimit: input.dailyLimitPerAccount,
    minIntervalMinutes: input.minIntervalMinutes,
    maxIntervalMinutes: input.maxIntervalMinutes,
  };
}

function chooseMedia(
  media: LoopMediaRow[],
  usedMediaIds: string[],
  noRepeat: boolean,
  mediaType: AutomatedMediaType,
  imageEveryN: number,
  videosSinceImage: number,
) {
  let used = new Set(usedMediaIds);
  let available = media.filter((item) => !used.has(item.id));
  if (!available.length) {
    if (noRepeat) return null;
    used = new Set();
    available = media;
  }
  if (!available.length) return null;

  let selected: LoopMediaRow | undefined;
  if (mediaType === "MIXED") {
    const images = available.filter((item) => item.media_kind === "IMAGE");
    const videos = available.filter((item) => item.media_kind === "VIDEO");
    selected = videosSinceImage >= imageEveryN && images.length ? images[0] : videos[0] ?? images[0];
  } else {
    selected = available[0];
  }
  if (!selected) return null;
  return {
    selected,
    usedMediaIds: [...used, selected.id],
    videosSinceImage: selected.media_kind === "IMAGE" ? 0 : videosSinceImage + 1,
  };
}

export async function scheduleNextLoopJob(input: {
  organizationId: string;
  loopId: string;
  accountId: string;
  completedAt?: Date;
  runAt?: Date;
}) {
  return getSqlClient().begin(async (sql) => {
    const [state] = await sql<Array<{
      campaign_id: string;
      status: "ACTIVE" | "PAUSED";
      media_type: AutomatedMediaType;
      image_every_n: number;
      no_repeat: boolean;
      min_interval_minutes: number;
      max_interval_minutes: number;
      daily_limit_per_account: number;
      auto_comment_text: string;
      auto_comment_delay_minutes: number;
      tiered_limits: boolean;
      tier_follower_threshold: number;
      tier1_daily_limit: number;
      tier1_min_interval_minutes: number;
      tier1_max_interval_minutes: number;
      followers_count: number | null;
      used_media_ids: string[];
      videos_since_image: number;
      finished: boolean;
      account_status: string;
    }>>`
      SELECT loop.campaign_id, loop.status, loop.media_type, loop.image_every_n, loop.no_repeat,
        loop.min_interval_minutes, loop.max_interval_minutes, loop.daily_limit_per_account,
        loop.auto_comment_text, loop.auto_comment_delay_minutes, loop.tiered_limits,
        loop.tier_follower_threshold, loop.tier1_daily_limit, loop.tier1_min_interval_minutes,
        loop.tier1_max_interval_minutes, metrics.followers_count,
        state.used_media_ids, state.videos_since_image, state.finished, account.status AS account_status
      FROM loop_account_state state
      JOIN loops loop ON loop.organization_id = state.organization_id AND loop.id = state.loop_id
      JOIN loop_accounts selected_account ON selected_account.organization_id = state.organization_id
        AND selected_account.loop_id = state.loop_id AND selected_account.instagram_account_id = state.instagram_account_id
      JOIN instagram_accounts account ON account.organization_id = state.organization_id
        AND account.id = state.instagram_account_id
      LEFT JOIN LATERAL (
        SELECT followers_count FROM account_daily_metrics
        WHERE organization_id = state.organization_id AND instagram_account_id = state.instagram_account_id
          AND followers_count IS NOT NULL
        ORDER BY day DESC LIMIT 1
      ) metrics ON true
      WHERE state.organization_id = ${input.organizationId} AND state.loop_id = ${input.loopId}
        AND state.instagram_account_id = ${input.accountId}
      FOR UPDATE OF state
    `;
    if (!state || state.status !== "ACTIVE" || state.finished) return null;
    if (!["CONNECTED", "TOKEN_EXPIRING"].includes(state.account_status)) return null;

    const [activeJob] = await sql<Array<{ id: string }>>`
      SELECT id FROM publication_jobs
      WHERE organization_id = ${input.organizationId} AND loop_id = ${input.loopId}
        AND instagram_account_id = ${input.accountId}
        AND status::text = ANY(${[...ACTIVE_JOB_STATUSES]}::text[])
      LIMIT 1
    `;
    if (activeJob) return null;

    const media = await sql<LoopMediaRow[]>`
      SELECT relation.id, relation.media_asset_id, relation.position, asset.media_kind
      FROM loop_media relation
      JOIN media_assets asset ON asset.organization_id = relation.organization_id AND asset.id = relation.media_asset_id
      WHERE relation.organization_id = ${input.organizationId} AND relation.loop_id = ${input.loopId}
        AND asset.processing_status = 'READY' AND asset.deleted_at IS NULL
      ORDER BY relation.position
    `;
    const choice = chooseMedia(
      media,
      state.used_media_ids,
      state.no_repeat,
      state.media_type,
      state.image_every_n,
      state.videos_since_image,
    );
    if (!choice) {
      await sql`
        UPDATE loop_account_state SET finished = true, updated_at = now()
        WHERE organization_id = ${input.organizationId} AND loop_id = ${input.loopId}
          AND instagram_account_id = ${input.accountId}
      `;
      return null;
    }

    let scheduledAt = input.runAt ?? new Date();
    if (!input.runAt) {
      const reference = input.completedAt ?? new Date();
      const [preferences] = await sql<Array<{ default_timezone: string }>>`
        SELECT default_timezone FROM settings WHERE organization_id = ${input.organizationId}
      `;
      const timezone = preferences?.default_timezone ?? "America/Sao_Paulo";
      const local = DateTime.fromJSDate(reference, { zone: "utc" }).setZone(timezone);
      const start = local.startOf("day").toUTC().toJSDate();
      const end = local.plus({ days: 1 }).startOf("day").toUTC().toJSDate();
      const [count] = await sql<Array<{ published: number }>>`
        SELECT count(*)::int AS published FROM publication_jobs
        WHERE organization_id = ${input.organizationId} AND loop_id = ${input.loopId}
          AND instagram_account_id = ${input.accountId} AND status = 'PUBLISHED'
          AND published_at >= ${start.toISOString()} AND published_at < ${end.toISOString()}
      `;
      const limits = effectiveLoopLimits({
        followerCount: state.followers_count,
        tieredLimits: state.tiered_limits,
        tierFollowerThreshold: state.tier_follower_threshold,
        dailyLimitPerAccount: state.daily_limit_per_account,
        minIntervalMinutes: state.min_interval_minutes,
        maxIntervalMinutes: state.max_interval_minutes,
        tier1DailyLimit: state.tier1_daily_limit,
        tier1MinIntervalMinutes: state.tier1_min_interval_minutes,
        tier1MaxIntervalMinutes: state.tier1_max_interval_minutes,
      });
      if (input.completedAt || (count?.published ?? 0) >= limits.dailyLimit) {
        scheduledAt = nextLoopScheduleAt({
          completedAt: reference,
          timezone,
          publishedToday: count?.published ?? 0,
          dailyLimit: limits.dailyLimit,
          minIntervalMinutes: limits.minIntervalMinutes,
          maxIntervalMinutes: limits.maxIntervalMinutes,
        });
      }
    }

    await sql`
      UPDATE loop_account_state SET used_media_ids = ${choice.usedMediaIds},
        videos_since_image = ${choice.videosSinceImage}, finished = false, updated_at = now()
      WHERE organization_id = ${input.organizationId} AND loop_id = ${input.loopId}
        AND instagram_account_id = ${input.accountId}
    `;
    const [job] = await sql<Array<{ id: string }>>`
      INSERT INTO publication_jobs (
        organization_id, campaign_id, loop_id, direct_media_asset_id, publication_type_override,
        instagram_account_id, publication_position, scheduled_at, status, max_attempts,
        auto_comment_text, auto_comment_delay_minutes, auto_comment_max_attempts
      ) VALUES (
        ${input.organizationId}, ${state.campaign_id}, ${input.loopId}, ${choice.selected.media_asset_id},
        ${publicationTypeFor(choice.selected)}::publication_type, ${input.accountId}, 0,
        ${scheduledAt.toISOString()}, 'QUEUED', ${getEnv().MAX_PUBLICATION_ATTEMPTS},
        ${state.auto_comment_text || null}, ${state.auto_comment_delay_minutes}, ${getEnv().MAX_PUBLICATION_ATTEMPTS}
      )
      RETURNING id
    `;
    return job.id;
  });
}

export async function reconcileActiveLoops() {
  const rows = await getSqlClient()<Array<{ organization_id: string; loop_id: string; instagram_account_id: string }>>`
    SELECT state.organization_id, state.loop_id, state.instagram_account_id
    FROM loop_account_state state
    JOIN loops loop ON loop.organization_id = state.organization_id AND loop.id = state.loop_id
    WHERE loop.status = 'ACTIVE' AND state.finished = false
  `;
  let scheduled = 0;
  for (const row of rows) {
    if (await scheduleNextLoopJob({
      organizationId: row.organization_id,
      loopId: row.loop_id,
      accountId: row.instagram_account_id,
    })) scheduled++;
  }
  return { checked: rows.length, scheduled };
}

export async function createLoop(input: LoopInput) {
  validateLoopInput(input);
  const normalized = {
    ...input,
    name: input.name.trim(),
    defaultCaption: input.defaultCaption?.trim() ?? "",
    autoCommentText: input.autoCommentText?.trim() ?? "",
    imageEveryN: input.mediaType === "MIXED" ? input.imageEveryN : 0,
  };
  const created = await getSqlClient().begin(async (sql) => {
    const accountIds = await loadAvailableAccounts(sql, input.organizationId, input.accountIds);
    const assets = await loadReadyAssets(sql, input.organizationId, input.mediaIds, input.mediaType);
    const [campaign] = await sql<Array<{ id: string }>>`
      INSERT INTO campaigns (
        organization_id, name, origin, publication_type, caption, status,
        delay_mode, delay_fixed_seconds, target_order, created_by
      ) VALUES (
        ${input.organizationId}, ${normalized.name}, 'LOOP',
        ${input.mediaType === "IMAGE" ? "FEED_IMAGE" : "REEL"}::publication_type,
        ${normalized.defaultCaption}, 'RUNNING', 'FIXED', 0, 'SELECTED', ${input.actorUserId}
      ) RETURNING id
    `;
    const [loop] = await sql<Array<{ id: string }>>`
      INSERT INTO loops (
        organization_id, campaign_id, name, default_caption, auto_comment_text, auto_comment_delay_minutes,
        min_interval_minutes, max_interval_minutes, daily_limit_per_account, tiered_limits,
        tier_follower_threshold, tier1_daily_limit, tier1_min_interval_minutes, tier1_max_interval_minutes,
        media_type, image_every_n, no_repeat, created_by
      ) VALUES (
        ${input.organizationId}, ${campaign.id}, ${normalized.name}, ${normalized.defaultCaption},
        ${normalized.autoCommentText}, ${input.autoCommentDelayMinutes},
        ${input.minIntervalMinutes}, ${input.maxIntervalMinutes}, ${input.dailyLimitPerAccount},
        ${input.tieredLimits}, ${input.tierFollowerThreshold}, ${input.tier1DailyLimit},
        ${input.tier1MinIntervalMinutes}, ${input.tier1MaxIntervalMinutes},
        ${input.mediaType}, ${normalized.imageEveryN}, ${input.noRepeat}, ${input.actorUserId}
      ) RETURNING id
    `;
    await sql`INSERT INTO loop_accounts ${sql(accountIds.map((accountId) => ({
      organization_id: input.organizationId,
      loop_id: loop.id,
      instagram_account_id: accountId,
    })))}`;
    await sql`INSERT INTO loop_account_state ${sql(accountIds.map((accountId) => ({
      organization_id: input.organizationId,
      loop_id: loop.id,
      instagram_account_id: accountId,
    })))}`;
    await sql`INSERT INTO loop_media ${sql(assets.map((asset, position) => ({
      organization_id: input.organizationId,
      loop_id: loop.id,
      media_asset_id: asset.id,
      position,
    })))}`;
    await sql`INSERT INTO campaign_targets ${sql(accountIds.map((accountId, position) => ({
      organization_id: input.organizationId,
      campaign_id: campaign.id,
      instagram_account_id: accountId,
      position,
    })))}`;
    await sql`
      INSERT INTO audit_logs (organization_id, actor_user_id, event_type, entity_type, entity_id, metadata_json)
      VALUES (${input.organizationId}, ${input.actorUserId}, 'LOOP_CREATED', 'loop', ${loop.id},
        ${JSON.stringify({ accounts: accountIds.length, media: assets.length, noRepeat: input.noRepeat })}::jsonb)
    `;
    return { loopId: loop.id, accountIds };
  });

  const results = await Promise.allSettled(created.accountIds.map((accountId) => scheduleNextLoopJob({
    organizationId: input.organizationId,
    loopId: created.loopId,
    accountId,
    runAt: new Date(),
  })));
  const failedAccountIds = created.accountIds.filter((_, index) => results[index].status === "rejected");
  const scheduledCount = results.filter((result) => result.status === "fulfilled" && result.value).length;
  return { loopId: created.loopId, scheduledCount, failedAccountIds };
}

export async function updateLoop(loopId: string, input: LoopInput) {
  validateLoopInput(input);
  const result = await getSqlClient().begin(async (sql) => {
    const accountIds = await loadAvailableAccounts(sql, input.organizationId, input.accountIds);
    const assets = await loadReadyAssets(sql, input.organizationId, input.mediaIds, input.mediaType);
    const [loop] = await sql<Array<{ campaign_id: string; status: "ACTIVE" | "PAUSED"; no_repeat: boolean }>>`
      SELECT campaign_id, status, no_repeat FROM loops
      WHERE organization_id = ${input.organizationId} AND id = ${loopId} FOR UPDATE
    `;
    if (!loop) throw new Error("Loop não encontrado");

    const [currentAccounts, currentMedia] = await Promise.all([
      sql<Array<{ instagram_account_id: string }>>`
        SELECT instagram_account_id FROM loop_accounts
        WHERE organization_id = ${input.organizationId} AND loop_id = ${loopId}
      `,
      sql<Array<{ id: string; media_asset_id: string }>>`
        SELECT id, media_asset_id FROM loop_media
        WHERE organization_id = ${input.organizationId} AND loop_id = ${loopId}
      `,
    ]);
    const desiredAccountIds = new Set(accountIds);
    const desiredMediaIds = new Set(assets.map((asset) => asset.id));
    const removedAccountIds = currentAccounts.map((row) => row.instagram_account_id).filter((id) => !desiredAccountIds.has(id));
    const addedAccountIds = accountIds.filter((id) => !currentAccounts.some((row) => row.instagram_account_id === id));
    const removedMediaIds = currentMedia.map((row) => row.media_asset_id).filter((id) => !desiredMediaIds.has(id));
    const addedMediaIds = assets.map((asset) => asset.id).filter((id) => !currentMedia.some((row) => row.media_asset_id === id));

    if (removedAccountIds.length || removedMediaIds.length) {
      await sql`
        UPDATE publication_jobs SET status = 'CANCELLED', finished_at = now(), updated_at = now()
        WHERE organization_id = ${input.organizationId} AND loop_id = ${loopId}
          AND status IN ('DRAFT', 'QUEUED', 'RETRY_WAIT')
          AND (instagram_account_id = ANY(${removedAccountIds}::uuid[])
            OR direct_media_asset_id = ANY(${removedMediaIds}::uuid[]))
      `;
    }
    if (removedAccountIds.length) {
      await sql`DELETE FROM loop_accounts WHERE organization_id = ${input.organizationId} AND loop_id = ${loopId} AND instagram_account_id = ANY(${removedAccountIds}::uuid[])`;
    }
    if (addedAccountIds.length) {
      await sql`INSERT INTO loop_accounts ${sql(addedAccountIds.map((accountId) => ({
        organization_id: input.organizationId,
        loop_id: loopId,
        instagram_account_id: accountId,
      })))}`;
      await sql`INSERT INTO loop_account_state ${sql(addedAccountIds.map((accountId) => ({
        organization_id: input.organizationId,
        loop_id: loopId,
        instagram_account_id: accountId,
      })))}`;
    }
    if (removedMediaIds.length) {
      await sql`DELETE FROM loop_media WHERE organization_id = ${input.organizationId} AND loop_id = ${loopId} AND media_asset_id = ANY(${removedMediaIds}::uuid[])`;
    }
    await sql`UPDATE loop_media SET position = position + 100000 WHERE organization_id = ${input.organizationId} AND loop_id = ${loopId}`;
    for (const [position, asset] of assets.entries()) {
      const existing = currentMedia.find((row) => row.media_asset_id === asset.id);
      if (existing) {
        await sql`UPDATE loop_media SET position = ${position} WHERE organization_id = ${input.organizationId} AND id = ${existing.id}`;
      } else {
        await sql`
          INSERT INTO loop_media (organization_id, loop_id, media_asset_id, position)
          VALUES (${input.organizationId}, ${loopId}, ${asset.id}, ${position})
        `;
      }
    }

    const normalizedCaption = input.defaultCaption?.trim() ?? "";
    const normalizedComment = input.autoCommentText?.trim() ?? "";
    const imageEveryN = input.mediaType === "MIXED" ? input.imageEveryN : 0;
    await sql`
      UPDATE loops SET name = ${input.name.trim()}, default_caption = ${normalizedCaption},
        auto_comment_text = ${normalizedComment}, auto_comment_delay_minutes = ${input.autoCommentDelayMinutes},
        min_interval_minutes = ${input.minIntervalMinutes}, max_interval_minutes = ${input.maxIntervalMinutes},
        daily_limit_per_account = ${input.dailyLimitPerAccount}, tiered_limits = ${input.tieredLimits},
        tier_follower_threshold = ${input.tierFollowerThreshold}, tier1_daily_limit = ${input.tier1DailyLimit},
        tier1_min_interval_minutes = ${input.tier1MinIntervalMinutes}, tier1_max_interval_minutes = ${input.tier1MaxIntervalMinutes},
        media_type = ${input.mediaType},
        image_every_n = ${imageEveryN}, no_repeat = ${input.noRepeat}, updated_at = now()
      WHERE organization_id = ${input.organizationId} AND id = ${loopId}
    `;
    await sql`
      UPDATE publication_jobs SET auto_comment_text = ${normalizedComment || null},
        auto_comment_delay_minutes = ${input.autoCommentDelayMinutes}, updated_at = now()
      WHERE organization_id = ${input.organizationId} AND loop_id = ${loopId}
        AND status IN ('DRAFT', 'QUEUED', 'RETRY_WAIT')
    `;
    await sql`
      UPDATE campaigns SET name = ${input.name.trim()}, caption = ${normalizedCaption},
        publication_type = ${input.mediaType === "IMAGE" ? "FEED_IMAGE" : "REEL"}::publication_type, updated_at = now()
      WHERE organization_id = ${input.organizationId} AND id = ${loop.campaign_id}
    `;
    await sql`DELETE FROM campaign_targets WHERE organization_id = ${input.organizationId} AND campaign_id = ${loop.campaign_id}`;
    await sql`INSERT INTO campaign_targets ${sql(accountIds.map((accountId, position) => ({
      organization_id: input.organizationId,
      campaign_id: loop.campaign_id,
      instagram_account_id: accountId,
      position,
    })))}`;
    const resetFinished = addedMediaIds.length > 0 || removedMediaIds.length > 0 || (loop.no_repeat && !input.noRepeat);
    await sql`
      UPDATE loop_account_state state SET
        used_media_ids = ARRAY(
          SELECT used_id FROM unnest(state.used_media_ids) used_id
          WHERE EXISTS (SELECT 1 FROM loop_media selected_media
            WHERE selected_media.organization_id = state.organization_id
              AND selected_media.loop_id = state.loop_id AND selected_media.id = used_id)
        ),
        finished = CASE WHEN ${resetFinished} THEN false ELSE state.finished END,
        updated_at = now()
      WHERE state.organization_id = ${input.organizationId} AND state.loop_id = ${loopId}
    `;
    await sql`
      INSERT INTO audit_logs (organization_id, actor_user_id, event_type, entity_type, entity_id, metadata_json)
      VALUES (${input.organizationId}, ${input.actorUserId}, 'LOOP_UPDATED', 'loop', ${loopId},
        ${JSON.stringify({ addedAccounts: addedAccountIds.length, removedAccounts: removedAccountIds.length, addedMedia: addedMediaIds.length, removedMedia: removedMediaIds.length })}::jsonb)
    `;
    return { status: loop.status, accountIds };
  });

  if (result.status === "ACTIVE") {
    await Promise.allSettled(result.accountIds.map((accountId) => scheduleNextLoopJob({
      organizationId: input.organizationId,
      loopId,
      accountId,
    })));
  }
}

export async function setLoopStatus(loopId: string, status: "ACTIVE" | "PAUSED", actorUserId: string, organizationId: string) {
  const accounts = await getSqlClient().begin(async (sql) => {
    const [loop] = await sql<Array<{ campaign_id: string }>>`
      UPDATE loops SET status = ${status}::loop_status, updated_at = now()
      WHERE organization_id = ${organizationId} AND id = ${loopId}
      RETURNING campaign_id
    `;
    if (!loop) throw new Error("Loop não encontrado");
    if (status === "PAUSED") {
      await sql`
        UPDATE publication_jobs SET status = 'CANCELLED', finished_at = now(), updated_at = now()
        WHERE organization_id = ${organizationId} AND loop_id = ${loopId}
          AND status IN ('DRAFT', 'QUEUED', 'RETRY_WAIT')
      `;
      await sql`UPDATE campaigns SET status = 'PAUSED', updated_at = now() WHERE organization_id = ${organizationId} AND id = ${loop.campaign_id}`;
    } else {
      await sql`UPDATE campaigns SET status = 'RUNNING', paused_at = NULL, updated_at = now() WHERE organization_id = ${organizationId} AND id = ${loop.campaign_id}`;
    }
    await sql`
      INSERT INTO audit_logs (organization_id, actor_user_id, event_type, entity_type, entity_id)
      VALUES (${organizationId}, ${actorUserId}, ${status === "ACTIVE" ? "LOOP_RESUMED" : "LOOP_PAUSED"}, 'loop', ${loopId})
    `;
    return sql<Array<{ instagram_account_id: string }>>`
      SELECT instagram_account_id FROM loop_accounts WHERE organization_id = ${organizationId} AND loop_id = ${loopId}
    `;
  });
  if (status === "ACTIVE") {
    await Promise.allSettled(accounts.map((account) => scheduleNextLoopJob({
      organizationId,
      loopId,
      accountId: account.instagram_account_id,
    })));
  }
}

export async function deleteLoop(loopId: string, actorUserId: string, organizationId: string) {
  await getSqlClient().begin(async (sql) => {
    const [loop] = await sql<Array<{ campaign_id: string }>>`
      SELECT campaign_id FROM loops WHERE organization_id = ${organizationId} AND id = ${loopId} FOR UPDATE
    `;
    if (!loop) throw new Error("Loop não encontrado");
    await sql`
      UPDATE publication_jobs SET status = 'CANCELLED', finished_at = now(), updated_at = now()
      WHERE organization_id = ${organizationId} AND loop_id = ${loopId}
        AND status IN ('DRAFT', 'QUEUED', 'RETRY_WAIT')
    `;
    await sql`UPDATE campaigns SET status = 'CANCELLED', cancelled_at = now(), updated_at = now() WHERE organization_id = ${organizationId} AND id = ${loop.campaign_id}`;
    await sql`DELETE FROM loops WHERE organization_id = ${organizationId} AND id = ${loopId}`;
    await sql`
      INSERT INTO audit_logs (organization_id, actor_user_id, event_type, entity_type, entity_id)
      VALUES (${organizationId}, ${actorUserId}, 'LOOP_DELETED', 'loop', ${loopId})
    `;
  });
}

export function buildRecurringSlots(input: {
  startDate: string;
  endDate: string;
  times: string[];
  daysOfWeek: number[];
  timezone: string;
  now?: Date;
}) {
  const start = DateTime.fromISO(input.startDate, { zone: input.timezone }).startOf("day");
  const end = DateTime.fromISO(input.endDate, { zone: input.timezone }).startOf("day");
  if (!start.isValid || !end.isValid || end < start) throw new Error("Período da escala inválido");
  if (end.diff(start, "days").days > 366) throw new Error("A escala pode cobrir no máximo 366 dias");
  const times = [...new Set(input.times)].sort();
  if (!times.length || times.some((time) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))) {
    throw new Error("Informe ao menos um horário válido no formato HH:MM");
  }
  const days = new Set(input.daysOfWeek);
  if (!days.size || [...days].some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
    throw new Error("Selecione ao menos um dia da semana");
  }
  const nowMs = (input.now ?? new Date()).getTime();
  const slots: Date[] = [];
  for (let day = start; day <= end; day = day.plus({ days: 1 })) {
    if (!days.has(day.weekday % 7)) continue;
    for (const time of times) {
      const [hour, minute] = time.split(":").map(Number);
      const slot = day.set({ hour, minute, second: 0, millisecond: 0 });
      if (slot.isValid && slot.toMillis() > nowMs) slots.push(slot.toUTC().toJSDate());
    }
  }
  return slots;
}

export async function createSchedule(input: ScheduleInput) {
  const name = input.name.trim();
  if (!name || name.length > 160) throw new Error("Informe um nome de escala válido");
  if (input.defaultCaption && input.defaultCaption.length > 2200) throw new Error("A legenda deve ter até 2.200 caracteres");
  validateAutoComment(input.autoCommentText, input.autoCommentDelayMinutes);
  const slots = buildRecurringSlots(input);
  if (!slots.length) throw new Error("A escala não possui horários futuros no período selecionado");

  return getSqlClient().begin(async (sql) => {
    const accountIds = await loadAvailableAccounts(sql, input.organizationId, input.accountIds);
    const assets = await loadReadyAssets(sql, input.organizationId, input.mediaIds, input.mediaType);
    const scheduledMedia = assets.slice(0, slots.length);
    const [campaign] = await sql<Array<{ id: string }>>`
      INSERT INTO campaigns (
        organization_id, name, origin, publication_type, caption, status, start_at,
        timezone, delay_mode, delay_fixed_seconds, target_order, created_by, scheduled_at
      ) VALUES (
        ${input.organizationId}, ${name}, 'SCHEDULE', ${input.mediaType === "REELS" ? "REEL" : "FEED_IMAGE"}::publication_type,
        ${input.defaultCaption?.trim() ?? ""}, 'SCHEDULED', ${slots[0].toISOString()}, ${input.timezone},
        'FIXED', 0, 'SELECTED', ${input.actorUserId}, now()
      ) RETURNING id
    `;
    const [schedule] = await sql<Array<{ id: string }>>`
      INSERT INTO schedules (
        organization_id, campaign_id, name, start_date, end_date, times, days_of_week,
        timezone, media_type, default_caption, auto_comment_text, auto_comment_delay_minutes, created_by
      ) VALUES (
        ${input.organizationId}, ${campaign.id}, ${name}, ${input.startDate}::date, ${input.endDate}::date,
        ${input.times}, ${input.daysOfWeek}, ${input.timezone}, ${input.mediaType},
        ${input.defaultCaption?.trim() ?? ""}, ${input.autoCommentText?.trim() ?? ""},
        ${input.autoCommentDelayMinutes}, ${input.actorUserId}
      ) RETURNING id
    `;
    await sql`INSERT INTO schedule_accounts ${sql(accountIds.map((accountId) => ({
      organization_id: input.organizationId,
      schedule_id: schedule.id,
      instagram_account_id: accountId,
    })))}`;
    await sql`INSERT INTO schedule_media ${sql(assets.map((asset, position) => ({
      organization_id: input.organizationId,
      schedule_id: schedule.id,
      media_asset_id: asset.id,
      position,
    })))}`;
    await sql`INSERT INTO campaign_media ${sql(assets.map((asset, position) => ({
      organization_id: input.organizationId,
      campaign_id: campaign.id,
      media_asset_id: asset.id,
      position,
    })))}`;
    await sql`INSERT INTO campaign_targets ${sql(accountIds.map((accountId, position) => ({
      organization_id: input.organizationId,
      campaign_id: campaign.id,
      instagram_account_id: accountId,
      position,
      scheduled_at: slots[0].toISOString(),
    })))}`;
    const jobs = scheduledMedia.flatMap((asset, publicationPosition) => accountIds.map((accountId) => ({
      organization_id: input.organizationId,
      campaign_id: campaign.id,
      schedule_id: schedule.id,
      direct_media_asset_id: asset.id,
      publication_type_override: publicationTypeFor(asset),
      instagram_account_id: accountId,
      publication_position: publicationPosition,
      scheduled_at: slots[publicationPosition].toISOString(),
      status: "QUEUED",
      max_attempts: getEnv().MAX_PUBLICATION_ATTEMPTS,
      auto_comment_text: input.autoCommentText?.trim() || null,
      auto_comment_delay_minutes: input.autoCommentDelayMinutes,
      auto_comment_max_attempts: getEnv().MAX_PUBLICATION_ATTEMPTS,
    })));
    await sql`INSERT INTO publication_jobs ${sql(jobs)}`;
    await sql`
      INSERT INTO audit_logs (organization_id, actor_user_id, event_type, entity_type, entity_id, metadata_json)
      VALUES (${input.organizationId}, ${input.actorUserId}, 'SCHEDULE_CREATED', 'schedule', ${schedule.id},
        ${JSON.stringify({ slots: slots.length, media: assets.length, scheduled: scheduledMedia.length, jobs: jobs.length })}::jsonb)
    `;
    return {
      scheduleId: schedule.id,
      scheduled: scheduledMedia.length,
      jobs: jobs.length,
      totalSlots: slots.length,
      totalMedia: assets.length,
    };
  });
}

export async function updateSchedule(scheduleId: string, input: ScheduleInput) {
  const name = input.name.trim();
  if (!name || name.length > 160) throw new Error("Informe um nome de escala válido");
  if (input.defaultCaption && input.defaultCaption.length > 2200) throw new Error("A legenda deve ter até 2.200 caracteres");
  validateAutoComment(input.autoCommentText, input.autoCommentDelayMinutes);
  const slots = buildRecurringSlots(input);
  if (!slots.length) throw new Error("A escala não possui horários futuros no período selecionado");

  return getSqlClient().begin(async (sql) => {
    const accountIds = await loadAvailableAccounts(sql, input.organizationId, input.accountIds);
    const assets = await loadReadyAssets(sql, input.organizationId, input.mediaIds, input.mediaType);
    const scheduledMedia = assets.slice(0, slots.length);
    const [schedule] = await sql<Array<{ campaign_id: string }>>`
      SELECT campaign_id FROM schedules
      WHERE organization_id = ${input.organizationId} AND id = ${scheduleId}
      FOR UPDATE
    `;
    if (!schedule) throw new Error("Escala não encontrada");

    const [busy] = await sql<Array<{ count: number }>>`
      SELECT count(*)::int AS count FROM publication_jobs
      WHERE organization_id = ${input.organizationId} AND schedule_id = ${scheduleId}
        AND status IN ('CLAIMED', 'CREATING_CONTAINER', 'WAITING_FOR_CONTAINER', 'READY_TO_PUBLISH', 'PUBLISHING')
    `;
    if ((busy?.count ?? 0) > 0) throw new Error("Aguarde a publicação em andamento antes de editar a escala");

    const terminal = await sql<Array<{ direct_media_asset_id: string; instagram_account_id: string }>>`
      SELECT direct_media_asset_id, instagram_account_id FROM publication_jobs
      WHERE organization_id = ${input.organizationId} AND schedule_id = ${scheduleId}
        AND direct_media_asset_id IS NOT NULL
        AND status IN ('PUBLISHED', 'FAILED', 'RECONCILIATION_REQUIRED')
    `;
    const terminalPairs = new Set(terminal.map((row) => `${row.direct_media_asset_id}:${row.instagram_account_id}`));
    const [position] = await sql<Array<{ next_position: number }>>`
      SELECT COALESCE(max(publication_position), -1)::int + 1 AS next_position
      FROM publication_jobs
      WHERE organization_id = ${input.organizationId} AND schedule_id = ${scheduleId}
    `;
    const removed = await sql<Array<{ id: string }>>`
      DELETE FROM publication_jobs
      WHERE organization_id = ${input.organizationId} AND schedule_id = ${scheduleId}
        AND status IN ('DRAFT', 'QUEUED', 'RETRY_WAIT', 'CANCELLED')
      RETURNING id
    `;

    await sql`
      UPDATE schedules SET name = ${name}, start_date = ${input.startDate}::date,
        end_date = ${input.endDate}::date, times = ${input.times}, days_of_week = ${input.daysOfWeek},
        timezone = ${input.timezone}, media_type = ${input.mediaType},
        default_caption = ${input.defaultCaption?.trim() ?? ""},
        auto_comment_text = ${input.autoCommentText?.trim() ?? ""},
        auto_comment_delay_minutes = ${input.autoCommentDelayMinutes}, updated_at = now()
      WHERE organization_id = ${input.organizationId} AND id = ${scheduleId}
    `;
    await sql`
      UPDATE campaigns SET name = ${name}, caption = ${input.defaultCaption?.trim() ?? ""},
        publication_type = ${input.mediaType === "REELS" ? "REEL" : "FEED_IMAGE"}::publication_type,
        start_at = ${slots[0].toISOString()}, timezone = ${input.timezone}, scheduled_at = now(), updated_at = now()
      WHERE organization_id = ${input.organizationId} AND id = ${schedule.campaign_id}
    `;
    await sql`DELETE FROM schedule_accounts WHERE organization_id = ${input.organizationId} AND schedule_id = ${scheduleId}`;
    await sql`INSERT INTO schedule_accounts ${sql(accountIds.map((accountId) => ({
      organization_id: input.organizationId,
      schedule_id: scheduleId,
      instagram_account_id: accountId,
    })))}`;
    await sql`DELETE FROM schedule_media WHERE organization_id = ${input.organizationId} AND schedule_id = ${scheduleId}`;
    await sql`INSERT INTO schedule_media ${sql(assets.map((asset, mediaPosition) => ({
      organization_id: input.organizationId,
      schedule_id: scheduleId,
      media_asset_id: asset.id,
      position: mediaPosition,
    })))}`;
    await sql`DELETE FROM campaign_media WHERE organization_id = ${input.organizationId} AND campaign_id = ${schedule.campaign_id}`;
    await sql`INSERT INTO campaign_media ${sql(assets.map((asset, mediaPosition) => ({
      organization_id: input.organizationId,
      campaign_id: schedule.campaign_id,
      media_asset_id: asset.id,
      position: mediaPosition,
    })))}`;
    await sql`DELETE FROM campaign_targets WHERE organization_id = ${input.organizationId} AND campaign_id = ${schedule.campaign_id}`;
    await sql`INSERT INTO campaign_targets ${sql(accountIds.map((accountId, targetPosition) => ({
      organization_id: input.organizationId,
      campaign_id: schedule.campaign_id,
      instagram_account_id: accountId,
      position: targetPosition,
      scheduled_at: slots[0].toISOString(),
    })))}`;

    const offset = position?.next_position ?? 0;
    const jobs = scheduledMedia.flatMap((asset, mediaPosition) => accountIds
      .filter((accountId) => !terminalPairs.has(`${asset.id}:${accountId}`))
      .map((accountId) => ({
        organization_id: input.organizationId,
        campaign_id: schedule.campaign_id,
        schedule_id: scheduleId,
        direct_media_asset_id: asset.id,
        publication_type_override: publicationTypeFor(asset),
        instagram_account_id: accountId,
        publication_position: offset + mediaPosition,
        scheduled_at: slots[mediaPosition].toISOString(),
        status: "QUEUED",
        max_attempts: getEnv().MAX_PUBLICATION_ATTEMPTS,
        auto_comment_text: input.autoCommentText?.trim() || null,
        auto_comment_delay_minutes: input.autoCommentDelayMinutes,
        auto_comment_max_attempts: getEnv().MAX_PUBLICATION_ATTEMPTS,
      })));
    if (jobs.length) await sql`INSERT INTO publication_jobs ${sql(jobs)}`;
    await sql`
      UPDATE campaigns SET status = CASE
        WHEN ${jobs.length} > 0 THEN 'SCHEDULED'::campaign_status
        WHEN EXISTS (SELECT 1 FROM publication_jobs WHERE organization_id = ${input.organizationId}
          AND schedule_id = ${scheduleId} AND status IN ('FAILED', 'RECONCILIATION_REQUIRED'))
          AND EXISTS (SELECT 1 FROM publication_jobs WHERE organization_id = ${input.organizationId}
          AND schedule_id = ${scheduleId} AND status = 'PUBLISHED') THEN 'PARTIALLY_FAILED'::campaign_status
        WHEN EXISTS (SELECT 1 FROM publication_jobs WHERE organization_id = ${input.organizationId}
          AND schedule_id = ${scheduleId} AND status IN ('FAILED', 'RECONCILIATION_REQUIRED')) THEN 'FAILED'::campaign_status
        ELSE 'COMPLETED'::campaign_status
      END, updated_at = now()
      WHERE organization_id = ${input.organizationId} AND id = ${schedule.campaign_id}
    `;
    await sql`
      INSERT INTO audit_logs (organization_id, actor_user_id, event_type, entity_type, entity_id, metadata_json)
      VALUES (${input.organizationId}, ${input.actorUserId}, 'SCHEDULE_UPDATED', 'schedule', ${scheduleId},
        ${JSON.stringify({ removedPending: removed.length, rescheduled: jobs.length })}::jsonb)
    `;
    return {
      rescheduled: jobs.length,
      added: Math.max(0, jobs.length - removed.length),
      trimmed: Math.max(0, removed.length - jobs.length),
      totalSlots: slots.length,
      totalMedia: assets.length,
    };
  });
}

export async function deleteSchedule(scheduleId: string, actorUserId: string, organizationId: string) {
  await getSqlClient().begin(async (sql) => {
    const [schedule] = await sql<Array<{ campaign_id: string }>>`
      SELECT campaign_id FROM schedules WHERE organization_id = ${organizationId} AND id = ${scheduleId} FOR UPDATE
    `;
    if (!schedule) throw new Error("Escala não encontrada");
    await sql`
      UPDATE publication_jobs SET status = 'CANCELLED', finished_at = now(), updated_at = now()
      WHERE organization_id = ${organizationId} AND schedule_id = ${scheduleId}
        AND status IN ('DRAFT', 'QUEUED', 'RETRY_WAIT')
    `;
    await sql`UPDATE campaigns SET status = 'CANCELLED', cancelled_at = now(), updated_at = now() WHERE organization_id = ${organizationId} AND id = ${schedule.campaign_id}`;
    await sql`DELETE FROM schedules WHERE organization_id = ${organizationId} AND id = ${scheduleId}`;
    await sql`
      INSERT INTO audit_logs (organization_id, actor_user_id, event_type, entity_type, entity_id)
      VALUES (${organizationId}, ${actorUserId}, 'SCHEDULE_DELETED', 'schedule', ${scheduleId})
    `;
  });
}
