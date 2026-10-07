import { randomInt } from "node:crypto";
import { getSqlClient } from "@/db/client";
import { decryptToken } from "@/lib/crypto";
import { InstagramError, asInstagramError } from "@/lib/errors";
import { getEnv } from "@/lib/env";
import { log } from "@/lib/logger";
import { getInstagramProvider } from "@/providers";
import { COMMENTS_SCOPE } from "@/providers/instagram";
import { getStorageProvider } from "@/providers/storage";
import { scheduleNextLoopJob } from "@/server/automation";
import { accountWarmupAllowedAt } from "@/server/account-warmup";
import type { WarmupProfile } from "@/lib/account-warmup";
import { markAccountUnavailableIfCurrent } from "./account-availability";

export type ClaimedJob = {
  id: string;
  organization_id: string;
  campaign_id: string;
  loop_id: string | null;
  instagram_account_id: string;
  fencing_token: number;
};

export type ClaimedAutoComment = {
  id: string;
  organization_id: string;
  campaign_id: string;
  instagram_account_id: string;
  auto_comment_fencing_token: number;
};

type JobDetails = ClaimedJob & {
  campaign_id: string;
  scheduled_at: Date;
  container_started_at: Date | string | null;
  status: string;
  attempt_count: number;
  max_attempts: number;
  meta_container_id: string | null;
  meta_child_container_ids: string[] | null;
  publication_type: "FEED_IMAGE" | "FEED_VIDEO" | "REEL" | "STORY_IMAGE" | "STORY_VIDEO" | "CAROUSEL";
  caption: string | null;
  share_to_feed: boolean;
  instagram_user_id: string;
  account_type: string | null;
  account_status: string;
  encrypted_access_token: string | null;
  publishing_limit_usage: number | null;
  publishing_limit_total: number | null;
  publishing_limit_checked_at: Date | null;
  media: Array<{
    id: string;
    storage_key: string;
    storage_provider: "LOCAL" | "S3";
    media_kind: "IMAGE" | "VIDEO";
  }>;
};

class LostLeaseError extends Error {}
const CONTAINER_MAX_WAIT_MS = 60 * 60 * 1000;

function containerWaitExpired(job: JobDetails) {
  if (!job.container_started_at) return false;
  return Date.now() - new Date(job.container_started_at).getTime() >= CONTAINER_MAX_WAIT_MS;
}

export function retryDelaySeconds(attempt: number, retryAfter?: number, jitter: () => number = () => randomInt(1000) / 1000) {
  const normalizedJitter = Math.max(0, Math.min(1, jitter()));
  if (retryAfter && retryAfter > 0) {
    const minimum = Math.min(retryAfter, 3600);
    const spread = Math.min(3600 - minimum, Math.max(1, Math.ceil(minimum * 0.1)));
    return Math.ceil(minimum + normalizedJitter * spread);
  }
  const ceiling = Math.min(3600, 5 * 2 ** Math.max(0, attempt - 1));
  return Math.max(1, Math.ceil(ceiling / 2 + normalizedJitter * ceiling / 2));
}

export async function renewJobLease(job: ClaimedJob, workerId: string) {
  const lockSeconds = getEnv().JOB_LOCK_SECONDS;
  const rows = await getSqlClient()`
    UPDATE publication_jobs SET lock_expires_at = now() + ${lockSeconds} * interval '1 second', updated_at = now()
    WHERE organization_id = ${job.organization_id}
      AND id = ${job.id} AND fencing_token = ${job.fencing_token} AND locked_by = ${workerId}
      AND lock_expires_at > now()
      AND status IN ('CLAIMED', 'CREATING_CONTAINER', 'WAITING_FOR_CONTAINER', 'READY_TO_PUBLISH', 'PUBLISHING')
    RETURNING id
  `;
  return rows.length > 0;
}

