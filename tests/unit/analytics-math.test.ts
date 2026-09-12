import { describe, expect, it } from "vitest";
import { deltaPercent, resolvePeriod } from "@/server/analytics";

describe("resolvePeriod", () => {
  it("fecha em hoje UTC e calcula o período anterior de mesmo tamanho", () => {
    const period = resolvePeriod(7, new Date("2026-09-11T22:00:00-03:00"));
    expect(period).toEqual({
      days: 7, from: "2026-09-06", to: "2026-09-12", previousFrom: "2026-08-30", previousTo: "2026-09-05",
    });
  });
});

describe("deltaPercent", () => {
  it("calcula variação relativa e devolve null sem base", () => {
    expect(deltaPercent(120, 100)).toBe(20);
    expect(deltaPercent(80, 100)).toBe(-20);
    expect(deltaPercent(5, 0)).toBeNull();
    expect(deltaPercent(0, 0)).toBeNull();
  });
});
