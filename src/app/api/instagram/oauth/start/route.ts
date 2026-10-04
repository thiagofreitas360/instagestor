import { z } from "zod";
import { getEnv } from "@/lib/env";
import { log } from "@/lib/logger";
import { requireAdminApi } from "@/server/auth";
import { createOauthState } from "@/server/accounts";
import { getMetaAppCredentials } from "@/server/meta-apps";
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
  const query = new URL(request.url).searchParams;
  const account = query.get("account");
  const targetAccountId = account ? z.uuid().safeParse(account).data : undefined;
  const app = query.get("app");
  const metaAppId = app ? z.uuid().safeParse(app).data : undefined;
  try {
    if (account && !targetAccountId) throw new Error("Conta para reconexão inválida");
    if (app && !metaAppId) throw new Error("Meta App inválido");
    // Sem app escolhido, vale o app central de INSTAGRAM_APP_ID.
    const appId = metaAppId ? (await getMetaAppCredentials(user.organizationId, metaAppId)).appId : undefined;
    const state = await createOauthState(user.organizationId, user.id, targetAccountId, metaAppId);
    log("info", "oauth", "oauth_started", {
      organizationId: user.organizationId, reconnect: Boolean(targetAccountId), metaAppId: metaAppId ?? null,
    });
    return Response.redirect(new MetaInstagramProvider().authorizationUrl(state, appId), 302);
  } catch (error) {
    log("warn", "oauth", "oauth_start_failed", { organizationId: user.organizationId, message: (error as Error).message });
    return Response.redirect(`${getEnv().APP_URL}/instagram/oauth/complete?result=connection_failed`, 302);
  }
}
