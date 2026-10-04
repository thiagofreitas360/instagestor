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
  organizationId: string;
};

function shuffled<T>(values: T[]) {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index--) {
    const other = randomInt(index + 1);
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}

export function expandPublicationTargets<T extends { id: string }>(
  targets: T[],
  mediaPositions: number[],
  publicationType: string,
) {
  const positions = ["FEED_VIDEO", "REEL"].includes(publicationType) ? mediaPositions : [0];
  if (!positions.length) throw new Error("A campanha precisa de ao menos uma mídia");
  return positions.flatMap((publicationPosition) => targets.map((account) => ({ account, publicationPosition })));
}

async function prepareCampaign(input: ScheduleCampaignInput, createJobs: boolean) {
  const uniqueTargets = [...new Set(input.targetIds)];
  if (!uniqueTargets.length) throw new Error("Selecione ao menos uma conta");

  return getSqlClient().begin(async (sql) => {
    const [campaign] = await sql<
      Array<{ id: string; status: string; delay_mode: "FIXED" | "RANDOM"; publication_type: string }>
    >`SELECT id, status, delay_mode, publication_type FROM campaigns
      WHERE organization_id = ${input.organizationId} AND id = ${input.campaignId} FOR UPDATE`;
    if (!campaign) throw new Error("Campanha não encontrada");
    if (campaign.status !== "DRAFT") throw new Error("Apenas campanhas em rascunho podem ser agendadas");

    const accounts = await sql<Array<{ id: string; username: string; account_type: string | null }>>`
      SELECT id, username, account_type FROM instagram_accounts
      WHERE organization_id = ${input.organizationId}
        AND id = ANY(${uniqueTargets}::uuid[]) AND status IN ('CONNECTED', 'TOKEN_EXPIRING')
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

    const media = await sql<Array<{ position: number }>>`
      SELECT position FROM campaign_media
      WHERE organization_id = ${input.organizationId} AND campaign_id = ${input.campaignId} ORDER BY position
    `;
    const publications = expandPublicationTargets(ordered, media.map((item) => item.position), campaign.publication_type);
    const times = buildSchedule(input.startAt, publications.length, input.delay);
    await sql`
      UPDATE campaigns SET
        status = ${createJobs ? "SCHEDULED" : "DRAFT"}::campaign_status,
        start_at = ${input.startAt.toISOString()}, timezone = ${input.timezone},
        delay_mode = ${input.delay.mode},
        delay_fixed_seconds = ${input.delay.mode === "FIXED" ? input.delay.fixedSeconds : null},
        delay_min_seconds = ${input.delay.mode === "RANDOM" ? input.delay.minSeconds : null},
        delay_max_seconds = ${input.delay.mode === "RANDOM" ? input.delay.maxSeconds : null},
        target_order = ${input.targetOrder}, scheduled_at = ${createJobs ? new Date().toISOString() : null}, updated_at = now()
      WHERE organization_id = ${input.organizationId} AND id = ${input.campaignId}
    `;
    await sql`DELETE FROM campaign_targets WHERE organization_id = ${input.organizationId} AND campaign_id = ${input.campaignId}`;
    await sql`DELETE FROM publication_jobs WHERE organization_id = ${input.organizationId} AND campaign_id = ${input.campaignId} AND status = 'DRAFT'`;
    const targetRows = ordered.map((account, position) => ({
      organization_id: input.organizationId,
      campaign_id: input.campaignId,
      instagram_account_id: account.id,
      position,
      scheduled_at: times[position].toISOString(),
    }));
    await sql`INSERT INTO campaign_targets ${sql(targetRows)}`;
    const jobRows = publications.map(({ account, publicationPosition }, position) => ({
      organization_id: input.organizationId,
      campaign_id: input.campaignId,
      instagram_account_id: account.id,
      publication_position: publicationPosition,
      scheduled_at: times[position].toISOString(),
      status: createJobs ? "QUEUED" : "DRAFT",
      max_attempts: getEnv().MAX_PUBLICATION_ATTEMPTS,
    }));
    await sql`INSERT INTO publication_jobs ${sql(jobRows)}`;
    if (createJobs) {
      await sql`
        INSERT INTO audit_logs (organization_id, actor_user_id, event_type, entity_type, entity_id, metadata_json)
        VALUES (${input.organizationId}, ${input.actorUserId}, 'CAMPAIGN_SCHEDULED', 'campaign', ${input.campaignId}, ${JSON.stringify({ jobs: jobRows.length })}::jsonb)
      `;
    }
    return { jobs: createJobs ? jobRows.length : 0, schedule: times };
  });
}

export function scheduleCampaign(input: ScheduleCampaignInput) {
  return prepareCampaign(input, true);
}

export function previewCampaignSchedule(input: ScheduleCampaignInput) {
  return prepareCampaign(input, false);
}

export async function confirmCampaignSchedule(campaignId: string, actorUserId: string, organizationId: string) {
  return getSqlClient().begin(async (sql) => {
    const [campaign] = await sql<{ id: string; status: string; publication_type: string }[]>`
      SELECT id, status, publication_type FROM campaigns
      WHERE organization_id = ${organizationId} AND id = ${campaignId} FOR UPDATE
    `;
    if (!campaign || campaign.status !== "DRAFT") throw new Error("Campanha não está pronta para confirmação");
    const targets = await sql<Array<{ instagram_account_id: string; account_status: string; account_type: string | null }>>`
      SELECT job.instagram_account_id, account.status AS account_status, account.account_type
      FROM publication_jobs job
      JOIN instagram_accounts account ON account.organization_id = job.organization_id
        AND account.id = job.instagram_account_id
      WHERE job.organization_id = ${organizationId} AND job.campaign_id = ${campaignId} AND job.status = 'DRAFT'
      ORDER BY job.scheduled_at, job.created_at
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
    await sql`UPDATE publication_jobs SET status = 'QUEUED', updated_at = now() WHERE organization_id = ${organizationId} AND campaign_id = ${campaignId} AND status = 'DRAFT'`;
    await sql`UPDATE campaigns SET status = 'SCHEDULED', scheduled_at = now(), updated_at = now() WHERE organization_id = ${organizationId} AND id = ${campaignId}`;
    await sql`
      INSERT INTO audit_logs (organization_id, actor_user_id, event_type, entity_type, entity_id, metadata_json)
      VALUES (${organizationId}, ${actorUserId}, 'CAMPAIGN_SCHEDULED', 'campaign', ${campaignId}, ${JSON.stringify({ jobs: targets.length })}::jsonb)
    `;
    return { jobs: targets.length };
  });
}

