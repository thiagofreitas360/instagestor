import { getSqlClient } from "@/db/client";

export type SeedAccount = { id: string; instagram_user_id: string; username: string };

export async function createUser(email = "admin@example.test") {
  const [user] = await getSqlClient()<{ id: string }[]>`
    INSERT INTO users (email, password_hash)
    VALUES (${email}, 'integration-test-password-hash')
    RETURNING id
  `;
  return user.id;
}

export async function createAccounts(count: number, prefix = "account") {
  const sql = getSqlClient();
  const rows = Array.from({ length: count }, (_, index) => ({
    instagram_user_id: `${prefix}-instagram-${index.toString().padStart(3, "0")}`,
    username: `${prefix}_${index.toString().padStart(3, "0")}`,
    status: "CONNECTED",
  }));

  return sql<SeedAccount[]>`
    INSERT INTO instagram_accounts ${sql(rows)}
    RETURNING id, instagram_user_id, username
  `;
}

export async function createCampaign(
  createdBy: string,
  status: "DRAFT" | "SCHEDULED" | "RUNNING" | "PAUSED" = "DRAFT",
  name = "Campanha de integração",
) {
  const [campaign] = await getSqlClient()<{ id: string }[]>`
    INSERT INTO campaigns (
      name, publication_type, status, delay_mode, delay_fixed_seconds, target_order, created_by
    ) VALUES (
      ${name}, 'FEED_IMAGE', ${status}::campaign_status, 'FIXED', 0, 'SELECTED', ${createdBy}
    )
    RETURNING id
  `;
  return campaign.id;
}

export async function createJobs(
  campaignId: string,
  accounts: SeedAccount[],
  options: {
    status?: "QUEUED" | "CLAIMED" | "WAITING_FOR_CONTAINER" | "PUBLISHING" | "RETRY_WAIT";
    scheduledAt?: Date;
    nextAttemptAt?: Date | null;
    lockedBy?: string | null;
    lockExpiresAt?: Date | null;
    fencingToken?: number;
  } = {},
) {
  const sql = getSqlClient();
  const rows = accounts.map((account) => ({
    campaign_id: campaignId,
    instagram_account_id: account.id,
    scheduled_at: (options.scheduledAt ?? new Date(Date.now() - 60_000)).toISOString(),
    status: options.status ?? "QUEUED",
    next_attempt_at: options.nextAttemptAt ?? null,
    locked_at: options.lockedBy ? new Date(Date.now() - 120_000).toISOString() : null,
    locked_by: options.lockedBy ?? null,
    lock_expires_at: options.lockExpiresAt?.toISOString() ?? null,
    fencing_token: options.fencingToken ?? 0,
  }));

  return sql<Array<{ id: string; instagram_account_id: string }>>`
    INSERT INTO publication_jobs ${sql(rows)}
    RETURNING id, instagram_account_id
  `;
}
