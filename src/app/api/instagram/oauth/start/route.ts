import { z } from "zod";
import { getEnv } from "@/lib/env";
import { log } from "@/lib/logger";
import { requireAdminApi } from "@/server/auth";
import { createOauthState } from "@/server/accounts";
import { MetaInstagramProvider } from "@/providers";

export async function GET(request: Request) {
  let user: Awaited<ReturnType<typeof requireAdminApi>>;
  try {
    user = await requireAdminApi();
  } catch (error) {
    // Sem sessão (ex.: popup aberto após expirar o login): leva ao login em vez de 500.
    if (error instanceof Response) return Response.redirect(`${getEnv().APP_URL}/login`, 302);
    throw error;
  }
  const account = new URL(request.url).searchParams.get("account");
  const targetAccountId = account ? z.uuid().safeParse(account).data : undefined;
  try {
    if (account && !targetAccountId) throw new Error("Conta para reconexão inválida");
    const state = await createOauthState(user.organizationId, user.id, targetAccountId);
    log("info", "oauth", "oauth_started", { organizationId: user.organizationId, reconnect: Boolean(targetAccountId) });
    return Response.redirect(new MetaInstagramProvider().authorizationUrl(state), 302);
  } catch (error) {
    log("warn", "oauth", "oauth_start_failed", { organizationId: user.organizationId, message: (error as Error).message });
    return Response.redirect(`${getEnv().APP_URL}/instagram/oauth/complete?result=connection_failed`, 302);
  }
}
