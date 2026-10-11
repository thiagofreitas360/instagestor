import { describe, expect, it } from "vitest";
import { accountActivity, activityDuration, type AccountActivityDates } from "@/lib/account-activity";

const start = "2026-10-01T02:30:00Z";
const account: AccountActivityDates = {
  status: "CONNECTED", instagram_user_id: "instagram-1", created_at: start, authorized_at: start,
  active_started_at: start, active_ended_at: null, active_timing_estimated: false,
  disconnected_at: null, banned_at: null,
};

describe("atividade da conta", () => {
  it("conta 24 horas completas, sem depender da meia-noite local", () => {
    expect(accountActivity(account, new Date("2026-10-01T04:00:00Z")).days).toBe(0);
    expect(accountActivity(account, new Date("2026-10-02T02:29:59Z")).days).toBe(0);
    expect(accountActivity(account, new Date("2026-10-02T02:30:00Z")).days).toBe(1);
    expect(activityDuration(0)).toBe("Menos de 1 dia");
    expect(activityDuration(1)).toBe("1 dia");
  });

  it("congela o período encerrado e aceita Date ou string", () => {
    const closed = { ...account, status: "BANNED", active_ended_at: "2026-10-06T02:30:00Z" };
    expect(accountActivity(closed, new Date("2026-10-10T02:30:00Z")).days).toBe(5);
    expect(accountActivity({ ...closed, active_started_at: new Date(start), active_ended_at: new Date(closed.active_ended_at) },
      new Date("2026-10-11T02:30:00Z"))).toEqual(accountActivity(closed, new Date("2026-10-10T02:30:00Z")));
  });

  it.each([
    { active_started_at: "inválida" },
    { active_started_at: "2027-01-01T00:00:00Z" },
    { active_ended_at: "inválida" },
    { active_ended_at: "2026-09-30T00:00:00Z" },
    { active_ended_at: "2027-01-01T00:00:00Z" },
  ])("não inventa duração para datas inválidas ou futuras: %j", (dates) => {
    expect(accountActivity({ ...account, ...dates }, new Date("2026-10-10T00:00:00Z")).days).toBeNull();
  });

  it("identifica estimativas legadas e não estende atividade até um banimento posterior", () => {
    const legacy = { ...account, status: "BANNED", active_started_at: null, active_timing_estimated: true,
      disconnected_at: "2026-10-03T02:30:00Z", banned_at: "2026-10-08T02:30:00Z" };
    expect(accountActivity(legacy, new Date("2026-10-10T00:00:00Z"))).toMatchObject({ days: 2, estimated: true });
    expect(accountActivity({ ...legacy, disconnected_at: null, banned_at: null }).days).toBeNull();
  });

  it("não reconstitui atividade de conta anonimizada", () => {
    expect(accountActivity({ ...account, instagram_user_id: "deleted_123" })).toMatchObject({ startedAt: null, endedAt: null, days: null });
  });
});
