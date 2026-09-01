import { requireAdminApi } from "@/server/auth";
import { createOauthState } from "@/server/accounts";
import { MetaInstagramProvider } from "@/providers";

export async function GET() {
  await requireAdminApi();
  const state = await createOauthState();
  return Response.redirect(new MetaInstagramProvider().authorizationUrl(state), 302);
}
