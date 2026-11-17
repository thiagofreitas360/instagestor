import { describe, expect, it } from "vitest";
import { recentDays } from "@/jobs/insights-sync";

describe("dias do sync", () => {
  it("usa a data no fuso da organização e devolve hoje, ontem e anteontem", () => {
    const now = new Date("2026-09-11T23:30:00-03:00"); // 2026-09-12T02:30Z
    expect(recentDays(now, "America/Sao_Paulo")).toEqual(["2026-09-11", "2026-09-10", "2026-09-09"]);
    expect(recentDays(new Date("2026-09-12T00:00:00-03:00"), "America/Sao_Paulo", 1)).toEqual(["2026-09-12"]);
    expect(recentDays(now, "UTC", 1)).toEqual(["2026-09-12"]);
  });
});
