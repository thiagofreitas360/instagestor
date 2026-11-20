"use client";

import { useState } from "react";

export function CopyWebhook({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard indisponível */
    }
  }
  return (
    <div className="webhook-copy">
      <code className="webhook-url" title={url}>{url}</code>
      <button type="button" className="button button-small button-primary" onClick={copy}>
        {copied ? "Copiado!" : "Copiar"}
      </button>
    </div>
  );
}
