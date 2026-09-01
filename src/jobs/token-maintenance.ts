import { getSqlClient } from "@/db/client";
import { decryptToken, encryptToken } from "@/lib/crypto";
import { asInstagramError } from "@/lib/errors";
import { log } from "@/lib/logger";
import { getInstagramProvider } from "@/providers";
import { markAccountUnavailableIfCurrent } from "./account-availability";

export async function refreshExpiringTokens(workerId: string) {
  const accounts = await getSqlClient()<
    Array<{ id: string; encrypted_access_token: string; token_expires_at: Date; status: string }>
  >`
    WITH candidates AS (
      SELECT id FROM instagram_accounts
      WHERE status IN ('CONNECTED', 'TOKEN_EXPIRING') AND encrypted_access_token IS NOT NULL
        AND token_expires_at < now() + interval '7 days'
        AND (token_last_checked_at IS NULL OR token_last_checked_at < now() - interval '1 hour')
      ORDER BY token_expires_at
      FOR UPDATE SKIP LOCKED
      LIMIT 25
    )
    UPDATE instagram_accounts account SET token_last_checked_at = now(), updated_at = now()
    FROM candidates WHERE account.id = candidates.id
    RETURNING account.id, account.encrypted_access_token, account.token_expires_at, account.status
  `;
  for (const account of accounts) {
    try {
      const refreshed = await getInstagramProvider().refreshAccessToken(decryptToken(account.encrypted_access_token));
      const updated = await getSqlClient().begin(async (sql) => {
        const rows = await sql`
          UPDATE instagram_accounts SET encrypted_access_token = ${encryptToken(refreshed.accessToken)},
            token_expires_at = now() + ${refreshed.expiresIn} * interval '1 second', status = 'CONNECTED',
            token_last_refreshed_at = now(), token_last_checked_at = now(), updated_at = now()
          WHERE id = ${account.id} AND encrypted_access_token = ${account.encrypted_access_token}
            AND status = ${account.status}
          RETURNING id
        `;
        if (!rows.length) return false;
        await sql`
          INSERT INTO audit_logs (event_type, entity_type, entity_id)
          VALUES ('TOKEN_REFRESHED', 'instagram_account', ${account.id})
        `;
        return true;
      });
      log("info", "token-maintenance", updated ? "token_refreshed" : "token_refresh_discarded", {
        worker_id: workerId,
        account_id: account.id,
      });
    } catch (rawError) {
      const error = asInstagramError(rawError);
      let updated: boolean;
      if (error.kind === "AUTH") {
        updated = await markAccountUnavailableIfCurrent({
          accountId: account.id,
          expectedEncryptedToken: account.encrypted_access_token,
          expectedStatus: account.status,
          nextStatus: "REAUTH_REQUIRED",
          errorCode: error.code,
          errorKind: error.kind,
          errorMessage: error.message,
        });
      } else {
        const rows = await getSqlClient()`
          UPDATE instagram_accounts SET status = 'TOKEN_EXPIRING',
            token_last_checked_at = now(), last_error_at = now(), last_error_code = ${error.code},
            last_error_message = ${error.message}, updated_at = now()
          WHERE id = ${account.id} AND encrypted_access_token = ${account.encrypted_access_token}
            AND status = ${account.status}
          RETURNING id
        `;
        updated = rows.length > 0;
      }
      log("warn", "token-maintenance", updated ? "refresh_failed" : "refresh_failure_discarded", {
        worker_id: workerId,
        account_id: account.id,
        error_code: error.code,
      });
    }
  }
}
