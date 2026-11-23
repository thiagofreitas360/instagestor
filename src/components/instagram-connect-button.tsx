"use client";

import { useId, useRef } from "react";
import Link from "next/link";
import type { MetaAppOption } from "@/server/meta-apps";

function oauthStartUrl(accountId?: string, app?: string) {
  const query = new URLSearchParams({ ...(accountId ? { account: accountId } : {}), ...(app ? { app } : {}) }).toString();
  return `/api/instagram/oauth/start${query ? `?${query}` : ""}`;
}

/**
 * OAuth na própria aba: o callback volta para /contas com o resultado.
 * Sem apps do cliente usa o app central; com um, vai direto; com dois ou mais, pergunta qual.
 */
export function InstagramConnectButton({
  accountId,
  apps = [],
  className = "button button-primary",
  children,
}: {
  accountId?: string;
  apps?: MetaAppOption[];
  className?: string;
  children: React.ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  if (apps.length < 2) return <a className={className} href={oauthStartUrl(accountId, apps[0]?.id)}>{children}</a>;

  return (
    <>
      <button className={className} type="button" onClick={() => dialog.current?.showModal()}>{children}</button>
      <dialog ref={dialog} className="oauth-dialog panel" aria-labelledby={titleId}>
        <h2 id={titleId}>{accountId ? "Reconectar" : "Conectar"} via qual Meta App?</h2>
        <p>Escolha o app em que a conta foi adicionada como testadora. Deixe o Instagram logado neste navegador.</p>
        <ul className="meta-app-options">
          {apps.map((app) => (
            <li key={app.id}>
              <a className="meta-app-option" href={oauthStartUrl(accountId, app.id)}>
                <strong>{app.name}</strong>
                <small>{app.account_count} conta(s) vinculada(s)</small>
              </a>
            </li>
          ))}
        </ul>
        <Link className="text-link" href="/meta-apps">Gerenciar Meta Apps →</Link>
        <form method="dialog" className="oauth-dialog-actions">
          <button className="button button-ghost" type="submit">Cancelar</button>
        </form>
      </dialog>
    </>
  );
}
