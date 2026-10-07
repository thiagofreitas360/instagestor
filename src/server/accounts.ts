import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { TransactionSql } from "postgres";
import { z } from "zod";
import { getSqlClient } from "@/db/client";
import { decryptToken, encryptToken, randomSecret, sha256 } from "@/lib/crypto";
import { asInstagramError } from "@/lib/errors";
import { OauthFlowError } from "@/lib/oauth-result";
import { getEnv } from "@/lib/env";
import { getInstagramProvider, MetaInstagramProvider } from "@/providers";
import { COMMENTS_SCOPE, INSIGHTS_SCOPE } from "@/providers/instagram";
import { markAccountUnavailableIfCurrent } from "@/jobs/account-availability";
import { audit } from "./auth";
import { getMetaAppCredentials } from "./meta-apps";
import { reschedulePendingLoopJobs } from "./automation";

const FAKE_SCOPES = ["instagram_business_basic", "instagram_business_content_publish", INSIGHTS_SCOPE, COMMENTS_SCOPE];
type Sql = TransactionSql;

export async function setAccountsNewStatus(accountIds: string[], isNewAccount: boolean, actorUserId: string, organizationId: string) {
  const ids = [...new Set(z.array(z.uuid()).min(1, "Selecione ao menos uma conta").parse(accountIds))].sort();
  z.boolean().parse(isNewAccount);
  return getSqlClient().begin(async (sql) => {
    // Mesma ordem da edição de loop: contas antes dos loops, sempre ordenadas por ID.
    const accounts = await sql<Array<{ id: string; is_new_account: boolean }>>`
      SELECT id, is_new_account FROM instagram_accounts
      WHERE organization_id = ${organizationId} AND id = ANY(${ids}::uuid[])
      ORDER BY id FOR UPDATE
    `;
    if (accounts.length !== ids.length) throw new Error("Uma ou mais contas não existem ou pertencem a outro cliente");
    const changed = accounts.filter((account) => account.is_new_account !== isNewAccount);
    if (!changed.length) return { changed: 0, unchanged: ids.length };
    const changedIds = changed.map((account) => account.id);
    await sql`
      SELECT loop.id FROM loops loop
      WHERE loop.organization_id = ${organizationId} AND EXISTS (
        SELECT 1 FROM loop_accounts selected WHERE selected.organization_id = loop.organization_id
          AND selected.loop_id = loop.id AND selected.instagram_account_id = ANY(${changedIds}::uuid[])
      ) ORDER BY loop.id FOR UPDATE OF loop
    `;
    await sql`
      UPDATE instagram_accounts SET is_new_account = ${isNewAccount}, updated_at = now()
      WHERE organization_id = ${organizationId} AND id = ANY(${changedIds}::uuid[])
    `;
    const jobs = await reschedulePendingLoopJobs(sql, organizationId, changedIds);
    await sql`INSERT INTO audit_logs ${sql(changed.map((account) => ({
      organization_id: organizationId, actor_user_id: actorUserId,
      event_type: "ACCOUNT_NEW_STATUS_UPDATED", entity_type: "instagram_account", entity_id: account.id,
      metadata_json: JSON.stringify({ previousValue: account.is_new_account, isNewAccount,
        jobs: jobs.filter((job) => job.accountId === account.id) }),
    })))}`;
    return { changed: changed.length, unchanged: ids.length - changed.length };
  });
}

export async function createFakeAccounts(count: number, actorUserId: string, organizationId: string) {
  const env = getEnv();
  if (env.INSTAGRAM_PROVIDER !== "fake" || (env.NODE_ENV === "production" && !env.ALLOW_FAKE_PROVIDER_IN_PRODUCTION)) {
    throw new Error("Contas fake exigem o provider fake explicitamente autorizado");
  }
  if (!Number.isInteger(count) || count < 1 || count > 200) throw new Error("Crie entre 1 e 200 contas por vez");
  const rows = Array.from({ length: count }, (_, position) => {
    const suffix = `${Date.now()}${position}${randomBytes(2).toString("hex")}`;
    const instagramUserId = `fake_${suffix}`;
    const username = `conta_${suffix}`;
    return {
      organization_id: organizationId,
      instagram_user_id: instagramUserId,
      app_scoped_user_id: `app_${instagramUserId}`,
      username,
      display_name: `Conta ${position + 1}`,
      account_type: "BUSINESS",
      status: "CONNECTED",
      encrypted_access_token: encryptToken(`fake-token:${instagramUserId}:${username}`),
      token_expires_at: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
      token_last_refreshed_at: new Date().toISOString(),
      token_last_checked_at: new Date().toISOString(),
      granted_scopes: FAKE_SCOPES,
    };
  });
  return getSqlClient().begin(async (sql) => {
    const created = await sql<{ id: string }[]>`INSERT INTO instagram_accounts ${sql(rows)} RETURNING id`;
    await sql`
      INSERT INTO audit_logs (organization_id, actor_user_id, event_type, entity_type, metadata_json)
      VALUES (${organizationId}, ${actorUserId}, 'ACCOUNT_CONNECTED', 'instagram_account', ${JSON.stringify({ fake: true, count })}::jsonb)
    `;
    return created.map((account) => account.id);
  });
}

