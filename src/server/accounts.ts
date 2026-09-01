import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getSqlClient } from "@/db/client";
import { decryptToken, encryptToken, randomSecret, sha256 } from "@/lib/crypto";
import { asInstagramError } from "@/lib/errors";
import { getEnv } from "@/lib/env";
import { getInstagramProvider, MetaInstagramProvider } from "@/providers";
import { markAccountUnavailableIfCurrent } from "@/jobs/account-availability";
import { audit } from "./auth";

export async function createFakeAccounts(count: number, actorUserId: string) {
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
    };
  });
  return getSqlClient().begin(async (sql) => {
    const created = await sql<{ id: string }[]>`INSERT INTO instagram_accounts ${sql(rows)} RETURNING id`;
    await sql`
      INSERT INTO audit_logs (actor_user_id, event_type, entity_type, metadata_json)
      VALUES (${actorUserId}, 'ACCOUNT_CONNECTED', 'instagram_account', ${JSON.stringify({ fake: true, count })}::jsonb)
    `;
    return created.map((account) => account.id);
  });
}

export async function disconnectAccount(accountId: string, actorUserId: string) {
  await getSqlClient().begin(async (sql) => {
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`instagestor:meta:account:${accountId}:0`}, 0))`;
    const [account] = await sql<{ id: string }[]>`
      UPDATE instagram_accounts SET status = 'DISCONNECTED', encrypted_access_token = NULL,
        disconnected_at = now(), updated_at = now() WHERE id = ${accountId} RETURNING id
    `;
    if (!account) throw new Error("Conta não encontrada");
    await sql`
      UPDATE publication_jobs SET status = 'FAILED', last_error_code = 'ACCOUNT_DISCONNECTED',
        last_error_type = 'AUTH', last_error_message = 'Conta desconectada', finished_at = now(),
        locked_at = NULL, locked_by = NULL, lock_expires_at = NULL,
        fencing_token = fencing_token + 1, updated_at = now()
      WHERE instagram_account_id = ${accountId}
        AND status IN ('QUEUED', 'RETRY_WAIT', 'CLAIMED', 'CREATING_CONTAINER', 'WAITING_FOR_CONTAINER', 'READY_TO_PUBLISH')
    `;
    await sql`
      UPDATE publication_jobs SET status = 'RECONCILIATION_REQUIRED', reconciliation_required = true,
        last_error_code = 'ACCOUNT_DISCONNECTED_DURING_PUBLISH', last_error_type = 'AMBIGUOUS',
        last_error_message = 'Conta desconectada durante publicação; verificação manual obrigatória',
        finished_at = now(), locked_at = NULL, locked_by = NULL, lock_expires_at = NULL,
        fencing_token = fencing_token + 1, updated_at = now()
      WHERE instagram_account_id = ${accountId} AND status = 'PUBLISHING'
    `;
    await sql`
      WITH affected AS (
        SELECT campaign_id FROM publication_jobs WHERE instagram_account_id = ${accountId} GROUP BY campaign_id
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
      WHERE campaigns.id = totals.campaign_id AND totals.pending = 0
        AND campaigns.status IN ('SCHEDULED', 'RUNNING', 'PAUSED')
    `;
    await sql`
      INSERT INTO audit_logs (actor_user_id, event_type, entity_type, entity_id)
      VALUES (${actorUserId}, 'ACCOUNT_DISCONNECTED', 'instagram_account', ${accountId})
    `;
  });
}

export async function verifyAccount(accountId: string) {
  const [account] = await getSqlClient()<
    Array<{ instagram_user_id: string; encrypted_access_token: string | null; status: string }>
  >`SELECT instagram_user_id, encrypted_access_token, status FROM instagram_accounts WHERE id = ${accountId}`;
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
      WHERE id = ${accountId} AND encrypted_access_token = ${account.encrypted_access_token}
        AND status = ${account.status}
      RETURNING id
    `;
    return updated.length > 0;
  } catch (rawError) {
    const error = asInstagramError(rawError);
    const updated = error.kind === "AUTH"
      ? await markAccountUnavailableIfCurrent({
          accountId,
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
          WHERE id = ${accountId} AND encrypted_access_token = ${account.encrypted_access_token}
            AND status = ${account.status}
          RETURNING id
        `).length > 0;
    if (!updated) return false;
    throw error;
  }
}

export async function createOauthState() {
  if (getEnv().INSTAGRAM_PROVIDER !== "meta") throw new Error("OAuth real requer INSTAGRAM_PROVIDER=meta");
  const state = randomSecret(32);
  await getSqlClient()`
    INSERT INTO oauth_states (nonce_hash, expires_at) VALUES (${sha256(state)}, now() + interval '10 minutes')
  `;
  return state;
}

export async function consumeOauthState(state: string) {
  const [valid] = await getSqlClient()<{ id: string }[]>`
    UPDATE oauth_states SET used_at = now()
    WHERE nonce_hash = ${sha256(state)} AND used_at IS NULL AND expires_at > now()
    RETURNING id
  `;
  if (!valid) throw new Error("OAuth state inválido, expirado ou já utilizado");
}

export async function connectFromAuthorizationCode(code: string, state: string) {
  await consumeOauthState(state);
  const provider = new MetaInstagramProvider();
  const exchanged = await provider.exchangeAuthorizationCode(code);
  const profile = await provider.getProfile(exchanged.accessToken);
  const encrypted = encryptToken(exchanged.accessToken);
  const [account] = await getSqlClient()<{ id: string; inserted: boolean }[]>`
    INSERT INTO instagram_accounts (
      instagram_user_id, app_scoped_user_id, username, display_name, profile_picture_url, account_type,
      status, encrypted_access_token, authorized_at, token_expires_at, token_last_refreshed_at, token_last_checked_at,
      last_successful_api_call_at, disconnected_at
    ) VALUES (
      ${profile.id}, ${profile.appScopedUserId ?? exchanged.appScopedUserId}, ${profile.username},
      ${profile.displayName ?? null}, ${profile.profilePictureUrl ?? null}, ${profile.accountType ?? null},
      'CONNECTED', ${encrypted}, now(), now() + ${exchanged.expiresIn} * interval '1 second', now(), now(), now(), NULL
    )
    ON CONFLICT (instagram_user_id) DO UPDATE SET
      app_scoped_user_id = EXCLUDED.app_scoped_user_id, username = EXCLUDED.username,
      display_name = EXCLUDED.display_name, profile_picture_url = EXCLUDED.profile_picture_url,
      account_type = EXCLUDED.account_type, status = 'CONNECTED',
      encrypted_access_token = EXCLUDED.encrypted_access_token, token_expires_at = EXCLUDED.token_expires_at,
      authorized_at = now(), token_last_refreshed_at = now(), token_last_checked_at = now(), last_successful_api_call_at = now(),
      disconnected_at = NULL, updated_at = now()
    RETURNING id, (xmax = 0) AS inserted
  `;
  await audit(null, account.inserted ? "ACCOUNT_CONNECTED" : "ACCOUNT_RECONNECTED", "instagram_account", account.id);
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
    const [candidate] = await sql<Array<{ id: string }>>`
      SELECT id FROM instagram_accounts WHERE app_scoped_user_id = ${appScopedUserId}
    `;
    if (!candidate) return;
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`instagestor:meta:account:${candidate.id}:0`}, 0))`;
    const [account] = await sql<Array<{ id: string }>>`
      SELECT id FROM instagram_accounts
      WHERE id = ${candidate.id} AND app_scoped_user_id = ${appScopedUserId} FOR UPDATE
    `;
    if (!account) return;

    const [alreadyProcessed] = await sql<Array<{ id: string }>>`
      SELECT id FROM audit_logs
      WHERE event_type IN ('ACCOUNT_DEAUTHORIZED', 'ACCOUNT_DEAUTHORIZATION_IGNORED')
        AND metadata_json->>'eventHash' = ${eventHash}
      LIMIT 1
    `;
    if (alreadyProcessed) return;

    const [disconnected] = await sql<Array<{ id: string }>>`
      UPDATE instagram_accounts SET status = 'DISCONNECTED', encrypted_access_token = NULL,
        disconnected_at = now(), updated_at = now()
      WHERE id = ${account.id}
        AND authorized_at <= to_timestamp(${issuedAt})
      RETURNING id
    `;
    if (!disconnected) {
      await sql`
        INSERT INTO audit_logs (event_type, entity_type, entity_id, metadata_json)
        VALUES (
          'ACCOUNT_DEAUTHORIZATION_IGNORED', 'instagram_account', ${account.id},
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
      WHERE instagram_account_id = ${account.id}
        AND status IN ('QUEUED', 'RETRY_WAIT', 'CLAIMED', 'CREATING_CONTAINER', 'WAITING_FOR_CONTAINER', 'READY_TO_PUBLISH')
    `;
    await sql`
      UPDATE publication_jobs SET status = 'RECONCILIATION_REQUIRED', reconciliation_required = true,
        last_error_code = 'ACCOUNT_DEAUTHORIZED_DURING_PUBLISH', last_error_type = 'AMBIGUOUS',
        last_error_message = 'Conta desautorizada durante publicação; verificação manual obrigatória',
        finished_at = now(), locked_at = NULL, locked_by = NULL, lock_expires_at = NULL,
        fencing_token = fencing_token + 1, updated_at = now()
      WHERE instagram_account_id = ${account.id} AND status = 'PUBLISHING'
    `;
    await sql`
      WITH affected AS (
        SELECT campaign_id FROM publication_jobs WHERE instagram_account_id = ${account.id} GROUP BY campaign_id
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
      WHERE campaigns.id = totals.campaign_id AND totals.pending = 0
        AND campaigns.status IN ('SCHEDULED', 'RUNNING', 'PAUSED')
    `;
    await sql`
      INSERT INTO audit_logs (event_type, entity_type, entity_id, metadata_json)
      VALUES (
        'ACCOUNT_DEAUTHORIZED', 'instagram_account', ${account.id},
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

    const [candidate] = await sql<Array<{ id: string }>>`
      SELECT id FROM instagram_accounts WHERE app_scoped_user_id = ${appScopedUserId}
    `;
    if (candidate) {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`instagestor:meta:account:${candidate.id}:0`}, 0))`;
    }
    const [account] = candidate
      ? await sql<Array<{ id: string }>>`
          SELECT id FROM instagram_accounts
          WHERE id = ${candidate.id} AND app_scoped_user_id = ${appScopedUserId}
          FOR UPDATE
        `
      : [];
    if (account) {
      await sql`DELETE FROM account_group_members WHERE instagram_account_id = ${account.id}`;
      await sql`
        UPDATE publication_jobs SET status = 'CANCELLED', finished_at = now(),
          locked_at = NULL, locked_by = NULL, lock_expires_at = NULL,
          fencing_token = fencing_token + 1, updated_at = now()
        WHERE instagram_account_id = ${account.id}
          AND status IN ('QUEUED', 'RETRY_WAIT', 'CLAIMED', 'CREATING_CONTAINER', 'WAITING_FOR_CONTAINER', 'READY_TO_PUBLISH')
      `;
      await sql`
        UPDATE publication_jobs SET status = 'RECONCILIATION_REQUIRED', reconciliation_required = true,
          last_error_code = 'DATA_DELETION_DURING_PUBLISH', last_error_type = 'AMBIGUOUS',
          last_error_message = 'Exclusão solicitada durante publicação; verificação manual obrigatória',
          finished_at = now(), locked_at = NULL, locked_by = NULL, lock_expires_at = NULL,
          fencing_token = fencing_token + 1, updated_at = now()
        WHERE instagram_account_id = ${account.id} AND status = 'PUBLISHING'
      `;
      await sql`
        UPDATE publication_jobs SET meta_container_id = NULL, meta_child_container_ids = NULL,
          container_started_at = NULL, meta_media_id = NULL,
          last_error_message = CASE WHEN status = 'RECONCILIATION_REQUIRED'
            THEN 'Resultado ambíguo após solicitação de exclusão de dados' ELSE NULL END,
          updated_at = now()
        WHERE instagram_account_id = ${account.id}
      `;
      await sql`
        UPDATE instagram_accounts SET instagram_user_id = 'deleted_' || id::text,
          app_scoped_user_id = NULL, username = 'deleted_' || left(id::text, 8),
          display_name = NULL, profile_picture_url = NULL, account_type = NULL,
          status = 'DISCONNECTED', encrypted_access_token = NULL, token_expires_at = NULL,
          token_last_refreshed_at = NULL, token_last_checked_at = NULL,
          last_successful_api_call_at = NULL, last_error_at = NULL, last_error_code = NULL,
          last_error_message = NULL, publishing_limit_usage = NULL, publishing_limit_total = NULL,
          publishing_limit_checked_at = NULL, disconnected_at = now(), updated_at = now()
        WHERE id = ${account.id}
      `;
      await sql`
        WITH affected AS (
          SELECT campaign_id FROM publication_jobs WHERE instagram_account_id = ${account.id} GROUP BY campaign_id
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
        WHERE campaigns.id = totals.campaign_id AND totals.pending = 0
          AND campaigns.status IN ('SCHEDULED', 'RUNNING', 'PAUSED')
      `;
    }

    const confirmationCode = randomSecret(18);
    await sql`
      INSERT INTO audit_logs (event_type, entity_type, entity_id, metadata_json)
      VALUES (
        'DATA_DELETION_REQUESTED', 'instagram_account', ${account?.id ?? null},
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
