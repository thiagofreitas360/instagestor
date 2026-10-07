import { randomUUID } from "node:crypto";
import { getSqlClient } from "@/db/client";

export type SeedAccount = { id: string; instagram_user_id: string; username: string };
export const TEST_ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";

export async function createOrganization(
  id: string = randomUUID(),
  name = `Organização ${id.slice(0, 8)}`,
  slug = `organizacao-${id}`,
) {
  await getSqlClient()`
    INSERT INTO organizations (id, name, slug) VALUES (${id}, ${name}, ${slug})
    ON CONFLICT (id) DO NOTHING
  `;
  return id;
}

export async function createUser(email = "admin@example.test", organizationId = TEST_ORGANIZATION_ID) {
  await createOrganization(organizationId, "InstaGestor Teste", `instagestor-teste-${organizationId}`);
  const [user] = await getSqlClient()<{ id: string }[]>`
    INSERT INTO users (email, password_hash)
    VALUES (${email}, 'integration-test-password-hash')
    RETURNING id
  `;
  await getSqlClient()`
    INSERT INTO organization_members (organization_id, user_id, role)
    VALUES (${organizationId}, ${user.id}, 'OWNER')
  `;
  return user.id;
}

export async function createAccounts(count: number, prefix = "account", organizationId = TEST_ORGANIZATION_ID) {
  await createOrganization(organizationId, "InstaGestor Teste", `instagestor-teste-${organizationId}`);
  const sql = getSqlClient();
  const rows = Array.from({ length: count }, (_, index) => ({
    organization_id: organizationId,
    instagram_user_id: `${prefix}-instagram-${index.toString().padStart(3, "0")}`,
    username: `${prefix}_${index.toString().padStart(3, "0")}`,
    status: "CONNECTED",
    warmup_profile: null,
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
  organizationId = TEST_ORGANIZATION_ID,
) {
  await createOrganization(organizationId, "InstaGestor Teste", `instagestor-teste-${organizationId}`);
  const [campaign] = await getSqlClient()<{ id: string }[]>`
    INSERT INTO campaigns (
      organization_id, name, publication_type, status, delay_mode, delay_fixed_seconds, target_order, created_by
    ) VALUES (
      ${organizationId}, ${name}, 'FEED_IMAGE', ${status}::campaign_status, 'FIXED', 0, 'SELECTED', ${createdBy}
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
    organizationId?: string;
  } = {},
) {
  const sql = getSqlClient();
  const rows = accounts.map((account) => ({
    organization_id: options.organizationId ?? TEST_ORGANIZATION_ID,
    campaign_id: campaignId,
    instagram_account_id: account.id,
    scheduled_at: (options.scheduledAt ?? new Date(Date.now() - 60_000)).toISOString(),
    status: options.status ?? "QUEUED",
    next_attempt_at: options.nextAttemptAt?.toISOString() ?? null,
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
