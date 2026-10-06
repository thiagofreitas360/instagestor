import { describe, expect, it } from "vitest";
import { buildRecurringSlots, chooseLoopMedia, effectiveLoopLimits, nextLoopScheduleAt } from "@/server/automation";

const pool = ["v1", "v2", "v3", "v4"].map((id, position) => ({
  id: `rel-${id}`, media_asset_id: id, media_kind: "VIDEO" as const, position,
}));
const pick = (overrides: Partial<Parameters<typeof chooseLoopMedia>[0]>) => chooseLoopMedia({
  media: pool, usedMediaIds: [], noRepeat: false, mediaType: "REELS", imageEveryN: 0, videosSinceImage: 0,
  lastPostedToday: new Map(), usedByOthersToday: new Map(), random: () => 0, ...overrides,
})?.selected.media_asset_id;

describe("loop media choice", () => {
  it("draws at random, skipping what the account posted today and what other accounts already took", () => {
    const lastPostedToday = new Map([["v1", 1]]);
    const usedByOthersToday = new Map([["v2", 1]]);
    expect(pick({ lastPostedToday, usedByOthersToday, random: () => 0 })).toBe("v3");
    expect(pick({ lastPostedToday, usedByOthersToday, random: () => 1 })).toBe("v4");
  });

  it("shares repeats evenly across accounts when there are fewer videos than accounts", () => {
    expect(pick({ usedByOthersToday: new Map([["v1", 2], ["v2", 1], ["v3", 2], ["v4", 2]]) })).toBe("v2");
  });

  it("prefers repeating for another account over repeating on the same account", () => {
    const lastPostedToday = new Map([["v1", 1], ["v2", 2], ["v3", 3]]);
    expect(pick({ lastPostedToday, usedByOthersToday: new Map([["v4", 5]]) })).toBe("v4");
  });

  it("restarts with the earliest posted video once the pool is exhausted for the day", () => {
    expect(pick({ lastPostedToday: new Map([["v1", 30], ["v2", 10], ["v3", 40], ["v4", 20]]) })).toBe("v2");
  });

  it("finishes a limited loop once every media was used by the account", () => {
    expect(pick({ noRepeat: true, usedMediaIds: pool.map((item) => item.id) })).toBeUndefined();
    expect(pick({ noRepeat: true, usedMediaIds: ["rel-v1", "rel-v2", "rel-v3"], lastPostedToday: new Map([["v4", 1]]) })).toBe("v4");
  });
});

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
