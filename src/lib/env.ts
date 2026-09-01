import { z } from "zod";

const booleanString = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

const LOCAL_SESSION_SECRET = "local-development-session-secret-change-before-production";
const ZERO_ENCRYPTION_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

function isHttps(value: string | undefined) {
  return value ? new URL(value).protocol === "https:" : false;
}

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.string().min(1),
    DATABASE_POOL_SIZE: z.coerce.number().int().min(5).max(100).default(10),
    APP_URL: z.url(),
    SESSION_SECRET: z.string().min(32),
    TOKEN_ENCRYPTION_KEY: z.string().refine(
      (value) => /^[A-Za-z0-9+/]{43}=$/.test(value) && Buffer.from(value, "base64").length === 32,
      { message: "TOKEN_ENCRYPTION_KEY deve representar exatamente 32 bytes em base64 canônico" },
    ),
    INSTAGRAM_PROVIDER: z.enum(["fake", "meta"]),
    ALLOW_FAKE_PROVIDER_IN_PRODUCTION: booleanString,
    META_API_VERSION: z.string().regex(/^v\d+\.\d+$/).default("v26.0"),
    INSTAGRAM_APP_ID: z.string().optional(),
    INSTAGRAM_APP_SECRET: z.string().optional(),
    INSTAGRAM_REDIRECT_URI: z.url().optional(),
    STORAGE_PROVIDER: z.enum(["local", "s3"]).default("local"),
    LOCAL_STORAGE_PATH: z.string().default("uploads"),
    S3_ENDPOINT: z.url().optional(),
    S3_PUBLIC_ENDPOINT: z.url().optional(),
    S3_REGION: z.string().default("auto"),
    S3_BUCKET: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_FORCE_PATH_STYLE: booleanString,
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(3),
    MAX_PUBLICATION_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
    META_GLOBAL_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
    META_ACCOUNT_CONCURRENCY: z.coerce.number().int().min(1).max(1).default(1),
    DEFAULT_TIMEZONE: z.string().default("America/Sao_Paulo"),
    JOB_LOCK_SECONDS: z.coerce.number().int().min(30).max(3600).default(180),
    WORKER_POLL_MS: z.coerce.number().int().min(250).max(60000).default(5000),
    META_HTTP_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(30000),
    CONTAINER_POLL_SECONDS: z.coerce.number().int().min(1).max(300).default(60),
    PUBLISHABLE_URL_TTL_SECONDS: z.coerce.number().int().min(900).max(86400).default(7200),
    UPLOAD_MAX_BYTES: z.coerce.number().int().min(1).max(300_000_000).default(300_000_000),
    FAKE_PROVIDER_SCENARIO: z
      .enum([
        "success",
        "http_400",
        "http_401",
        "http_403",
        "http_429",
        "http_500",
        "http_501",
        "timeout",
        "transient",
        "permanent",
        "ambiguous_publish",
        "token_expired",
      ])
      .default("success"),
  })
  .superRefine((env, context) => {
    const explicitlyInsecureLocalFake =
      env.NODE_ENV === "production"
      && env.INSTAGRAM_PROVIDER === "fake"
      && env.ALLOW_FAKE_PROVIDER_IN_PRODUCTION;

    if (env.DATABASE_POOL_SIZE < env.WORKER_CONCURRENCY + 2) {
      context.addIssue({
        code: "custom",
        path: ["DATABASE_POOL_SIZE"],
        message: "DATABASE_POOL_SIZE deve reservar ao menos duas conexões além de WORKER_CONCURRENCY",
      });
    }
    if (env.NODE_ENV === "production" && env.INSTAGRAM_PROVIDER === "fake" && !env.ALLOW_FAKE_PROVIDER_IN_PRODUCTION) {
      context.addIssue({ code: "custom", path: ["INSTAGRAM_PROVIDER"], message: "Fake provider é bloqueado em produção" });
    }
    if (env.NODE_ENV === "production" && !explicitlyInsecureLocalFake) {
      if (env.SESSION_SECRET === LOCAL_SESSION_SECRET) {
        context.addIssue({ code: "custom", path: ["SESSION_SECRET"], message: "SESSION_SECRET de exemplo é proibido em produção" });
      }
      if (env.TOKEN_ENCRYPTION_KEY === ZERO_ENCRYPTION_KEY) {
        context.addIssue({
          code: "custom",
          path: ["TOKEN_ENCRYPTION_KEY"],
          message: "TOKEN_ENCRYPTION_KEY de exemplo é proibida em produção",
        });
      }
      if (!isHttps(env.APP_URL)) {
        context.addIssue({ code: "custom", path: ["APP_URL"], message: "APP_URL deve usar HTTPS em produção" });
      }
    }
    if (env.INSTAGRAM_PROVIDER === "meta") {
      for (const key of ["INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET", "INSTAGRAM_REDIRECT_URI"] as const) {
        if (!env[key]) context.addIssue({ code: "custom", path: [key], message: `${key} é obrigatório com provider meta` });
      }
      if (env.NODE_ENV === "production" && !isHttps(env.INSTAGRAM_REDIRECT_URI)) {
        context.addIssue({
          code: "custom",
          path: ["INSTAGRAM_REDIRECT_URI"],
          message: "INSTAGRAM_REDIRECT_URI deve usar HTTPS em produção",
        });
      }
    }
    if (env.STORAGE_PROVIDER === "s3") {
      for (const key of ["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const) {
        if (!env[key]) context.addIssue({ code: "custom", path: [key], message: `${key} é obrigatório com storage s3` });
      }
      if (env.NODE_ENV === "production" && !explicitlyInsecureLocalFake && !isHttps(env.S3_PUBLIC_ENDPOINT ?? env.S3_ENDPOINT)) {
        context.addIssue({
          code: "custom",
          path: ["S3_PUBLIC_ENDPOINT"],
          message: "A origem pública do storage deve usar HTTPS em produção",
        });
      }
    }
  });

export type AppEnv = z.infer<typeof schema>;
let cached: AppEnv | undefined;

export function getEnv(): AppEnv {
  if (!cached) cached = schema.parse(process.env);
  return cached;
}

export function resetEnvForTests() {
  cached = undefined;
}
