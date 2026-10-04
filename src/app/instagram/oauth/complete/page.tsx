import { getEnv } from "@/lib/env";
import { OAUTH_RESULT_MESSAGES, parseOauthResult } from "@/lib/oauth-result";
import { OauthCompleteNotifier } from "@/components/instagram-connect-button";

type PageProps = { searchParams: Promise<{ result?: string | string[] }> };

export default async function OauthCompletePage({ searchParams }: PageProps) {
  const { result: raw } = await searchParams;
  const result = parseOauthResult(Array.isArray(raw) ? raw[0] : raw) ?? "connection_failed";
  return (
    <main className="oauth-complete">
      <p role="status">{OAUTH_RESULT_MESSAGES[result]}</p>
      <OauthCompleteNotifier result={result} targetOrigin={new URL(getEnv().APP_URL).origin} />
    </main>
  );
}
