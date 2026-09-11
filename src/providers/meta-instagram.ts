import { InstagramError } from "@/lib/errors";
import { getEnv } from "@/lib/env";
import { log } from "@/lib/logger";
import type {
  AccountDayInsights, AccountSnapshot, ContainerInput, InstagramProfile, InstagramProvider,
  MediaInsights, MediaProductType, MediaSummary,
} from "./instagram";
import { INSIGHTS_SCOPE } from "./instagram";

type MetaErrorBody = { error?: { message?: string; type?: string; code?: number; error_subcode?: number; is_transient?: boolean } };

const ACCOUNT_TOTAL_METRICS = [
  "reach", "views", "profile_views", "accounts_engaged", "total_interactions", "likes", "comments",
  "shares", "saves", "replies", "website_clicks", "profile_links_taps",
] as const;

// ponytail: lista fixa por tipo; se a Meta rejeitar uma métrica o sync inteiro da mídia devolve nulos.
// Validar no primeiro smoke test real e ajustar aqui.
const MEDIA_METRICS: Record<MediaProductType, string> = {
  FEED: "views,reach,likes,comments,shares,saved,total_interactions,follows,profile_visits",
  REELS: "views,reach,likes,comments,shares,saved,total_interactions,ig_reels_avg_watch_time,ig_reels_video_view_total_time",
  STORY: "views,reach,replies,shares,follows,profile_visits,total_interactions",
};

const MEDIA_FIELDS = "id,media_type,media_product_type,timestamp,permalink,thumbnail_url,media_url,caption,like_count,comments_count";

type InsightEntry = {
  name: string;
  total_value?: { value?: number; breakdowns?: Array<{ results?: Array<{ dimension_values?: string[]; value?: number }> }> };
  values?: Array<{ value?: number; end_time?: string }>;
};

type MetaMedia = {
  id: string; media_type?: string; media_product_type?: string; timestamp: string; permalink?: string;
  thumbnail_url?: string; media_url?: string; caption?: string; like_count?: number; comments_count?: number;
};