async function closeAccountJobs(sql: Sql, organizationId: string, accountId: string, errorCode: string, errorMessage: string) {
  await sql`
    UPDATE publication_jobs SET status = 'FAILED', last_error_code = ${errorCode},
      last_error_type = 'AUTH', last_error_message = ${errorMessage}, finished_at = now(),
      locked_at = NULL, locked_by = NULL, lock_expires_at = NULL,
      fencing_token = fencing_token + 1, updated_at = now()
    WHERE organization_id = ${organizationId} AND instagram_account_id = ${accountId}
      AND status IN ('QUEUED', 'RETRY_WAIT', 'CLAIMED', 'CREATING_CONTAINER', 'WAITING_FOR_CONTAINER', 'READY_TO_PUBLISH')
  `;
  await sql`
    UPDATE publication_jobs SET status = 'RECONCILIATION_REQUIRED', reconciliation_required = true,
      last_error_code = ${`${errorCode}_DURING_PUBLISH`}, last_error_type = 'AMBIGUOUS',
      last_error_message = ${`${errorMessage} durante publicação; verificação manual obrigatória`},
      finished_at = now(), locked_at = NULL, locked_by = NULL, lock_expires_at = NULL,
      fencing_token = fencing_token + 1, updated_at = now()
    WHERE organization_id = ${organizationId} AND instagram_account_id = ${accountId} AND status = 'PUBLISHING'
  `;
  await sql`
    WITH affected AS (
      SELECT campaign_id FROM publication_jobs
      WHERE organization_id = ${organizationId} AND instagram_account_id = ${accountId}
      GROUP BY campaign_id
    ), totals AS (
      SELECT job.campaign_id,
        count(*) FILTER (WHERE job.status NOT IN ('PUBLISHED', 'FAILED', 'CANCELLED', 'RECONCILIATION_REQUIRED')) AS pending,
        count(*) FILTER (WHERE job.status = 'PUBLISHED') AS published,
        count(*) FILTER (WHERE job.status IN ('FAILED', 'RECONCILIATION_REQUIRED')) AS failed
      FROM publication_jobs job JOIN affected ON affected.campaign_id = job.campaign_id
      GROUP BY job.campaign_id
    )
    UPDATE campaigns SET status = CASE
        WHEN totals.failed = 0 THEN 'COMPLETED'::campaign_status
        WHEN totals.published = 0 THEN 'FAILED'::campaign_status
        ELSE 'PARTIALLY_FAILED'::campaign_status
      END,
      updated_at = now()
    FROM totals
    WHERE campaigns.organization_id = ${organizationId} AND campaigns.id = totals.campaign_id AND totals.pending = 0
      AND campaigns.origin <> 'LOOP' AND campaigns.status IN ('SCHEDULED', 'RUNNING', 'PAUSED')
  `;
}

