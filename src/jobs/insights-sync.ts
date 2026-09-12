import { getSqlClient } from "@/db/client";
import { decryptToken } from "@/lib/crypto";
import { getEnv } from "@/lib/env";
import { asInstagramError } from "@/lib/errors";
import { log } from "@/lib/logger";
import { getInstagramProvider } from "@/providers";
import { INSIGHTS_SCOPE, type AccountDayInsights, type AccountSnapshot, type MediaProductType, type MediaSummary } from "@/providers/instagram";
import { markAccountUnavailableIfCurrent } from "./account-availability";

const DAY_MS = 86_400_000;
const CLAIM_BATCH = 10;
const FRESH_MEDIA_DAYS = 3;

type ClaimedAccount = { id: string; instagram_user_id: string; encrypted_access_token: string; status: string };
type PendingMedia = { id: string; product_type: MediaProductType };

// ponytail: dia = data UTC; a Meta fecha o dia no fuso dela. Trocar para settings.default_timezone se as bordas incomodarem.
export function utcDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function recentDays(now = new Date(), count = 3) {
  return Array.from({ length: count }, (_, offset) => utcDay(new Date(now.getTime() - offset * DAY_MS)));
}

async function claimAccounts() {
  return getSqlClient()<ClaimedAccount[]>`
    WITH candidates AS (
      SELECT id FROM instagram_accounts
      WHERE status IN ('CONNECTED', 'TOKEN_EXPIRING') AND encrypted_access_token IS NOT NULL
        AND ${INSIGHTS_SCOPE} = ANY(granted_scopes)
        AND (insights_synced_at IS NULL OR insights_synced_at < now() - ${getEnv().INSIGHTS_SYNC_INTERVAL_MS} * interval '1 millisecond')
      ORDER BY insights_synced_at NULLS FIRST
      FOR UPDATE SKIP LOCKED
      LIMIT ${CLAIM_BATCH}
    )
    UPDATE instagram_accounts account SET insights_synced_at = now(), updated_at = now()
    FROM candidates WHERE account.id = candidates.id
    RETURNING account.id, account.instagram_user_id, account.encrypted_access_token, account.status
  `;
}

async function upsertDailyMetrics(accountId: string, today: string, snapshot: AccountSnapshot, days: AccountDayInsights[]) {
  const sql = getSqlClient();
  for (const day of days) {
    const isToday = day.day === today;
    await sql`
      INSERT INTO account_daily_metrics (
        instagram_account_id, day, followers_count, follows_count, media_count, follower_gains, reach, views,
        profile_views, accounts_engaged, total_interactions, likes, comments, shares, saves, replies,
        website_clicks, profile_links_taps, synced_at
      ) VALUES (
        ${accountId}, ${day.day}::date,
        ${isToday ? snapshot.followersCount : null}, ${isToday ? snapshot.followsCount : null}, ${isToday ? snapshot.mediaCount : null},
        ${day.followerGains}, ${day.reach}, ${day.views}, ${day.profileViews}, ${day.accountsEngaged}, ${day.totalInteractions},
        ${day.likes}, ${day.comments}, ${day.shares}, ${day.saves}, ${day.replies}, ${day.websiteClicks}, ${day.profileLinksTaps}, now()
      )
      ON CONFLICT (instagram_account_id, day) DO UPDATE SET
        followers_count = COALESCE(EXCLUDED.followers_count, account_daily_metrics.followers_count),
        follows_count = COALESCE(EXCLUDED.follows_count, account_daily_metrics.follows_count),
        media_count = COALESCE(EXCLUDED.media_count, account_daily_metrics.media_count),
        follower_gains = EXCLUDED.follower_gains, reach = EXCLUDED.reach, views = EXCLUDED.views,
        profile_views = EXCLUDED.profile_views, accounts_engaged = EXCLUDED.accounts_engaged,
        total_interactions = EXCLUDED.total_interactions, likes = EXCLUDED.likes, comments = EXCLUDED.comments,
        shares = EXCLUDED.shares, saves = EXCLUDED.saves, replies = EXCLUDED.replies,
        website_clicks = EXCLUDED.website_clicks, profile_links_taps = EXCLUDED.profile_links_taps, synced_at = now()
    `;
  }
}

async function upsertMedia(accountId: string, items: MediaSummary[]) {
  if (!items.length) return;
  const sql = getSqlClient();
  const rows = items.map((item) => ({
    id: item.id,
    instagram_account_id: accountId,
    media_type: item.mediaType,
    product_type: item.productType,
    permalink: item.permalink ?? null,
    thumbnail_url: item.thumbnailUrl ?? null,
    caption: item.caption ?? null,
    posted_at: item.postedAt.toISOString(),
    expires_at: item.productType === "STORY" ? new Date(item.postedAt.getTime() + DAY_MS).toISOString() : null,
    like_count: item.likeCount ?? null,
    comments_count: item.commentsCount ?? null,
  }));
  await sql`
    INSERT INTO account_media ${sql(rows)}
    ON CONFLICT (id) DO UPDATE SET
      permalink = COALESCE(EXCLUDED.permalink, account_media.permalink),
      thumbnail_url = COALESCE(EXCLUDED.thumbnail_url, account_media.thumbnail_url),
      caption = COALESCE(EXCLUDED.caption, account_media.caption),
      like_count = COALESCE(EXCLUDED.like_count, account_media.like_count),
      comments_count = COALESCE(EXCLUDED.comments_count, account_media.comments_count),
      updated_at = now()
  `;
}

