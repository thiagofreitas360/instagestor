import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvForTests } from "@/lib/env";
import { MetaInstagramProvider } from "@/providers/meta-instagram";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function fetchMock(...responses: Response[]) {
  const mock = vi.fn<typeof fetch>();
  for (const response of responses) mock.mockResolvedValueOnce(response);
  vi.stubGlobal("fetch", mock);
  return mock;
}

function calledUrl(mock: ReturnType<typeof fetchMock>, index: number) {
  return new URL(String(mock.mock.calls[index][0]));
}

beforeEach(() => {
  process.env.INSTAGRAM_PROVIDER = "meta";
  process.env.INSTAGRAM_APP_ID = "app-123";
  process.env.INSTAGRAM_APP_SECRET = "meta-provider-test-secret";
  process.env.INSTAGRAM_REDIRECT_URI = "http://localhost:3000/api/instagram/oauth/callback";
  process.env.META_API_VERSION = "v26.0";
  resetEnvForTests();
});

describe("OAuth com escopo de insights", () => {
  it("pede manage_insights e devolve as permissões concedidas", async () => {
    const url = new URL(new MetaInstagramProvider().authorizationUrl("state"));
    expect(url.searchParams.get("scope")).toBe(
      "instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights",
    );

    fetchMock(
      jsonResponse({ data: [{ access_token: "curto", user_id: "app-7", permissions: "instagram_business_basic,instagram_business_content_publish" }] }),
      jsonResponse({ access_token: "longo", expires_in: 5_184_000 }),
    );
    const exchanged = await new MetaInstagramProvider().exchangeAuthorizationCode("codigo");
    expect(exchanged.permissions).toEqual(["instagram_business_basic", "instagram_business_content_publish"]);
  });
});

describe("getAccountSnapshot", () => {
  it("lê contadores e perfil em uma chamada", async () => {
    const mock = fetchMock(jsonResponse({
      username: "loja", name: "Loja", profile_picture_url: "https://cdn/x.jpg",
      followers_count: 1200, follows_count: 300, media_count: 45, biography: "Bio", website: "https://loja.example",
    }));
    const snapshot = await new MetaInstagramProvider().getAccountSnapshot("token");
    expect(snapshot).toEqual({
      username: "loja", displayName: "Loja", profilePictureUrl: "https://cdn/x.jpg",
      followersCount: 1200, followsCount: 300, mediaCount: 45, biography: "Bio", website: "https://loja.example",
    });
    const url = calledUrl(mock, 0);
    expect(url.pathname).toBe("/v26.0/me");
    expect(url.searchParams.get("fields")).toBe(
      "username,name,profile_picture_url,followers_count,follows_count,media_count,biography,website",
    );
  });
});

