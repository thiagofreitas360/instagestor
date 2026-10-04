import { describe, expect, it } from "vitest";
import { getSqlClient } from "@/db/client";
import { authenticate } from "@/server/auth";
import {
  changeTemporaryPassword,
  createTenant,
  normalizeOrganizationSlug,
  resetTenantOwnerPassword,
  setTenantStatus,
} from "@/server/tenants";
import { createUser, TEST_ORGANIZATION_ID } from "./helpers";

describe("tenant management", () => {
  it("provisiona um cliente isolado e força a troca da senha temporária", async () => {
    const actorUserId = await createUser("platform@example.test");
    const temporaryPassword = "senha-temporaria-segura";
    const organizationId = await createTenant({
      name: "Cliente Árvore",
      slug: normalizeOrganizationSlug("Cliente Árvore"),
      ownerEmail: "owner@arvore.test",
      temporaryPassword,
      actorUserId,
      defaultTimezone: "America/Sao_Paulo",
    });

    const [provisioned] = await getSqlClient()<Array<{
      slug: string;
      status: string;
      email: string;
      role: string;
      must_change_password: boolean;
      session_version: number;
      timezone: string;
    }>>`
      SELECT organization.slug, organization.status, users.email, member.role,
        users.must_change_password, users.session_version, settings.default_timezone AS timezone
      FROM organizations organization
      JOIN organization_members member ON member.organization_id = organization.id
      JOIN users ON users.id = member.user_id
      JOIN settings ON settings.organization_id = organization.id
      WHERE organization.id = ${organizationId}
    `;
    expect(provisioned).toMatchObject({
      slug: "cliente-arvore",
      status: "ACTIVE",
      email: "owner@arvore.test",
      role: "OWNER",
      must_change_password: true,
      session_version: 0,
      timezone: "America/Sao_Paulo",
    });

    const owner = await authenticate("owner@arvore.test", temporaryPassword, "192.0.2.30");
    expect(owner).toMatchObject({ organizationId, mustChangePassword: true, isPlatformAdmin: false });
    const newVersion = await changeTemporaryPassword(owner!.id, "nova-senha-definitiva-segura");
    expect(newVersion).toBe(1);
    await expect(authenticate("owner@arvore.test", temporaryPassword, "192.0.2.31")).resolves.toBeNull();
    await expect(authenticate("owner@arvore.test", "nova-senha-definitiva-segura", "192.0.2.32"))
      .resolves.toMatchObject({ organizationId, mustChangePassword: false, sessionVersion: 1 });
  });

  it("suspende, reativa e redefine o acesso sem permitir alterar a organização principal", async () => {
    const actorUserId = await createUser("platform@example.test");
    const organizationId = await createTenant({
      name: "Cliente Operação",
      slug: "cliente-operacao",
      ownerEmail: "owner@operacao.test",
      temporaryPassword: "senha-temporaria-inicial",
      actorUserId,
      defaultTimezone: "America/Sao_Paulo",
    });
    const [owner] = await getSqlClient()<Array<{ user_id: string }>>`
      SELECT user_id FROM organization_members WHERE organization_id = ${organizationId} AND role = 'OWNER'
    `;

    await setTenantStatus({
      organizationId,
      status: "SUSPENDED",
      protectedOrganizationId: TEST_ORGANIZATION_ID,
      actorUserId,
    });
    await expect(authenticate("owner@operacao.test", "senha-temporaria-inicial", "192.0.2.40")).resolves.toBeNull();
    await setTenantStatus({
      organizationId,
      status: "ACTIVE",
      protectedOrganizationId: TEST_ORGANIZATION_ID,
      actorUserId,
    });
    await resetTenantOwnerPassword({
      organizationId,
      ownerUserId: owner.user_id,
      temporaryPassword: "senha-temporaria-redefinida",
      protectedOrganizationId: TEST_ORGANIZATION_ID,
      actorUserId,
    });
    await expect(authenticate("owner@operacao.test", "senha-temporaria-inicial", "192.0.2.41")).resolves.toBeNull();
    await expect(authenticate("owner@operacao.test", "senha-temporaria-redefinida", "192.0.2.42"))
      .resolves.toMatchObject({ organizationId, mustChangePassword: true, sessionVersion: 1 });

    await expect(setTenantStatus({
      organizationId: TEST_ORGANIZATION_ID,
      status: "SUSPENDED",
      protectedOrganizationId: TEST_ORGANIZATION_ID,
      actorUserId,
    })).rejects.toThrow("principal");
  });
});
