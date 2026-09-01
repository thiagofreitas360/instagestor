import { randomInt } from "node:crypto";
import { DateTime } from "luxon";
import { getSqlClient } from "@/db/client";
import { getEnv } from "@/lib/env";

export type ScheduleOptions =
  | { mode: "FIXED"; fixedSeconds: number }
  | { mode: "RANDOM"; minSeconds: number; maxSeconds: number };

export function buildSchedule(
  startAt: Date,
  count: number,
  delay: ScheduleOptions,
  random: (min: number, maxExclusive: number) => number = randomInt,
) {
  if (!Number.isInteger(count) || count < 1) throw new Error("A campanha precisa de ao menos um destino");
  const dates = [new Date(startAt)];
  for (let position = 1; position < count; position++) {
    const seconds = delay.mode === "FIXED" ? delay.fixedSeconds : random(delay.minSeconds, delay.maxSeconds + 1);
    if (!Number.isInteger(seconds) || seconds < 0) throw new Error("Intervalo inválido");
    dates.push(new Date(dates[position - 1].getTime() + seconds * 1000));
  }
  return dates;
}

export function localDateTimeToUtc(value: string, timezone: string) {
  const date = DateTime.fromISO(value, { zone: timezone });
  if (!date.isValid) throw new Error("Data, hora ou timezone inválido");
  return date.toUTC().toJSDate();
}

type ScheduleCampaignInput = {
  campaignId: string;
  targetIds: string[];
  startAt: Date;
  timezone: string;
  delay: ScheduleOptions;
  targetOrder: "SELECTED" | "RANDOM" | "USERNAME";
  actorUserId: string;
};

function shuffled<T>(values: T[]) {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index--) {
    const other = randomInt(index + 1);
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}

async function prepareCampaign(input: ScheduleCampaignInput, createJobs: boolean) {
  const uniqueTargets = [...new Set(input.targetIds)];
  if (!uniqueTargets.length) throw new Error("Selecione ao menos uma conta");

  return getSqlClient().begin(async (sql) => {
    const [campaign] = await sql<
      Array<{ id: string; status: string; delay_mode: "FIXED" | "RANDOM"; publication_type: string }>
    >`SELECT id, status, delay_mode, publication_type FROM campaigns WHERE id = ${input.campaignId} FOR UPDATE`;
    if (!campaign) throw new Error("Campanha não encontrada");
    if (campaign.status !== "DRAFT") throw new Error("Apenas campanhas em rascunho podem ser agendadas");

    const accounts = await sql<Array<{ id: string; username: string; account_type: string | null }>>`
      SELECT id, username, account_type FROM instagram_accounts
      WHERE id = ANY(${uniqueTargets}::uuid[]) AND status IN ('CONNECTED', 'TOKEN_EXPIRING')
    `;
    if (accounts.length !== uniqueTargets.length) throw new Error("Uma ou mais contas estão desconectadas ou indisponíveis");
    if (
      getEnv().INSTAGRAM_PROVIDER === "meta"
      && campaign.publication_type.startsWith("STORY_")
      && accounts.some((account) => account.account_type?.toUpperCase() !== "BUSINESS")
    ) {
      throw new Error("Stories estão habilitados somente para contas Business até a validação oficial em contas Creator");
    }
    const byId = new Map(accounts.map((account) => [account.id, account]));
    let ordered = uniqueTargets.map((id) => byId.get(id)!);
    if (input.targetOrder === "USERNAME") ordered.sort((a, b) => a.username.localeCompare(b.username));
    if (input.targetOrder === "RANDOM") ordered = shuffled(ordered);

    const times = buildSchedule(input.startAt, ordered.length, input.delay);
    await sql`
      UPDATE campaigns SET
        status = ${createJobs ? "SCHEDULED" : "DRAFT"}::campaign_status,
        start_at = ${input.startAt.toISOString()}, timezone = ${input.timezone},
        delay_mode = ${input.delay.mode},
        delay_fixed_seconds = ${input.delay.mode === "FIXED" ? input.delay.fixedSeconds : null},
        delay_min_seconds = ${input.delay.mode === "RANDOM" ? input.delay.minSeconds : null},
        delay_max_seconds = ${input.delay.mode === "RANDOM" ? input.delay.maxSeconds : null},
        target_order = ${input.targetOrder}, scheduled_at = ${createJobs ? new Date().toISOString() : null}, updated_at = now()
      WHERE id = ${input.campaignId}
    `;
    await sql`DELETE FROM campaign_targets WHERE campaign_id = ${input.campaignId}`;
    const targetRows = ordered.map((account, position) => ({
      campaign_id: input.campaignId,
      instagram_account_id: account.id,
      position,
      scheduled_at: times[position].toISOString(),
    }));
    await sql`INSERT INTO campaign_targets ${sql(targetRows)}`;
    if (createJobs) {
      const jobRows = ordered.map((account, position) => ({
        campaign_id: input.campaignId,
        instagram_account_id: account.id,
        scheduled_at: times[position].toISOString(),
        status: "QUEUED",
        max_attempts: getEnv().MAX_PUBLICATION_ATTEMPTS,
      }));
      await sql`INSERT INTO publication_jobs ${sql(jobRows)}`;
      await sql`
        INSERT INTO audit_logs (actor_user_id, event_type, entity_type, entity_id, metadata_json)
        VALUES (${input.actorUserId}, 'CAMPAIGN_SCHEDULED', 'campaign', ${input.campaignId}, ${JSON.stringify({ jobs: jobRows.length })}::jsonb)
      `;
    }
    return { jobs: createJobs ? ordered.length : 0, schedule: times };
  });
}