describe("getAccountInsights", () => {
  const totalValue = (values: Record<string, number>) => ({
    data: Object.entries(values).map(([name, value]) => ({ name, period: "day", total_value: { value } })),
  });

  it("faz uma chamada total_value por dia e uma time_series para follower_count", async () => {
    const mock = fetchMock(
      jsonResponse(totalValue({ reach: 10, views: 20, profile_views: 3, accounts_engaged: 4, total_interactions: 9, likes: 5, comments: 1, shares: 2, saves: 1, replies: 0, website_clicks: 2, profile_links_taps: 3 })),
      jsonResponse(totalValue({ reach: 11, views: 21, profile_views: 4, accounts_engaged: 5, total_interactions: 10, likes: 6, comments: 2, shares: 1, saves: 0, replies: 1, website_clicks: 0, profile_links_taps: 1 })),
      jsonResponse({ data: [{
        name: "follower_count", period: "day",
        values: [
          { value: 7, end_time: "2026-09-10T07:00:00+0000" },
          { value: 9, end_time: "2026-09-11T07:00:00+0000" },
        ],
      }] }),
    );
    const result = await new MetaInstagramProvider().getAccountInsights("178", "token", ["2026-09-11", "2026-09-10"]);
    expect(result).toEqual([
      { day: "2026-09-11", followerGains: 9, reach: 10, views: 20, profileViews: 3, accountsEngaged: 4, totalInteractions: 9, likes: 5, comments: 1, shares: 2, saves: 1, replies: 0, websiteClicks: 2, profileLinksTaps: 3 },
      { day: "2026-09-10", followerGains: 7, reach: 11, views: 21, profileViews: 4, accountsEngaged: 5, totalInteractions: 10, likes: 6, comments: 2, shares: 1, saves: 0, replies: 1, websiteClicks: 0, profileLinksTaps: 1 },
    ]);

    const first = calledUrl(mock, 0);
    expect(first.pathname).toBe("/v26.0/178/insights");
    expect(first.searchParams.get("metric_type")).toBe("total_value");
    expect(first.searchParams.get("period")).toBe("day");
    expect(first.searchParams.get("since")).toBe(String(Date.UTC(2026, 8, 11) / 1000));
    expect(first.searchParams.get("until")).toBe(String(Date.UTC(2026, 8, 11) / 1000 + 86_399));

    const series = calledUrl(mock, 2);
    expect(series.searchParams.get("metric")).toBe("follower_count");
    expect(series.searchParams.get("metric_type")).toBe("time_series");
    expect(series.searchParams.get("since")).toBe(String(Date.UTC(2026, 8, 10) / 1000));
  });

  it("tolera conta com menos de 100 seguidores deixando follower_gains nulo", async () => {
    fetchMock(
      jsonResponse(totalValue({ reach: 1 })),
      jsonResponse({ error: { message: "(#100) Not enough followers", type: "OAuthException", code: 100 } }, 400),
    );
    const [day] = await new MetaInstagramProvider().getAccountInsights("178", "token", ["2026-09-11"]);
    expect(day.followerGains).toBeNull();
    expect(day.reach).toBe(1);
    expect(day.views).toBeNull();
  });

  it("propaga erro de autorização", async () => {
    fetchMock(jsonResponse({ error: { message: "Invalid OAuth access token", code: 190 } }, 401));
    await expect(new MetaInstagramProvider().getAccountInsights("178", "token", ["2026-09-11"]))
      .rejects.toMatchObject({ kind: "AUTH" });
  });
});

