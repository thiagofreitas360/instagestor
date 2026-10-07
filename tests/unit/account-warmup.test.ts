import { describe, expect, it } from "vitest";
import { accountWarmup, DAY_MS, warmupPublicationAt, type WarmupProfile } from "@/lib/account-warmup";
import { effectiveLoopLimits, nextLoopScheduleAt } from "@/server/automation";

const connectedAt = new Date("2026-10-07T12:00:00Z");
const at = (days: number) => new Date(connectedAt.getTime() + days * DAY_MS);

describe("account warmup", () => {
  it.each<[WarmupProfile, number[]]>([
    ["FAST", [2, 6, 12]],
    ["BALANCED", [2, 2, 4, 4, 8, 8, 12, 12, 16, 16]],
    ["CONSERVATIVE", [2, 2, 2, 2, 4, 4, 4, 4, 8, 8, 8, 8, 12, 12, 12, 12, 16, 16, 16, 16]],
  ])("advances %s at exact 24-hour boundaries and finishes automatically", (profile, limits) => {
    limits.forEach((limit, day) => {
      expect(accountWarmup(profile, connectedAt.toISOString(), at(day))).toMatchObject({ active: true, day: day + 1, dailyLimit: limit });
      expect(accountWarmup(profile, connectedAt, new Date(at(day + 1).getTime() - 1))?.dailyLimit).toBe(limit);
    });
    expect(accountWarmup(profile, connectedAt, at(limits.length))).toMatchObject({ active: false, dailyLimit: null });
    expect(accountWarmup(profile, connectedAt, at(-1))?.day).toBe(1);
    expect(accountWarmup(null, connectedAt, at(0))).toBeNull();
  });

  it("spaces posts, enforces a rolling window across midnight and delays after a failed attempt", () => {
    const now = new Date("2026-10-08T00:30:00Z");
    const before = (hours: number) => new Date(now.getTime() - hours * 3_600_000).toISOString();
    expect(warmupPublicationAt({ now, dailyLimit: 2, publishedAt: [] })).toEqual(now);
    expect(warmupPublicationAt({ now, dailyLimit: 2, publishedAt: [before(1)] }).getTime()).toBe(now.getTime() + 11 * 3_600_000);
    expect(warmupPublicationAt({ now, dailyLimit: 2, publishedAt: [before(14), before(15)] }).getTime()).toBe(now.getTime() + 9 * 3_600_000);
    expect(warmupPublicationAt({ now, dailyLimit: 2, publishedAt: [before(24)] })).toEqual(now);
    expect(warmupPublicationAt({ now, dailyLimit: 2, publishedAt: [], lastAttemptAt: before(1) }).getTime()).toBe(now.getTime() + 11 * 3_600_000);
  });

  it("never exceeds the normal loop cap or speeds up a slower loop, including follower tiers", () => {
    const input = { warmupProfile: "BALANCED" as const, accountCreatedAt: connectedAt, now: at(0), isNewAccount: true,
      followerCount: null, tieredLimits: true, tierFollowerThreshold: 10000,
      dailyLimitPerAccount: 24, minIntervalMinutes: 50, maxIntervalMinutes: 60,
      tier1DailyLimit: 1, tier1MinIntervalMinutes: 60, tier1MaxIntervalMinutes: 120 };
    expect(effectiveLoopLimits(input)).toEqual({ dailyLimit: 2, minIntervalMinutes: 720, maxIntervalMinutes: 720 });
    expect(effectiveLoopLimits({ ...input, followerCount: 500 })).toEqual({ dailyLimit: 1, minIntervalMinutes: 1440, maxIntervalMinutes: 1440 });
    expect(effectiveLoopLimits({ ...input, minIntervalMinutes: 1440, maxIntervalMinutes: 1440 }).minIntervalMinutes).toBe(1440);
    expect(effectiveLoopLimits({ ...input, now: at(10) })).toEqual({ dailyLimit: 24, minIntervalMinutes: 50, maxIntervalMinutes: 60 });
    const uneven = effectiveLoopLimits({ ...input, now: at(4), dailyLimitPerAccount: 7, maxIntervalMinutes: 300 });
    expect(uneven).toEqual({ dailyLimit: 7, minIntervalMinutes: 206, maxIntervalMinutes: 300 });
    expect(() => nextLoopScheduleAt({ ...uneven, completedAt: at(4), timezone: "UTC", publishedToday: 0 })).not.toThrow();
  });
});
