export type InstagramErrorKind = "AUTH" | "RATE_LIMIT" | "VALIDATION" | "TRANSIENT" | "PERMANENT" | "AMBIGUOUS";

export class InstagramError extends Error {
  constructor(
    message: string,
    public readonly kind: InstagramErrorKind,
    public readonly code: string,
    public readonly httpStatus?: number,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "InstagramError";
  }
}

export function asInstagramError(error: unknown) {
  if (error instanceof InstagramError) return error;
  if (error instanceof Error && error.name === "AbortError") {
    return new InstagramError("Tempo limite da Meta excedido", "TRANSIENT", "META_TIMEOUT");
  }
  return new InstagramError(error instanceof Error ? error.message : "Erro desconhecido", "TRANSIENT", "UNKNOWN");
}
