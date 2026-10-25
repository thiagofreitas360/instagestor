import { describe, expect, it } from "vitest";
import { activityPeriodRange } from "@/lib/account-activity";

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