async function pendingMedia(accountId: string) {
  return getSqlClient()<PendingMedia[]>`
    SELECT id, product_type FROM account_media
    WHERE instagram_account_id = ${accountId} AND (
      (product_type = 'STORY' AND expires_at > now())
      OR (product_type <> 'STORY' AND posted_at > now() - ${FRESH_MEDIA_DAYS} * interval '1 day')
      OR (product_type <> 'STORY'
        AND posted_at > now() - ${getEnv().INSIGHTS_MEDIA_WINDOW_DAYS} * interval '1 day'
        AND (insights_synced_at IS NULL OR insights_synced_at < now() - interval '24 hours'))
    )
    ORDER BY posted_at DESC
  `;
}

async function syncAccount(account: ClaimedAccount, now: Date) {
  const sql = getSqlClient();
  const provider = getInstagramProvider();
  const accessToken = decryptToken(account.encrypted_access_token);
  const igUserId = account.instagram_user_id;
  const today = utcDay(now);
  let calls = 0;

  const snapshot = await provider.getAccountSnapshot(accessToken);
  calls++;
  const days = recentDays(now);
  const insights = await provider.getAccountInsights(igUserId, accessToken, days);
  calls += days.length + 1;
  await upsertDailyMetrics(account.id, today, snapshot, insights);

  const since = new Date(now.getTime() - getEnv().INSIGHTS_MEDIA_WINDOW_DAYS * DAY_MS);
  const [recent, stories] = await Promise.all([
    provider.listRecentMedia(igUserId, accessToken, since),
    provider.listLiveStories(igUserId, accessToken),
  ]);
  calls += 2;
  await upsertMedia(account.id, [...recent, ...stories]);

  let mediaSynced = 0;
  for (const media of await pendingMedia(account.id)) {
    try {
      const values = await provider.getMediaInsights(media.id, accessToken, media.product_type);
      calls++;
      await sql`
        UPDATE account_media SET views = ${values.views}, reach = ${values.reach}, shares = ${values.shares},
          saved = ${values.saved}, total_interactions = ${values.totalInteractions}, replies = ${values.replies},
          follows = ${values.follows}, profile_visits = ${values.profileVisits},
          reels_avg_watch_time_ms = ${values.reelsAvgWatchTimeMs}, reels_total_watch_time_ms = ${values.reelsTotalWatchTimeMs},
          story_taps_forward = ${values.storyTapsForward}, story_taps_back = ${values.storyTapsBack}, story_exits = ${values.storyExits},
          insights_synced_at = now(), updated_at = now()
        WHERE id = ${media.id}
      `;
      mediaSynced++;
    } catch (rawError) {
      const error = asInstagramError(rawError);
      if (error.kind === "AUTH" || error.kind === "RATE_LIMIT") throw error;
      log("warn", "insights-sync", "media_failed", { account_id: account.id, media_id: media.id, error_code: error.code });
    }
  }

  await sql`
    UPDATE account_media SET published_job_id = job.id, updated_at = now()
    FROM publication_jobs job
    WHERE job.meta_media_id = account_media.id AND account_media.instagram_account_id = ${account.id}
      AND account_media.published_job_id IS NULL
  `;
  await sql`
    UPDATE instagram_accounts SET username = ${snapshot.username}, display_name = ${snapshot.displayName ?? null},
      profile_picture_url = COALESCE(${snapshot.profilePictureUrl ?? null}, profile_picture_url),
      biography = ${snapshot.biography ?? null}, website = ${snapshot.website ?? null},
      insights_synced_at = now(), insights_error_code = NULL, last_successful_api_call_at = now(), updated_at = now()
    WHERE id = ${account.id} AND encrypted_access_token = ${account.encrypted_access_token}
  `;
  return { calls, mediaSynced };
}

export async function runInsightsSync(workerId: string) {
  const accounts = await claimAccounts();
  let synced = 0;
  let failed = 0;
  for (const account of accounts) {
    const started = Date.now();
    try {
      const { calls, mediaSynced } = await syncAccount(account, new Date());
      synced++;
      log("info", "insights-sync", "account_synced", {
        worker_id: workerId, account_id: account.id, calls, media_synced: mediaSynced, duration_ms: Date.now() - started,
      });
    } catch (rawError) {
      failed++;
      const error = asInstagramError(rawError);
      if (error.kind === "AUTH") {
        await markAccountUnavailableIfCurrent({
          accountId: account.id,
          expectedEncryptedToken: account.encrypted_access_token,
          expectedStatus: account.status,
          nextStatus: "REAUTH_REQUIRED",
          errorCode: error.code,
          errorKind: error.kind,
          errorMessage: error.message,
        });
      } else {
        const delayMs = error.kind === "RATE_LIMIT" ? Math.max(error.retryAfterSeconds ?? 0, 900) * 1000 : 0;
        await getSqlClient()`
          UPDATE instagram_accounts SET insights_error_code = ${error.code},
            insights_synced_at = now() + ${delayMs} * interval '1 millisecond',
            last_error_at = now(), last_error_code = ${error.code}, last_error_message = ${error.message}, updated_at = now()
          WHERE id = ${account.id} AND encrypted_access_token = ${account.encrypted_access_token}
        `;
      }
      log("warn", "insights-sync", "account_failed", {
        worker_id: workerId, account_id: account.id, error_code: error.code, error_kind: error.kind, duration_ms: Date.now() - started,
      });
    }
  }
  return { synced, failed };
}
