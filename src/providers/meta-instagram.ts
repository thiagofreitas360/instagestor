import { InstagramError } from "@/lib/errors";
import { getEnv } from "@/lib/env";
import { log } from "@/lib/logger";
import type { ContainerInput, InstagramProvider, InstagramProfile } from "./instagram";

type MetaErrorBody = { error?: { message?: string; type?: string; code?: number; error_subcode?: number; is_transient?: boolean } };

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
      scope: "instagram_business_basic,instagram_business_content_publish",
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
    return { appScopedUserId: shortLived.user_id, accessToken: longLived.access_token, expiresIn: longLived.expires_in };
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
