import { accountActivity, type AccountActivityDates } from "./account-activity";

/** Como a conta foi conectada: por uma pessoa (MANUAL) ou por automação (AUTO). Nulo = não informado. */
export const CONNECTION_MODES = { MANUAL: "Manual", AUTO: "Automática" } as const;
export type ConnectionMode = keyof typeof CONNECTION_MODES;

export function connectionModeLabel(mode: ConnectionMode | null | undefined) {
  return mode ? CONNECTION_MODES[mode] : "Não informada";
}

export type ReconnectStatsRow = { mode: ConnectionMode | null; connected: number; reauth: number; percent: number | null };

/**
 * Por tipo de conexão: quantas contas começaram a funcionar no período (mesma data do filtro "Conectadas em")
 * e quantas delas pedem reconexão agora. Sem período, considera todas as contas.
 */
export function reconnectStatsByMode(
  accounts: Array<AccountActivityDates & { connection_mode: ConnectionMode | null }>,
  range?: { from: Date; to: Date },
): { rows: ReconnectStatsRow[]; total: ReconnectStatsRow } {
  const cohort = accounts.filter((account) => {
    const startedAt = accountActivity(account).startedAt;
    return startedAt !== null && (!range || (startedAt >= range.from && startedAt < range.to));
  });
  const summarize = (mode: ConnectionMode | null, group: typeof cohort): ReconnectStatsRow => {
    const reauth = group.filter((account) => account.status === "REAUTH_REQUIRED").length;
    return { mode, connected: group.length, reauth, percent: group.length ? Math.round((reauth / group.length) * 100) : null };
  };
  const modes: Array<ConnectionMode | null> = [...(Object.keys(CONNECTION_MODES) as ConnectionMode[]), null];
  const rows = modes
    .map((mode) => summarize(mode, cohort.filter((account) => account.connection_mode === mode)))
    .filter((row) => row.mode !== null || row.connected > 0);
  return { rows, total: summarize(null, cohort) };
}
