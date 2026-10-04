import { InstagramError } from "./errors";

export const OAUTH_RESULTS = [
  "success",
  "cancelled",
  "state_expired",
  "permissions_missing",
  "account_already_claimed",
  "wrong_reconnect_account",
  "provider_unavailable",
  "connection_failed",
] as const;
export type OauthResult = (typeof OAUTH_RESULTS)[number];

export const OAUTH_MESSAGE_TYPE = "instagestor:instagram-oauth";

export const OAUTH_RESULT_MESSAGES: Record<OauthResult, string> = {
  success: "Conta do Instagram conectada.",
  cancelled: "A autorização foi cancelada na Meta.",
  state_expired: "A autorização expirou ou já foi usada. Inicie a conexão novamente.",
  permissions_missing: "As permissões obrigatórias não foram concedidas. Autorize publicação e dados básicos da conta.",
  account_already_claimed: "Esta conta do Instagram já está vinculada a outro cliente.",
  wrong_reconnect_account: "A conta autorizada é diferente da conta que você pediu para reconectar.",
  provider_unavailable: "A Meta está indisponível no momento. Tente novamente em alguns minutos.",
  connection_failed: "Não foi possível concluir a conexão com o Instagram.",
};

export class OauthFlowError extends Error {
  constructor(public readonly result: OauthResult, message: string = OAUTH_RESULT_MESSAGES[result]) {
    super(message);
    this.name = "OauthFlowError";
  }
}

export function parseOauthResult(value: unknown): OauthResult | null {
  return OAUTH_RESULTS.find((result) => result === value) ?? null;
}

/** Aceita somente `{ type, result }` exatos vindos da página de conclusão. */
export function parseOauthMessage(data: unknown): OauthResult | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;
  if (Object.keys(record).length !== 2 || record.type !== OAUTH_MESSAGE_TYPE) return null;
  return parseOauthResult(record.result);
}

export function oauthResultFromError(error: unknown): OauthResult {
  if (error instanceof OauthFlowError) return error.result;
  if (error instanceof InstagramError) {
    if (error.code === "OAUTH_PERMISSIONS_MISSING") return "permissions_missing";
    if (error.kind === "TRANSIENT" || error.kind === "RATE_LIMIT") return "provider_unavailable";
  }
  return "connection_failed";
}

export function oauthFallbackUrl(result: OauthResult) {
  const key = result === "success" ? "ok" : "erro";
  return `/contas?${key}=${encodeURIComponent(OAUTH_RESULT_MESSAGES[result])}`;
}
