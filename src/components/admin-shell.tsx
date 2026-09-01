import Link from "next/link";
import { logoutAction } from "@/app/actions";

const navigation = [
  { href: "/dashboard", label: "Dashboard", mark: "D" },
  { href: "/contas", label: "Contas", mark: "@" },
  { href: "/grupos", label: "Grupos", mark: "G" },
  { href: "/midias", label: "Mídias", mark: "M" },
  { href: "/campanhas", label: "Campanhas", mark: "C" },
  { href: "/fila", label: "Fila", mark: "F" },
  { href: "/configuracoes", label: "Configurações", mark: "⚙" },
] as const;

function Brand() {
  return (
    <Link className="brand" href="/dashboard" aria-label="InstaGestor — ir para o dashboard">
      <span className="brand-mark" aria-hidden="true">
        IG
      </span>
      <span>
        <strong>InstaGestor</strong>
        <small>Publicação em escala</small>
      </span>
    </Link>
  );
}

function Navigation() {
  return (
    <nav aria-label="Navegação principal">
      <ul className="nav-list">
        {navigation.map((item) => (
          <li key={item.href}>
            <Link className="nav-link" href={item.href}>
              <span className="nav-mark" aria-hidden="true">
                {item.mark}
              </span>
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function AdminShell({ email, children }: { email: string; children: React.ReactNode }) {
  return (
    <div className="admin-shell">
      <a className="skip-link" href="#conteudo">
        Pular para o conteúdo
      </a>

      <aside className="sidebar">
        <Brand />
        <div className="sidebar-section-label">Operação</div>
        <Navigation />
        <div className="sidebar-user">
          <span className="avatar" aria-hidden="true">
            {email.slice(0, 1).toUpperCase()}
          </span>
          <span className="sidebar-user-copy">
            <strong>Administrador</strong>
            <small title={email}>{email}</small>
          </span>
          <form action={logoutAction}>
            <button className="icon-button" type="submit" title="Sair" aria-label="Sair da conta">
              ↗
            </button>
          </form>
        </div>
      </aside>

      <header className="mobile-header">
        <Brand />
        <details className="mobile-menu">
          <summary aria-label="Abrir menu">Menu</summary>
          <div className="mobile-menu-panel">
            <Navigation />
            <form action={logoutAction}>
              <button className="button button-secondary button-block" type="submit">
                Sair de {email}
              </button>
            </form>
          </div>
        </details>
      </header>

      <main className="main-content" id="conteudo" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
