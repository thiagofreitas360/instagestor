import Link from "next/link";
import { createFakeAccountsAction, disconnectAccountAction } from "@/app/actions";
import { getSqlClient } from "@/db/client";
import { EmptyState, formatDate, MessageBanner, PageHeader, Panel, StatusBadge, initials } from "@/components/ui";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { InstagramConnectButton } from "@/components/instagram-connect-button";
import { requireAdmin } from "@/server/auth";

type AccountRow = {
  id: string;
  username: string;
  display_name: string | null;
  profile_picture_url: string | null;
  account_type: string | null;
  status: string;
  token_expires_at: Date | null;
  publishing_limit_usage: number | null;
  publishing_limit_total: number | null;
  group_names: string[];
  published_count: number;
  last_published_at: Date | null;
  last_error_at: Date | null;
  last_error_message: string | null;
  group_ids: string[];
};
type GroupRow = { id: string; name: string };

type PageProps = {
  searchParams: Promise<{ erro?: string | string[]; ok?: string | string[]; filtro?: string | string[]; nicho?: string | string[]; busca?: string | string[] }>;
};

function first(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AccountsPage({ searchParams }: PageProps) {
  const user = await requireAdmin();
  const params = await searchParams;
  const sql = getSqlClient();
  const [accounts, groups] = await Promise.all([
    sql<AccountRow[]>`
      SELECT account.id, account.username, account.display_name, account.profile_picture_url, account.account_type, account.status,
        account.token_expires_at,
        account.last_error_at, account.last_error_message,
        account.publishing_limit_usage, account.publishing_limit_total,
        coalesce(array_agg(DISTINCT group_row.name ORDER BY group_row.name)
          FILTER (WHERE group_row.name IS NOT NULL), '{}') AS group_names,
        coalesce(array_agg(DISTINCT group_row.id::text)
          FILTER (WHERE group_row.id IS NOT NULL), '{}') AS group_ids,
        count(DISTINCT job.id) FILTER (WHERE job.status = 'PUBLISHED')::int AS published_count,
        max(job.published_at) FILTER (WHERE job.status = 'PUBLISHED') AS last_published_at
      FROM instagram_accounts account
      LEFT JOIN account_group_members member ON member.organization_id = account.organization_id
        AND member.instagram_account_id = account.id
      LEFT JOIN account_groups group_row ON group_row.organization_id = account.organization_id AND group_row.id = member.group_id
      LEFT JOIN publication_jobs job ON job.organization_id = account.organization_id AND job.instagram_account_id = account.id
      WHERE account.organization_id = ${user.organizationId}
      GROUP BY account.id
      ORDER BY
        CASE account.status
          WHEN 'REAUTH_REQUIRED' THEN 0 WHEN 'ERROR' THEN 1 WHEN 'TOKEN_EXPIRING' THEN 2
          WHEN 'CONNECTED' THEN 3 ELSE 4
        END,
        account.username
    `,
    sql<GroupRow[]>`SELECT id, name FROM account_groups WHERE organization_id = ${user.organizationId} ORDER BY name`,
  ]);
  const fakeMode = process.env.INSTAGRAM_PROVIDER === "fake"
    && (process.env.NODE_ENV !== "production" || process.env.ALLOW_FAKE_PROVIDER_IN_PRODUCTION === "true");
  const connected = accounts.filter((account) => ["CONNECTED", "TOKEN_EXPIRING"].includes(account.status)).length;
  const needsAttention = accounts.filter((account) => ["REAUTH_REQUIRED", "ERROR"].includes(account.status)).length;
  const selectedFilter = first(params.filtro) ?? "todas";
  const requestedNiche = first(params.nicho);
  const selectedNiche = groups.some((group) => group.id === requestedNiche) ? requestedNiche : undefined;
  const search = (first(params.busca) ?? "").trim();
  const normalizedSearch = search.toLocaleLowerCase("pt-BR").replace(/^@/, "");
  const filteredAccounts = accounts.filter((account) => {
    if (selectedNiche && !account.group_ids.includes(selectedNiche)) return false;
    if (normalizedSearch && !account.username.toLocaleLowerCase("pt-BR").includes(normalizedSearch)
      && !account.display_name?.toLocaleLowerCase("pt-BR").includes(normalizedSearch)) return false;
    if (selectedFilter === "conectadas") return account.status === "CONNECTED";
    if (selectedFilter === "problema") return ["ERROR", "DISABLED"].includes(account.status);
    if (selectedFilter === "expirando") return account.status === "TOKEN_EXPIRING";
    if (selectedFilter === "reconectar") return account.status === "REAUTH_REQUIRED";
    if (selectedFilter === "banidas") return account.status === "BANNED";
    return true;
  });

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Canais"
        title="Contas do Instagram"
        description={`${connected} de ${accounts.length} contas disponíveis para publicação${needsAttention ? ` · ${needsAttention} precisam de atenção` : ""}.`}
        actions={
          <InstagramConnectButton>Conectar Instagram</InstagramConnectButton>
        }
      />
      <MessageBanner error={first(params.erro)} success={first(params.ok)} />

      <form className="analytics-filters" method="get" action="/contas">
        {selectedFilter !== "todas" ? <input type="hidden" name="filtro" value={selectedFilter} /> : null}
        <label>
          Buscar conta
          <input name="busca" type="search" defaultValue={search} placeholder="@usuario ou nome" />
        </label>
        <label>
          Nicho / grupo
          <select name="nicho" defaultValue={selectedNiche ?? ""}>
            <option value="">Todos os nichos</option>
            {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
          </select>
        </label>
        <button className="button button-secondary" type="submit">Aplicar nicho</button>
      </form>

      <nav className="page-actions" aria-label="Filtrar contas">
        {[
          ["todas", "Todas"],
          ["conectadas", "Conectadas"],
          ["problema", "Problema"],
          ["expirando", "Expirando"],
          ["reconectar", "Reconectar"],
          ["banidas", "Banidas"],
        ].map(([value, label]) => (
          <Link
            className={`button button-small ${selectedFilter === value ? "button-primary" : "button-secondary"}`}
            href={`/contas?${new URLSearchParams({
              ...(value === "todas" ? {} : { filtro: value }),
              ...(selectedNiche ? { nicho: selectedNiche } : {}),
              ...(search ? { busca: search } : {}),
            }).toString()}`.replace(/\?$/, "")}
            key={value}
          >
            {label}
          </Link>
        ))}
      </nav>

      {fakeMode ? (
        <Panel className="dev-panel" title="Ambiente de desenvolvimento" description="Crie contas simuladas para testar o fluxo completo sem chamar a Meta.">
          <form className="inline-form" action={createFakeAccountsAction}>
            <label>
              Quantidade
              <input name="count" type="number" min="1" max="200" defaultValue="10" required />
            </label>
            <button className="button button-secondary" type="submit">
              Criar contas fake
            </button>
          </form>
        </Panel>
      ) : null}

      <Panel>
        {filteredAccounts.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Conta</th>
                  <th scope="col">Status</th>
                  <th scope="col">Limite de publicação</th>
                  <th scope="col">Nichos / grupos</th>
                  <th scope="col">Publicações</th>
                  <th scope="col" className="table-action-column">Ação</th>
                </tr>
              </thead>
              <tbody>
                {filteredAccounts.map((account) => {
                  const total = account.publishing_limit_total ?? 0;
                  const usage = account.publishing_limit_usage ?? 0;
                  const usagePercent = total ? Math.min(100, Math.round((usage / total) * 100)) : 0;
                  return (
                    <tr key={account.id}>
                      <td data-label="Conta">
                        <Link className="account-cell" href={`/contas/${account.id}`}>
                          <span className="account-avatar" aria-hidden="true">
                            {account.profile_picture_url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={account.profile_picture_url} alt="" loading="lazy" referrerPolicy="no-referrer" />
                            ) : initials(account.display_name ?? account.username)}
                          </span>
                          <span>
                            <strong>{account.display_name ?? `@${account.username}`}</strong>
                            <small>@{account.username}{account.account_type ? ` · ${account.account_type}` : ""}</small>
                          </span>
                        </Link>
                      </td>
                      <td data-label="Status" className="cell-wrap">
                        <StatusBadge status={account.status} />
                        {account.token_expires_at ? <small>Token até {formatDate(account.token_expires_at, { dateOnly: true })}</small> : null}
                        {account.last_error_message ? (
                          <small className="error-copy account-last-error" title={account.last_error_message}>
                            Último erro: {account.last_error_message}
                            {account.last_error_at ? ` · ${formatDate(account.last_error_at)}` : ""}
                          </small>
                        ) : null}
                      </td>
                      <td data-label="Limite de publicação">
                        {total ? (
                          <div className="quota-cell">
                            <span>{usage} de {total}</span>
                            <div className="progress-track progress-compact" aria-label={`${usagePercent}% do limite utilizado`}>
                              <div className="progress-value" style={{ width: `${usagePercent}%` }} />
                            </div>
                          </div>
                        ) : <span className="muted">Não consultado</span>}
                      </td>
                      <td data-label="Nichos / grupos">
                        {account.group_names.length ? (
                          <span className="mini-tag-list" title={account.group_names.join(", ")}>
                            {account.group_names.slice(0, 2).map((name) => <span key={name}>{name}</span>)}
                            {account.group_names.length > 2 ? <small>+{account.group_names.length - 2}</small> : null}
                          </span>
                        ) : <span className="muted">Nenhum</span>}
                      </td>
                      <td data-label="Publicações">
                        <span className="table-main-value">{account.published_count}</span>
                        <small>Última: {formatDate(account.last_published_at)}</small>
                      </td>
                      <td data-label="Ação" className="table-action-column">
                        <div className="table-actions">
                          {account.status === "REAUTH_REQUIRED" ? <InstagramConnectButton accountId={account.id} className="button button-small button-primary">Reconectar</InstagramConnectButton> : null}
                          <Link className="button button-small button-secondary" href={`/contas/${account.id}`}>Detalhes</Link>
                          {!(["DISCONNECTED", "DISABLED", "BANNED"].includes(account.status)) ? (
                            <form action={disconnectAccountAction}>
                              <input type="hidden" name="accountId" value={account.id} />
                              <ConfirmSubmitButton className="button button-small button-quiet-danger" message={`Desconectar @${account.username}? Publicações pendentes dessa conta serão canceladas.`}>Desconectar</ConfirmSubmitButton>
                            </form>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title={accounts.length ? "Nenhuma conta neste filtro" : "Nenhuma conta conectada"}
            description={accounts.length ? "Escolha outro filtro para ver as demais contas." : "Conecte uma conta profissional do Instagram para começar a publicar."}
            href={accounts.length ? "/contas" : undefined}
            actionLabel={accounts.length ? "Mostrar todas" : undefined}
            action={<InstagramConnectButton className="button button-secondary">Conectar Instagram</InstagramConnectButton>}
          />
        )}
      </Panel>
    </div>
  );
}
