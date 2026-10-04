"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getEnv } from "@/lib/env";
import { requirePlatformAdmin } from "@/server/auth";
import {
  createTenant,
  normalizeOrganizationSlug,
  resetTenantOwnerPassword,
  setTenantStatus,
} from "@/server/tenants";

const password = z.string().min(12, "A senha temporária deve ter pelo menos 12 caracteres").max(128);

function back(error: unknown): never {
  const message = error instanceof Error ? error.message : "Operação não concluída";
  redirect(`/admin/clientes?erro=${encodeURIComponent(message)}`);
}

export async function createClientAction(formData: FormData) {
  const actor = await requirePlatformAdmin();
  try {
    const parsed = z.object({
      name: z.string().trim().min(2).max(120),
      ownerEmail: z.email().transform((value) => value.toLowerCase().trim()),
      temporaryPassword: password,
    }).parse({
      name: formData.get("name"),
      ownerEmail: formData.get("ownerEmail"),
      temporaryPassword: formData.get("temporaryPassword"),
    });
    const slug = normalizeOrganizationSlug(String(formData.get("slug") || parsed.name));
    if (slug.length < 2) throw new Error("Informe um identificador válido para o cliente");
    await createTenant({
      ...parsed,
      slug,
      actorUserId: actor.id,
      defaultTimezone: getEnv().DEFAULT_TIMEZONE,
    });
    revalidatePath("/admin/clientes");
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    back(error);
  }
  redirect("/admin/clientes?ok=cliente-criado");
}

export async function setClientStatusAction(formData: FormData) {
  const actor = await requirePlatformAdmin();
  try {
    const parsed = z.object({
      organizationId: z.uuid(),
      status: z.enum(["ACTIVE", "SUSPENDED"]),
    }).parse({
      organizationId: formData.get("organizationId"),
      status: formData.get("status"),
    });
    await setTenantStatus({
      ...parsed,
      protectedOrganizationId: actor.organizationId,
      actorUserId: actor.id,
    });
    revalidatePath("/admin/clientes");
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    back(error);
  }
  redirect("/admin/clientes?ok=status-atualizado");
}

export async function resetClientPasswordAction(formData: FormData) {
  const actor = await requirePlatformAdmin();
  try {
    const parsed = z.object({
      organizationId: z.uuid(),
      ownerUserId: z.uuid(),
      temporaryPassword: password,
    }).parse({
      organizationId: formData.get("organizationId"),
      ownerUserId: formData.get("ownerUserId"),
      temporaryPassword: formData.get("temporaryPassword"),
    });
    await resetTenantOwnerPassword({
      ...parsed,
      protectedOrganizationId: actor.organizationId,
      actorUserId: actor.id,
    });
    revalidatePath("/admin/clientes");
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    back(error);
  }
  redirect("/admin/clientes?ok=senha-redefinida");
}
