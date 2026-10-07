import type { TransactionSql } from "postgres";
import { accountWarmup, warmupPublicationAt, type WarmupProfile } from "@/lib/account-warmup";

export async function accountWarmupAllowedAt(sql: TransactionSql, input: {
  organizationId: string; accountId: string; profile: WarmupProfile | null;
  connectedAt: Date | string; normalLimit?: number; excludeJobId?: string;
}) {
  const now = new Date();
  const warmup = accountWarmup(input.profile, input.connectedAt, now);
  if (!warmup?.dailyLimit) return now;
  const [loop] = await sql<Array<{ daily_limit: number }>>`
    SELECT CASE WHEN loop.tiered_limits AND metrics.followers_count <= loop.tier_follower_threshold
      THEN loop.tier1_daily_limit ELSE loop.daily_limit_per_account END AS daily_limit
    FROM loop_accounts selected
    JOIN loops loop ON loop.organization_id = selected.organization_id AND loop.id = selected.loop_id
    LEFT JOIN LATERAL (
      SELECT followers_count FROM account_daily_metrics
      WHERE organization_id = selected.organization_id AND instagram_account_id = selected.instagram_account_id
        AND followers_count IS NOT NULL ORDER BY day DESC LIMIT 1
    ) metrics ON true
    WHERE selected.organization_id = ${input.organizationId} AND selected.instagram_account_id = ${input.accountId}
      AND loop.status = 'ACTIVE'
  `;
  const publications = await sql<Array<{ published_at: Date }>>`
    SELECT published_at FROM publication_jobs
    WHERE organization_id = ${input.organizationId} AND instagram_account_id = ${input.accountId}
      AND status = 'PUBLISHED' AND published_at > now() - interval '24 hours'
    ORDER BY published_at DESC
  `;
  // Uma falha definitiva também espaça o próximo job, evitando que a recuperação insista a cada 30 segundos.
  const [attempt] = await sql<Array<{ attempted_at: Date | null }>>`
    SELECT max(started_at) AS attempted_at FROM publication_jobs
    WHERE organization_id = ${input.organizationId} AND instagram_account_id = ${input.accountId}
      AND status IN ('FAILED', 'RECONCILIATION_REQUIRED')
      AND (${input.excludeJobId ?? null}::uuid IS NULL OR id <> ${input.excludeJobId ?? null}::uuid)
  `;
  const allowedAt = warmupPublicationAt({ now, dailyLimit: Math.min(input.normalLimit ?? warmup.dailyLimit, loop?.daily_limit ?? warmup.dailyLimit, warmup.dailyLimit),
    publishedAt: publications.map((job) => job.published_at), lastAttemptAt: attempt?.attempted_at });
  // Na virada da etapa o worker reavalia o limite maior, sem manter a espera da etapa anterior.
  return new Date(Math.min(allowedAt.getTime(), warmup.stageEndsAt!.getTime()));
}
