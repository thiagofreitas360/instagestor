import { describe, expect, it } from "vitest";
import { activityPeriodRange, customPeriodRange, inDateRange } from "@/lib/account-activity";

describe("customPeriodRange", () => {
  it("converte de/até em dias locais, aceita extremo aberto e ignora datas inválidas", () => {
    expect(customPeriodRange("2026-10-20", "2026-10-22", "America/Sao_Paulo"))
      .toEqual({ from: new Date("2026-10-20T03:00:00Z"), to: new Date("2026-10-23T03:00:00Z") });
    expect(customPeriodRange("2026-10-20", "", "America/Sao_Paulo")).toEqual({ from: new Date("2026-10-20T03:00:00Z"), to: undefined });
    expect(customPeriodRange("", "lixo", "America/Sao_Paulo")).toBeUndefined();
  });

  it("inDateRange trata intervalo ausente como tudo e exige data dentro de [from, to)", () => {
    const range = customPeriodRange("2026-10-20", "2026-10-20", "America/Sao_Paulo");
    expect(inDateRange(null, undefined)).toBe(true);
    expect(inDateRange(null, range)).toBe(false);
    expect(inDateRange(new Date("2026-10-21T02:59:59Z"), range)).toBe(true);
    expect(inDateRange(new Date("2026-10-21T03:00:00Z"), range)).toBe(false);
  });
});

describe("activityPeriodRange", () => {
  // 23/10 às 23:30 em São Paulo (UTC-3): o dia local ainda é 23.
  const now = new Date("2026-10-24T02:30:00Z");

  it("usa o dia local do fuso para hoje e ontem", () => {
    expect(activityPeriodRange("hoje", "America/Sao_Paulo", now))
      .toEqual({ from: new Date("2026-10-23T03:00:00Z"), to: new Date("2026-10-24T03:00:00Z") });
    expect(activityPeriodRange("ontem", "America/Sao_Paulo", now))
      .toEqual({ from: new Date("2026-10-22T03:00:00Z"), to: new Date("2026-10-23T03:00:00Z") });
  });

  it("inclui hoje nas janelas de 7 e 30 dias", () => {
    expect(activityPeriodRange("7d", "America/Sao_Paulo", now))
      .toEqual({ from: new Date("2026-10-17T03:00:00Z"), to: new Date("2026-10-24T03:00:00Z") });
    expect(activityPeriodRange("30d", "America/Sao_Paulo", now).from).toEqual(new Date("2026-09-24T03:00:00Z"));
  });
});
