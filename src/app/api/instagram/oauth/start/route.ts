import { requireAdminApi } from "@/server/auth";
import { createOauthState } from "@/server/accounts";
import { MetaInstagramProvider } from "@/providers";

export async function GET() {
  const user = await requireAdminApi();
  const state = await createOauthState(user.organizationId, user.id);
  return Response.redirect(new MetaInstagramProvider().authorizationUrl(state), 302);
}
