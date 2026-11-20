"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "rg-privacy";

export function AppTopbar({ organizationName, email }: { organizationName: string; email: string }) {
  const [privacy, setPrivacy] = useState(false);

  // Restaura preferência (fica só neste navegador; não é segredo, é conveniência de gravação de tela).
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) === "on";
      setPrivacy(saved);
      document.body.toggleAttribute("data-privacy", saved);
    } catch {
      /* ignora storage indisponível */
    }
  }, []);

  function toggle() {
    const next = !privacy;
    setPrivacy(next);
    document.body.toggleAttribute("data-privacy", next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? "on" : "off");
    } catch {
      /* ignora */
    }
  }

  return (
    <div className="app-topbar">
      <div className="app-topbar-brand">
        <strong title={organizationName}>{organizationName}</strong>
        <small title={email}>{email}</small>
      </div>
      <div className="app-topbar-actions">
        <button
          type="button"
          className={`topbar-button${privacy ? " is-active" : ""}`}
          onClick={toggle}
          aria-pressed={privacy}
          title={privacy ? "Mostrar valores" : "Ocultar valores (modo privacidade)"}
        >
          {privacy ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07A3 3 0 1 1 9.9 9.9" />
              <path d="M6.6 6.6A18.4 18.4 0 0 0 2 12s3 8 10 8a9.1 9.1 0 0 0 5.4-1.6" />
              <line x1="2" y1="2" x2="22" y2="22" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M2 12s3-8 10-8 10 8 10 8-3 8-10 8-10-8-10-8Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
          <span className="sr-only">Modo privacidade</span>
        </button>
      </div>
    </div>
  );
}