async function startLeaseKeepalive(job: ClaimedJob, workerId: string) {
  const lockMilliseconds = getEnv().JOB_LOCK_SECONDS * 1000;
  const intervalMilliseconds = Math.max(1_000, Math.floor(lockMilliseconds / 3));
  let leaseValidUntil = 0;
  let lost = false;
  let stopped = false;
  let pendingRenewal = Promise.resolve();

  const renew = async () => {
    if (stopped || lost) return;
    try {
      if (await renewJobLease(job, workerId)) leaseValidUntil = Date.now() + lockMilliseconds;
      else lost = true;
    } catch (error) {
      if (Date.now() >= leaseValidUntil) lost = true;
      log("warn", "worker", "lease_renewal_failed", {
        job_id: job.id,
        account_id: job.instagram_account_id,
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  };

  await renew();
  if (lost) throw new LostLeaseError("Lease do job foi perdido antes do processamento");
  const timer = setInterval(() => {
    pendingRenewal = pendingRenewal.then(renew);
  }, intervalMilliseconds);
  timer.unref();

  return {
    assertCurrent() {
      if (lost || Date.now() >= leaseValidUntil) throw new LostLeaseError("Lease do job expirou durante o processamento");
    },
    async stop() {
      stopped = true;
      clearInterval(timer);
      await pendingRenewal;
    },
  };
}

export async function claimJob(workerId: string): Promise<ClaimedJob | null> {
  const lockSeconds = getEnv().JOB_LOCK_SECONDS;
  const [job] = await getSqlClient()<ClaimedJob[]>`
    WITH candidate AS (
      SELECT jobs.id
      FROM publication_jobs jobs
      JOIN campaigns campaign ON campaign.organization_id = jobs.organization_id AND campaign.id = jobs.campaign_id
      JOIN instagram_accounts account ON account.organization_id = jobs.organization_id AND account.id = jobs.instagram_account_id
      WHERE campaign.status IN ('SCHEDULED', 'RUNNING')
        AND account.status IN ('CONNECTED', 'TOKEN_EXPIRING')
        AND (
          (jobs.status = 'QUEUED' AND jobs.scheduled_at <= now()) OR
          (jobs.status = 'RETRY_WAIT' AND jobs.next_attempt_at <= now())
        )
      ORDER BY COALESCE(jobs.next_attempt_at, jobs.scheduled_at), jobs.created_at
      FOR UPDATE OF jobs SKIP LOCKED
      LIMIT 1
    )
    UPDATE publication_jobs jobs SET
      status = 'CLAIMED', locked_at = now(), locked_by = ${workerId},
      lock_expires_at = now() + ${lockSeconds} * interval '1 second',
      fencing_token = jobs.fencing_token + 1,
      started_at = COALESCE(jobs.started_at, now()), updated_at = now()
    FROM candidate WHERE jobs.id = candidate.id
    RETURNING jobs.id, jobs.organization_id, jobs.campaign_id, jobs.instagram_account_id,
      jobs.loop_id, jobs.fencing_token::int AS fencing_token
  `;
  if (job) {
    await getSqlClient()`
      UPDATE campaigns SET status = 'RUNNING', updated_at = now()
      WHERE organization_id = ${job.organization_id}
        AND id = (SELECT campaign_id FROM publication_jobs WHERE organization_id = ${job.organization_id} AND id = ${job.id})
        AND status = 'SCHEDULED'
    `;
  }
  return job ?? null;
}

export async function claimAutoComment(workerId: string): Promise<ClaimedAutoComment | null> {
  const lockSeconds = Math.max(
    getEnv().JOB_LOCK_SECONDS,
    Math.ceil(getEnv().META_HTTP_TIMEOUT_MS / 1000) + 30,
  );
  const [job] = await getSqlClient()<ClaimedAutoComment[]>`
    WITH candidate AS (
      SELECT jobs.id
      FROM publication_jobs jobs
      JOIN instagram_accounts account ON account.organization_id = jobs.organization_id
        AND account.id = jobs.instagram_account_id
      WHERE jobs.status = 'PUBLISHED'
        AND account.status IN ('CONNECTED', 'TOKEN_EXPIRING')
        AND jobs.auto_comment_text IS NOT NULL
        AND (
          (jobs.auto_comment_status = 'QUEUED' AND jobs.auto_comment_scheduled_at <= now()) OR
          (jobs.auto_comment_status = 'RETRY_WAIT' AND jobs.auto_comment_scheduled_at <= now())
        )
      ORDER BY jobs.auto_comment_scheduled_at, jobs.published_at
      FOR UPDATE OF jobs SKIP LOCKED
      LIMIT 1
    )
    UPDATE publication_jobs jobs SET auto_comment_status = 'PROCESSING',
      auto_comment_locked_at = now(), auto_comment_locked_by = ${workerId},
      auto_comment_lock_expires_at = now() + ${lockSeconds} * interval '1 second',
      auto_comment_fencing_token = jobs.auto_comment_fencing_token + 1, updated_at = now()
    FROM candidate WHERE jobs.id = candidate.id
    RETURNING jobs.id, jobs.organization_id, jobs.campaign_id, jobs.instagram_account_id,
      jobs.auto_comment_fencing_token::int AS auto_comment_fencing_token
  `;
  return job ?? null;
}

export async function recoverStaleJobs() {
  return getSqlClient().begin(async (sql) => {
    await sql`
      UPDATE publication_jobs SET auto_comment_status = 'RECONCILIATION_REQUIRED',
        auto_comment_last_error_code = 'STALE_COMMENT_LOCK', auto_comment_last_error_type = 'AMBIGUOUS',
        auto_comment_last_error_message = 'Worker perdeu o lock durante o comentário; a operação não será repetida automaticamente',
        auto_comment_locked_at = NULL, auto_comment_locked_by = NULL, auto_comment_lock_expires_at = NULL,
        auto_comment_fencing_token = auto_comment_fencing_token + 1, updated_at = now()
      WHERE auto_comment_status = 'PROCESSING' AND auto_comment_lock_expires_at < now()
    `;
    const ambiguous = await sql<Array<{ id: string }>>`
      UPDATE publication_jobs SET
        status = 'RECONCILIATION_REQUIRED', reconciliation_required = true,
        last_error_code = 'STALE_DURING_PUBLISH', last_error_type = 'AMBIGUOUS',
        last_error_message = 'Worker perdeu o lease durante media_publish; publicação não será repetida automaticamente',
        locked_at = NULL, locked_by = NULL, lock_expires_at = NULL,
        fencing_token = fencing_token + 1, finished_at = now(), updated_at = now()
      WHERE status = 'PUBLISHING' AND lock_expires_at < now()
      RETURNING id
    `;
    const retryable = await sql`
      UPDATE publication_jobs job SET
        status = CASE WHEN campaign.status = 'CANCELLED' THEN 'CANCELLED'::publication_job_status ELSE 'RETRY_WAIT'::publication_job_status END,
        next_attempt_at = CASE WHEN campaign.status = 'CANCELLED' THEN NULL ELSE now() END,
        finished_at = CASE WHEN campaign.status = 'CANCELLED' THEN now() ELSE job.finished_at END,
        locked_at = NULL, locked_by = NULL, lock_expires_at = NULL,
        fencing_token = job.fencing_token + 1,
        last_error_code = CASE WHEN campaign.status = 'CANCELLED' THEN 'STALE_AFTER_CAMPAIGN_CANCEL' ELSE 'STALE_LOCK_RECOVERED' END,
        last_error_type = CASE WHEN campaign.status = 'CANCELLED' THEN NULL ELSE 'TRANSIENT' END,
        last_error_message = CASE WHEN campaign.status = 'CANCELLED'
          THEN 'Job cancelado após expiração do worker' ELSE 'Lease expirado; job recuperado' END,
        updated_at = now()
      FROM campaigns campaign
      WHERE campaign.organization_id = job.organization_id AND campaign.id = job.campaign_id
        AND job.status IN ('CLAIMED', 'CREATING_CONTAINER', 'WAITING_FOR_CONTAINER', 'READY_TO_PUBLISH')
        AND job.lock_expires_at < now()
      RETURNING job.id
    `;
    await sql`
      WITH terminal AS (
        SELECT campaign.id,
          count(job.id) FILTER (WHERE job.status NOT IN ('PUBLISHED', 'FAILED', 'CANCELLED', 'RECONCILIATION_REQUIRED')) AS pending,
          count(job.id) FILTER (WHERE job.status = 'PUBLISHED') AS published,
          count(job.id) FILTER (WHERE job.status IN ('FAILED', 'RECONCILIATION_REQUIRED')) AS failed,
          count(job.id) FILTER (WHERE job.status = 'CANCELLED') AS cancelled,
          count(job.id) AS total
        FROM campaigns campaign
        JOIN publication_jobs job ON job.organization_id = campaign.organization_id AND job.campaign_id = campaign.id
        WHERE campaign.status IN ('SCHEDULED', 'RUNNING', 'PAUSED') AND campaign.origin <> 'LOOP'
        GROUP BY campaign.id
      )
      UPDATE campaigns SET
        status = CASE
          WHEN terminal.cancelled = terminal.total THEN 'CANCELLED'::campaign_status
          WHEN terminal.failed = 0 THEN 'COMPLETED'::campaign_status
          WHEN terminal.published = 0 THEN 'FAILED'::campaign_status
          ELSE 'PARTIALLY_FAILED'::campaign_status
        END,
        cancelled_at = CASE WHEN terminal.cancelled = terminal.total THEN now() ELSE campaigns.cancelled_at END,
        updated_at = now()
      FROM terminal
      WHERE campaigns.id = terminal.id AND terminal.pending = 0
    `;
    return { ambiguous: ambiguous.length, retryable: retryable.length };
  });
}

async function loadJob(job: ClaimedJob, workerId: string) {
  const [details] = await getSqlClient()<JobDetails[]>`
    SELECT jobs.*, COALESCE(jobs.publication_type_override, campaign.publication_type) AS publication_type,
      campaign.caption, campaign.share_to_feed,
      account.instagram_user_id, account.account_type, account.status AS account_status, account.encrypted_access_token,
      account.publishing_limit_usage, account.publishing_limit_total, account.publishing_limit_checked_at,
      COALESCE(
        json_agg(json_build_object(
          'id', media.id, 'storage_key', media.storage_key, 'storage_provider', media.storage_provider,
          'media_kind', media.media_kind
        ) ORDER BY COALESCE(campaign_media.position, 0)) FILTER (WHERE media.id IS NOT NULL), '[]'
      ) AS media
    FROM publication_jobs jobs
    JOIN campaigns campaign ON campaign.organization_id = jobs.organization_id AND campaign.id = jobs.campaign_id
    JOIN instagram_accounts account ON account.organization_id = jobs.organization_id AND account.id = jobs.instagram_account_id
    LEFT JOIN campaign_media ON campaign_media.organization_id = jobs.organization_id AND campaign_media.campaign_id = campaign.id
      AND jobs.direct_media_asset_id IS NULL
      AND (campaign.publication_type = 'CAROUSEL' OR campaign_media.position = jobs.publication_position)
    LEFT JOIN media_assets media ON media.organization_id = jobs.organization_id
      AND media.id = COALESCE(jobs.direct_media_asset_id, campaign_media.media_asset_id)
      AND media.processing_status = 'READY' AND media.deleted_at IS NULL
    WHERE jobs.organization_id = ${job.organization_id}
      AND jobs.id = ${job.id} AND jobs.fencing_token = ${job.fencing_token} AND jobs.locked_by = ${workerId}
    GROUP BY jobs.id, campaign.id, account.id
  `;
  if (!details) throw new LostLeaseError("Lease do job foi perdido");
  if (!["CONNECTED", "TOKEN_EXPIRING"].includes(details.account_status)) {
    const authFailure = details.account_status === "REAUTH_REQUIRED" || details.account_status === "DISCONNECTED";
    throw new InstagramError(
      "Conta indisponível para publicação",
      authFailure ? "AUTH" : "PERMANENT",
      "ACCOUNT_UNAVAILABLE",
    );
  }
  if (!details.encrypted_access_token) throw new InstagramError("Conta sem token utilizável", "AUTH", "TOKEN_MISSING");
  if (!details.media.length) throw new InstagramError("Campanha sem mídia pronta", "VALIDATION", "MEDIA_MISSING");
  if (
    getEnv().INSTAGRAM_PROVIDER === "meta"
    && details.publication_type.startsWith("STORY_")
    && details.account_type?.toUpperCase() !== "BUSINESS"
  ) {
    throw new InstagramError("Story requer conta Business neste rollout", "VALIDATION", "STORY_BUSINESS_REQUIRED");
  }
  return details;
}

async function fencedUpdate(
  job: ClaimedJob,
  workerId: string,
  fragment: ReturnType<ReturnType<typeof getSqlClient>>,
) {
  const rows = await getSqlClient()`
    UPDATE publication_jobs SET ${fragment}, updated_at = now()
    WHERE organization_id = ${job.organization_id}
      AND id = ${job.id} AND fencing_token = ${job.fencing_token} AND locked_by = ${workerId}
    RETURNING id
  `;
  if (!rows.length) throw new LostLeaseError("Escrita rejeitada pelo fencing token");
}

async function releaseForRetry(job: ClaimedJob, workerId: string, seconds: number, incrementAttempt: boolean) {
  const rows = await getSqlClient()`
    UPDATE publication_jobs SET
      status = 'RETRY_WAIT', next_attempt_at = now() + ${seconds} * interval '1 second',
      attempt_count = attempt_count + ${incrementAttempt ? 1 : 0},
      locked_at = NULL, locked_by = NULL, lock_expires_at = NULL, updated_at = now()
    WHERE organization_id = ${job.organization_id}
      AND id = ${job.id} AND fencing_token = ${job.fencing_token} AND locked_by = ${workerId}
    RETURNING id
  `;
  if (!rows.length) throw new LostLeaseError("Escrita rejeitada pelo fencing token");
}

async function finishCampaign(organizationId: string, campaignId: string) {
  await getSqlClient()`
    WITH totals AS (
      SELECT
        count(*) FILTER (WHERE status NOT IN ('PUBLISHED', 'FAILED', 'CANCELLED', 'RECONCILIATION_REQUIRED')) AS pending,
        count(*) FILTER (WHERE status = 'PUBLISHED') AS published,
        count(*) FILTER (WHERE status IN ('FAILED', 'RECONCILIATION_REQUIRED')) AS failed
      FROM publication_jobs WHERE organization_id = ${organizationId} AND campaign_id = ${campaignId}
    )
    UPDATE campaigns SET
      status = CASE
        WHEN totals.pending > 0 THEN campaigns.status
        WHEN totals.failed = 0 THEN 'COMPLETED'::campaign_status
        WHEN totals.published = 0 THEN 'FAILED'::campaign_status
        ELSE 'PARTIALLY_FAILED'::campaign_status
      END,
      updated_at = now()
    FROM totals WHERE campaigns.organization_id = ${organizationId}
      AND campaigns.id = ${campaignId} AND campaigns.origin <> 'LOOP'
      AND totals.pending = 0 AND campaigns.status <> 'CANCELLED'
  `;
}

async function acquireSlots<T>(campaignId: string, accountId: string, run: () => Promise<T>): Promise<T | null> {
  const env = getEnv();
  const connection = await getSqlClient().reserve();
  let globalKey: string | undefined;
  let campaignKey: string | undefined;
  let accountKey: string | undefined;
  try {
    for (let slot = 0; slot < env.META_GLOBAL_CONCURRENCY; slot++) {
      const key = `instagestor:meta:global:${slot}`;
      const [row] = await connection<{ acquired: boolean }[]>`SELECT pg_try_advisory_lock(hashtextextended(${key}, 0)) AS acquired`;
      if (row.acquired) {
        globalKey = key;
        break;
      }
    }
    if (!globalKey) return null;
    const requestedCampaignKey = `instagestor:meta:campaign:${campaignId}`;
    const [campaignLock] = await connection<{ acquired: boolean }[]>`
      SELECT pg_try_advisory_lock(hashtextextended(${requestedCampaignKey}, 0)) AS acquired
    `;
    if (!campaignLock.acquired) return null;
    campaignKey = requestedCampaignKey;
    for (let slot = 0; slot < env.META_ACCOUNT_CONCURRENCY; slot++) {
      const key = `instagestor:meta:account:${accountId}:${slot}`;
      const [row] = await connection<{ acquired: boolean }[]>`SELECT pg_try_advisory_lock(hashtextextended(${key}, 0)) AS acquired`;
      if (row.acquired) {
        accountKey = key;
        break;
      }
    }
    if (!accountKey) return null;
    return await run();
  } finally {
    try {
      if (accountKey) await connection`SELECT pg_advisory_unlock(hashtextextended(${accountKey}, 0))`;
    } finally {
      try {
        if (campaignKey) await connection`SELECT pg_advisory_unlock(hashtextextended(${campaignKey}, 0))`;
      } finally {
        try {
          if (globalKey) await connection`SELECT pg_advisory_unlock(hashtextextended(${globalKey}, 0))`;
        } finally {
          connection.release();
        }
      }
    }
  }
}

async function fencedAutoCommentUpdate(
  job: ClaimedAutoComment,
  workerId: string,
  fragment: ReturnType<ReturnType<typeof getSqlClient>>,
) {
  const rows = await getSqlClient()`
    UPDATE publication_jobs SET ${fragment}, updated_at = now()
    WHERE organization_id = ${job.organization_id} AND id = ${job.id}
      AND auto_comment_fencing_token = ${job.auto_comment_fencing_token}
      AND auto_comment_locked_by = ${workerId} AND auto_comment_status = 'PROCESSING'
    RETURNING id
  `;
  if (!rows.length) throw new LostLeaseError("Lock do comentário foi perdido");
}

export async function processClaimedAutoComment(job: ClaimedAutoComment, workerId: string) {
  let attempted = false;
  let accountState: { encryptedAccessToken: string; status: string } | undefined;
  try {
    const [details] = await getSqlClient()<Array<{
      meta_media_id: string | null;
      auto_comment_text: string | null;
      encrypted_access_token: string | null;
      account_status: string;
      granted_scopes: string[] | null;
    }>>`
      SELECT publication.meta_media_id, publication.auto_comment_text,
        account.encrypted_access_token, account.status AS account_status, account.granted_scopes
      FROM publication_jobs publication
      JOIN instagram_accounts account ON account.organization_id = publication.organization_id
        AND account.id = publication.instagram_account_id
      WHERE publication.organization_id = ${job.organization_id} AND publication.id = ${job.id}
        AND publication.auto_comment_fencing_token = ${job.auto_comment_fencing_token}
        AND publication.auto_comment_locked_by = ${workerId} AND publication.auto_comment_status = 'PROCESSING'
    `;
    if (!details) throw new LostLeaseError("Lock do comentário foi perdido");
    if (!details.meta_media_id || !details.auto_comment_text) {
      throw new InstagramError("Publicação sem dados para comentar", "VALIDATION", "COMMENT_DATA_MISSING");
    }
    if (!details.encrypted_access_token || !["CONNECTED", "TOKEN_EXPIRING"].includes(details.account_status)) {
      throw new InstagramError("Conta indisponível para comentar", "AUTH", "ACCOUNT_UNAVAILABLE");
    }
    if (getEnv().INSTAGRAM_PROVIDER === "meta" && !details.granted_scopes?.includes(COMMENTS_SCOPE)) {
      throw new InstagramError("Auto-comentário indisponível: a permissão de comentários não é solicitada nesta versão", "VALIDATION", "COMMENTS_SCOPE_MISSING");
    }
    accountState = { encryptedAccessToken: details.encrypted_access_token, status: details.account_status };
    const result = await acquireSlots(job.campaign_id, job.instagram_account_id, async () => {
      attempted = true;
      const commentId = await getInstagramProvider().createComment(
        details.meta_media_id!,
        details.auto_comment_text!,
        decryptToken(details.encrypted_access_token!),
      );
      await fencedAutoCommentUpdate(
        job,
        workerId,
        getSqlClient()`auto_comment_status = 'PUBLISHED', meta_comment_id = ${commentId},
          auto_comment_published_at = now(), auto_comment_last_error_code = NULL,
          auto_comment_last_error_type = NULL, auto_comment_last_error_message = NULL,
          auto_comment_last_http_status = NULL, auto_comment_locked_at = NULL,
          auto_comment_locked_by = NULL, auto_comment_lock_expires_at = NULL`,
      );
      return commentId;
    });
    if (result === null) {
      await fencedAutoCommentUpdate(
        job,
        workerId,
        getSqlClient()`auto_comment_status = 'RETRY_WAIT', auto_comment_scheduled_at = now() + interval '1 second',
          auto_comment_locked_at = NULL, auto_comment_locked_by = NULL, auto_comment_lock_expires_at = NULL`,
      );
      return;
    }
    log("info", "worker", "auto_comment_published", { job_id: job.id, account_id: job.instagram_account_id });
  } catch (rawError) {
    if (rawError instanceof LostLeaseError) {
      log("warn", "worker", "auto_comment_lock_lost", { job_id: job.id, account_id: job.instagram_account_id });
      return;
    }
    const error = attempted && !(rawError instanceof InstagramError)
      ? new InstagramError("O comentário pode ter sido publicado, mas não foi confirmado", "AMBIGUOUS", "COMMENT_RESULT_NOT_PERSISTED")
      : asInstagramError(rawError);
    const [current] = await getSqlClient()<Array<{ attempt_count: number; max_attempts: number }>>`
      SELECT auto_comment_attempt_count AS attempt_count, auto_comment_max_attempts AS max_attempts
      FROM publication_jobs
      WHERE organization_id = ${job.organization_id} AND id = ${job.id}
        AND auto_comment_fencing_token = ${job.auto_comment_fencing_token}
        AND auto_comment_locked_by = ${workerId} AND auto_comment_status = 'PROCESSING'
    `;
    if (!current) return;
    const terminal = error.kind === "AMBIGUOUS" ? "RECONCILIATION_REQUIRED"
      : ["AUTH", "VALIDATION", "PERMANENT"].includes(error.kind) || current.attempt_count + 1 >= current.max_attempts
        ? "FAILED"
        : "RETRY_WAIT";
    const retrySeconds = terminal === "RETRY_WAIT"
      ? retryDelaySeconds(current.attempt_count + 1, error.retryAfterSeconds)
      : 0;
    await fencedAutoCommentUpdate(
      job,
      workerId,
      getSqlClient()`auto_comment_status = ${terminal}::auto_comment_status,
        auto_comment_attempt_count = auto_comment_attempt_count + 1,
        auto_comment_scheduled_at = CASE WHEN ${terminal} = 'RETRY_WAIT'
          THEN now() + ${retrySeconds} * interval '1 second' ELSE auto_comment_scheduled_at END,
        auto_comment_last_error_code = ${error.code}, auto_comment_last_error_type = ${error.kind},
        auto_comment_last_error_message = ${error.message}, auto_comment_last_http_status = ${error.httpStatus ?? null},
        auto_comment_locked_at = NULL, auto_comment_locked_by = NULL, auto_comment_lock_expires_at = NULL`,
    );
    if (error.kind === "AUTH" && accountState) {
      await markAccountUnavailableIfCurrent({
        organizationId: job.organization_id,
        accountId: job.instagram_account_id,
        expectedEncryptedToken: accountState.encryptedAccessToken,
        expectedStatus: accountState.status,
        nextStatus: "REAUTH_REQUIRED",
        errorCode: error.code,
        errorKind: error.kind,
        errorMessage: error.message,
      });
    }
    log("error", "worker", "auto_comment_failed", {
      job_id: job.id,
      account_id: job.instagram_account_id,
      error_code: error.code,
      error_type: error.kind,
    });
  }
}

export async function processClaimedJob(job: ClaimedJob, workerId: string) {
  const campaignId = job.campaign_id;
  let publishAttempted = false;
  let publishSucceeded = false;
  let lease: Awaited<ReturnType<typeof startLeaseKeepalive>> | undefined;
  let processingAccountState: { encryptedAccessToken: string; status: string } | undefined;
  try {
    const leaseGuard = await startLeaseKeepalive(job, workerId);
    lease = leaseGuard;
    const details = await loadJob(job, workerId);
    const result = await acquireSlots(details.campaign_id, details.instagram_account_id, async () => {
      leaseGuard.assertCurrent();
      const [currentState] = await getSqlClient()<Array<{
        account_status: string;
        encrypted_access_token: string | null;
        publishing_limit_usage: number | null;
        publishing_limit_total: number | null;
        publishing_limit_checked_at: Date | string | null;
        warmup_profile: WarmupProfile | null;
        account_created_at: Date | string;
      }>>`
        SELECT account.status AS account_status, account.encrypted_access_token,
          account.publishing_limit_usage, account.publishing_limit_total, account.publishing_limit_checked_at,
          account.warmup_profile, account.created_at AS account_created_at
        FROM publication_jobs current_job
        JOIN instagram_accounts account ON account.organization_id = current_job.organization_id
          AND account.id = current_job.instagram_account_id
        WHERE current_job.organization_id = ${job.organization_id}
          AND current_job.id = ${job.id} AND current_job.fencing_token = ${job.fencing_token}
          AND current_job.locked_by = ${workerId}
      `;
      if (!currentState) throw new LostLeaseError("Lease do job foi perdido antes da chamada externa");
      if (!["CONNECTED", "TOKEN_EXPIRING"].includes(currentState.account_status)) {
        throw new InstagramError("Conta indisponível para publicação", "AUTH", "ACCOUNT_UNAVAILABLE");
      }
      if (currentState.encrypted_access_token !== details.encrypted_access_token) {
        throw new InstagramError("Token da conta mudou durante o processamento", "TRANSIENT", "ACCOUNT_TOKEN_CHANGED");
      }
      const warmupAt = await getSqlClient().begin((sql) => accountWarmupAllowedAt(sql, {
        organizationId: job.organization_id, accountId: job.instagram_account_id,
        profile: currentState.warmup_profile, connectedAt: currentState.account_created_at, excludeJobId: job.id,
      }));
      if (warmupAt.getTime() > Date.now()) {
        await fencedUpdate(job, workerId, getSqlClient()`status = 'RETRY_WAIT', next_attempt_at = ${warmupAt.toISOString()},
          last_error_code = 'ACCOUNT_WARMUP_WAIT', last_error_type = NULL,
          last_error_message = 'Aguardando o intervalo do perfil de aquecimento',
          locked_at = NULL, locked_by = NULL, lock_expires_at = NULL`);
        return "warmup_wait" as const;
      }
      const [rhythm] = await getSqlClient()<Array<{
        delay_mode: string;
        delay_min_seconds: number | null;
        last_published_at: Date | null;
        has_earlier_pending: boolean;
      }>>`
        SELECT campaign.delay_mode, campaign.delay_min_seconds,
          max(previous.published_at) FILTER (WHERE previous.status = 'PUBLISHED') AS last_published_at,
          EXISTS (
            SELECT 1 FROM publication_jobs earlier
            WHERE earlier.organization_id = current_job.organization_id
              AND earlier.campaign_id = current_job.campaign_id AND earlier.id <> current_job.id
              AND earlier.status NOT IN ('PUBLISHED', 'FAILED', 'CANCELLED', 'RECONCILIATION_REQUIRED')
              AND (earlier.scheduled_at, earlier.created_at) < (current_job.scheduled_at, current_job.created_at)
              -- Loop: cada conta tem a própria fila; uma conta travada não segura as outras.
              AND (current_job.loop_id IS NULL OR earlier.instagram_account_id = current_job.instagram_account_id)
          ) AS has_earlier_pending
        FROM publication_jobs current_job
        JOIN campaigns campaign ON campaign.organization_id = current_job.organization_id
          AND campaign.id = current_job.campaign_id
        LEFT JOIN publication_jobs previous ON previous.organization_id = current_job.organization_id
          AND previous.campaign_id = campaign.id AND previous.id <> current_job.id
        WHERE current_job.organization_id = ${job.organization_id} AND current_job.id = ${job.id}
        GROUP BY campaign.id, current_job.id
      `;
      if (rhythm?.has_earlier_pending) {
        await releaseForRetry(job, workerId, 1, false);
        return "sequence_wait" as const;
      }
      if (rhythm?.delay_mode === "RANDOM" && (rhythm.delay_min_seconds ?? 0) >= 1500 && rhythm.last_published_at) {
        const eligibleAt = new Date(rhythm.last_published_at).getTime() + rhythm.delay_min_seconds! * 1000;
        const remainingSeconds = Math.ceil((eligibleAt - Date.now()) / 1000);
        if (remainingSeconds > 0) {
          await releaseForRetry(job, workerId, remainingSeconds, false);
          return "paced" as const;
        }
      }
      processingAccountState = {
        encryptedAccessToken: currentState.encrypted_access_token!,
        status: currentState.account_status,
      };
      const accessToken = decryptToken(currentState.encrypted_access_token!);
      const provider = getInstagramProvider();
      const quotaCheckedAt = currentState.publishing_limit_checked_at
        ? new Date(currentState.publishing_limit_checked_at).getTime()
        : Number.NaN;
      const quotaIsFresh = Number.isFinite(quotaCheckedAt)
        && Date.now() - quotaCheckedAt < 60_000
        && currentState.publishing_limit_usage !== null
        && currentState.publishing_limit_total !== null;
      leaseGuard.assertCurrent();
      const limit = quotaIsFresh
        ? { usage: currentState.publishing_limit_usage!, total: currentState.publishing_limit_total! }
        : await provider.getPublishingLimit(details.instagram_user_id, accessToken);
      leaseGuard.assertCurrent();
      if (!quotaIsFresh) {
        await getSqlClient()`
          UPDATE instagram_accounts SET publishing_limit_usage = ${limit.usage}, publishing_limit_total = ${limit.total},
            publishing_limit_checked_at = now(), updated_at = now()
          WHERE organization_id = ${job.organization_id} AND id = ${details.instagram_account_id}
            AND encrypted_access_token = ${currentState.encrypted_access_token}
            AND status = ${currentState.account_status}
        `;
      }
      if (limit.usage >= limit.total) {
        throw new InstagramError("Limite de publicação atingido", "RATE_LIMIT", "PUBLISHING_LIMIT", 429, 3600);
      }
      await fencedUpdate(
        job,
        workerId,
        getSqlClient()`last_error_code = NULL, last_error_type = NULL, last_error_message = NULL, last_http_status = NULL`,
      );
      let containerId = details.meta_container_id;

      if (!containerId) {
        await fencedUpdate(job, workerId, getSqlClient()`status = 'CREATING_CONTAINER', publishing_phase = 'CREATE_CONTAINER'`);
        const mediaUrls = await Promise.all(
          details.media.map((asset) =>
            getStorageProvider(asset.storage_provider).getPublishableUrl({
              id: asset.id,
              organizationId: job.organization_id,
              storageKey: asset.storage_key,
            }),
          ),
        );
        leaseGuard.assertCurrent();
        let childIds = details.meta_child_container_ids ?? [];
        if (details.publication_type === "CAROUSEL") {
          while (childIds.length < details.media.length) {
            const position = childIds.length;
            leaseGuard.assertCurrent();
            const child = await provider.createMediaContainer({
              accountId: details.instagram_user_id,
              accessToken,
              publicationType: details.media[position].media_kind === "VIDEO" ? "FEED_VIDEO" : "FEED_IMAGE",
              mediaUrls: [mediaUrls[position]],
              mediaKinds: [details.media[position].media_kind],
              isCarouselItem: true,
            });
            leaseGuard.assertCurrent();
            childIds = [...childIds, child];
            await fencedUpdate(
              job,
              workerId,
              getSqlClient()`meta_child_container_ids = ${childIds}, container_started_at = COALESCE(container_started_at, now())`,
            );
          }
          leaseGuard.assertCurrent();
          const childStatuses = await Promise.all(childIds.map((id) => provider.getContainerStatus(id, accessToken)));
          leaseGuard.assertCurrent();
          if (childStatuses.some((status) => status === "ERROR")) {
            throw new InstagramError("Um container filho do Carousel falhou", "VALIDATION", "CAROUSEL_CHILD_ERROR");
          }
          if (childStatuses.some((status) => status === "PUBLISHED")) {
            throw new InstagramError("Container filho já consta como publicado", "AMBIGUOUS", "CAROUSEL_CHILD_PUBLISHED");
          }
          if (childStatuses.some((status) => status === "PROCESSING")) {
            if (containerWaitExpired(details)) {
              throw new InstagramError(
                "O processamento do container excedeu uma hora",
                "PERMANENT",
                "CONTAINER_PROCESSING_TIMEOUT",
              );
            }
            await fencedUpdate(job, workerId, getSqlClient()`status = 'WAITING_FOR_CONTAINER', publishing_phase = 'WAIT_CONTAINER'`);
            await releaseForRetry(job, workerId, getEnv().INSTAGRAM_PROVIDER === "fake" ? 1 : getEnv().CONTAINER_POLL_SECONDS, false);
            return "waiting" as const;
          }
          leaseGuard.assertCurrent();
          containerId = await provider.createMediaContainer({
            accountId: details.instagram_user_id,
            accessToken,
            publicationType: "CAROUSEL",
            mediaUrls: [],
            children: childIds,
            caption: details.caption ?? undefined,
          });
          leaseGuard.assertCurrent();
        } else {
          leaseGuard.assertCurrent();
          containerId = await provider.createMediaContainer({
            accountId: details.instagram_user_id,
            accessToken,
            publicationType: details.publication_type,
            mediaUrls,
            mediaKinds: details.media.map((asset) => asset.media_kind),
            caption: details.caption ?? undefined,
            shareToFeed: details.share_to_feed,
          });
          leaseGuard.assertCurrent();
        }
        await fencedUpdate(
          job,
          workerId,
          getSqlClient()`status = 'WAITING_FOR_CONTAINER', publishing_phase = 'WAIT_CONTAINER', meta_container_id = ${containerId}, container_started_at = COALESCE(container_started_at, now())`,
        );
      }

      leaseGuard.assertCurrent();
      const containerStatus = await provider.getContainerStatus(containerId, accessToken);
      leaseGuard.assertCurrent();
      if (containerStatus === "PROCESSING") {
        if (containerWaitExpired(details)) {
          throw new InstagramError(
            "O processamento do container excedeu uma hora",
            "PERMANENT",
            "CONTAINER_PROCESSING_TIMEOUT",
          );
        }
        await releaseForRetry(
          job,
          workerId,
          getEnv().INSTAGRAM_PROVIDER === "fake" ? 1 : getEnv().CONTAINER_POLL_SECONDS,
          false,
        );
        return "waiting" as const;
      }
      if (containerStatus === "PUBLISHED") {
        throw new InstagramError("Container já publicado; reconciliação manual necessária", "AMBIGUOUS", "CONTAINER_ALREADY_PUBLISHED");
      }
      if (containerStatus === "ERROR") throw new InstagramError("Container rejeitado pela Meta", "VALIDATION", "CONTAINER_ERROR");

      await fencedUpdate(job, workerId, getSqlClient()`status = 'READY_TO_PUBLISH', publishing_phase = 'PUBLISH'`);
      await fencedUpdate(job, workerId, getSqlClient()`status = 'PUBLISHING'`);
      leaseGuard.assertCurrent();
      publishAttempted = true;
      const mediaId = await provider.publishContainer(details.instagram_user_id, containerId, accessToken);
      publishSucceeded = true;
      leaseGuard.assertCurrent();
      await fencedUpdate(
        job,
        workerId,
        getSqlClient()`status = 'PUBLISHED', publishing_phase = 'DONE', meta_media_id = ${mediaId},
          published_at = now(), finished_at = now(), last_error_code = NULL, last_error_type = NULL,
          last_error_message = NULL, last_http_status = NULL, locked_at = NULL, locked_by = NULL,
          lock_expires_at = NULL, reconciliation_required = false,
          auto_comment_status = CASE WHEN auto_comment_text IS NOT NULL THEN 'QUEUED'::auto_comment_status ELSE NULL END,
          auto_comment_scheduled_at = CASE WHEN auto_comment_text IS NOT NULL
            THEN now() + auto_comment_delay_minutes * interval '1 minute' ELSE NULL END`,
      );
      await getSqlClient()`
        UPDATE instagram_accounts SET publishing_limit_usage = LEAST(
            COALESCE(publishing_limit_usage, 0) + 1,
            COALESCE(publishing_limit_total, COALESCE(publishing_limit_usage, 0) + 1)
          ), last_successful_api_call_at = now(), last_error_at = NULL,
          last_error_code = NULL, last_error_message = NULL, updated_at = now()
        WHERE organization_id = ${job.organization_id} AND id = ${details.instagram_account_id}
          AND encrypted_access_token = ${processingAccountState.encryptedAccessToken}
          AND status = ${processingAccountState.status}
      `;
      return "published" as const;
    });

    if (result === null) await releaseForRetry(job, workerId, 1, false);
    if (result === "published" && job.loop_id) {
      try {
        await scheduleNextLoopJob({
          organizationId: job.organization_id,
          loopId: job.loop_id,
          accountId: job.instagram_account_id,
          completedAt: new Date(),
        });
      } catch (error) {
        log("error", "worker", "loop_next_job_failed", {
          job_id: job.id,
          loop_id: job.loop_id,
          account_id: job.instagram_account_id,
          error: error instanceof Error ? error.message : "unknown",
        });
      }
    }
    log("info", "worker", result ?? "concurrency_wait", { job_id: job.id, campaign_id: campaignId, account_id: job.instagram_account_id });
  } catch (rawError) {
    if (rawError instanceof LostLeaseError) {
      log("warn", "worker", "lease_lost", { job_id: job.id, account_id: job.instagram_account_id });
      return;
    }
    const error = publishSucceeded || (publishAttempted && !(rawError instanceof InstagramError))
      ? new InstagramError(
          "A publicação pode ter sido aceita, mas o resultado não pôde ser confirmado com segurança",
          "AMBIGUOUS",
          "PUBLISH_RESULT_NOT_PERSISTED",
        )
      : asInstagramError(rawError);
    const [current] = await getSqlClient()<Array<{ attempt_count: number; max_attempts: number }>>`
      SELECT attempt_count, max_attempts FROM publication_jobs
      WHERE organization_id = ${job.organization_id}
        AND id = ${job.id} AND fencing_token = ${job.fencing_token} AND locked_by = ${workerId}
    `;
    if (!current) return;

    if (error.code === "PUBLISHING_LIMIT") {
      const seconds = Math.max(300, error.retryAfterSeconds ?? 3600);
      await fencedUpdate(
        job,
        workerId,
        getSqlClient()`status = 'RETRY_WAIT', next_attempt_at = now() + ${seconds} * interval '1 second', last_error_code = ${error.code}, last_error_type = ${error.kind}, last_error_message = ${error.message}, last_http_status = ${error.httpStatus ?? null}, locked_at = NULL, locked_by = NULL, lock_expires_at = NULL`,
      );
    } else if (error.kind === "AMBIGUOUS") {
      await fencedUpdate(
        job,
        workerId,
        getSqlClient()`status = 'RECONCILIATION_REQUIRED', reconciliation_required = true, last_error_code = ${error.code}, last_error_type = ${error.kind}, last_error_message = ${error.message}, last_http_status = ${error.httpStatus ?? null}, finished_at = now(), locked_at = NULL, locked_by = NULL, lock_expires_at = NULL`,
      );
    } else if (["AUTH", "VALIDATION", "PERMANENT"].includes(error.kind) || current.attempt_count + 1 >= current.max_attempts) {
      await fencedUpdate(
        job,
        workerId,
        getSqlClient()`status = 'FAILED', attempt_count = attempt_count + 1, last_error_code = ${error.code}, last_error_type = ${error.kind}, last_error_message = ${error.message}, last_http_status = ${error.httpStatus ?? null}, finished_at = now(), locked_at = NULL, locked_by = NULL, lock_expires_at = NULL`,
      );
    } else {
      const seconds = retryDelaySeconds(current.attempt_count + 1, error.retryAfterSeconds);
      await fencedUpdate(
        job,
        workerId,
        getSqlClient()`status = 'RETRY_WAIT', attempt_count = attempt_count + 1, next_attempt_at = now() + ${seconds} * interval '1 second', last_error_code = ${error.code}, last_error_type = ${error.kind}, last_error_message = ${error.message}, last_http_status = ${error.httpStatus ?? null}, locked_at = NULL, locked_by = NULL, lock_expires_at = NULL`,
      );
    }
    if (error.kind === "AUTH" && processingAccountState) {
      await markAccountUnavailableIfCurrent({
        organizationId: job.organization_id,
        accountId: job.instagram_account_id,
        expectedEncryptedToken: processingAccountState.encryptedAccessToken,
        expectedStatus: processingAccountState.status,
        nextStatus: "REAUTH_REQUIRED",
        errorCode: error.code,
        errorKind: error.kind,
        errorMessage: error.message,
      });
    }
    log("error", "worker", "job_failed", {
      job_id: job.id,
      campaign_id: campaignId,
      account_id: job.instagram_account_id,
      error_code: error.code,
      error_type: error.kind,
      error_message: error.message,
    });
  } finally {
    await lease?.stop();
    if (campaignId) await finishCampaign(job.organization_id, campaignId);
  }
}
