import { getSqlClient } from "@/db/client";
import type { InstagramErrorKind } from "@/lib/errors";

type MarkAccountUnavailableInput = {
  accountId: string;
  expectedEncryptedToken: string;
  expectedStatus: string;
  nextStatus: "REAUTH_REQUIRED" | "ERROR";
  errorCode: string;
  errorKind: InstagramErrorKind;
  errorMessage: string;
};

/**
 * Moves an account out of the publishable state only if the provider result was
 * produced with the account state that is still current. The same transaction
 * fences every affected job and closes campaigns, so an unavailable account
 * cannot leave work permanently queued.
 */
export async function markAccountUnavailableIfCurrent(input: MarkAccountUnavailableInput) {
  return getSqlClient().begin(async (sql) => {
    const [updatedAccount] = await sql<{ id: string }[]>`
      UPDATE instagram_accounts SET
        status = ${input.nextStatus}, token_last_checked_at = now(), last_error_at = now(),
        last_error_code = ${input.errorCode}, last_error_message = ${input.errorMessage}, updated_at = now()
      WHERE id = ${input.accountId}
        AND encrypted_access_token = ${input.expectedEncryptedToken}
        AND status = ${input.expectedStatus}
      RETURNING id
    `;
    if (!updatedAccount) return false;

    const publishingErrorCode = `${input.errorCode}_DURING_PUBLISH`;
    const affected = await sql<{ campaign_id: string }[]>`
      WITH failed_jobs AS (
        UPDATE publication_jobs SET
          status = 'FAILED',
          last_error_code = ${input.errorCode}, last_error_type = ${input.errorKind},
          last_error_message = ${input.errorMessage}, finished_at = now(),
          locked_at = NULL, locked_by = NULL, lock_expires_at = NULL,
          fencing_token = fencing_token + 1, updated_at = now()
        WHERE instagram_account_id = ${input.accountId}
          AND status IN ('QUEUED', 'RETRY_WAIT', 'CLAIMED', 'CREATING_CONTAINER', 'WAITING_FOR_CONTAINER', 'READY_TO_PUBLISH')
        RETURNING campaign_id
      ), ambiguous_jobs AS (
        UPDATE publication_jobs SET
          status = 'RECONCILIATION_REQUIRED', reconciliation_required = true,
          last_error_code = ${publishingErrorCode}, last_error_type = 'AMBIGUOUS',
          last_error_message = 'A conta ficou indisponível durante media_publish; reconciliação manual obrigatória',
          finished_at = now(), locked_at = NULL, locked_by = NULL, lock_expires_at = NULL,
          fencing_token = fencing_token + 1, updated_at = now()
        WHERE instagram_account_id = ${input.accountId} AND status = 'PUBLISHING'
        RETURNING campaign_id
      ), affected AS (
        SELECT campaign_id FROM failed_jobs
        UNION
        SELECT campaign_id FROM ambiguous_jobs
      )
      SELECT campaign_id FROM affected
    `;
    if (affected.length) {
      const campaignIds = [...new Set(affected.map(({ campaign_id: campaignId }) => campaignId))];
      await sql`
      WITH totals AS (
        SELECT job.campaign_id,
          count(*) FILTER (WHERE job.status NOT IN ('PUBLISHED', 'FAILED', 'CANCELLED', 'RECONCILIATION_REQUIRED')) AS pending,
          count(*) FILTER (WHERE job.status = 'PUBLISHED') AS published,
          count(*) FILTER (WHERE job.status IN ('FAILED', 'RECONCILIATION_REQUIRED')) AS failed
        FROM publication_jobs job
        WHERE job.campaign_id = ANY(${campaignIds}::uuid[])
        GROUP BY job.campaign_id
      )
      UPDATE campaigns SET
        status = CASE
          WHEN totals.failed = 0 THEN 'COMPLETED'::campaign_status
          WHEN totals.published = 0 THEN 'FAILED'::campaign_status
          ELSE 'PARTIALLY_FAILED'::campaign_status
        END,
        updated_at = now()
      FROM totals
      WHERE campaigns.id = totals.campaign_id AND totals.pending = 0
        AND campaigns.status IN ('SCHEDULED', 'RUNNING', 'PAUSED')
      `;
    }
    return true;
  });
}
