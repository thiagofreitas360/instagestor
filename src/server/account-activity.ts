import type { TransactionSql } from "postgres";
import { accountActivity, type AccountActivityDates } from "@/lib/account-activity";

export async function accountActivitySnapshot(sql: TransactionSql, organizationId: string, accountId: string) {
  const [account] = await sql<AccountActivityDates[]>`
    SELECT status, created_at, authorized_at, active_started_at, active_ended_at,
      active_timing_estimated, disconnected_at, banned_at, instagram_user_id, now() AS activity_observed_at
    FROM instagram_accounts WHERE organization_id = ${organizationId} AND id = ${accountId}
  `;
  const activity = accountActivity(account);
  return { activity: {
    startedAt: activity.startedAt?.toISOString() ?? null,
    endedAt: activity.endedAt?.toISOString() ?? null,
    days: activity.days,
    estimated: activity.estimated,
  } };
}
