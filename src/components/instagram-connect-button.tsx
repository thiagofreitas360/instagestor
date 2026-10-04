"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  OAUTH_MESSAGE_TYPE,
  OAUTH_RESULT_MESSAGES,
  oauthFallbackUrl,
  parseOauthMessage,
  type OauthResult,
} from "@/lib/oauth-result";

type Status = "waiting" | "blocked" | "closed" | OauthResult;

const STATUS_COPY: Record<"waiting" | "blocked" | "closed", string> = {
  waiting: "Conclua a autorização na janela oficial da Meta. Esta tela será atualizada automaticamente.",
  blocked: "O navegador bloqueou a janela de autorização. Continue nesta aba ou permita pop-ups para este site.",
  closed: "A janela da Meta foi fechada. Se você concluiu a autorização, a lista já foi atualizada.",
};

export function InstagramConnectButton({
  accountId,
  className = "button button-primary",
  children,
}: {
  accountId?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const popup = useRef<Window | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const startUrl = `/api/instagram/oauth/start${accountId ? `?account=${encodeURIComponent(accountId)}` : ""}`;

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

  function start() {
    popup.current = window.open(startUrl, "instagestor-instagram-oauth", "popup,width=560,height=760");
    setStatus(popup.current ? "waiting" : "blocked");
    if (!dialog.current?.open) dialog.current?.showModal();
  }

  function onClose() {
    if (status === "waiting") popup.current?.close();
    popup.current = null;
    setStatus(null);
  }

  const message = status ? (status in STATUS_COPY ? STATUS_COPY[status as keyof typeof STATUS_COPY] : OAUTH_RESULT_MESSAGES[status as OauthResult]) : "";
  const failed = status !== null && !["waiting", "success"].includes(status);

  return (
    <>
      <button className={className} type="button" onClick={start}>{children}</button>
      <dialog ref={dialog} className="oauth-dialog panel" aria-labelledby="oauth-dialog-title" onClose={onClose}>
        <h2 id="oauth-dialog-title">{accountId ? "Reconectar Instagram" : "Conectar Instagram"}</h2>
        <p role="status" aria-live="polite">{message}</p>
        <p className="muted">O InstaGestor nunca pede sua senha do Instagram: o acesso é concedido pela Meta e pode ser revogado a qualquer momento.</p>
        <form method="dialog" className="oauth-dialog-actions">
          {status === "waiting" || status === "blocked" ? (
            <a className="button button-secondary" href={startUrl}>Continuar nesta aba</a>
          ) : null}
          {failed ? <button className="button button-secondary" type="button" onClick={start}>Tentar novamente</button> : null}
          <button className={status === "success" ? "button button-primary" : "button button-ghost"} type="submit">
            {status === "waiting" ? "Cancelar" : "Fechar"}
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