export function scheduleCampaign(input: ScheduleCampaignInput) {
  return prepareCampaign(input, true);
}

export function previewCampaignSchedule(input: ScheduleCampaignInput) {
  return prepareCampaign(input, false);
}

export async function confirmCampaignSchedule(campaignId: string, actorUserId: string) {
  return getSqlClient().begin(async (sql) => {
    const [campaign] = await sql<{ id: string; status: string; publication_type: string }[]>`
      SELECT id, status, publication_type FROM campaigns WHERE id = ${campaignId} FOR UPDATE
    `;
    if (!campaign || campaign.status !== "DRAFT") throw new Error("Campanha não está pronta para confirmação");
    const targets = await sql<Array<{ instagram_account_id: string; scheduled_at: Date; account_status: string; account_type: string | null }>>`
      SELECT target.instagram_account_id, target.scheduled_at, account.status AS account_status, account.account_type
      FROM campaign_targets target
      JOIN instagram_accounts account ON account.id = target.instagram_account_id
      WHERE target.campaign_id = ${campaignId} AND target.scheduled_at IS NOT NULL
      ORDER BY target.position
    `;
    if (!targets.length) throw new Error("Gere o preview do cronograma antes de confirmar");
    if (targets.some((target) => !["CONNECTED", "TOKEN_EXPIRING"].includes(target.account_status))) {
      throw new Error("Uma ou mais contas ficaram indisponíveis após o preview");
    }
    if (
      getEnv().INSTAGRAM_PROVIDER === "meta"
      && campaign.publication_type.startsWith("STORY_")
      && targets.some((target) => target.account_type?.toUpperCase() !== "BUSINESS")
    ) {
      throw new Error("Uma ou mais contas deixaram de ser Business após o preview");
    }
    const jobRows = targets.map((target) => ({
      campaign_id: campaignId,
      instagram_account_id: target.instagram_account_id,
      scheduled_at: target.scheduled_at.toISOString(),
      status: "QUEUED",
      max_attempts: getEnv().MAX_PUBLICATION_ATTEMPTS,
    }));
    await sql`INSERT INTO publication_jobs ${sql(jobRows)}`;
    await sql`UPDATE campaigns SET status = 'SCHEDULED', scheduled_at = now(), updated_at = now() WHERE id = ${campaignId}`;
    await sql`
      INSERT INTO audit_logs (actor_user_id, event_type, entity_type, entity_id, metadata_json)
      VALUES (${actorUserId}, 'CAMPAIGN_SCHEDULED', 'campaign', ${campaignId}, ${JSON.stringify({ jobs: jobRows.length })}::jsonb)
    `;
    return { jobs: jobRows.length };
  });
}

