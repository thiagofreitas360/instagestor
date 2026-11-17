import { describe, expect, it } from "vitest";
import { deltaPercent, resolvePeriod } from "@/server/analytics";
import { linePath, scaleY } from "@/components/charts";
import { formatNumber } from "@/components/ui";

describe("resolvePeriod", () => {
  it("fecha em hoje no fuso da organização e calcula o período anterior de mesmo tamanho", () => {
    // 22h em Brasília já é dia 12 em UTC, mas ainda é dia 11 aqui.
    const period = resolvePeriod(7, "America/Sao_Paulo", new Date("2026-09-11T22:00:00-03:00"));
    expect(period).toEqual({
      days: 7, timezone: "America/Sao_Paulo", from: "2026-09-05", to: "2026-09-11", previousFrom: "2026-08-29", previousTo: "2026-09-04",
    });
  });

  it("hoje e ontem são um dia só e viram à meia-noite de Brasília", () => {
    const tz = "America/Sao_Paulo";
    const lateNight = new Date("2026-09-11T23:59:00-03:00");
    expect(resolvePeriod(1, tz, lateNight)).toMatchObject({ from: "2026-09-11", to: "2026-09-11", previousFrom: "2026-09-10", previousTo: "2026-09-10" });
    expect(resolvePeriod(1, tz, lateNight, 1)).toMatchObject({ from: "2026-09-10", to: "2026-09-10", previousFrom: "2026-09-09", previousTo: "2026-09-09" });
    expect(resolvePeriod(1, tz, new Date("2026-09-12T00:00:00-03:00"))).toMatchObject({ from: "2026-09-12", to: "2026-09-12" });
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

describe("gráfico de linha", () => {
  it("escala valores no eixo e pula pontos nulos", () => {
    expect(scaleY(0, 100, 200, 10)).toBe(190);
    expect(scaleY(100, 100, 200, 10)).toBe(10);
    expect(linePath([0, 100, null, 50], 300, 200, 10)).toBe("M10,190 L103.33,10 M290,100");
  });
});

describe("formatNumber", () => {
  it("formata em pt-BR e usa travessão para nulo", () => {
    expect(formatNumber(1234567)).toBe("1.234.567");
    expect(formatNumber(null)).toBe("—");
  });
});
