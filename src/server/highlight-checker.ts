import { getSqlClient } from "@/db/client";
import { randomSecret, sha256 } from "@/lib/crypto";

// Conferidor de destaques: programa no PC de cada organização (public/conferidor.mjs) que abre o perfil
// público de cada conta conectada, logado numa conta de Instagram só para isso. A API oficial não expõe destaques.

/** Gera a chave embutida no programa baixado; a anterior deixa de valer. */
export async function rotateCheckerKey(organizationId: string) {
  const key = randomSecret();
  await getSqlClient()`
    INSERT INTO highlight_checkers (organization_id, key_hash) VALUES (${organizationId}, ${sha256(key)})
    ON CONFLICT (organization_id) DO UPDATE SET key_hash = excluded.key_hash
  `;
  return key;
}

/** Organização dona da chave; cada chamada do programa conta como sinal de que ele está ligado. */
export async function organizationForCheckerKey(key: string) {
  const [row] = await getSqlClient()<{ organization_id: string }[]>`
    UPDATE highlight_checkers SET seen_at = now() WHERE key_hash = ${sha256(key)} RETURNING organization_id
  `;
  return row?.organization_id ?? null;
}

/** Botão "Conferir destaques": abre uma rodada com as contas conectadas, a menos que já haja uma aberta. */
export async function requestHighlightCheck(organizationId: string) {
  const [row] = await getSqlClient()<{ started: boolean }[]>`
    UPDATE highlight_checkers SET run_started_at = now(), run_finished_at = NULL, run_error = NULL,
      run_total = (SELECT count(*) FROM instagram_accounts
        WHERE organization_id = ${organizationId} AND status IN ('CONNECTED', 'TOKEN_EXPIRING'))
    WHERE organization_id = ${organizationId} AND key_hash IS NOT NULL
      AND (run_started_at IS NULL OR run_finished_at IS NOT NULL)
    RETURNING true AS started
  `;
  return Boolean(row?.started);
}

/** Encerra a rodada aberta; as contas que faltavam ficam com o resultado anterior. */
export async function finishHighlightCheck(organizationId: string, error: string | null) {
  await getSqlClient()`
    UPDATE highlight_checkers SET run_finished_at = now(), run_error = ${error?.slice(0, 300) ?? null}
    WHERE organization_id = ${organizationId} AND run_started_at IS NOT NULL AND run_finished_at IS NULL
  `;
}

/**
 * Contas que faltam conferir na rodada aberta. Faltar nenhuma encerra a rodada no mesmo comando, e o
 * programa fechado no meio continua de onde parou porque só recebe as que ainda não foram conferidas.
 */
export async function pendingHighlightChecks(organizationId: string) {
  return getSqlClient()<{ id: string; username: string }[]>`
    WITH run AS (
      SELECT run_started_at FROM highlight_checkers
      WHERE organization_id = ${organizationId} AND run_started_at IS NOT NULL AND run_finished_at IS NULL
    ), pending AS (
      SELECT account.id, account.username FROM instagram_accounts account, run
      WHERE account.organization_id = ${organizationId} AND account.status IN ('CONNECTED', 'TOKEN_EXPIRING')
        AND (account.highlight_checked_at IS NULL OR account.highlight_checked_at < run.run_started_at)
    ), finished AS (
      UPDATE highlight_checkers SET run_finished_at = now()
      WHERE organization_id = ${organizationId} AND run_finished_at IS NULL
        AND run_started_at IN (SELECT run_started_at FROM run) AND NOT EXISTS (SELECT 1 FROM pending)
    )
    SELECT id, username FROM pending ORDER BY username
  `;
}

export async function recordHighlightCheck(organizationId: string, accountId: string, highlightCount: number | null, error: string | null) {
  await getSqlClient()`
    UPDATE instagram_accounts
    SET highlight_count = ${error ? null : highlightCount}, highlight_check_error = ${error?.slice(0, 300) ?? null},
      highlight_checked_at = now()
    WHERE organization_id = ${organizationId} AND id = ${accountId}
  `;
}

export type HighlightCheckStatus = {
  has_key: boolean;
  online: boolean;
  running: boolean;
  run_started_at: Date | null;
  run_finished_at: Date | null;
  run_total: number;
  run_error: string | null;
  done: number;
  missing: number;
  failed: number;
};

/** Situação para o painel; null = organização nunca baixou o conferidor. */
export async function highlightCheckStatus(organizationId: string) {
  const [row] = await getSqlClient()<HighlightCheckStatus[]>`
    SELECT checker.key_hash IS NOT NULL AS has_key,
      coalesce(checker.seen_at > now() - interval '2 minutes', false) AS online,
      (checker.run_started_at IS NOT NULL AND checker.run_finished_at IS NULL) AS running,
      checker.run_started_at, checker.run_finished_at, checker.run_total, checker.run_error,
      coalesce(stats.done, 0)::int AS done, coalesce(stats.missing, 0)::int AS missing, coalesce(stats.failed, 0)::int AS failed
    FROM highlight_checkers checker
    LEFT JOIN LATERAL (
      SELECT count(*) AS done,
        count(*) FILTER (WHERE account.highlight_count = 0) AS missing,
        count(*) FILTER (WHERE account.highlight_check_error IS NOT NULL) AS failed
      FROM instagram_accounts account
      WHERE account.organization_id = checker.organization_id AND account.highlight_checked_at >= checker.run_started_at
    ) stats ON true
    WHERE checker.organization_id = ${organizationId}
  `;
  return row ?? null;
}
