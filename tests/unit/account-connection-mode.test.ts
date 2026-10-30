import { describe, expect, it } from "vitest";
import { reconnectStatsByMode, type ConnectionMode } from "@/lib/account-connection-mode";

let sequence = 0;
function account(mode: ConnectionMode | null, status: string, startedAt: string, deleted = false) {
  sequence += 1;
  return {
    instagram_user_id: `${deleted ? "deleted_" : "ig-"}${sequence}`, connection_mode: mode, status,
    created_at: startedAt, authorized_at: startedAt, active_started_at: startedAt, active_ended_at: null,
    active_timing_estimated: false, disconnected_at: null, banned_at: null,
  };
}

const yesterday = "2026-10-29T12:00:00Z";
const lastWeek = "2026-10-22T12:00:00Z";

describe("reconnectStatsByMode", () => {
  it("conta conectadas e pedindo reconexão por tipo, com percentual e total", () => {
    const stats = reconnectStatsByMode([
      account("MANUAL", "CONNECTED", yesterday), account("MANUAL", "CONNECTED", yesterday), account("MANUAL", "REAUTH_REQUIRED", yesterday),
      account("AUTO", "REAUTH_REQUIRED", yesterday), account("AUTO", "REAUTH_REQUIRED", yesterday),
      account(null, "CONNECTED", yesterday),
    ]);
    expect(stats.rows).toEqual([
      { mode: "MANUAL", connected: 3, reauth: 1, percent: 33 },
      { mode: "AUTO", connected: 2, reauth: 2, percent: 100 },
      { mode: null, connected: 1, reauth: 0, percent: 0 },
    ]);
    expect(stats.total).toEqual({ mode: null, connected: 6, reauth: 3, percent: 50 });
  });

  it("restringe ao período de conexão, omite 'não informada' vazia e ignora contas apagadas", () => {
    const range = { from: new Date("2026-10-29T03:00:00Z"), to: new Date("2026-10-30T03:00:00Z") };
    const stats = reconnectStatsByMode([
      account("AUTO", "REAUTH_REQUIRED", yesterday), account("AUTO", "CONNECTED", lastWeek),
      account("MANUAL", "REAUTH_REQUIRED", lastWeek), account(null, "CONNECTED", lastWeek),
      account("AUTO", "REAUTH_REQUIRED", yesterday, true),
    ], range);
    expect(stats.rows).toEqual([
      { mode: "MANUAL", connected: 0, reauth: 0, percent: null },
      { mode: "AUTO", connected: 1, reauth: 1, percent: 100 },
    ]);
    expect(stats.total).toEqual({ mode: null, connected: 1, reauth: 1, percent: 100 });
  });
});
