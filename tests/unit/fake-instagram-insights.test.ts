import { describe, expect, it, vi } from "vitest";
import { FakeInstagramProvider } from "@/providers/fake-instagram";

describe("FakeInstagramProvider insights", () => {
  it("snapshot é determinístico dentro do mesmo dia e cresce entre dias", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-11T10:00:00Z"));
    const provider = new FakeInstagramProvider("success");
    const first = await provider.getAccountSnapshot("fake-token:1000:conta_a");
    const second = await provider.getAccountSnapshot("fake-token:1000:conta_a");
    expect(first).toEqual(second);
    expect(first.username).toBe("conta_a");
    expect(first.followersCount).toBeGreaterThan(0);

    vi.setSystemTime(new Date("2026-09-12T10:00:00Z"));
    const tomorrow = await provider.getAccountSnapshot("fake-token:1000:conta_a");
    expect(tomorrow.followersCount).toBeGreaterThan(first.followersCount);
  });

  it("insights por dia são determinísticos e respeitam a lista de dias", async () => {
    const provider = new FakeInstagramProvider("success");
    const a = await provider.getAccountInsights("1000", "t", ["2026-09-11", "2026-09-10"]);
    const b = await provider.getAccountInsights("1000", "t", ["2026-09-11", "2026-09-10"]);
    expect(a).toEqual(b);
    expect(a.map((day) => day.day)).toEqual(["2026-09-11", "2026-09-10"]);
    expect(a[0].reach).toBeGreaterThanOrEqual(0);
  });

  it("lista mídias recentes dentro da janela e um story vivo", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-11T10:00:00Z"));
    const provider = new FakeInstagramProvider("success");
    const media = await provider.listRecentMedia("1000", "t", new Date("2026-09-01T00:00:00Z"));
    expect(media.length).toBeGreaterThan(0);
    expect(media.every((item) => item.postedAt >= new Date("2026-09-01T00:00:00Z"))).toBe(true);
    expect(media.every((item) => item.id.startsWith("fake_media_1000_"))).toBe(true);

    const stories = await provider.listLiveStories("1000", "t");
    expect(stories).toHaveLength(1);
    expect(stories[0].productType).toBe("STORY");
    expect(stories[0].postedAt.getTime()).toBeGreaterThan(Date.now() - 24 * 3_600_000);
  });

  it("insights de mídia respeitam o tipo", async () => {
    const provider = new FakeInstagramProvider("success");
    const reel = await provider.getMediaInsights("fake_media_1000_0", "t", "REELS");
    expect(reel.reelsAvgWatchTimeMs).not.toBeNull();
    expect(reel.storyTapsForward).toBeNull();
    const story = await provider.getMediaInsights("fake_story_1000_1", "t", "STORY");
    expect(story.storyTapsForward).not.toBeNull();
    expect(story.reelsAvgWatchTimeMs).toBeNull();
  });

  it("obedece ao cenário de falha", async () => {
    await expect(new FakeInstagramProvider("http_401").getAccountSnapshot("fake-token:1:a")).rejects.toMatchObject({ kind: "AUTH" });
    await expect(new FakeInstagramProvider("http_429").getAccountInsights("1", "t", ["2026-09-11"])).rejects.toMatchObject({ kind: "RATE_LIMIT" });
  });
});
