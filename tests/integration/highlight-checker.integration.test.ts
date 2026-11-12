import { describe, expect, it } from "vitest";
import { getSqlClient } from "@/db/client";
import {
  finishHighlightCheck,
  highlightCheckStatus,
  organizationForCheckerKey,
  pendingHighlightChecks,
  recordHighlightCheck,
  requestHighlightCheck,
  rotateCheckerKey,
} from "@/server/highlight-checker";
import { createAccounts, createOrganization, TEST_ORGANIZATION_ID } from "./helpers";

const OTHER_ORGANIZATION_ID = "00000000-0000-4000-8000-000000000002";

describe("conferidor de destaques", () => {
  it("chave identifica só a própria organização e baixar de novo invalida a anterior", async () => {
    await createOrganization(TEST_ORGANIZATION_ID);
    await createOrganization(OTHER_ORGANIZATION_ID);
    const first = await rotateCheckerKey(TEST_ORGANIZATION_ID);
    const other = await rotateCheckerKey(OTHER_ORGANIZATION_ID);
    await expect(organizationForCheckerKey(first)).resolves.toBe(TEST_ORGANIZATION_ID);
    await expect(organizationForCheckerKey(other)).resolves.toBe(OTHER_ORGANIZATION_ID);

    const second = await rotateCheckerKey(TEST_ORGANIZATION_ID);
    await expect(organizationForCheckerKey(first)).resolves.toBeNull();
    await expect(organizationForCheckerKey(second)).resolves.toBe(TEST_ORGANIZATION_ID);
    await expect(highlightCheckStatus(TEST_ORGANIZATION_ID)).resolves.toMatchObject({ has_key: true, online: true });
  });

  it("sem conferidor baixado não abre rodada", async () => {
    await createAccounts(2, "sem_chave");
    await expect(requestHighlightCheck(TEST_ORGANIZATION_ID)).resolves.toBe(false);
    await expect(pendingHighlightChecks(TEST_ORGANIZATION_ID)).resolves.toEqual([]);
  });

  it("rodada entrega só as contas conectadas que faltam, continua de onde parou e termina sozinha", async () => {
    const [first, second, third, disconnected] = await createAccounts(4, "destaque");
    await getSqlClient()`UPDATE instagram_accounts SET status = 'DISCONNECTED' WHERE id = ${disconnected.id}`;
    const [foreign] = await createAccounts(1, "outra", OTHER_ORGANIZATION_ID);
    await rotateCheckerKey(TEST_ORGANIZATION_ID);
    await rotateCheckerKey(OTHER_ORGANIZATION_ID);
    // Resultado de uma rodada anterior não conta para a nova.
    await recordHighlightCheck(TEST_ORGANIZATION_ID, first.id, 5, null);

    await expect(requestHighlightCheck(TEST_ORGANIZATION_ID)).resolves.toBe(true);
    await expect(requestHighlightCheck(TEST_ORGANIZATION_ID)).resolves.toBe(false);
    await expect(pendingHighlightChecks(TEST_ORGANIZATION_ID)).resolves.toEqual(
      [first, second, third].map(({ id, username }) => ({ id, username })),
    );
    await expect(pendingHighlightChecks(OTHER_ORGANIZATION_ID)).resolves.toEqual([]);

    await recordHighlightCheck(TEST_ORGANIZATION_ID, first.id, 3, null);
    // Outra organização não grava resultado em conta alheia.
    await recordHighlightCheck(OTHER_ORGANIZATION_ID, second.id, 0, null);
    await expect(pendingHighlightChecks(TEST_ORGANIZATION_ID)).resolves.toEqual(
      [second, third].map(({ id, username }) => ({ id, username })),
    );
    await expect(highlightCheckStatus(TEST_ORGANIZATION_ID)).resolves.toMatchObject({ running: true, run_total: 3, done: 1 });

    await recordHighlightCheck(TEST_ORGANIZATION_ID, second.id, 0, null);
    await recordHighlightCheck(TEST_ORGANIZATION_ID, third.id, 2, "Perfil não encontrado no Instagram");
    await expect(pendingHighlightChecks(TEST_ORGANIZATION_ID)).resolves.toEqual([]);
    await expect(highlightCheckStatus(TEST_ORGANIZATION_ID)).resolves.toMatchObject({
      running: false, run_total: 3, done: 3, missing: 1, failed: 1, run_error: null,
    });
    const [thirdRow] = await getSqlClient()<{ highlight_count: number | null }[]>`
      SELECT highlight_count FROM instagram_accounts WHERE id = ${third.id}
    `;
    expect(thirdRow.highlight_count).toBeNull();
    const [foreignRow] = await getSqlClient()<{ highlight_checked_at: Date | null }[]>`
      SELECT highlight_checked_at FROM instagram_accounts WHERE id = ${foreign.id}
    `;
    expect(foreignRow.highlight_checked_at).toBeNull();
  });

  it("parada no meio encerra a rodada com o motivo e libera uma nova", async () => {
    await createAccounts(2, "parada");
    await rotateCheckerKey(TEST_ORGANIZATION_ID);
    await requestHighlightCheck(TEST_ORGANIZATION_ID);
    await finishHighlightCheck(TEST_ORGANIZATION_ID, "O Instagram pediu uma pausa nas consultas (código 429).");

    await expect(pendingHighlightChecks(TEST_ORGANIZATION_ID)).resolves.toEqual([]);
    await expect(highlightCheckStatus(TEST_ORGANIZATION_ID)).resolves.toMatchObject({
      running: false, done: 0, run_error: "O Instagram pediu uma pausa nas consultas (código 429).",
    });
    await expect(requestHighlightCheck(TEST_ORGANIZATION_ID)).resolves.toBe(true);
    await expect(pendingHighlightChecks(TEST_ORGANIZATION_ID)).resolves.toHaveLength(2);
  });
});
