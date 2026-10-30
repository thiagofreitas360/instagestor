function oauthStartUrl(accountId?: string) {
  return accountId ? `/api/instagram/oauth/start?account=${accountId}` : "/api/instagram/oauth/start";
}

/**
 * OAuth na própria aba: o callback volta para /contas com o resultado.
 * Conta nova vai sempre ao app oficial (INSTAGRAM_APP_ID); reconexão fica no app pelo qual a conta foi conectada,
 * decidido no servidor pela própria conta.
 */
export function InstagramConnectButton({
  accountId,
  className = "button button-primary",
  children,
}: {
  accountId?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return <a className={className} href={oauthStartUrl(accountId)}>{children}</a>;
}
