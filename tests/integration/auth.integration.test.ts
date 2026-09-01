import { describe, expect, it } from "vitest";
import { getSqlClient } from "@/db/client";
import { authenticate, hashPassword, LOGIN_RATE_LIMITS } from "@/server/auth";

async function createAdmin(email: string, password: string) {
  const [user] = await getSqlClient()<{ id: string }[]>`
    INSERT INTO users (email, password_hash, role)
    VALUES (${email}, ${await hashPassword(password)}, 'ADMIN')
    RETURNING id
  `;
  return user.id;
}

describe("login rate limiting", () => {
  it("serializa admissões concorrentes e não permite lockout global por e-mail", async () => {
    const email = "admin-rate-limit@example.test";
    const password = "correct horse battery staple";
    const userId = await createAdmin(email, password);

    const attempts = await Promise.all(
      Array.from({ length: LOGIN_RATE_LIMITS.pairMaxAttempts + 5 }, () =>
        authenticate(email, "senha-incorreta", "192.0.2.10"),
      ),
    );
    expect(attempts).toEqual(Array(attempts.length).fill(null));

    const [blocked] = await getSqlClient()<{ count: number }[]>`
      SELECT count(*)::int AS count FROM login_attempts WHERE blocked_until > now()
    `;
    expect(blocked?.count).toBe(1);
    await expect(authenticate(email, password, "192.0.2.10")).resolves.toBeNull();
    await expect(authenticate(email, password, "198.51.100.20")).resolves.toMatchObject({ id: userId, email });
  });

  it("limita o volume agregado do IP antes de aceitar outro par e-mail/IP", async () => {
    const email = "admin-ip-volume@example.test";
    const password = "another correct horse battery staple";
    await createAdmin(email, password);
    const sourceIp = "203.0.113.77";

    for (let index = 0; index < LOGIN_RATE_LIMITS.ipMaxAttempts; index += 1) {
      await expect(authenticate(`missing-${index}@example.test`, "senha-incorreta", sourceIp)).resolves.toBeNull();
    }

    await expect(authenticate(email, password, sourceIp)).resolves.toBeNull();
    const [ipBlock] = await getSqlClient()<{ attempt_count: number }[]>`
      SELECT attempt_count FROM login_attempts
      WHERE blocked_until > now()
      ORDER BY attempt_count DESC
      LIMIT 1
    `;
    expect(ipBlock?.attempt_count).toBe(LOGIN_RATE_LIMITS.ipMaxAttempts + 1);
  });
});
