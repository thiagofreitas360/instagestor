import { createHash, randomUUID } from "node:crypto";
import { InstagramError } from "@/lib/errors";
import { getEnv } from "@/lib/env";
import type {
  AccountDayInsights, AccountSnapshot, ContainerInput, FakeScenario, InstagramProvider,
  MediaInsights, MediaProductType, MediaSummary,
} from "./instagram";

type FakeContainer = { id: string; readyAt: number };

const DAY_MS = 86_400_000;

function seeded(seed: string, max: number, min = 0) {
  const hash = createHash("sha256").update(seed).digest();
  return min + (hash.readUInt32BE(0) % (max - min + 1));
}

export class FakeInstagramProvider implements InstagramProvider {
  private transientFailures = 0;

  constructor(private readonly scenario: FakeScenario = getEnv().FAKE_PROVIDER_SCENARIO) {}

  private fail(phase: "request" | "publish") {
    if (this.scenario === "success") return;
    if (this.scenario === "transient" && this.transientFailures++ > 0) return;
    if (this.scenario === "ambiguous_publish" && phase !== "publish") return;
    const errors: Record<Exclude<FakeScenario, "success">, InstagramError> = {
      http_400: new InstagramError("Mídia rejeitada pelo fake provider", "VALIDATION", "FAKE_400", 400),
      http_401: new InstagramError("Token inválido", "AUTH", "FAKE_401", 401),
      http_403: new InstagramError("Permissão insuficiente", "AUTH", "FAKE_403", 403),
      http_429: new InstagramError("Limite temporário", "RATE_LIMIT", "FAKE_429", 429, 30),
      http_500: new InstagramError("Falha interna simulada", "TRANSIENT", "FAKE_500", 500),
      http_501: new InstagramError("Operação não implementada simulada", "TRANSIENT", "FAKE_501", 501),
      timeout: new InstagramError("Timeout simulado", "TRANSIENT", "FAKE_TIMEOUT"),
      transient: new InstagramError("Falha transitória simulada", "TRANSIENT", "FAKE_TRANSIENT", 503),
      permanent: new InstagramError("Falha permanente simulada", "PERMANENT", "FAKE_PERMANENT", 400),
      ambiguous_publish: new InstagramError("Publicação aceita, resposta perdida", "AMBIGUOUS", "FAKE_AMBIGUOUS"),
      token_expired: new InstagramError("Token expirado", "AUTH", "FAKE_TOKEN_EXPIRED", 401),
    };
    throw errors[this.scenario];
  }

  async getProfile(accessToken: string) {
    this.fail("request");
    const [, id = "1000", username = "conta_fake"] = accessToken.split(":");
    return { id, appScopedUserId: `app_${id}`, username, displayName: `Conta ${username}`, accountType: "BUSINESS" };
  }

