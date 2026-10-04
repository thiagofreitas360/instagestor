"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { currentUser, setSession } from "@/server/auth";
import { changeTemporaryPassword } from "@/server/tenants";

export async function changeTemporaryPasswordAction(formData: FormData) {
  const user = await currentUser();
  if (!user) redirect("/login");
  try {
    const parsed = z.object({
      password: z.string().min(12, "A nova senha deve ter pelo menos 12 caracteres").max(128),
      confirmation: z.string(),
    }).parse({
      password: formData.get("password"),
      confirmation: formData.get("confirmation"),
    });
    if (parsed.password !== parsed.confirmation) throw new Error("A confirmação da senha não confere");
    const sessionVersion = await changeTemporaryPassword(user.id, parsed.password);
    await setSession({ ...user, mustChangePassword: false, sessionVersion });
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    const message = error instanceof Error ? error.message : "Não foi possível alterar a senha";
    redirect(`/alterar-senha?erro=${encodeURIComponent(message)}`);
  }
  redirect("/dashboard");
}
