import { describe, expect, it, vi } from "vitest";
import { buildSchedule, localDateTimeToUtc } from "@/server/scheduler";

describe("buildSchedule", () => {
  it("gera intervalos fixos cumulativos a partir do horário inicial", () => {
    const startAt = new Date("2026-09-01T21:00:00.000Z");

    const schedule = buildSchedule(startAt, 4, { mode: "FIXED", fixedSeconds: 90 });

    expect(schedule.map((date) => date.toISOString())).toEqual([
      "2026-09-01T21:00:00.000Z",
      "2026-09-01T21:01:30.000Z",
      "2026-09-01T21:03:00.000Z",
      "2026-09-01T21:04:30.000Z",
    ]);
    expect(schedule[0]).not.toBe(startAt);
  });

  it("gera intervalos aleatórios inclusivos e determinísticos com RNG injetado", () => {
    const random = vi.fn().mockReturnValueOnce(120).mockReturnValueOnce(300).mockReturnValueOnce(180);

    const schedule = buildSchedule(
      new Date("2026-09-01T21:00:00.000Z"),
      4,
      { mode: "RANDOM", minSeconds: 120, maxSeconds: 300 },
      random,
    );

    expect(random.mock.calls).toEqual([
      [120, 301],
      [120, 301],
      [120, 301],
    ]);
    expect(schedule.map((date) => date.toISOString())).toEqual([
      "2026-09-01T21:00:00.000Z",
      "2026-09-01T21:02:00.000Z",
      "2026-09-01T21:07:00.000Z",
      "2026-09-01T21:10:00.000Z",
    ]);
  });

  it("rejeita quantidade e intervalos inválidos", () => {
    const startAt = new Date("2026-09-01T21:00:00.000Z");

    expect(() => buildSchedule(startAt, 0, { mode: "FIXED", fixedSeconds: 60 })).toThrow();
    expect(() => buildSchedule(startAt, 2, { mode: "FIXED", fixedSeconds: -1 })).toThrow();
    expect(() => buildSchedule(startAt, 2, { mode: "RANDOM", minSeconds: 1, maxSeconds: 2 }, () => 1.5)).toThrow();
  });
});

describe("localDateTimeToUtc", () => {
  it("interpreta o horário informado no timezone da campanha e persiste em UTC", () => {
    expect(localDateTimeToUtc("2026-09-01T18:00:00", "America/Sao_Paulo").toISOString()).toBe(
      "2026-09-01T21:00:00.000Z",
    );
  });

  it("respeita timezones com offset diferente para o mesmo horário local", () => {
    expect(localDateTimeToUtc("2026-09-01T18:00:00", "UTC").toISOString()).toBe("2026-09-01T18:00:00.000Z");
    expect(localDateTimeToUtc("2026-09-01T18:00:00", "Asia/Tokyo").toISOString()).toBe(
      "2026-09-01T09:00:00.000Z",
    );
  });

  it("rejeita data ou timezone inválido", () => {
    expect(() => localDateTimeToUtc("não-é-uma-data", "America/Sao_Paulo")).toThrow();
    expect(() => localDateTimeToUtc("2026-09-01T18:00:00", "Timezone/Inexistente")).toThrow();
  });
});
