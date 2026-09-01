import { getEnv } from "@/lib/env";
import { connectFromAuthorizationCode } from "@/server/accounts";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const code = query.get("code")?.replace(/#_$/, "");
  const state = query.get("state");
  if (!code || !state) return Response.redirect(`${getEnv().APP_URL}/contas?erro=OAuth%20incompleto`, 302);
  try {
    const accountId = await connectFromAuthorizationCode(code, state);
    return Response.redirect(`${getEnv().APP_URL}/contas/${accountId}?ok=conectada`, 302);
  } catch {
    const reason = encodeURIComponent("Não foi possível concluir a conexão com o Instagram");
    return Response.redirect(`${getEnv().APP_URL}/contas?erro=${reason}`, 302);
  }
}
