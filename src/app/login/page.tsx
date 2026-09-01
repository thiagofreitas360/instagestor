import { redirect } from "next/navigation";
import { loginAction } from "@/app/actions";
import { currentUser } from "@/server/auth";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  if (await currentUser()) redirect("/");
  const { erro } = await searchParams;
  return (
    <main className="login-shell">
      <section className="login-card" aria-labelledby="login-title">
        <div className="brand-mark" aria-hidden="true">IG</div>
        <p className="eyebrow">Painel interno</p>
        <h1 id="login-title">Entrar no InstaGestor</h1>
        <p className="muted">Acesso exclusivo do administrador.</p>
        {erro && <p className="alert error" role="alert">{erro}</p>}
        <form action={loginAction} className="stack">
          <label>E-mail<input name="email" type="email" autoComplete="username" required /></label>
          <label>Senha<input name="password" type="password" autoComplete="current-password" minLength={8} required /></label>
          <button type="submit" className="button primary">Entrar</button>
        </form>
      </section>
    </main>
  );
}
