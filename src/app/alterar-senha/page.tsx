import { redirect } from "next/navigation";
import { logoutAction } from "@/app/actions";
import { changeTemporaryPasswordAction } from "./actions";
import { getSqlClient } from "@/db/client";
import { currentUser } from "@/server/auth";

export const dynamic = "force-dynamic";

export default async function ChangePasswordPage({ searchParams }: {
  searchParams: Promise<{ erro?: string | string[] }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!user.mustChangePassword) redirect("/dashboard");
  const [settings] = await getSqlClient()<Array<{ theme: "LIGHT" | "DARK" }>>`
    SELECT theme FROM settings WHERE organization_id = ${user.organizationId}
  `;
  const query = await searchParams;
  const error = Array.isArray(query.erro) ? query.erro[0] : query.erro;

  return (
    <div data-theme={settings?.theme ?? "LIGHT"}>
      <main className="login-shell">
        <section className="login-card" aria-labelledby="password-title">
          <div className="brand-mark" aria-hidden="true">IG</div>
          <p className="eyebrow">Primeiro acesso</p>
          <h1 id="password-title">Crie sua senha</h1>
          <p className="muted">Substitua a senha temporária antes de acessar {user.organizationName}.</p>
          {error ? <p className="inline-error" role="alert">{error}</p> : null}
          <form action={changeTemporaryPasswordAction} className="form-stack">
            <label>
              Nova senha
              <input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required />
            </label>
            <label>
              Confirmar nova senha
              <input name="confirmation" type="password" autoComplete="new-password" minLength={12} maxLength={128} required />
            </label>
            <p className="form-hint">Use pelo menos 12 caracteres e não reutilize senhas de outros serviços.</p>
            <button type="submit" className="button button-primary button-block">Salvar nova senha</button>
          </form>
          <form action={logoutAction}>
            <button type="submit" className="button button-ghost button-block">Sair</button>
          </form>
        </section>
      </main>
    </div>
  );
}
