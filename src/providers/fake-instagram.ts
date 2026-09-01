import { createHash, randomUUID } from "node:crypto";
import { InstagramError } from "@/lib/errors";
import { getEnv } from "@/lib/env";
import type { ContainerInput, FakeScenario, InstagramProvider } from "./instagram";

type FakeContainer = { id: string; readyAt: number };

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
}