export async function pauseCampaign(campaignId: string, actorUserId: string, organizationId: string) {
  await getSqlClient().begin(async (sql) => {
    const [campaign] = await sql<{ id: string }[]>`
      UPDATE campaigns SET status = 'PAUSED', paused_at = now(), updated_at = now()
      WHERE organization_id = ${organizationId} AND id = ${campaignId}
        AND status IN ('SCHEDULED', 'RUNNING') RETURNING id
    `;
    if (!campaign) throw new Error("Campanha não pode ser pausada neste estado");
    await sql`
      INSERT INTO audit_logs (organization_id, actor_user_id, event_type, entity_type, entity_id)
      VALUES (${organizationId}, ${actorUserId}, 'CAMPAIGN_PAUSED', 'campaign', ${campaignId})
    `;
  });
}

export async function resumeCampaign(campaignId: string, actorUserId: string, organizationId: string) {
  await getSqlClient().begin(async (sql) => {
    const [campaign] = await sql<{ id: string }[]>`
      UPDATE campaigns SET status = 'SCHEDULED', paused_at = NULL, updated_at = now()
      WHERE organization_id = ${organizationId} AND id = ${campaignId} AND status = 'PAUSED' RETURNING id
    `;
    if (!campaign) throw new Error("Campanha não está pausada");
    const [pending] = await sql<Array<{ earliest: Date | null }>>`
      SELECT min(COALESCE(next_attempt_at, scheduled_at)) AS earliest
      FROM publication_jobs WHERE organization_id = ${organizationId}
        AND campaign_id = ${campaignId} AND status IN ('QUEUED', 'RETRY_WAIT')
    `;
    const earliest = pending?.earliest ? new Date(pending.earliest) : null;
    const shiftSeconds = earliest && earliest.getTime() < Date.now()
      ? Math.floor((Date.now() - earliest.getTime()) / 1000)
      : 0;
    if (shiftSeconds) {
      await sql`
        UPDATE publication_jobs SET
          scheduled_at = scheduled_at + ${shiftSeconds} * interval '1 second',
          next_attempt_at = CASE WHEN next_attempt_at IS NULL THEN NULL ELSE next_attempt_at + ${shiftSeconds} * interval '1 second' END,
          updated_at = now()
        WHERE organization_id = ${organizationId}
          AND campaign_id = ${campaignId} AND status IN ('QUEUED', 'RETRY_WAIT')
      `;
    }
    await sql`
      INSERT INTO audit_logs (organization_id, actor_user_id, event_type, entity_type, entity_id, metadata_json)
      VALUES (${organizationId}, ${actorUserId}, 'CAMPAIGN_RESUMED', 'campaign', ${campaignId}, ${JSON.stringify({ overdue: shiftSeconds ? "rebased" : "unchanged", shiftSeconds })}::jsonb)
    `;
  });
}

