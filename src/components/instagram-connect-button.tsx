"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  OAUTH_MESSAGE_TYPE,
  OAUTH_RESULT_MESSAGES,
  oauthFallbackUrl,
  parseOauthMessage,
  type OauthResult,
} from "@/lib/oauth-result";
import type { MetaAppOption } from "@/server/meta-apps";

type Status = "picking" | "waiting" | "blocked" | "closed" | OauthResult;

const STATUS_COPY: Record<"picking" | "waiting" | "blocked" | "closed", string> = {
  picking: "Escolha o app em que a conta foi adicionada como testadora. Deixe o Instagram logado neste navegador.",
  waiting: "Conclua a autorização na janela oficial da Meta. Esta tela será atualizada automaticamente.",
  blocked: "O navegador bloqueou a janela de autorização. Continue nesta aba ou permita pop-ups para este site.",
  closed: "A janela da Meta foi fechada. Se você concluiu a autorização, a lista já foi atualizada.",
};

function oauthStartUrl(accountId?: string, app?: string) {
  const query = new URLSearchParams({ ...(accountId ? { account: accountId } : {}), ...(app ? { app } : {}) }).toString();
  return `/api/instagram/oauth/start${query ? `?${query}` : ""}`;
}

/** Sem apps do cliente usa o app central; com um, conecta direto; com dois ou mais, pergunta qual. */
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
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const popup = useRef<Window | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [appId, setAppId] = useState<string>();
  const startUrl = oauthStartUrl(accountId, appId);

  useEffect(() => {
    if (status !== "waiting") return;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || !popup.current || event.source !== popup.current) return;
      const result = parseOauthMessage(event.data);
      if (!result) return;
      setStatus(result);
      // O banco é a fonte de verdade: recarrega a lista do servidor em vez de confiar na mensagem.
      router.refresh();
    };
    const timer = window.setInterval(() => {
      if (!popup.current?.closed) return;
      setStatus("closed");
      router.refresh();
    }, 500);
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      window.clearInterval(timer);
    };
  }, [status, router]);

  function start(chosen?: string) {
    setAppId(chosen);
    popup.current = window.open(oauthStartUrl(accountId, chosen), "instagestor-instagram-oauth", "popup,width=560,height=760");
    setStatus(popup.current ? "waiting" : "blocked");
    if (!dialog.current?.open) dialog.current?.showModal();
  }

  function open() {
    if (apps.length < 2) return start(apps[0]?.id);
    setStatus("picking");
    dialog.current?.showModal();
  }

  function onClose() {
    if (status === "waiting") popup.current?.close();
    popup.current = null;
    setStatus(null);
  }

  const message = status ? (status in STATUS_COPY ? STATUS_COPY[status as keyof typeof STATUS_COPY] : OAUTH_RESULT_MESSAGES[status as OauthResult]) : "";
  const failed = status !== null && !["picking", "waiting", "success"].includes(status);
  const verb = accountId ? "Reconectar" : "Conectar";

  return (
    <>
      <button className={className} type="button" onClick={open}>{children}</button>
      <dialog ref={dialog} className="oauth-dialog panel" aria-labelledby="oauth-dialog-title" onClose={onClose}>
        <h2 id="oauth-dialog-title">{status === "picking" ? `${verb} via qual Meta App?` : `${verb} Instagram`}</h2>
        <p role="status" aria-live="polite">{message}</p>
        {status === "picking" ? (
          <>
            <ul className="meta-app-options">
              {apps.map((app) => (
                <li key={app.id}>
                  <button className="meta-app-option" type="button" onClick={() => start(app.id)}>
                    <strong>{app.name}</strong>
                    <small>{app.account_count} conta(s) vinculada(s)</small>
                  </button>
                </li>
              ))}
            </ul>
            <Link className="text-link" href="/meta-apps">Gerenciar Meta Apps →</Link>
          </>
        ) : (
          <p className="muted">O InstaGestor nunca pede sua senha do Instagram: o acesso é concedido pela Meta e pode ser revogado a qualquer momento.</p>
        )}
        <form method="dialog" className="oauth-dialog-actions">
          {status === "waiting" || status === "blocked" ? (
            <a className="button button-secondary" href={startUrl}>Continuar nesta aba</a>
          ) : null}
          {failed ? <button className="button button-secondary" type="button" onClick={() => start(appId)}>Tentar novamente</button> : null}
          <button className={status === "success" ? "button button-primary" : "button button-ghost"} type="submit">
            {status === "waiting" || status === "picking" ? "Cancelar" : "Fechar"}
          </button>
        </form>
      </dialog>
    </>
  );
}

/** Roda dentro do popup em /instagram/oauth/complete: avisa a janela principal e fecha. */
export function OauthCompleteNotifier({ result, targetOrigin }: { result: OauthResult; targetOrigin: string }) {
  useEffect(() => {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({ type: OAUTH_MESSAGE_TYPE, result }, targetOrigin);
      window.setTimeout(() => {
        window.close();
        // Se o navegador não permitir fechar, mostra o resultado na tela de contas.
        window.location.replace(oauthFallbackUrl(result));
      }, 300);
    } else {
      window.location.replace(oauthFallbackUrl(result));
    }
  }, [result, targetOrigin]);
  return null;
}