export async function disconnectAccount(accountId: string, actorUserId: string, organizationId: string) {
  await getSqlClient().begin(async (sql) => {
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`instagestor:meta:account:${accountId}:0`}, 0))`;
    const [account] = await sql<{ id: string }[]>`
      UPDATE instagram_accounts SET status = 'DISCONNECTED', encrypted_access_token = NULL,
        disconnected_at = now(), updated_at = now()
      WHERE organization_id = ${organizationId} AND id = ${accountId} RETURNING id
    `;
    if (!account) throw new Error("Conta não encontrada");
    await closeAccountJobs(sql, organizationId, accountId, "ACCOUNT_DISCONNECTED", "Conta desconectada");
    await sql`
      INSERT INTO audit_logs (organization_id, actor_user_id, event_type, entity_type, entity_id)
      VALUES (${organizationId}, ${actorUserId}, 'ACCOUNT_DISCONNECTED', 'instagram_account', ${accountId})
    `;
  });
}

export async function banAccount(accountId: string, reason: string, actorUserId: string, organizationId: string) {
  const trimmed = reason.trim();
  if (trimmed.length < 3 || trimmed.length > 500) throw new Error("Informe um motivo entre 3 e 500 caracteres");
  await getSqlClient().begin(async (sql) => {
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`instagestor:meta:account:${accountId}:0`}, 0))`;
    const [account] = await sql<Array<{ status: string; last_error_code: string | null; last_error_at: Date | null }>>`
      SELECT status, last_error_code, last_error_at FROM instagram_accounts
      WHERE organization_id = ${organizationId} AND id = ${accountId} FOR UPDATE
    `;
    if (!account) throw new Error("Conta não encontrada");
    if (account.status === "BANNED") throw new Error("Conta já está marcada como banida");
    const [metrics] = await sql<Array<{ followers_count: number | null; media_count: number | null }>>`
      SELECT followers_count, media_count FROM account_daily_metrics
      WHERE organization_id = ${organizationId} AND instagram_account_id = ${accountId} AND followers_count IS NOT NULL
      ORDER BY day DESC LIMIT 1
    `;
    const [{ published }] = await sql<Array<{ published: number }>>`
      SELECT count(*)::int AS published FROM publication_jobs
      WHERE organization_id = ${organizationId} AND instagram_account_id = ${accountId} AND status = 'PUBLISHED'
    `;
    await sql`
      UPDATE instagram_accounts SET status = 'BANNED', encrypted_access_token = NULL, banned_at = now(),
        ban_reason = ${trimmed}, disconnected_at = now(), updated_at = now()
      WHERE organization_id = ${organizationId} AND id = ${accountId}
    `;
    await closeAccountJobs(sql, organizationId, accountId, "ACCOUNT_BANNED", "Conta marcada como banida");
    await sql`
      INSERT INTO audit_logs (organization_id, actor_user_id, event_type, entity_type, entity_id, metadata_json)
      VALUES (${organizationId}, ${actorUserId}, 'ACCOUNT_BANNED', 'instagram_account', ${accountId}, ${JSON.stringify({
        reason: trimmed,
        followersCount: metrics?.followers_count ?? null,
        mediaCount: metrics?.media_count ?? null,
        lastErrorCode: account.last_error_code,
        lastErrorAt: account.last_error_at
          ? (account.last_error_at instanceof Date ? account.last_error_at : new Date(account.last_error_at)).toISOString()
          : null,
        publishedByTool: published,
      })}::jsonb)
    `;
  });
}

export async function unbanAccount(accountId: string, actorUserId: string, organizationId: string) {
  const rows = await getSqlClient()`
    UPDATE instagram_accounts SET status = 'DISCONNECTED', banned_at = NULL, ban_reason = NULL, updated_at = now()
    WHERE organization_id = ${organizationId} AND id = ${accountId} AND status = 'BANNED' RETURNING id
  `;
  if (!rows.length) throw new Error("Conta não está marcada como banida");
  await audit(organizationId, actorUserId, "ACCOUNT_UNBANNED", "instagram_account", accountId);
}

export async function requestInsightsRefresh(organizationId: string, accountId?: string) {
  const rows = await getSqlClient()`
    UPDATE instagram_accounts SET insights_synced_at = NULL, updated_at = now()
    WHERE organization_id = ${organizationId}
      AND status IN ('CONNECTED', 'TOKEN_EXPIRING') AND encrypted_access_token IS NOT NULL
      AND ${INSIGHTS_SCOPE} = ANY(granted_scopes)
      AND (${accountId ?? null}::uuid IS NULL OR id = ${accountId ?? null}::uuid)
    RETURNING id
  `;
  return rows.length;
}