describe("listRecentMedia e listLiveStories", () => {
  it("segue a paginação até passar de `since` e normaliza timestamp da Meta", async () => {
    const mock = fetchMock(
      jsonResponse({
        data: [
          { id: "m1", media_type: "VIDEO", media_product_type: "REELS", timestamp: "2026-09-10T12:00:00+0000", permalink: "https://ig/m1", thumbnail_url: "https://cdn/m1.jpg", caption: "a", like_count: 3, comments_count: 1 },
          { id: "m2", media_type: "IMAGE", media_product_type: "FEED", timestamp: "2026-09-01T12:00:00+0000", permalink: "https://ig/m2", media_url: "https://cdn/m2.jpg", like_count: 8, comments_count: 2 },
        ],
        paging: { next: "https://graph.instagram.com/v26.0/178/media?after=abc" },
      }),
      jsonResponse({
        data: [{ id: "m3", media_type: "IMAGE", media_product_type: "FEED", timestamp: "2026-07-01T12:00:00+0000" }],
      }),
    );
    const media = await new MetaInstagramProvider().listRecentMedia("178", "token", new Date("2026-08-15T00:00:00Z"));
    expect(media.map((item) => item.id)).toEqual(["m1", "m2"]);
    expect(media[0]).toMatchObject({ productType: "REELS", thumbnailUrl: "https://cdn/m1.jpg", likeCount: 3, commentsCount: 1 });
    expect(media[0].postedAt.toISOString()).toBe("2026-09-10T12:00:00.000Z");
    expect(media[1].thumbnailUrl).toBe("https://cdn/m2.jpg");
    expect(mock).toHaveBeenCalledTimes(2);
    expect(calledUrl(mock, 0).searchParams.get("fields")).toBe(
      "id,media_type,media_product_type,timestamp,permalink,thumbnail_url,media_url,caption,like_count,comments_count",
    );
  });

  it("para de paginar quando a página já passou de `since`", async () => {
    const mock = fetchMock(jsonResponse({
      data: [{ id: "old", media_type: "IMAGE", media_product_type: "FEED", timestamp: "2026-01-01T00:00:00+0000" }],
      paging: { next: "https://graph.instagram.com/v26.0/178/media?after=zzz" },
    }));
    const media = await new MetaInstagramProvider().listRecentMedia("178", "token", new Date("2026-08-15T00:00:00Z"));
    expect(media).toEqual([]);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("lista stories vivos como STORY", async () => {
    const mock = fetchMock(jsonResponse({
      data: [{ id: "s1", media_type: "IMAGE", media_product_type: "STORY", timestamp: "2026-09-11T08:00:00+0000", media_url: "https://cdn/s1.jpg" }],
    }));
    const stories = await new MetaInstagramProvider().listLiveStories("178", "token");
    expect(stories).toEqual([{
      id: "s1", mediaType: "IMAGE", productType: "STORY", permalink: undefined, thumbnailUrl: "https://cdn/s1.jpg",
      caption: undefined, postedAt: new Date("2026-09-11T08:00:00Z"), likeCount: undefined, commentsCount: undefined,
    }]);
    expect(calledUrl(mock, 0).pathname).toBe("/v26.0/178/stories");
  });
});

describe("getMediaInsights", () => {
  const lifetime = (values: Record<string, number>) => ({
    data: Object.entries(values).map(([name, value]) => ({ name, period: "lifetime", values: [{ value }] })),
  });

  it("pede as métricas de REELS e converte tempos para milissegundos inteiros", async () => {
    const mock = fetchMock(jsonResponse(lifetime({
      views: 100, reach: 80, likes: 9, comments: 1, shares: 2, saved: 3, total_interactions: 15,
      ig_reels_avg_watch_time: 4321.7, ig_reels_video_view_total_time: 987654,
    })));
    const insights = await new MetaInstagramProvider().getMediaInsights("m1", "token", "REELS");
    expect(insights).toEqual({
      views: 100, reach: 80, shares: 2, saved: 3, totalInteractions: 15, replies: null, follows: null, profileVisits: null,
      reelsAvgWatchTimeMs: 4322, reelsTotalWatchTimeMs: 987654, storyTapsForward: null, storyTapsBack: null, storyExits: null,
    });
    expect(calledUrl(mock, 0).searchParams.get("metric")).toBe(
      "views,reach,likes,comments,shares,saved,total_interactions,ig_reels_avg_watch_time,ig_reels_video_view_total_time",
    );
  });

  it("faz segunda chamada de navigation para STORY e agrega o breakdown", async () => {
    const mock = fetchMock(
      jsonResponse(lifetime({ views: 50, reach: 40, replies: 2, shares: 1, follows: 1, profile_visits: 3, total_interactions: 7 })),
      jsonResponse({ data: [{
        name: "navigation", period: "lifetime",
        total_value: { value: 30, breakdowns: [{ dimension_keys: ["story_navigation_action_type"], results: [
          { dimension_values: ["tap_forward"], value: 20 },
          { dimension_values: ["tap_back"], value: 4 },
          { dimension_values: ["swipe_forward"], value: 5 },
          { dimension_values: ["exit"], value: 1 },
        ] }] },
      }] }),
    );
    const insights = await new MetaInstagramProvider().getMediaInsights("s1", "token", "STORY");
    expect(insights).toMatchObject({ views: 50, replies: 2, follows: 1, profileVisits: 3, storyTapsForward: 20, storyTapsBack: 4, storyExits: 6 });
    expect(mock).toHaveBeenCalledTimes(2);
    expect(calledUrl(mock, 1).searchParams.get("breakdown")).toBe("story_navigation_action_type");
  });

  it("devolve tudo nulo quando a Meta recusa insights daquela mídia", async () => {
    fetchMock(jsonResponse({ error: { message: "(#100) Insights not available", code: 100, error_subcode: 2108006 } }, 400));
    const insights = await new MetaInstagramProvider().getMediaInsights("m9", "token", "FEED");
    expect(Object.values(insights).every((value) => value === null)).toBe(true);
  });
});
