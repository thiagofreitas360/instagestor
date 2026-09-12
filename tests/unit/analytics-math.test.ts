import { describe, expect, it } from "vitest";
import { deltaPercent, resolvePeriod } from "@/server/analytics";
import { linePath, scaleY } from "@/components/charts";
import { formatNumber } from "@/components/ui";

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