  async createMediaContainer(input: ContainerInput) {
    void input;
    this.fail("request");
    const payload: FakeContainer = { id: randomUUID(), readyAt: Date.now() + 500 };
    return `fake_${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
  }

  async getContainerStatus(containerId: string, accessToken: string) {
    void accessToken;
    this.fail("request");
    try {
      const payload = JSON.parse(Buffer.from(containerId.slice(5), "base64url").toString("utf8")) as FakeContainer;
      return Date.now() >= payload.readyAt ? ("FINISHED" as const) : ("PROCESSING" as const);
    } catch {
      return "ERROR" as const;
    }
  }

  async publishContainer(accountId: string, containerId: string, accessToken: string) {
    void accountId;
    void accessToken;
    this.fail("publish");
    return `fake_media_${createHash("sha256").update(containerId).digest("hex").slice(0, 20)}`;
  }

  async getPublishingLimit(accountId: string, accessToken: string) {
    void accountId;
    void accessToken;
    this.fail("request");
    return { usage: 3, total: 100 };
  }

  async refreshAccessToken(accessToken: string) {
    this.fail("request");
    return { accessToken: `${accessToken.split(":refreshed")[0]}:refreshed`, expiresIn: 60 * 24 * 60 * 60 };
  }

  async getAccountSnapshot(accessToken: string): Promise<AccountSnapshot> {
    this.fail("request");
    const [, id = "1000", username = "conta_fake"] = accessToken.split(":");
    const dayIndex = Math.floor(Date.now() / DAY_MS);
    return {
      username,
      displayName: `Conta ${username}`,
      followersCount: 100 + seeded(`${id}:base`, 5000) + dayIndex * seeded(`${id}:growth`, 25, 5),
      followsCount: seeded(`${id}:follows`, 800, 50),
      mediaCount: 30 + seeded(`${id}:media`, 200),
      biography: `Bio da ${username}`,
      website: `https://${username}.example`,
    };
  }

  async getAccountInsights(accountId: string, accessToken: string, days: string[]): Promise<AccountDayInsights[]> {
    void accessToken;
    this.fail("request");
    const small = seeded(`${accountId}:small`, 9) === 0;
    return days.map((day) => {
      const value = (name: string, max: number, min?: number) => seeded(`${accountId}:${day}:${name}`, max, min);
      return {
        day,
        followerGains: small ? null : value("gains", 60),
        reach: value("reach", 5000, 100),
        views: value("views", 12000, 200),
        profileViews: value("profile_views", 400),
        accountsEngaged: value("engaged", 900),
        totalInteractions: value("interactions", 1200),
        likes: value("likes", 800),
        comments: value("comments", 120),
        shares: value("shares", 150),
        saves: value("saves", 90),
        replies: value("replies", 40),
        websiteClicks: value("website", 60),
        profileLinksTaps: value("links", 80),
      };
    });
  }

  async listRecentMedia(accountId: string, accessToken: string, since: Date): Promise<MediaSummary[]> {
    void accessToken;
    this.fail("request");
    return Array.from({ length: 5 }, (_, position) => {
      const reel = position % 2 === 0;
      return {
        id: `fake_media_${accountId}_${position}`,
        mediaType: reel ? "VIDEO" : "IMAGE",
        productType: (reel ? "REELS" : "FEED") as MediaProductType,
        permalink: `https://www.instagram.com/p/fake_${accountId}_${position}/`,
        caption: `Publicação ${position + 1} da conta ${accountId}`,
        postedAt: new Date(Date.now() - (position * 5 + 1) * DAY_MS),
        likeCount: seeded(`${accountId}:${position}:likes`, 500),
        commentsCount: seeded(`${accountId}:${position}:comments`, 60),
      };
    }).filter((item) => item.postedAt >= since);
  }

  async listLiveStories(accountId: string, accessToken: string): Promise<MediaSummary[]> {
    void accessToken;
    this.fail("request");
    const dayIndex = Math.floor(Date.now() / DAY_MS);
    return [{
      id: `fake_story_${accountId}_${dayIndex}`,
      mediaType: "IMAGE",
      productType: "STORY",
      postedAt: new Date(Date.now() - 3_600_000),
    }];
  }

  async getMediaInsights(mediaId: string, accessToken: string, productType: MediaProductType): Promise<MediaInsights> {
    void accessToken;
    this.fail("request");
    const value = (name: string, max: number, min?: number) => seeded(`${mediaId}:${name}`, max, min);
    const story = productType === "STORY";
    const reel = productType === "REELS";
    return {
      views: value("views", 8000, 50),
      reach: value("reach", 6000, 40),
      shares: value("shares", 120),
      saved: story ? null : value("saved", 200),
      totalInteractions: value("interactions", 900),
      replies: story ? value("replies", 30) : null,
      follows: reel ? null : value("follows", 25),
      profileVisits: reel ? null : value("visits", 80),
      reelsAvgWatchTimeMs: reel ? value("avg_watch", 15000, 1000) : null,
      reelsTotalWatchTimeMs: reel ? value("total_watch", 5_000_000, 10_000) : null,
      storyTapsForward: story ? value("forward", 400) : null,
      storyTapsBack: story ? value("back", 40) : null,
      storyExits: story ? value("exits", 60) : null,
    };
  }
}
