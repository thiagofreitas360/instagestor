import { z } from "zod";
import { getEnv } from "@/lib/env";
import { log } from "@/lib/logger";
import { requireAdminApi } from "@/server/auth";
import { createOauthState } from "@/server/accounts";
import { MetaInstagramProvider } from "@/providers";

export async function GET(request: Request) {
  const user = await requireAdminApi();
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
