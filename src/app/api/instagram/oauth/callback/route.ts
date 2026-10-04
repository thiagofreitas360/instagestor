import { getEnv } from "@/lib/env";
import { log } from "@/lib/logger";
import { oauthFallbackUrl, oauthResultFromError, type OauthResult } from "@/lib/oauth-result";
import { connectFromAuthorizationCode } from "@/server/accounts";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const code = query.get("code")?.replace(/#_$/, "");
  const state = query.get("state");
  let result: OauthResult = "success";
  if (query.get("error")) result = query.get("error") === "access_denied" ? "cancelled" : "connection_failed";
  else if (!code || !state) result = "connection_failed";
  else {
    try {
      await connectFromAuthorizationCode(code, state);
    } catch (error) {
      result = oauthResultFromError(error);
      log("warn", "oauth", "oauth_callback_failed", { result, errorName: (error as Error).name });
    }
  }
  log("info", "oauth", "oauth_finished", { result });
  // Somente a mensagem fixa do resultado vai para a URL; nunca o código OAuth, token ou mensagem bruta da Meta.
  return Response.redirect(`${getEnv().APP_URL}${oauthFallbackUrl(result)}`, 302);
}
