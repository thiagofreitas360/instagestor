import { getSqlClient } from "@/db/client";
import { INSIGHTS_SCOPE } from "@/providers/instagram";

const DAY_MS = 86_400_000;

export type PeriodDays = 7 | 30 | 90;
export type Period = { days: PeriodDays; from: string; to: string; previousFrom: string; previousTo: string };

function utcDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function resolvePeriod(days: PeriodDays, now = new Date()): Period {
  const to = new Date(`${utcDay(now)}T00:00:00Z`);
  const from = new Date(to.getTime() - (days - 1) * DAY_MS);
  const previousTo = new Date(from.getTime() - DAY_MS);
  const previousFrom = new Date(previousTo.getTime() - (days - 1) * DAY_MS);
  return { days, from: utcDay(from), to: utcDay(to), previousFrom: utcDay(previousFrom), previousTo: utcDay(previousTo) };
}

export function deltaPercent(current: number, previous: number) {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export type Totals = {
  followers: number; netChange: number; gains: number; lost: number; reach: number; views: number; profileViews: number;
  accountsEngaged: number; totalInteractions: number; likes: number; comments: number; shares: number; saves: number;
  replies: number; websiteClicks: number; profileLinksTaps: number; mediaCount: number; mediaByTool: number;
};

export type DailyPoint = { day: string; followers: number | null; reach: number; views: number };

export const RANKING_ORDERS = ["followers", "net_change", "reach", "views", "total_interactions", "media_count"] as const;
export type RankingOrder = (typeof RANKING_ORDERS)[number];

export type AccountRank = {
  id: string; username: string; display_name: string | null; profile_picture_url: string | null; status: string;
  followers: number | null; net_change: number | null; reach: number; views: number; total_interactions: number;
  media_count: number; insights_synced_at: Date | null;
};

export const MEDIA_ORDERS = ["views", "reach", "like_count", "comments_count", "shares", "saved", "posted_at"] as const;
export type MediaOrder = (typeof MEDIA_ORDERS)[number];

export type MediaRow = {
  id: string; account_id: string; username: string; media_type: string; product_type: string; permalink: string | null;
  thumbnail_url: string | null; caption: string | null; posted_at: Date; like_count: number | null; comments_count: number | null;
  views: number | null; reach: number | null; shares: number | null; saved: number | null; replies: number | null; follows: number | null;
  reels_avg_watch_time_ms: number | null; story_taps_forward: number | null; story_taps_back: number | null; story_exits: number | null;
  published_job_id: string | null;
};

export type AnalyticsResult = {
  totals: Totals; previous: Totals; series: DailyPoint[]; ranking: AccountRank[]; media: MediaRow[];
  syncedAt: Date | null; missingScope: Array<{ id: string; username: string }>; syncErrors: Array<{ id: string; username: string; code: string }>;
};

type SumsRow = Omit<Totals, "followers" | "netChange" | "lost">;
type FollowerBound = { instagram_account_id: string; followers: number; net_change: number };

// Por conta: último followers_count até `to` e base (último antes de `from`, senão o primeiro dentro do período).
function followerBounds(ids: string[] | null, from: string, to: string) {
  return getSqlClient()<FollowerBound[]>`
    WITH scoped AS (
      SELECT id FROM instagram_accounts WHERE ${ids}::uuid[] IS NULL OR id = ANY(${ids}::uuid[])
    ), last_in AS (
      SELECT DISTINCT ON (m.instagram_account_id) m.instagram_account_id, m.followers_count
      FROM account_daily_metrics m JOIN scoped ON scoped.id = m.instagram_account_id
      WHERE m.day BETWEEN ${from}::date AND ${to}::date AND m.followers_count IS NOT NULL
      ORDER BY m.instagram_account_id, m.day DESC
    ), base AS (
      SELECT DISTINCT ON (instagram_account_id) instagram_account_id, followers_count FROM (
        SELECT m.instagram_account_id, m.followers_count, 0 AS rank, m.day
        FROM account_daily_metrics m JOIN scoped ON scoped.id = m.instagram_account_id
        WHERE m.day < ${from}::date AND m.followers_count IS NOT NULL
        UNION ALL
        SELECT m.instagram_account_id, m.followers_count, 1 AS rank, m.day
        FROM account_daily_metrics m JOIN scoped ON scoped.id = m.instagram_account_id
        WHERE m.day BETWEEN ${from}::date AND ${to}::date AND m.followers_count IS NOT NULL
      ) candidates
      ORDER BY instagram_account_id, rank, CASE WHEN rank = 0 THEN day END DESC, day ASC
    )
    SELECT last_in.instagram_account_id, last_in.followers_count AS followers,
      last_in.followers_count - base.followers_count AS net_change
    FROM last_in JOIN base USING (instagram_account_id)
  `;
}

async function loadTotals(ids: string[] | null, from: string, to: string): Promise<Totals> {
  const sql = getSqlClient();
  const [[sums], bounds] = await Promise.all([
    sql<SumsRow[]>`
      WITH scoped AS (
        SELECT id FROM instagram_accounts WHERE ${ids}::uuid[] IS NULL OR id = ANY(${ids}::uuid[])
      ), metrics AS (
        SELECT coalesce(sum(follower_gains), 0)::int AS gains, coalesce(sum(reach), 0)::int AS reach,
          coalesce(sum(views), 0)::int AS views, coalesce(sum(profile_views), 0)::int AS "profileViews",
          coalesce(sum(accounts_engaged), 0)::int AS "accountsEngaged", coalesce(sum(total_interactions), 0)::int AS "totalInteractions",
          coalesce(sum(likes), 0)::int AS likes, coalesce(sum(comments), 0)::int AS comments, coalesce(sum(shares), 0)::int AS shares,
          coalesce(sum(saves), 0)::int AS saves, coalesce(sum(replies), 0)::int AS replies,
          coalesce(sum(website_clicks), 0)::int AS "websiteClicks", coalesce(sum(profile_links_taps), 0)::int AS "profileLinksTaps"
        FROM account_daily_metrics m JOIN scoped ON scoped.id = m.instagram_account_id
        WHERE m.day BETWEEN ${from}::date AND ${to}::date
      ), media AS (
        SELECT count(*)::int AS "mediaCount", count(published_job_id)::int AS "mediaByTool"
        FROM account_media am JOIN scoped ON scoped.id = am.instagram_account_id
        WHERE am.posted_at >= ${from}::date AND am.posted_at < ${to}::date + 1
      )
      SELECT metrics.*, media.* FROM metrics, media
    `,
    followerBounds(ids, from, to),
  ]);
  const followers = bounds.reduce((total, row) => total + row.followers, 0);
  const netChange = bounds.reduce((total, row) => total + row.net_change, 0);
  // ponytail: perdidos = ganhos − variação líquida; subestima em contas < 100 seguidores (sem follower_gains).
  const lost = Math.max(sums.gains - netChange, 0);
  return { ...sums, followers, netChange, lost };
}

export async function loadAnalytics(input: {
  accountIds: string[] | null; period: Period; mediaType?: "FEED" | "REELS" | "STORY";
  rankingOrder?: RankingOrder; mediaOrder?: MediaOrder;
}): Promise<AnalyticsResult> {
  const sql = getSqlClient();
  const ids = input.accountIds;
  const { from, to, previousFrom, previousTo } = input.period;
  const rankingOrder: RankingOrder = input.rankingOrder ?? "reach";
  const mediaOrder: MediaOrder = input.mediaOrder ?? "views";

  const [totals, previous, series, sums, bounds, media, [state], missingScope, syncErrors] = await Promise.all([
    loadTotals(ids, from, to),
    loadTotals(ids, previousFrom, previousTo),
    sql<DailyPoint[]>`
      WITH days AS (
        SELECT generate_series(${from}::date, ${to}::date, interval '1 day')::date AS day
      )
      SELECT to_char(days.day, 'YYYY-MM-DD') AS day,
        sum(m.followers_count)::int AS followers,
        coalesce(sum(m.reach), 0)::int AS reach, coalesce(sum(m.views), 0)::int AS views
      FROM days
      LEFT JOIN account_daily_metrics m ON m.day = days.day
        AND (${ids}::uuid[] IS NULL OR m.instagram_account_id = ANY(${ids}::uuid[]))
      GROUP BY days.day ORDER BY days.day
    `,
    sql<Array<{ id: string; username: string; display_name: string | null; profile_picture_url: string | null; status: string; reach: number; views: number; total_interactions: number; media_count: number; insights_synced_at: Date | null }>>`
      SELECT account.id, account.username, account.display_name, account.profile_picture_url, account.status, account.insights_synced_at,
        coalesce(sum(m.reach), 0)::int AS reach, coalesce(sum(m.views), 0)::int AS views,
        coalesce(sum(m.total_interactions), 0)::int AS total_interactions,
        (SELECT count(*)::int FROM account_media am WHERE am.instagram_account_id = account.id
          AND am.posted_at >= ${from}::date AND am.posted_at < ${to}::date + 1) AS media_count
      FROM instagram_accounts account
      LEFT JOIN account_daily_metrics m ON m.instagram_account_id = account.id AND m.day BETWEEN ${from}::date AND ${to}::date
      WHERE (${ids}::uuid[] IS NULL OR account.id = ANY(${ids}::uuid[]))
        AND (account.status IN ('CONNECTED', 'TOKEN_EXPIRING') OR m.instagram_account_id IS NOT NULL)
      GROUP BY account.id
    `,
    followerBounds(ids, from, to),
    sql<MediaRow[]>`
      SELECT am.id, am.instagram_account_id AS account_id, account.username, am.media_type, am.product_type, am.permalink,
        am.thumbnail_url, am.caption, am.posted_at, am.like_count, am.comments_count, am.views, am.reach, am.shares, am.saved,
        am.replies, am.follows, am.reels_avg_watch_time_ms, am.story_taps_forward, am.story_taps_back, am.story_exits, am.published_job_id
      FROM account_media am JOIN instagram_accounts account ON account.id = am.instagram_account_id
      WHERE (${ids}::uuid[] IS NULL OR am.instagram_account_id = ANY(${ids}::uuid[]))
        AND am.posted_at >= ${from}::date AND am.posted_at < ${to}::date + 1
        AND (${input.mediaType ?? null}::text IS NULL OR am.product_type = ${input.mediaType ?? null}::text)
      ORDER BY ${sql(mediaOrder)} DESC NULLS LAST, am.posted_at DESC
      LIMIT 20
    `,
    sql<Array<{ synced_at: Date | null }>>`
      SELECT min(insights_synced_at) AS synced_at FROM instagram_accounts
      WHERE status IN ('CONNECTED', 'TOKEN_EXPIRING') AND ${INSIGHTS_SCOPE} = ANY(granted_scopes)
        AND (${ids}::uuid[] IS NULL OR id = ANY(${ids}::uuid[]))
    `,
    sql<Array<{ id: string; username: string }>>`
      SELECT id, username FROM instagram_accounts
      WHERE status IN ('CONNECTED', 'TOKEN_EXPIRING') AND NOT (${INSIGHTS_SCOPE} = ANY(coalesce(granted_scopes, '{}')))
        AND (${ids}::uuid[] IS NULL OR id = ANY(${ids}::uuid[]))
      ORDER BY username
    `,
    sql<Array<{ id: string; username: string; code: string }>>`
      SELECT id, username, insights_error_code AS code FROM instagram_accounts
      WHERE status IN ('CONNECTED', 'TOKEN_EXPIRING') AND insights_error_code IS NOT NULL
        AND (${ids}::uuid[] IS NULL OR id = ANY(${ids}::uuid[]))
      ORDER BY username
    `,
  ]);

  const boundsById = new Map(bounds.map((row) => [row.instagram_account_id, row]));
  const ranking: AccountRank[] = sums
    .map((row) => ({
      ...row,
      followers: boundsById.get(row.id)?.followers ?? null,
      net_change: boundsById.get(row.id)?.net_change ?? null,
    }))
    .sort((a, b) => (b[rankingOrder] ?? -1) - (a[rankingOrder] ?? -1) || a.username.localeCompare(b.username));

  return { totals, previous, series, ranking, media, syncedAt: state?.synced_at ?? null, missingScope, syncErrors };
}

export type BanRecord = {
  id: string; account_id: string; username: string; display_name: string | null; status: string; banned_at: Date;
  reason: string | null; followers_count: number | null; published_by_tool: number | null; last_error_code: string | null;
  last_error_at: string | null; days_alive: number;
};

export async function loadBanHistory() {
  const records = await getSqlClient()<BanRecord[]>`
    SELECT log.id, account.id AS account_id, account.username, account.display_name, account.status, log.created_at AS banned_at,
      log.metadata_json->>'reason' AS reason,
      (log.metadata_json->>'followersCount')::int AS followers_count,
      (log.metadata_json->>'publishedByTool')::int AS published_by_tool,
      log.metadata_json->>'lastErrorCode' AS last_error_code,
      log.metadata_json->>'lastErrorAt' AS last_error_at,
      floor(extract(epoch FROM (log.created_at - account.created_at)) / 86400)::int AS days_alive
    FROM audit_logs log
    JOIN instagram_accounts account ON account.id::text = log.entity_id
    WHERE log.event_type = 'ACCOUNT_BANNED'
    ORDER BY log.created_at DESC
  `;
  const cutoff = Date.now() - 30 * DAY_MS;
  const average = (values: number[]) => (values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null);
  return {
    records,
    total: records.length,
    // known environment fact: raw SQL timestamp columns come back as strings in integration
    // tests (drizzle migrator installs identity parsers on the shared client) but as Date in
    // production — coerce before calling Date methods so both shapes work.
    last30: records.filter((record) => new Date(record.banned_at).getTime() >= cutoff).length,
    avgDaysAlive: average(records.map((record) => record.days_alive)),
    avgFollowers: average(records.flatMap((record) => (record.followers_count === null ? [] : [record.followers_count]))),
  };
}