export async function verifyAccount(accountId: string, organizationId: string) {
  const [account] = await getSqlClient()<
    Array<{ instagram_user_id: string; encrypted_access_token: string | null; status: string }>
  >`SELECT instagram_user_id, encrypted_access_token, status FROM instagram_accounts
    WHERE organization_id = ${organizationId} AND id = ${accountId}`;
  if (!account?.encrypted_access_token) throw new Error("Conta sem token utilizável");
  const accessToken = decryptToken(account.encrypted_access_token);
  try {
    const provider = getInstagramProvider();
    const [profile, limit] = await Promise.all([
      provider.getProfile(accessToken),
      provider.getPublishingLimit(account.instagram_user_id, accessToken),
    ]);
    const updated = await getSqlClient()`
      UPDATE instagram_accounts SET username = ${profile.username}, display_name = ${profile.displayName ?? null},
        profile_picture_url = ${profile.profilePictureUrl ?? null}, account_type = ${profile.accountType ?? null},
        app_scoped_user_id = COALESCE(${profile.appScopedUserId ?? null}, app_scoped_user_id),
        status = 'CONNECTED', token_last_checked_at = now(), last_successful_api_call_at = now(),
        publishing_limit_usage = ${limit.usage}, publishing_limit_total = ${limit.total},
        publishing_limit_checked_at = now(), last_error_at = NULL, last_error_code = NULL,
        last_error_message = NULL, updated_at = now()
      WHERE organization_id = ${organizationId} AND id = ${accountId} AND encrypted_access_token = ${account.encrypted_access_token}
        AND status = ${account.status}
      RETURNING id
    `;
    return updated.length > 0;
  } catch (rawError) {
    const error = asInstagramError(rawError);
    const updated = error.kind === "AUTH"
      ? await markAccountUnavailableIfCurrent({
          accountId,
          organizationId,
          expectedEncryptedToken: account.encrypted_access_token,
          expectedStatus: account.status,
          nextStatus: "REAUTH_REQUIRED",
          errorCode: error.code,
          errorKind: error.kind,
          errorMessage: error.message,
        })
      : (await getSqlClient()`
          UPDATE instagram_accounts SET token_last_checked_at = now(), last_error_at = now(),
            last_error_code = ${error.code}, last_error_message = ${error.message}, updated_at = now()
          WHERE organization_id = ${organizationId} AND id = ${accountId}
            AND encrypted_access_token = ${account.encrypted_access_token}
            AND status = ${account.status}
          RETURNING id
        `).length > 0;
    if (!updated) return false;
    throw error;
  }
}

export async function createOauthState(
  organizationId: string,
  actorUserId: string,
  targetAccountId?: string,
  metaAppId?: string,
) {
  if (getEnv().INSTAGRAM_PROVIDER !== "meta") throw new Error("OAuth real requer INSTAGRAM_PROVIDER=meta");
  const state = randomSecret(32);
  const target = targetAccountId ?? null;
  // A FK (organization_id, meta_app_id) recusa app de outro cliente.
  const created = await getSqlClient()`
    INSERT INTO oauth_states (organization_id, initiated_by, nonce_hash, expires_at, target_instagram_account_id, meta_app_id)
    SELECT ${organizationId}, ${actorUserId}, ${sha256(state)}, now() + interval '10 minutes', ${target}::uuid,
      ${metaAppId ?? null}::uuid
    WHERE ${target}::uuid IS NULL OR EXISTS (
      SELECT 1 FROM instagram_accounts WHERE organization_id = ${organizationId} AND id = ${target}::uuid
    )
    RETURNING id
  `;
  if (!created.length) throw new Error("Conta para reconexão não encontrada");
  return state;
}

export async function consumeOauthState(state: string) {
  const [valid] = await getSqlClient()<
    {
      id: string; organization_id: string; initiated_by: string;
      target_instagram_account_id: string | null; meta_app_id: string | null;
    }[]
  >`
    UPDATE oauth_states SET used_at = now()
    WHERE nonce_hash = ${sha256(state)} AND used_at IS NULL AND expires_at > now()
    RETURNING id, organization_id, initiated_by, target_instagram_account_id, meta_app_id
  `;
  if (!valid) throw new OauthFlowError("state_expired", "OAuth state inválido, expirado ou já utilizado");
  return valid;
}