function parseMetaTimestamp(value: string) {
  return new Date(value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
}

function toInt(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
}

function entryValue(entries: InsightEntry[], name: string) {
  const entry = entries.find((item) => item.name === name);
  return toInt(entry?.total_value?.value ?? entry?.values?.[0]?.value);
}

function dayBounds(day: string) {
  const since = Math.floor(Date.parse(`${day}T00:00:00Z`) / 1000);
  return { since, until: since + 86_399 };
}

function toMediaSummary(item: MetaMedia, productType?: MediaProductType): MediaSummary {
  const product = productType ?? (item.media_product_type === "REELS" ? "REELS" : item.media_product_type === "STORY" ? "STORY" : "FEED");
  return {
    id: item.id,
    mediaType: item.media_type ?? "IMAGE",
    productType: product,
    permalink: item.permalink,
    thumbnailUrl: item.thumbnail_url ?? (item.media_type === "IMAGE" ? item.media_url : undefined),
    caption: item.caption?.slice(0, 300),
    postedAt: parseMetaTimestamp(item.timestamp),
    likeCount: item.like_count,
    commentsCount: item.comments_count,
  };
}

const emptyMediaInsights = (): MediaInsights => ({
  views: null, reach: null, shares: null, saved: null, totalInteractions: null, replies: null, follows: null,
  profileVisits: null, reelsAvgWatchTimeMs: null, reelsTotalWatchTimeMs: null,
  storyTapsForward: null, storyTapsBack: null, storyExits: null,
});

export class MetaInstagramProvider implements InstagramProvider {
  private get baseUrl() {
    return `https://graph.instagram.com/${getEnv().META_API_VERSION}`;
  }

  authorizationUrl(state: string) {
    const env = getEnv();
    const query = new URLSearchParams({
      client_id: env.INSTAGRAM_APP_ID!,
      redirect_uri: env.INSTAGRAM_REDIRECT_URI!,
      response_type: "code",
      scope: `instagram_business_basic,instagram_business_content_publish,${INSIGHTS_SCOPE}`,
      state,
      enable_fb_login: "0",
      force_reauth: "true",
    });
    return `https://www.instagram.com/oauth/authorize?${query}`;
  }

  async exchangeAuthorizationCode(code: string) {
    const env = getEnv();
    const body = new FormData();
    body.set("client_id", env.INSTAGRAM_APP_ID!);
    body.set("client_secret", env.INSTAGRAM_APP_SECRET!);
    body.set("grant_type", "authorization_code");
    body.set("redirect_uri", env.INSTAGRAM_REDIRECT_URI!);
    body.set("code", code);
    const response = await this.fetchJson<{
      data?: Array<{ access_token: string; user_id: string; permissions?: string[] | string }>;
      access_token?: string;
      user_id?: string;
      permissions?: string[] | string;
    }>(
      "https://api.instagram.com/oauth/access_token",
      {
        method: "POST",
        body,
      },
    );
    const shortLived = response.data?.[0] ?? (response.access_token && response.user_id ? response : undefined);
    if (!shortLived?.access_token || !shortLived.user_id) throw new InstagramError("Resposta OAuth incompleta", "AUTH", "OAUTH_RESPONSE_INVALID");
    const permissions = Array.isArray(shortLived.permissions)
      ? shortLived.permissions
      : (shortLived.permissions ?? "").split(",").map((permission) => permission.trim()).filter(Boolean);
    const requiredPermissions = ["instagram_business_basic", "instagram_business_content_publish"];
    if (!requiredPermissions.every((permission) => permissions.includes(permission))) {
      throw new InstagramError("Permissões obrigatórias não foram concedidas", "AUTH", "OAUTH_PERMISSIONS_MISSING");
    }
    const exchangeUrl = new URL("https://graph.instagram.com/access_token");
    exchangeUrl.search = new URLSearchParams({
      grant_type: "ig_exchange_token",
      client_secret: env.INSTAGRAM_APP_SECRET!,
      access_token: shortLived.access_token,
    }).toString();
    const longLived = await this.fetchJson<{ access_token: string; expires_in: number }>(exchangeUrl.toString(), { method: "GET" });
    return { appScopedUserId: shortLived.user_id, accessToken: longLived.access_token, expiresIn: longLived.expires_in, permissions };
  }

  async getProfile(accessToken: string): Promise<InstagramProfile> {
    const profile = await this.request<{
      id?: string;
      user_id?: string;
      username: string;
      name?: string;
      account_type?: string;
      profile_picture_url?: string;
    }>("/me", { fields: "id,user_id,username,name,account_type,profile_picture_url", access_token: accessToken });
    if (!profile.user_id) throw new InstagramError("Perfil sem user_id profissional", "AUTH", "PROFILE_USER_ID_MISSING");
    return {
      id: profile.user_id,
      appScopedUserId: profile.id,
      username: profile.username,
      displayName: profile.name,
      profilePictureUrl: profile.profile_picture_url,
      accountType: profile.account_type,
    };
  }

  async getAccountSnapshot(accessToken: string): Promise<AccountSnapshot> {
    const me = await this.request<{
      username: string; name?: string; profile_picture_url?: string; followers_count?: number;
      follows_count?: number; media_count?: number; biography?: string; website?: string;
    }>("/me", {
      fields: "username,name,profile_picture_url,followers_count,follows_count,media_count,biography,website",
      access_token: accessToken,
    });
    return {
      username: me.username,
      displayName: me.name,
      profilePictureUrl: me.profile_picture_url,
      followersCount: toInt(me.followers_count) ?? 0,
      followsCount: toInt(me.follows_count) ?? 0,
      mediaCount: toInt(me.media_count) ?? 0,
      biography: me.biography,
      website: me.website,
    };
  }

  async getAccountInsights(accountId: string, accessToken: string, days: string[]): Promise<AccountDayInsights[]> {
    const results: AccountDayInsights[] = [];
    for (const day of days) {
      const { since, until } = dayBounds(day);
      const { data = [] } = await this.request<{ data?: InsightEntry[] }>(`/${accountId}/insights`, {
        metric: ACCOUNT_TOTAL_METRICS.join(","), period: "day", metric_type: "total_value",
        since: String(since), until: String(until), access_token: accessToken,
      });
      results.push({
        day, followerGains: null,
        reach: entryValue(data, "reach"), views: entryValue(data, "views"), profileViews: entryValue(data, "profile_views"),
        accountsEngaged: entryValue(data, "accounts_engaged"), totalInteractions: entryValue(data, "total_interactions"),
        likes: entryValue(data, "likes"), comments: entryValue(data, "comments"), shares: entryValue(data, "shares"),
        saves: entryValue(data, "saves"), replies: entryValue(data, "replies"),
        websiteClicks: entryValue(data, "website_clicks"), profileLinksTaps: entryValue(data, "profile_links_taps"),
      });
    }
    if (!days.length) return results;
    const sorted = [...days].sort();
    try {
      const { data = [] } = await this.request<{ data?: InsightEntry[] }>(`/${accountId}/insights`, {
        metric: "follower_count", period: "day", metric_type: "time_series",
        since: String(dayBounds(sorted[0]).since), until: String(dayBounds(sorted[sorted.length - 1]).until),
        access_token: accessToken,
      });
      for (const point of data.find((entry) => entry.name === "follower_count")?.values ?? []) {
        if (!point.end_time) continue;
        // end_time marca o fim do bucket; o dia do bucket é o dia UTC desse instante.
        const day = parseMetaTimestamp(point.end_time).toISOString().slice(0, 10);
        const target = results.find((entry) => entry.day === day);
        if (target) target.followerGains = toInt(point.value);
      }
    } catch (error) {
      // Contas com menos de 100 seguidores não têm follower_count; qualquer outro erro sobe.
      if (!(error instanceof InstagramError && error.kind === "VALIDATION")) throw error;
      log("info", "meta", "follower_count_unavailable", { account_id: accountId });
    }
    return results;
  }

  private async listMediaEdge(path: string, params: Record<string, string>, accessToken: string, since?: Date) {
    const collected: MediaSummary[] = [];
    let url: string | undefined = `${this.baseUrl}${path}?${new URLSearchParams({ ...params, limit: "50" })}`;
    while (url) {
      const page: { data?: MetaMedia[]; paging?: { next?: string } } = await this.fetchJson(url, {
        method: "GET", headers: { authorization: `Bearer ${accessToken}` },
      });
      const items = (page.data ?? []).map((item) => toMediaSummary(item));
      const recent = since ? items.filter((item) => item.postedAt >= since) : items;
      collected.push(...recent);
      const reachedLimit = since ? recent.length < items.length : false;
      url = !reachedLimit && page.paging?.next ? page.paging.next : undefined;
    }
    return collected;
  }

  listRecentMedia(accountId: string, accessToken: string, since: Date) {
    return this.listMediaEdge(`/${accountId}/media`, { fields: MEDIA_FIELDS }, accessToken, since);
  }

  async listLiveStories(accountId: string, accessToken: string) {
    const stories = await this.listMediaEdge(`/${accountId}/stories`, { fields: MEDIA_FIELDS }, accessToken);
    return stories.map((story) => ({ ...story, productType: "STORY" as const }));
  }

  async getMediaInsights(mediaId: string, accessToken: string, productType: MediaProductType): Promise<MediaInsights> {
    const result = emptyMediaInsights();
    let data: InsightEntry[];
    try {
      ({ data = [] } = await this.request<{ data?: InsightEntry[] }>(`/${mediaId}/insights`, {
        metric: MEDIA_METRICS[productType], access_token: accessToken,
      }));
    } catch (error) {
      if (error instanceof InstagramError && error.kind === "VALIDATION") return result;
      throw error;
    }
    result.views = entryValue(data, "views");
    result.reach = entryValue(data, "reach");
    result.shares = entryValue(data, "shares");
    result.saved = entryValue(data, "saved");
    result.totalInteractions = entryValue(data, "total_interactions");
    result.replies = entryValue(data, "replies");
    result.follows = entryValue(data, "follows");
    result.profileVisits = entryValue(data, "profile_visits");
    result.reelsAvgWatchTimeMs = entryValue(data, "ig_reels_avg_watch_time");
    result.reelsTotalWatchTimeMs = entryValue(data, "ig_reels_video_view_total_time");
    if (productType !== "STORY") return result;
    try {
      const { data: navigation = [] } = await this.request<{ data?: InsightEntry[] }>(`/${mediaId}/insights`, {
        metric: "navigation", breakdown: "story_navigation_action_type", access_token: accessToken,
      });
      const buckets = new Map<string, number>();
      for (const bucket of navigation.find((entry) => entry.name === "navigation")?.total_value?.breakdowns?.[0]?.results ?? []) {
        buckets.set(bucket.dimension_values?.[0] ?? "", toInt(bucket.value) ?? 0);
      }
      result.storyTapsForward = buckets.get("tap_forward") ?? null;
      result.storyTapsBack = buckets.get("tap_back") ?? null;
      result.storyExits = buckets.has("swipe_forward") || buckets.has("exit")
        ? (buckets.get("swipe_forward") ?? 0) + (buckets.get("exit") ?? 0)
        : null;
    } catch (error) {
      if (!(error instanceof InstagramError && error.kind === "VALIDATION")) throw error;
    }
    return result;
  }

  private async createSingle(accountId: string, accessToken: string, values: Record<string, string>) {
    const result = await this.request<{ id: string }>(`/${accountId}/media`, { ...values, access_token: accessToken }, "POST");
    if (!result.id) throw new InstagramError("Resposta de criação de container sem ID", "PERMANENT", "META_CONTAINER_RESPONSE_INVALID");
    return result.id;
  }

  async createMediaContainer(input: ContainerInput) {
    if (input.publicationType === "CAROUSEL") {
      if (!input.children?.length) throw new InstagramError("Carousel sem containers filhos", "VALIDATION", "CAROUSEL_CHILDREN_MISSING");
      return this.createSingle(input.accountId, input.accessToken, {
        media_type: "CAROUSEL",
        children: input.children.join(","),
        ...(input.caption ? { caption: input.caption } : {}),
      });
    }

    const video = ["FEED_VIDEO", "REEL", "STORY_VIDEO"].includes(input.publicationType);
    const values: Record<string, string> = { [video ? "video_url" : "image_url"]: input.mediaUrls[0] };
    if (input.publicationType === "REEL") values.media_type = "REELS";
    else if (input.publicationType.startsWith("STORY")) values.media_type = "STORIES";
    else if (input.publicationType === "FEED_VIDEO") values.media_type = "VIDEO";
    if (!input.publicationType.startsWith("STORY") && input.caption) values.caption = input.caption;
    if (input.publicationType === "REEL" && input.shareToFeed !== undefined) values.share_to_feed = String(input.shareToFeed);
    if (input.isCarouselItem) values.is_carousel_item = "true";
    return this.createSingle(input.accountId, input.accessToken, values);
  }

  async getContainerStatus(containerId: string, accessToken: string) {
    const value = await this.request<{ status_code?: string; status?: string }>(`/${containerId}`, {
      fields: "status_code,status",
      access_token: accessToken,
    });
    if (value.status_code === "FINISHED") return "FINISHED" as const;
    if (value.status_code === "PUBLISHED") return "PUBLISHED" as const;
    if (value.status_code === "ERROR" || value.status_code === "EXPIRED") return "ERROR" as const;
    return "PROCESSING" as const;
  }

  async publishContainer(accountId: string, containerId: string, accessToken: string) {
    const value = await this.request<{ id: string }>(
      `/${accountId}/media_publish`,
      { creation_id: containerId, access_token: accessToken },
      "POST",
      true,
    );
    if (!value.id) {
      throw new InstagramError(
        "A Meta aceitou a publicação, mas não devolveu o ID esperado",
        "AMBIGUOUS",
        "META_PUBLISH_RESPONSE_INVALID",
      );
    }
    return value.id;
  }

  async getPublishingLimit(accountId: string, accessToken: string) {
    const value = await this.request<{
      data?: Array<{
        quota_usage?: number;
        config?: { quota_total?: number };
        rate_limit_settings?: { quota_total?: number };
      }>;
    }>(
      `/${accountId}/content_publishing_limit`,
      { fields: "quota_usage,config", access_token: accessToken },
    );
    const limit = value.data?.[0];
    const total = limit?.config?.quota_total ?? limit?.rate_limit_settings?.quota_total;
    if (!Number.isFinite(limit?.quota_usage) || !Number.isFinite(total) || !total || total < 1) {
      throw new InstagramError(
        "A Meta não retornou uma quota de publicação utilizável",
        "RATE_LIMIT",
        "PUBLISHING_LIMIT_SCHEMA",
        undefined,
        3600,
      );
    }
    return { usage: limit!.quota_usage!, total };
  }

  async refreshAccessToken(accessToken: string) {
    const url = new URL("https://graph.instagram.com/refresh_access_token");
    url.search = new URLSearchParams({
      grant_type: "ig_refresh_token",
      access_token: accessToken,
    }).toString();
    const value = await this.fetchJson<{ access_token: string; expires_in: number }>(url.toString(), { method: "GET" });
    return { accessToken: value.access_token, expiresIn: value.expires_in };
  }

  private async request<T>(path: string, params: Record<string, string>, method: "GET" | "POST" = "GET", publish = false) {
    const url = new URL(`${this.baseUrl}${path}`);
    const { access_token: accessToken, ...requestParams } = params;
    const init: RequestInit = {
      method,
      headers: accessToken ? { authorization: `Bearer ${accessToken}` } : undefined,
    };
    if (method === "GET") Object.entries(requestParams).forEach(([key, value]) => url.searchParams.set(key, value));
    else {
      init.headers = {
        ...init.headers,
        "content-type": "application/x-www-form-urlencoded",
      };
      init.body = new URLSearchParams(requestParams);
    }
    try {
      return await this.fetchJson<T>(url.toString(), init);
    } catch (error) {
      if (publish && error instanceof InstagramError && (error.code === "META_TIMEOUT" || error.kind === "TRANSIENT")) {
        throw new InstagramError("Resultado da publicação é ambíguo", "AMBIGUOUS", "META_PUBLISH_AMBIGUOUS");
      }
      throw error;
    }
  }

  private async fetchJson<T>(url: string, init: RequestInit) {
    const started = Date.now();
    let response: Response;
    try {
      response = await fetch(url, { ...init, signal: AbortSignal.timeout(getEnv().META_HTTP_TIMEOUT_MS) });
    } catch (error) {
      log("warn", "meta", "http_failed", { duration_ms: Date.now() - started, error: error instanceof Error ? error.name : "unknown" });
      throw new InstagramError("Tempo limite ou falha de rede na Meta", "TRANSIENT", "META_TIMEOUT");
    }
    const body = (await response.json().catch(() => ({}))) as T & MetaErrorBody;
    log(response.ok ? "info" : "warn", "meta", "http_completed", { status: response.status, duration_ms: Date.now() - started });
    if (response.ok) return body;

    const meta = body.error;
    const code = `META_${meta?.code ?? response.status}${meta?.error_subcode ? `_${meta.error_subcode}` : ""}`;
    const retryAfter = Number(response.headers.get("retry-after")) || undefined;
    if (response.status === 401 || response.status === 403 || meta?.code === 190) {
      throw new InstagramError("A Meta rejeitou a autorização da conta", "AUTH", code, response.status);
    }
    if (response.status === 429 || meta?.code === 4 || meta?.code === 17 || meta?.code === 32) {
      throw new InstagramError("A Meta aplicou um limite temporário", "RATE_LIMIT", code, response.status, retryAfter);
    }
    if (response.status >= 500 || meta?.is_transient) {
      throw new InstagramError("A Meta está temporariamente indisponível", "TRANSIENT", code, response.status);
    }
    throw new InstagramError(
      response.status === 400 ? "A Meta rejeitou os dados enviados" : "A Meta rejeitou a requisição",
      response.status === 400 ? "VALIDATION" : "PERMANENT",
      code,
      response.status,
    );
  }
}