export async function pauseCampaign(campaignId: string, actorUserId: string) {
  await getSqlClient().begin(async (sql) => {
    const [campaign] = await sql<{ id: string }[]>`
      UPDATE campaigns SET status = 'PAUSED', paused_at = now(), updated_at = now()
      WHERE id = ${campaignId} AND status IN ('SCHEDULED', 'RUNNING') RETURNING id
    `;
    if (!campaign) throw new Error("Campanha não pode ser pausada neste estado");
    await sql`
      INSERT INTO audit_logs (actor_user_id, event_type, entity_type, entity_id)
      VALUES (${actorUserId}, 'CAMPAIGN_PAUSED', 'campaign', ${campaignId})
    `;
  });
}

export async function resumeCampaign(campaignId: string, actorUserId: string) {
  await getSqlClient().begin(async (sql) => {
    const [campaign] = await sql<{ id: string }[]>`
      UPDATE campaigns SET status = 'SCHEDULED', paused_at = NULL, updated_at = now()
      WHERE id = ${campaignId} AND status = 'PAUSED' RETURNING id
    `;
    if (!campaign) throw new Error("Campanha não está pausada");
    await sql`
      INSERT INTO audit_logs (actor_user_id, event_type, entity_type, entity_id, metadata_json)
      VALUES (${actorUserId}, 'CAMPAIGN_RESUMED', 'campaign', ${campaignId}, ${JSON.stringify({ overdue: "eligible_immediately" })}::jsonb)
    `;
  });
}

export async function cancelCampaign(campaignId: string, actorUserId: string) {
  return getSqlClient().begin(async (sql) => {
    const [campaign] = await sql<{ id: string }[]>`
      UPDATE campaigns SET status = 'CANCELLED', cancelled_at = now(), updated_at = now()
      WHERE id = ${campaignId} AND status NOT IN ('COMPLETED', 'CANCELLED') RETURNING id
    `;
    if (!campaign) throw new Error("Campanha não pode ser cancelada neste estado");
    await sql`
      UPDATE publication_jobs SET status = 'CANCELLED', finished_at = now(), updated_at = now()
      WHERE campaign_id = ${campaignId} AND status IN ('QUEUED', 'RETRY_WAIT')
    `;
    await sql`
      INSERT INTO audit_logs (actor_user_id, event_type, entity_type, entity_id)
      VALUES (${actorUserId}, 'CAMPAIGN_CANCELLED', 'campaign', ${campaignId})
    `;
  });
}

export async function retryFailedJob(jobId: string, actorUserId: string) {
  await getSqlClient().begin(async (sql) => {
    const [job] = await sql<{ id: string; campaign_id: string }[]>`
      UPDATE publication_jobs job SET
        status = 'QUEUED', attempt_count = 0, next_attempt_at = NULL, locked_at = NULL,
        locked_by = NULL, lock_expires_at = NULL, last_error_code = NULL,
        last_error_type = NULL, last_error_message = NULL, last_http_status = NULL,
        meta_container_id = NULL, meta_child_container_ids = NULL, meta_media_id = NULL,
        container_started_at = NULL, publishing_phase = NULL, started_at = NULL, published_at = NULL, finished_at = NULL,
        reconciliation_required = false, updated_at = now()
      FROM campaigns campaign
      WHERE job.id = ${jobId} AND job.status = 'FAILED' AND campaign.id = job.campaign_id
        AND campaign.status <> 'CANCELLED'
      RETURNING job.id, job.campaign_id
    `;
    if (!job) throw new Error("Apenas jobs falhados e não ambíguos podem ser reenfileirados");
    await sql`
      UPDATE campaigns SET status = 'SCHEDULED', updated_at = now()
      WHERE id = ${job.campaign_id} AND status IN ('FAILED', 'PARTIALLY_FAILED')
    `;
    await sql`
      INSERT INTO audit_logs (actor_user_id, event_type, entity_type, entity_id)
      VALUES (${actorUserId}, 'JOB_MANUAL_RETRY', 'publication_job', ${jobId})
    `;
  });
}

