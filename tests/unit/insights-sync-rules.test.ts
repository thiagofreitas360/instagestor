import { describe, expect, it } from "vitest";
import { recentDays, utcDay } from "@/jobs/insights-sync";

describe("dias do sync", () => {
  it("usa data UTC e devolve hoje, ontem e anteontem", () => {
    const now = new Date("2026-09-11T23:30:00-03:00"); // 2026-09-12T02:30Z
    expect(utcDay(now)).toBe("2026-09-12");
    expect(recentDays(now)).toEqual(["2026-09-12", "2026-09-11", "2026-09-10"]);
    expect(recentDays(now, 1)).toEqual(["2026-09-12"]);
  });
});
