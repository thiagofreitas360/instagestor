import Link from "next/link";
import { logoutAction } from "@/app/actions";
import { AppNav } from "@/components/app-nav";
import { AppTopbar } from "@/components/app-topbar";

function Brand() {
  return (
    <Link className="brand" href="/dashboard" aria-label="redegestor — ir para o dashboard">
      <span className="brand-mark" aria-hidden="true">
        RG
      </span>
      <span>
        <strong>redegestor</strong>
        <small>Agendamento e análise</small>
      </span>
    </Link>
  );
}

function LogoutButton() {
  return (
    <form action={logoutAction}>
      <button className="icon-button" type="submit" title="Sair" aria-label="Sair da conta">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <polyline points="16 17 21 12 16 7" />
          <line x1="21" y1="12" x2="9" y2="12" />
        </svg>
      </button>
    </form>
  );
}

export function AdminShell({
  email,
  organizationName,
  theme,
  isPlatformAdmin,
  children,
}: {
  email: string;
  organizationName: string;
  theme: "LIGHT" | "DARK";
  isPlatformAdmin: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="admin-shell" data-theme={theme}>
      <a className="skip-link" href="#conteudo">
        Pular para o conteúdo
      </a>

      <aside className="sidebar">
        <Brand />
        <AppNav isPlatformAdmin={isPlatformAdmin} />
        <div className="sidebar-user">
          <span className="avatar" aria-hidden="true">
            {organizationName.slice(0, 1).toUpperCase()}
          </span>
          <LogoutButton />
        </div>
      </aside>

      <header className="mobile-header">
        <Brand />
        <details className="mobile-menu">
          <summary aria-label="Abrir menu">Menu</summary>
          <div className="mobile-menu-panel">
            <AppNav isPlatformAdmin={isPlatformAdmin} />
            <form action={logoutAction}>
              <button className="button button-secondary button-block" type="submit">
                Sair de {email}
              </button>
            </form>
          </div>
        </details>
      </header>

      <main className="main-content" id="conteudo" tabIndex={-1}>
        <AppTopbar organizationName={organizationName} email={email} />
        <div className="main-inner">{children}</div>
      </main>
    </div>
  );
}