export async function cancelCampaign(campaignId: string, actorUserId: string, organizationId: string) {
  return getSqlClient().begin(async (sql) => {
    const [campaign] = await sql<{ id: string }[]>`
      UPDATE campaigns SET status = 'CANCELLED', cancelled_at = now(), updated_at = now()
      WHERE organization_id = ${organizationId} AND id = ${campaignId}
        AND status NOT IN ('COMPLETED', 'CANCELLED') RETURNING id
    `;
    if (!campaign) throw new Error("Campanha não pode ser cancelada neste estado");
    await sql`
      UPDATE publication_jobs SET status = 'CANCELLED', finished_at = now(), updated_at = now()
      WHERE organization_id = ${organizationId}
        AND campaign_id = ${campaignId} AND status IN ('DRAFT', 'QUEUED', 'RETRY_WAIT')
    `;
    await sql`
      INSERT INTO audit_logs (organization_id, actor_user_id, event_type, entity_type, entity_id)
      VALUES (${organizationId}, ${actorUserId}, 'CAMPAIGN_CANCELLED', 'campaign', ${campaignId})
    `;
  });
}

export async function retryFailedJob(jobId: string, actorUserId: string, organizationId: string) {
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
      WHERE job.organization_id = ${organizationId} AND job.id = ${jobId}
        AND job.status = 'FAILED' AND campaign.organization_id = ${organizationId} AND campaign.id = job.campaign_id
        AND campaign.status <> 'CANCELLED'
      RETURNING job.id, job.campaign_id
    `;
    if (!job) throw new Error("Apenas jobs falhados e não ambíguos podem ser reenfileirados");
    await sql`
      UPDATE campaigns SET status = 'SCHEDULED', updated_at = now()
      WHERE organization_id = ${organizationId}
        AND id = ${job.campaign_id} AND status IN ('FAILED', 'PARTIALLY_FAILED')
    `;
    await sql`
      INSERT INTO audit_logs (organization_id, actor_user_id, event_type, entity_type, entity_id)
      VALUES (${organizationId}, ${actorUserId}, 'JOB_MANUAL_RETRY', 'publication_job', ${jobId})
    `;
  });
}

export async function cancelPendingJob(jobId: string, actorUserId: string, organizationId: string) {
  await getSqlClient().begin(async (sql) => {
    const [job] = await sql<{ id: string; campaign_id: string }[]>`
      UPDATE publication_jobs SET status = 'CANCELLED', finished_at = now(), updated_at = now()
      WHERE organization_id = ${organizationId} AND id = ${jobId} AND status IN ('QUEUED', 'RETRY_WAIT')
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
        FROM publication_jobs WHERE organization_id = ${organizationId} AND campaign_id = ${job.campaign_id}
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
      WHERE campaigns.organization_id = ${organizationId} AND campaigns.id = ${job.campaign_id}
        AND totals.pending = 0 AND campaigns.status <> 'CANCELLED'
    `;
    await sql`
      INSERT INTO audit_logs (organization_id, actor_user_id, event_type, entity_type, entity_id)
      VALUES (${organizationId}, ${actorUserId}, 'JOB_CANCELLED', 'publication_job', ${jobId})
    `;
  });
}

export async function duplicateCampaign(campaignId: string, actorUserId: string, organizationId: string) {
  return getSqlClient().begin(async (sql) => {
    const [copy] = await sql<{ id: string }[]>`
      INSERT INTO campaigns (
        organization_id, name, publication_type, caption, status, timezone, delay_mode, delay_fixed_seconds,
        delay_min_seconds, delay_max_seconds, target_order, share_to_feed, created_by
      )
      SELECT organization_id, name || ' — cópia', publication_type, caption, 'DRAFT', timezone, delay_mode,
        delay_fixed_seconds, delay_min_seconds, delay_max_seconds, target_order, share_to_feed, ${actorUserId}
      FROM campaigns WHERE organization_id = ${organizationId} AND id = ${campaignId}
      RETURNING id
    `;
    if (!copy) throw new Error("Campanha não encontrada");
    await sql`
      INSERT INTO campaign_media (organization_id, campaign_id, media_asset_id, position)
      SELECT ${organizationId}, ${copy.id}, media_asset_id, position FROM campaign_media
      WHERE organization_id = ${organizationId} AND campaign_id = ${campaignId}
    `;
    await sql`
      INSERT INTO campaign_targets (organization_id, campaign_id, instagram_account_id, position)
      SELECT ${organizationId}, ${copy.id}, instagram_account_id, position FROM campaign_targets
      WHERE organization_id = ${organizationId} AND campaign_id = ${campaignId}
    `;
    await sql`
      INSERT INTO audit_logs (organization_id, actor_user_id, event_type, entity_type, entity_id, metadata_json)
      VALUES (${organizationId}, ${actorUserId}, 'CAMPAIGN_CREATED', 'campaign', ${copy.id}, ${JSON.stringify({ duplicatedFrom: campaignId })}::jsonb)
    `;
    return copy.id;
  });
}
