import { saveSettingsAction } from "@/app/actions";
import { getSqlClient } from "@/db/client";
import { DefinitionList, MessageBanner, PageHeader, Panel } from "@/components/ui";

type Settings = {
  default_timezone: string;
  default_delay_mode: "FIXED" | "RANDOM";
  default_delay_min: number;
  default_delay_max: number;
  updated_at: Date;
};
type PageProps = { searchParams: Promise<{ erro?: string | string[]; ok?: string | string[] }> };
function first(value?: string | string[]) { return Array.isArray(value) ? value[0] : value; }

export default async function SettingsPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const [stored] = await getSqlClient()<Settings[]>`SELECT * FROM settings WHERE id = true`;
  const settings = stored ?? {
    default_timezone: "America/Sao_Paulo",
    default_delay_mode: "FIXED" as const,
    default_delay_min: 120,
    default_delay_max: 300,
    updated_at: new Date(),
  };
  const provider = process.env.INSTAGRAM_PROVIDER === "meta" ? "Meta Instagram API" : "Provedor simulado";

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Administração"
        title="Configurações"
        description="Padrões seguros para novos agendamentos. Cada campanha pode sobrescrevê-los antes da confirmação."
      />
      <MessageBanner
        error={first(query.erro)}
        success={first(query.ok) === "salvo" ? "Preferências salvas." : first(query.ok)}
      />

      <section className="settings-grid">
        <Panel title="Padrões de agendamento" description="Valores sugeridos ao criar o cronograma de uma campanha.">
          <form className="form-stack" action={saveSettingsAction}>
            <label>
              Fuso horário padrão
              <select name="timezone" defaultValue={settings.default_timezone}>
                <option value="America/Sao_Paulo">America/Sao_Paulo (Brasília)</option>
                <option value="America/Manaus">America/Manaus</option>
                <option value="America/Recife">America/Recife</option>
                <option value="America/Fortaleza">America/Fortaleza</option>
                <option value="America/Rio_Branco">America/Rio_Branco</option>
              </select>
            </label>
            <label>
              Modo de intervalo padrão
              <select name="delayMode" defaultValue={settings.default_delay_mode}>
                <option value="FIXED">Fixo</option>
                <option value="RANDOM">Aleatório dentro de uma faixa</option>
              </select>
            </label>
            <div className="form-grid form-grid-two">
              <label>
                Intervalo mínimo (segundos)
                <input name="delayMin" type="number" min="0" max="86400" defaultValue={settings.default_delay_min} required />
              </label>
              <label>
                Intervalo máximo (segundos)
                <input name="delayMax" type="number" min="0" max="86400" defaultValue={settings.default_delay_max} required />
              </label>
            </div>
            <p className="form-hint">Um ritmo conservador reduz picos de chamadas. O máximo nunca pode ser menor que o mínimo.</p>
            <button className="button button-primary" type="submit">Salvar preferências</button>
          </form>
        </Panel>

        <div className="settings-side-stack">
          <Panel title="Ambiente" description="Informações não sensíveis da instalação atual.">
            <DefinitionList items={[
              { label: "Provedor", value: provider },
              { label: "Modo", value: process.env.NODE_ENV === "production" ? "Produção" : "Desenvolvimento" },
              { label: "Concorrência global", value: process.env.META_GLOBAL_CONCURRENCY ?? "Padrão conservador" },
              { label: "Concorrência por conta", value: process.env.META_ACCOUNT_CONCURRENCY ?? "Padrão conservador" },
              { label: "Worker", value: process.env.WORKER_CONCURRENCY ?? "Configuração padrão" },
            ]} />
          </Panel>
          <Panel className="security-note" title="Segurança de credenciais">
            <p>Tokens, senhas e chaves não são exibidos nem editados nesta interface. Altere segredos somente nas variáveis protegidas do ambiente.</p>
          </Panel>
        </div>
      </section>
    </div>
  );
}
