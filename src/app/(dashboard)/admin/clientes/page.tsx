import { randomBytes } from "node:crypto";
import {
  createClientAction,
  resetClientPasswordAction,
  setClientStatusAction,
} from "./actions";
import { formatDate, MessageBanner, PageHeader, Panel, StatusBadge } from "@/components/ui";
import { requirePlatformAdmin } from "@/server/auth";
import { listTenants } from "@/server/tenants";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ erro?: string | string[]; ok?: string | string[] }>;
};

function first(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

function temporaryPassword() {
  return randomBytes(15).toString("base64url");
}

const successMessages: Record<string, string> = {
  "cliente-criado": "Cliente criado. Envie o e-mail e a senha temporária por um canal seguro.",
  "status-atualizado": "Status do cliente atualizado.",
  "senha-redefinida": "Senha temporária redefinida e sessões anteriores revogadas.",
};

export default async function ClientsPage({ searchParams }: PageProps) {
  const user = await requirePlatformAdmin();
  const [clients, query] = await Promise.all([listTenants(), searchParams]);
  const success = first(query.ok);

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Plataforma"
        title="Clientes"
        description="Crie ambientes isolados, controle o acesso e acompanhe a ativação de cada operação."
      />
      <MessageBanner error={first(query.erro)} success={success ? successMessages[success] ?? success : undefined} />

      <div className="tenant-admin-layout">
        <Panel
          className="tenant-create-panel sticky-panel"
          title="Novo cliente"
          description="Cria a organização e o primeiro acesso de proprietário."
        >
          <form className="form-stack" action={createClientAction}>
            <label>
              Nome da empresa
              <input name="name" type="text" minLength={2} maxLength={120} autoComplete="organization" required />
            </label>
            <label>
              Identificador
              <input name="slug" type="text" maxLength={80} placeholder="gerado pelo nome se ficar vazio" />
              <span className="form-hint">Somente letras, números e hífens.</span>
            </label>
            <label>
              E-mail do proprietário
              <input name="ownerEmail" type="email" maxLength={254} autoComplete="off" required />
            </label>
            <label>
              Senha temporária
              <input
                className="credential-input"
                name="temporaryPassword"
                type="text"
                minLength={12}
                maxLength={128}
                defaultValue={temporaryPassword()}
                autoComplete="off"
                required
              />
            </label>
            <p className="form-hint">Copie a senha antes de criar. O cliente terá de substituí-la no primeiro login.</p>
            <button className="button button-primary button-block" type="submit">Criar cliente</button>
          </form>
        </Panel>

        <Panel
          className="tenant-list-panel"
          title={`Organizações (${clients.length})`}
          description="A suspensão interrompe novos acessos e invalida a navegação de sessões ativas."
        >
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Proprietário</th>
                  <th>Uso</th>
                  <th>Status</th>
                  <th className="table-action-column">Ações</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((client) => {
                  const isPrimary = client.id === user.organizationId;
                  return (
                    <tr key={client.id}>
                      <td data-label="Cliente">
                        <strong className="table-main-value">{client.name}</strong>
                        <small>{client.slug} · desde {formatDate(client.created_at, { dateOnly: true })}</small>
                      </td>
                      <td data-label="Proprietário">
                        <span className="table-main-value">{client.owner_email ?? "Sem proprietário"}</span>
                        <small>
                          {client.owner_last_login_at
                            ? `Último acesso ${formatDate(client.owner_last_login_at)}`
                            : "Ainda não acessou"}
                        </small>
                      </td>
                      <td data-label="Uso">
                        <span className="table-main-value">{client.account_count} conta(s)</span>
                        <small>{client.member_count} usuário(s)</small>
                      </td>
                      <td data-label="Status">
                        <StatusBadge status={client.status} label={client.status === "ACTIVE" ? "Ativo" : "Suspenso"} />
                        {client.owner_must_change_password ? <small>Senha temporária pendente</small> : null}
                      </td>
                      <td className="table-action-column" data-label="Ações">
                        {isPrimary ? (
                          <span className="status-badge">Organização principal</span>
                        ) : (
                          <div className="tenant-actions">
                            <form action={setClientStatusAction}>
                              <input type="hidden" name="organizationId" value={client.id} />
                              <input type="hidden" name="status" value={client.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE"} />
                              <button
                                className={`button button-small ${client.status === "ACTIVE" ? "button-quiet-danger" : "button-secondary"}`}
                                type="submit"
                              >
                                {client.status === "ACTIVE" ? "Suspender" : "Reativar"}
                              </button>
                            </form>
                            {client.owner_user_id ? (
                              <details className="native-disclosure tenant-password-reset">
                                <summary>Redefinir senha</summary>
                                <form action={resetClientPasswordAction}>
                                  <input type="hidden" name="organizationId" value={client.id} />
                                  <input type="hidden" name="ownerUserId" value={client.owner_user_id} />
                                  <label>
                                    Nova senha temporária
                                    <input
                                      className="credential-input"
                                      name="temporaryPassword"
                                      type="text"
                                      minLength={12}
                                      maxLength={128}
                                      defaultValue={temporaryPassword()}
                                      autoComplete="off"
                                      required
                                    />
                                  </label>
                                  <p className="form-hint">Copie antes de salvar. As sessões atuais serão encerradas.</p>
                                  <button className="button button-primary button-small button-block" type="submit">Salvar nova senha</button>
                                </form>
                              </details>
                            ) : null}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </div>
  );
}