export async function connectFromAuthorizationCode(code: string, state: string) {
  const oauth = await consumeOauthState(state);
  const provider = new MetaInstagramProvider();
  const app = oauth.meta_app_id ? await getMetaAppCredentials(oauth.organization_id, oauth.meta_app_id) : undefined;
  const exchanged = await provider.exchangeAuthorizationCode(code, app);
  const profile = await provider.getProfile(exchanged.accessToken);
  const encrypted = encryptToken(exchanged.accessToken);
  const account = await getSqlClient().begin(async (sql) => {
    const [existing] = await sql<Array<{ id: string; organization_id: string }>>`
      SELECT id, organization_id FROM instagram_accounts WHERE instagram_user_id = ${profile.id} FOR UPDATE
    `;
    if (existing && existing.organization_id !== oauth.organization_id) {
      throw new OauthFlowError("account_already_claimed");
    }
    if (oauth.target_instagram_account_id && existing?.id !== oauth.target_instagram_account_id) {
      throw new OauthFlowError("wrong_reconnect_account");
    }
    const [saved] = await sql<{ id: string; inserted: boolean }[]>`
      INSERT INTO instagram_accounts (
        organization_id, instagram_user_id, app_scoped_user_id, username, display_name, profile_picture_url, account_type,
        status, encrypted_access_token, authorized_at, token_expires_at, token_last_refreshed_at, token_last_checked_at,
        last_successful_api_call_at, disconnected_at, granted_scopes, banned_at, ban_reason, insights_synced_at, meta_app_id
      ) VALUES (
        ${oauth.organization_id}, ${profile.id}, ${profile.appScopedUserId ?? exchanged.appScopedUserId}, ${profile.username},
        ${profile.displayName ?? null}, ${profile.profilePictureUrl ?? null}, ${profile.accountType ?? null},
        'CONNECTED', ${encrypted}, now(), now() + ${exchanged.expiresIn} * interval '1 second', now(), now(), now(), NULL,
        ${exchanged.permissions}, NULL, NULL, NULL, ${oauth.meta_app_id ?? null}
      )
      ON CONFLICT (instagram_user_id) DO UPDATE SET
        app_scoped_user_id = EXCLUDED.app_scoped_user_id, username = EXCLUDED.username,
        display_name = EXCLUDED.display_name, profile_picture_url = EXCLUDED.profile_picture_url,
        account_type = EXCLUDED.account_type, status = 'CONNECTED',
        encrypted_access_token = EXCLUDED.encrypted_access_token, token_expires_at = EXCLUDED.token_expires_at,
        authorized_at = now(), token_last_refreshed_at = now(), token_last_checked_at = now(), last_successful_api_call_at = now(),
        disconnected_at = NULL, granted_scopes = EXCLUDED.granted_scopes, banned_at = NULL, ban_reason = NULL,
        insights_synced_at = NULL, meta_app_id = EXCLUDED.meta_app_id, updated_at = now()
      WHERE instagram_accounts.organization_id = EXCLUDED.organization_id
      RETURNING id, (xmax = 0) AS inserted
    `;
    if (!saved) throw new Error("Não foi possível vincular a conta à organização");
    return saved;
  });
  await audit(
    oauth.organization_id,
    oauth.initiated_by,
    account.inserted ? "ACCOUNT_CONNECTED" : "ACCOUNT_RECONNECTED",
    "instagram_account",
    account.id,
  );
  return account.id;
}

type SignedRequestPayload = { user_id?: string; algorithm?: string; issued_at?: number; expires?: number };

export function parseMetaSignedRequest(value: string): SignedRequestPayload {
  const parts = value.split(".");
  if (parts.length !== 2) throw new Error("signed_request inválido");
  const [encodedSignature, encodedPayload] = parts;
  if (!encodedSignature || !encodedPayload || !getEnv().INSTAGRAM_APP_SECRET) throw new Error("signed_request inválido");
  const expected = createHmac("sha256", getEnv().INSTAGRAM_APP_SECRET!).update(encodedPayload).digest();
  const actual = Buffer.from(encodedSignature, "base64url");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error("Assinatura Meta inválida");
  const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as SignedRequestPayload;
  if (payload.algorithm?.toUpperCase() !== "HMAC-SHA256") throw new Error("Algoritmo Meta inválido");
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isInteger(payload.issued_at) || payload.issued_at! < now - 86_400 || payload.issued_at! > now + 300) {
    throw new Error("signed_request expirado ou sem data de emissão válida");
  }
  if (
    payload.expires !== undefined
    && (!Number.isInteger(payload.expires) || payload.expires < now - 300 || payload.expires < payload.issued_at!)
  ) {
    throw new Error("signed_request expirado ou com validade inválida");
  }
  return payload;
}