export async function cancelPendingJob(jobId: string, actorUserId: string) {
  await getSqlClient().begin(async (sql) => {
    const [job] = await sql<{ id: string; campaign_id: string }[]>`
      UPDATE publication_jobs SET status = 'CANCELLED', finished_at = now(), updated_at = now()
      WHERE id = ${jobId} AND status IN ('QUEUED', 'RETRY_WAIT')
      RETURNING id, campaign_id
    `;
    if (!job) throw new Error("Apenas jobs ainda não iniciados podem ser cancelados");
    await sql`
      WITH totals AS (
        SELECT
          count(*) FILTER (WHERE status NOT IN ('PUBLISHED', 'FAILED', 'CANCELLED', 'RECONCILIATION_REQUIRED')) AS pending,
          count(*) FILTER (WHERE status = 'PUBLISHED') AS published,
          count(*) FILTER (WHERE status IN ('FAILED', 'RECONCILIATION_REQUIRED')) AS failed,
          count(*) FILTER (WHERE status = 'CANCELLED') AS cancelled,
          count(*) AS total
        FROM publication_jobs WHERE campaign_id = ${job.campaign_id}
      )
      UPDATE campaigns SET status = CASE
          WHEN totals.pending > 0 THEN campaigns.status
          WHEN totals.cancelled = totals.total THEN 'CANCELLED'::campaign_status
          WHEN totals.failed = 0 THEN 'COMPLETED'::campaign_status
          WHEN totals.published = 0 THEN 'FAILED'::campaign_status
          ELSE 'PARTIALLY_FAILED'::campaign_status
        END,
        cancelled_at = CASE WHEN totals.cancelled = totals.total THEN now() ELSE campaigns.cancelled_at END,
        updated_at = now()
      FROM totals
      WHERE campaigns.id = ${job.campaign_id} AND totals.pending = 0 AND campaigns.status <> 'CANCELLED'
    `;
    await sql`
      INSERT INTO audit_logs (actor_user_id, event_type, entity_type, entity_id)
      VALUES (${actorUserId}, 'JOB_CANCELLED', 'publication_job', ${jobId})
    `;
  });
}

export async function duplicateCampaign(campaignId: string, actorUserId: string) {
  return getSqlClient().begin(async (sql) => {
    const [copy] = await sql<{ id: string }[]>`
      INSERT INTO campaigns (
        name, publication_type, caption, status, timezone, delay_mode, delay_fixed_seconds,
        delay_min_seconds, delay_max_seconds, target_order, share_to_feed, created_by
      )
      SELECT name || ' — cópia', publication_type, caption, 'DRAFT', timezone, delay_mode,
        delay_fixed_seconds, delay_min_seconds, delay_max_seconds, target_order, share_to_feed, ${actorUserId}
      FROM campaigns WHERE id = ${campaignId}
      RETURNING id
    `;
    if (!copy) throw new Error("Campanha não encontrada");
    await sql`
      INSERT INTO campaign_media (campaign_id, media_asset_id, position)
      SELECT ${copy.id}, media_asset_id, position FROM campaign_media WHERE campaign_id = ${campaignId}
    `;
    await sql`
      INSERT INTO campaign_targets (campaign_id, instagram_account_id, position)
      SELECT ${copy.id}, instagram_account_id, position FROM campaign_targets WHERE campaign_id = ${campaignId}
    `;
    await sql`
      INSERT INTO audit_logs (actor_user_id, event_type, entity_type, entity_id, metadata_json)
      VALUES (${actorUserId}, 'CAMPAIGN_CREATED', 'campaign', ${copy.id}, ${JSON.stringify({ duplicatedFrom: campaignId })}::jsonb)
    `;
    return copy.id;
  });
}
