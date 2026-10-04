import { getSqlClient } from "@/db/client";
import { hashPassword } from "@/server/auth";

export type TenantSummary = {
  id: string;
  name: string;
  slug: string;
  status: "ACTIVE" | "SUSPENDED";
  created_at: Date;
  member_count: number;
  account_count: number;
  owner_user_id: string | null;
  owner_email: string | null;
  owner_last_login_at: Date | null;
  owner_must_change_password: boolean | null;
};

export function normalizeOrganizationSlug(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export async function listTenants() {
  return getSqlClient()<TenantSummary[]>`
    SELECT organization.id, organization.name, organization.slug, organization.status, organization.created_at,
      (SELECT count(*)::int FROM organization_members member
        WHERE member.organization_id = organization.id) AS member_count,
      (SELECT count(*)::int FROM instagram_accounts account
        WHERE account.organization_id = organization.id) AS account_count,
      owner.user_id AS owner_user_id,
      owner.email AS owner_email,
      owner.last_login_at AS owner_last_login_at,
      owner.must_change_password AS owner_must_change_password
    FROM organizations organization
    LEFT JOIN LATERAL (
      SELECT member.user_id, users.email, users.last_login_at, users.must_change_password
      FROM organization_members member
      JOIN users ON users.id = member.user_id
      WHERE member.organization_id = organization.id
      ORDER BY CASE member.role WHEN 'OWNER' THEN 0 WHEN 'ADMIN' THEN 1 ELSE 2 END,
        member.created_at, member.user_id
      LIMIT 1
    ) owner ON true
    ORDER BY organization.created_at DESC, organization.id
  `;
}

function uniqueViolation(error: unknown, fragment: string) {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && error.code === "23505"
    && "constraint_name" in error
    && String(error.constraint_name).includes(fragment),
  );
}

export async function createTenant(input: {
  name: string;
  slug: string;
  ownerEmail: string;
  temporaryPassword: string;
  actorUserId: string;
  defaultTimezone: string;
}) {
  const passwordHash = await hashPassword(input.temporaryPassword);
  try {
    return await getSqlClient().begin(async (sql) => {
      const [organization] = await sql<{ id: string }[]>`
        INSERT INTO organizations (name, slug)
        VALUES (${input.name.trim()}, ${input.slug})
        RETURNING id
      `;
      const [owner] = await sql<{ id: string }[]>`
        INSERT INTO users (email, password_hash, role, must_change_password)
        VALUES (${input.ownerEmail.toLowerCase().trim()}, ${passwordHash}, 'ADMIN', true)
        RETURNING id
      `;
      await sql`
        INSERT INTO organization_members (organization_id, user_id, role)
        VALUES (${organization.id}, ${owner.id}, 'OWNER')
      `;
      await sql`
        INSERT INTO settings (organization_id, default_timezone)
        VALUES (${organization.id}, ${input.defaultTimezone})
      `;
      await sql`
        INSERT INTO audit_logs (organization_id, actor_user_id, event_type, entity_type, entity_id, metadata_json)
        VALUES (NULL, ${input.actorUserId}, 'ORGANIZATION_CREATED', 'organization', ${organization.id},
          ${JSON.stringify({ name: input.name.trim(), slug: input.slug, ownerEmail: input.ownerEmail.toLowerCase().trim() })}::jsonb)
      `;
      return organization.id;
    });
  } catch (error) {
    if (uniqueViolation(error, "organizations_slug")) throw new Error("Este identificador de cliente já está em uso");
    if (uniqueViolation(error, "users_email")) throw new Error("Este e-mail já possui acesso ao sistema");
    throw error;
  }
}

export async function setTenantStatus(input: {
  organizationId: string;
  status: "ACTIVE" | "SUSPENDED";
  protectedOrganizationId: string;
  actorUserId: string;
}) {
  if (input.organizationId === input.protectedOrganizationId) {
    throw new Error("A organização principal não pode ser suspensa por esta tela");
  }
  await getSqlClient().begin(async (sql) => {
    const [organization] = await sql<{ id: string }[]>`
      UPDATE organizations SET status = ${input.status}::organization_status, updated_at = now()
      WHERE id = ${input.organizationId}
      RETURNING id
    `;
    if (!organization) throw new Error("Cliente não encontrado");
    await sql`
      INSERT INTO audit_logs (organization_id, actor_user_id, event_type, entity_type, entity_id, metadata_json)
      VALUES (NULL, ${input.actorUserId}, ${input.status === "ACTIVE" ? "ORGANIZATION_ACTIVATED" : "ORGANIZATION_SUSPENDED"},
        'organization', ${organization.id}, ${JSON.stringify({ status: input.status })}::jsonb)
    `;
  });
}

export async function resetTenantOwnerPassword(input: {
  organizationId: string;
  ownerUserId: string;
  temporaryPassword: string;
  protectedOrganizationId: string;
  actorUserId: string;
}) {
  if (input.organizationId === input.protectedOrganizationId) {
    throw new Error("Use o fluxo de alteração de senha da conta principal");
  }
  const passwordHash = await hashPassword(input.temporaryPassword);
  await getSqlClient().begin(async (sql) => {
    const [owner] = await sql<{ id: string }[]>`
      UPDATE users SET password_hash = ${passwordHash}, must_change_password = true,
        session_version = session_version + 1, updated_at = now()
      WHERE id = ${input.ownerUserId}
        AND EXISTS (
          SELECT 1 FROM organization_members member
          WHERE member.organization_id = ${input.organizationId}
            AND member.user_id = users.id AND member.role = 'OWNER'
        )
      RETURNING id
    `;
    if (!owner) throw new Error("Proprietário do cliente não encontrado");
    await sql`
      INSERT INTO audit_logs (organization_id, actor_user_id, event_type, entity_type, entity_id)
      VALUES (NULL, ${input.actorUserId}, 'ORGANIZATION_PASSWORD_RESET', 'organization', ${input.organizationId})
    `;
  });
}

export async function changeTemporaryPassword(userId: string, password: string) {
  const passwordHash = await hashPassword(password);
  const [updated] = await getSqlClient()<{ session_version: number }[]>`
    UPDATE users SET password_hash = ${passwordHash}, must_change_password = false,
      session_version = session_version + 1, updated_at = now()
    WHERE id = ${userId} AND must_change_password = true
    RETURNING session_version
  `;
  if (!updated) throw new Error("A troca de senha não está mais pendente");
  return updated.session_version;
}