export async function deauthorizeBySignedRequest(signedRequest: string) {
  const payload = parseMetaSignedRequest(signedRequest);
  if (!payload.user_id) throw new Error("Callback sem user_id app-scoped");
  const appScopedUserId = payload.user_id;
  const issuedAt = payload.issued_at!;
  const eventHash = sha256(`meta-deauthorization|${signedRequest}`);
  await getSqlClient().begin(async (sql) => {
    const [candidate] = await sql<Array<{ id: string; organization_id: string }>>`
      SELECT id, organization_id FROM instagram_accounts WHERE app_scoped_user_id = ${appScopedUserId}
    `;
    if (!candidate) return;
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`instagestor:meta:account:${candidate.id}:0`}, 0))`;
    const [account] = await sql<Array<{ id: string; organization_id: string }>>`
      SELECT id, organization_id FROM instagram_accounts
      WHERE organization_id = ${candidate.organization_id}
        AND id = ${candidate.id} AND app_scoped_user_id = ${appScopedUserId} FOR UPDATE
    `;
    if (!account) return;

    const [alreadyProcessed] = await sql<Array<{ id: string }>>`
      SELECT id FROM audit_logs
      WHERE organization_id = ${account.organization_id}
        AND event_type IN ('ACCOUNT_DEAUTHORIZED', 'ACCOUNT_DEAUTHORIZATION_IGNORED')
        AND metadata_json->>'eventHash' = ${eventHash}
      LIMIT 1
    `;
    if (alreadyProcessed) return;

    const [disconnected] = await sql<Array<{ id: string }>>`
      UPDATE instagram_accounts SET status = 'DISCONNECTED', encrypted_access_token = NULL,
        disconnected_at = now(), updated_at = now()
      WHERE organization_id = ${account.organization_id} AND id = ${account.id}
        AND authorized_at <= to_timestamp(${issuedAt})
      RETURNING id
    `;
    if (!disconnected) {
      await sql`
        INSERT INTO audit_logs (organization_id, event_type, entity_type, entity_id, metadata_json)
        VALUES (
          ${account.organization_id}, 'ACCOUNT_DEAUTHORIZATION_IGNORED', 'instagram_account', ${account.id},
          ${JSON.stringify({ eventHash, issuedAt, reason: "stale_after_reconnect" })}::jsonb
        )
      `;
      return;
    }
    await sql`
      UPDATE publication_jobs SET status = 'FAILED', last_error_code = 'ACCOUNT_DEAUTHORIZED',
        last_error_type = 'AUTH', last_error_message = 'Conta desautorizada na Meta', finished_at = now(),
        locked_at = NULL, locked_by = NULL, lock_expires_at = NULL,
        fencing_token = fencing_token + 1, updated_at = now()
      WHERE organization_id = ${account.organization_id} AND instagram_account_id = ${account.id}
        AND status IN ('QUEUED', 'RETRY_WAIT', 'CLAIMED', 'CREATING_CONTAINER', 'WAITING_FOR_CONTAINER', 'READY_TO_PUBLISH')
    `;
    await sql`
      UPDATE publication_jobs SET status = 'RECONCILIATION_REQUIRED', reconciliation_required = true,
        last_error_code = 'ACCOUNT_DEAUTHORIZED_DURING_PUBLISH', last_error_type = 'AMBIGUOUS',
        last_error_message = 'Conta desautorizada durante publicação; verificação manual obrigatória',
        finished_at = now(), locked_at = NULL, locked_by = NULL, lock_expires_at = NULL,
        fencing_token = fencing_token + 1, updated_at = now()
      WHERE organization_id = ${account.organization_id} AND instagram_account_id = ${account.id} AND status = 'PUBLISHING'
    `;
    await sql`
      WITH affected AS (
        SELECT campaign_id FROM publication_jobs
        WHERE organization_id = ${account.organization_id} AND instagram_account_id = ${account.id}
        GROUP BY campaign_id
      ), totals AS (
        SELECT job.campaign_id,
          count(*) FILTER (WHERE job.status NOT IN ('PUBLISHED', 'FAILED', 'CANCELLED', 'RECONCILIATION_REQUIRED')) AS pending,
          count(*) FILTER (WHERE job.status = 'PUBLISHED') AS published,
          count(*) FILTER (WHERE job.status IN ('FAILED', 'RECONCILIATION_REQUIRED')) AS failed
        FROM publication_jobs job JOIN affected ON affected.campaign_id = job.campaign_id
        GROUP BY job.campaign_id
      )
      UPDATE campaigns SET status = CASE
          WHEN totals.failed = 0 THEN 'COMPLETED'::campaign_status
          WHEN totals.published = 0 THEN 'FAILED'::campaign_status
          ELSE 'PARTIALLY_FAILED'::campaign_status
        END,
        updated_at = now()
      FROM totals
      WHERE campaigns.organization_id = ${account.organization_id}
        AND campaigns.id = totals.campaign_id AND totals.pending = 0
        AND campaigns.origin <> 'LOOP' AND campaigns.status IN ('SCHEDULED', 'RUNNING', 'PAUSED')
    `;
    await sql`
      INSERT INTO audit_logs (organization_id, event_type, entity_type, entity_id, metadata_json)
      VALUES (
        ${account.organization_id}, 'ACCOUNT_DEAUTHORIZED', 'instagram_account', ${account.id},
        ${JSON.stringify({ eventHash, issuedAt })}::jsonb
      )
    `;
  });
}

export async function deleteDataBySignedRequest(signedRequest: string) {
  const payload = parseMetaSignedRequest(signedRequest);
  if (!payload.user_id) throw new Error("Callback sem user_id app-scoped");
  const appScopedUserId = payload.user_id;
  const appScopedHash = sha256(`${appScopedUserId}|${getEnv().SESSION_SECRET}`);
  const eventHash = sha256(`meta-data-deletion|${signedRequest}`);
  const result = await getSqlClient().begin(async (sql) => {
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`instagestor:deletion:${appScopedHash}`}, 0))`;
    const [existing] = await sql<Array<{ metadata_json: { confirmationCode?: string } }>>`
      SELECT metadata_json FROM audit_logs
      WHERE event_type = 'DATA_DELETION_REQUESTED' AND metadata_json->>'eventHash' = ${eventHash}
      ORDER BY created_at DESC LIMIT 1
    `;
    if (existing?.metadata_json.confirmationCode) return existing.metadata_json.confirmationCode;

    const [candidate] = await sql<Array<{ id: string; organization_id: string }>>`
      SELECT id, organization_id FROM instagram_accounts WHERE app_scoped_user_id = ${appScopedUserId}
    `;
    if (candidate) {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`instagestor:meta:account:${candidate.id}:0`}, 0))`;
    }
    const [account] = candidate
      ? await sql<Array<{ id: string; organization_id: string }>>`
          SELECT id, organization_id FROM instagram_accounts
          WHERE organization_id = ${candidate.organization_id}
            AND id = ${candidate.id} AND app_scoped_user_id = ${appScopedUserId}
          FOR UPDATE
        `
      : [];
    if (account) {
      await sql`DELETE FROM account_group_members WHERE organization_id = ${account.organization_id} AND instagram_account_id = ${account.id}`;
      await sql`DELETE FROM account_media WHERE organization_id = ${account.organization_id} AND instagram_account_id = ${account.id}`;
      await sql`DELETE FROM account_daily_metrics WHERE organization_id = ${account.organization_id} AND instagram_account_id = ${account.id}`;
      await sql`
        UPDATE publication_jobs SET status = 'CANCELLED', finished_at = now(),
          locked_at = NULL, locked_by = NULL, lock_expires_at = NULL,
          fencing_token = fencing_token + 1, updated_at = now()
        WHERE organization_id = ${account.organization_id} AND instagram_account_id = ${account.id}
          AND status IN ('QUEUED', 'RETRY_WAIT', 'CLAIMED', 'CREATING_CONTAINER', 'WAITING_FOR_CONTAINER', 'READY_TO_PUBLISH')
      `;
      await sql`
        UPDATE publication_jobs SET status = 'RECONCILIATION_REQUIRED', reconciliation_required = true,
          last_error_code = 'DATA_DELETION_DURING_PUBLISH', last_error_type = 'AMBIGUOUS',
          last_error_message = 'Exclusão solicitada durante publicação; verificação manual obrigatória',
          finished_at = now(), locked_at = NULL, locked_by = NULL, lock_expires_at = NULL,
          fencing_token = fencing_token + 1, updated_at = now()
        WHERE organization_id = ${account.organization_id} AND instagram_account_id = ${account.id} AND status = 'PUBLISHING'
      `;
      await sql`
        UPDATE publication_jobs SET meta_container_id = NULL, meta_child_container_ids = NULL,
          container_started_at = NULL, meta_media_id = NULL,
          last_error_message = CASE WHEN status = 'RECONCILIATION_REQUIRED'
            THEN 'Resultado ambíguo após solicitação de exclusão de dados' ELSE NULL END,
          updated_at = now()
        WHERE organization_id = ${account.organization_id} AND instagram_account_id = ${account.id}
      `;
      await sql`
        UPDATE instagram_accounts SET instagram_user_id = 'deleted_' || id::text,
          app_scoped_user_id = NULL, username = 'deleted_' || left(id::text, 8),
          display_name = NULL, profile_picture_url = NULL, account_type = NULL,
          status = 'DISCONNECTED', encrypted_access_token = NULL, token_expires_at = NULL,
          token_last_refreshed_at = NULL, token_last_checked_at = NULL,
          last_successful_api_call_at = NULL, last_error_at = NULL, last_error_code = NULL,
          last_error_message = NULL, publishing_limit_usage = NULL, publishing_limit_total = NULL,
          publishing_limit_checked_at = NULL, disconnected_at = now(), updated_at = now(),
          biography = NULL, website = NULL, granted_scopes = NULL, insights_error_code = NULL,
          insights_synced_at = NULL
        WHERE organization_id = ${account.organization_id} AND id = ${account.id}
      `;
      await sql`
        WITH affected AS (
          SELECT campaign_id FROM publication_jobs
          WHERE organization_id = ${account.organization_id} AND instagram_account_id = ${account.id}
          GROUP BY campaign_id
        ), totals AS (
          SELECT job.campaign_id,
            count(*) FILTER (WHERE job.status NOT IN ('PUBLISHED', 'FAILED', 'CANCELLED', 'RECONCILIATION_REQUIRED')) AS pending,
            count(*) FILTER (WHERE job.status = 'PUBLISHED') AS published,
            count(*) FILTER (WHERE job.status IN ('FAILED', 'RECONCILIATION_REQUIRED')) AS failed,
            count(*) FILTER (WHERE job.status = 'CANCELLED') AS cancelled
          FROM publication_jobs job JOIN affected ON affected.campaign_id = job.campaign_id
          GROUP BY job.campaign_id
        )
        UPDATE campaigns SET status = CASE
            WHEN totals.failed > 0 AND totals.published = 0 THEN 'FAILED'::campaign_status
            WHEN totals.failed > 0 THEN 'PARTIALLY_FAILED'::campaign_status
            WHEN totals.published > 0 THEN 'COMPLETED'::campaign_status
            WHEN totals.cancelled > 0 THEN 'CANCELLED'::campaign_status
            ELSE campaigns.status
          END,
          updated_at = now()
        FROM totals
        WHERE campaigns.organization_id = ${account.organization_id}
          AND campaigns.id = totals.campaign_id AND totals.pending = 0
          AND campaigns.origin <> 'LOOP' AND campaigns.status IN ('SCHEDULED', 'RUNNING', 'PAUSED')
      `;
    }

    const confirmationCode = randomSecret(18);
    await sql`
      INSERT INTO audit_logs (organization_id, event_type, entity_type, entity_id, metadata_json)
      VALUES (
        ${account?.organization_id ?? null}, 'DATA_DELETION_REQUESTED', 'instagram_account', ${account?.id ?? null},
        ${JSON.stringify({ confirmationCode, appScopedHash, eventHash, issuedAt: payload.issued_at, completed: true })}::jsonb
      )
    `;
    return confirmationCode;
  });
  return { confirmationCode: result, url: `${getEnv().APP_URL}/data-deletion?code=${encodeURIComponent(result)}` };
}

export async function findDeletionStatus(code: string) {
  if (!/^[A-Za-z0-9_-]{24}$/.test(code)) return null;
  const [row] = await getSqlClient()<Array<{ created_at: Date; metadata_json: { completed?: boolean } }>>`
    SELECT created_at, metadata_json FROM audit_logs
    WHERE event_type = 'DATA_DELETION_REQUESTED' AND metadata_json->>'confirmationCode' = ${code}
    ORDER BY created_at DESC LIMIT 1
  `;
  return row ? { completed: row.metadata_json.completed === true, requestedAt: row.created_at } : null;
}
