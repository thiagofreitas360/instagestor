import { describe, expect, it } from "vitest";
import { buildRecurringSlots, effectiveLoopLimits, nextLoopScheduleAt } from "@/server/automation";

describe("automation scheduling", () => {
  it("moves the next loop job to the following local day after the daily limit", () => {
    const scheduledAt = nextLoopScheduleAt({
      completedAt: new Date("2026-10-04T02:50:00.000Z"),
      timezone: "America/Sao_Paulo",
      publishedToday: 10,
      dailyLimit: 10,
      minIntervalMinutes: 30,
      maxIntervalMinutes: 60,
      random: () => 30,
    });
    expect(scheduledAt.toISOString()).toBe("2026-10-04T03:30:00.000Z");
  });

  it("builds only future slots on the selected local weekdays", () => {
    const slots = buildRecurringSlots({
      startDate: "2030-01-07",
      endDate: "2030-01-09",
      times: ["09:00", "18:30"],
      daysOfWeek: [1, 3],
      timezone: "America/Sao_Paulo",
      now: new Date("2030-01-01T00:00:00.000Z"),
    });
    expect(slots.map((slot) => slot.toISOString())).toEqual([
      "2030-01-07T12:00:00.000Z",
      "2030-01-07T21:30:00.000Z",
      "2030-01-09T12:00:00.000Z",
      "2030-01-09T21:30:00.000Z",
    ]);
  });

  it("uses follower-tier limits only for accounts with a synchronized count in range", () => {
    const input = {
      tieredLimits: true,
      tierFollowerThreshold: 10_000,
      dailyLimitPerAccount: 40,
      minIntervalMinutes: 20,
      maxIntervalMinutes: 40,
      tier1DailyLimit: 10,
      tier1MinIntervalMinutes: 60,
      tier1MaxIntervalMinutes: 120,
    };
    expect(effectiveLoopLimits({ ...input, followerCount: 9_999 })).toEqual({
      dailyLimit: 10,
      minIntervalMinutes: 60,
      maxIntervalMinutes: 120,
    });
    expect(effectiveLoopLimits({ ...input, followerCount: null })).toEqual({
      dailyLimit: 40,
      minIntervalMinutes: 20,
      maxIntervalMinutes: 40,
    });
  });
});
