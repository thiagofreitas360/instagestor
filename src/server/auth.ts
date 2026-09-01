import argon2 from "argon2";
import { isIP } from "node:net";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSqlClient } from "@/db/client";
import { sha256, sign, verifySignature } from "@/lib/crypto";
import { getEnv } from "@/lib/env";

const SESSION_COOKIE = "instagestor_session";
const SESSION_SECONDS = 12 * 60 * 60;
export const LOGIN_RATE_LIMITS = {
  windowMinutes: 15,
  pairMaxAttempts: 5,
  ipMaxAttempts: 30,
} as const;
let dummyPasswordHash: Promise<string> | undefined;

type Session = { userId: string; role: "ADMIN"; expiresAt: number };
export type AdminUser = { id: string; email: string; role: "ADMIN" };

export async function hashPassword(password: string) {
  return argon2.hash(password, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 });
}

function getDummyPasswordHash() {
  dummyPasswordHash ??= hashPassword("invalid-password-not-used-for-login");
  return dummyPasswordHash;
}

function encodeSession(session: Session) {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function decodeSession(value?: string): Session | null {
  if (!value) return null;
  const [payload, signature] = value.split(".");
  if (!payload || !signature || !verifySignature(payload, signature)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Session;
    return session.role === "ADMIN" && session.expiresAt > Date.now() ? session : null;
  } catch {
    return null;
  }
}

export async function setSession(user: AdminUser) {
  const expiresAt = Date.now() + SESSION_SECONDS * 1000;
  (await cookies()).set(SESSION_COOKIE, encodeSession({ userId: user.id, role: user.role, expiresAt }), {
    httpOnly: true,
    secure: getEnv().NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
}

export async function clearSession() {
  (await cookies()).set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: getEnv().NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export async function currentUser(): Promise<AdminUser | null> {
  const session = decodeSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session) return null;
  const [user] = await getSqlClient()<AdminUser[]>`
    SELECT id, email, role FROM users WHERE id = ${session.userId} AND role = 'ADMIN' LIMIT 1
  `;
  return user ?? null;
}

export async function requireAdmin() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireAdminApi() {
  const user = await currentUser();
  if (!user) throw new Response("Não autorizado", { status: 401 });
  return user;
}

function normalizeIp(value: string | null) {
  let candidate = value?.trim() ?? "";
  if (candidate.startsWith("[") && candidate.includes("]")) candidate = candidate.slice(1, candidate.indexOf("]"));
  if (isIP(candidate) === 4) return candidate;
  if (isIP(candidate) === 6) {
    try {
      return new URL(`http://[${candidate}]/`).hostname.slice(1, -1);
    } catch {
      return candidate.toLowerCase();
    }
  }
  const ipv4WithPort = candidate.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/);
  return ipv4WithPort && isIP(ipv4WithPort[1] ?? "") === 4 ? ipv4WithPort[1]! : null;
}

/**
 * Resolves the address supplied by the trusted ingress. The ingress must strip
 * client-supplied forwarding headers before setting these values.
 */
export function clientAddressFromHeaders(requestHeaders: Pick<Headers, "get">) {
  for (const name of ["cf-connecting-ip", "x-real-ip"]) {
    const normalized = normalizeIp(requestHeaders.get(name));
    if (normalized) return normalized;
  }
  return normalizeIp(requestHeaders.get("x-forwarded-for")?.split(",", 1)[0] ?? null) ?? "unknown";
}

function loginKey(scope: "pair" | "ip", value: string) {
  return sha256(`login:${scope}:${value}|${getEnv().SESSION_SECRET}`);
}

type LoginAdmission = { pairKey: string; pairCount: number };

async function admitLogin(normalizedEmail: string, clientAddress: string): Promise<LoginAdmission | null> {
  const ipKey = loginKey("ip", clientAddress);
  const pairKey = loginKey("pair", `${normalizedEmail}\0${clientAddress}`);

  return getSqlClient().begin(async (sql) => {
    const reserve = async (keyHash: string, maximum: number) => {
      const [row] = await sql<{ attempt_count: number; blocked_until: Date | null }[]>`
        INSERT INTO login_attempts (key_hash, attempt_count, window_started_at, blocked_until, updated_at)
        VALUES (${keyHash}, 1, now(), NULL, now())
        ON CONFLICT (key_hash) DO UPDATE SET
          attempt_count = CASE
            WHEN login_attempts.blocked_until > now() THEN login_attempts.attempt_count + 1
            WHEN login_attempts.window_started_at < now() - ${LOGIN_RATE_LIMITS.windowMinutes} * interval '1 minute' THEN 1
            ELSE login_attempts.attempt_count + 1
          END,
          window_started_at = CASE
            WHEN (login_attempts.blocked_until IS NULL OR login_attempts.blocked_until <= now())
              AND login_attempts.window_started_at < now() - ${LOGIN_RATE_LIMITS.windowMinutes} * interval '1 minute' THEN now()
            ELSE login_attempts.window_started_at
          END,
          blocked_until = CASE
            WHEN login_attempts.blocked_until > now() THEN login_attempts.blocked_until
            WHEN login_attempts.window_started_at < now() - ${LOGIN_RATE_LIMITS.windowMinutes} * interval '1 minute' THEN NULL
            WHEN login_attempts.attempt_count + 1 > ${maximum}
              THEN now() + ${LOGIN_RATE_LIMITS.windowMinutes} * interval '1 minute'
            ELSE NULL
          END,
          updated_at = now()
        RETURNING attempt_count, blocked_until
      `;
      if (!row) throw new Error("Falha ao registrar tentativa de autenticação");
      return {
        allowed: row.attempt_count <= maximum && (!row.blocked_until || row.blocked_until <= new Date()),
        count: row.attempt_count,
      };
    };

    const ipAdmission = await reserve(ipKey, LOGIN_RATE_LIMITS.ipMaxAttempts);
    if (!ipAdmission.allowed) return null;
    const pairAdmission = await reserve(pairKey, LOGIN_RATE_LIMITS.pairMaxAttempts);
    return pairAdmission.allowed
      ? { pairKey, pairCount: pairAdmission.count }
      : null;
  });
}

export async function authenticate(email: string, password: string, clientAddress = "unknown"): Promise<AdminUser | null> {
  const normalizedEmail = email.toLowerCase().trim();
  const normalizedAddress = normalizeIp(clientAddress) ?? "unknown";
  const admission = await admitLogin(normalizedEmail, normalizedAddress);
  if (!admission) return null;
  const [user] = await getSqlClient()<(AdminUser & { password_hash: string })[]>`
    SELECT id, email, role, password_hash FROM users WHERE email = ${normalizedEmail} LIMIT 1
  `;

  const valid = await argon2.verify(user?.password_hash ?? await getDummyPasswordHash(), password);
  if (!user || !valid) return null;

  await getSqlClient().begin(async (sql) => {
    await sql`
      UPDATE login_attempts
      SET attempt_count = GREATEST(attempt_count - ${admission.pairCount}, 0),
          blocked_until = NULL,
          updated_at = now()
      WHERE key_hash = ${admission.pairKey}
    `;
    await sql`UPDATE users SET last_login_at = now(), updated_at = now() WHERE id = ${user.id}`;
  });
  return { id: user.id, email: user.email, role: user.role };
}

export async function audit(
  actorUserId: string | null,
  eventType: string,
  entityType: string,
  entityId?: string,
  metadata: Record<string, unknown> = {},
) {
  await getSqlClient()`
    INSERT INTO audit_logs (actor_user_id, event_type, entity_type, entity_id, metadata_json)
    VALUES (${actorUserId}, ${eventType}, ${entityType}, ${entityId ?? null}, ${JSON.stringify(metadata)}::jsonb)
  `;
}
