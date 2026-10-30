import Link from "next/link";
import { createFakeAccountsAction, disconnectAccountAction, setAccountsConnectionModeAction } from "@/app/actions";
import { getSqlClient } from "@/db/client";
import { EmptyState, formatDate, MessageBanner, MetricCard, PageHeader, Panel, StatusBadge, initials } from "@/components/ui";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { InstagramConnectButton } from "@/components/instagram-connect-button";
import { AccountBulkSelection } from "@/components/account-bulk-selection";
import { AccountWarmupBadge } from "@/components/account-warmup-badge";
import { AccountActivity } from "@/components/account-activity";
import { accountActivity, ACTIVITY_PERIODS, activityPeriodRange, type AccountActivityDates, type ActivityPeriod } from "@/lib/account-activity";
import { accountWarmup, WARMUP_PROFILES, type WarmupProfile } from "@/lib/account-warmup";
import { CONNECTION_MODES, connectionModeLabel, reconnectStatsByMode, type ConnectionMode } from "@/lib/account-connection-mode";
import { requireAdmin } from "@/server/auth";

type AccountRow = AccountActivityDates & {
  id: string;
  username: string;
  display_name: string | null;
  profile_picture_url: string | null;
  account_type: string | null;
  is_new_account: boolean;
  warmup_profile: WarmupProfile | null;
  connection_mode: ConnectionMode | null;
  created_at: Date;
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
  meta_app_name: string | null;
  has_loop: boolean;
};
type GroupRow = { id: string; name: string };

type PageProps = {
  searchParams: Promise<{ erro?: string | string[]; ok?: string | string[]; filtro?: string | string[]; nicho?: string | string[]; busca?: string | string[]; tipo?: string | string[]; perfil?: string | string[]; vinculo?: string | string[]; periodo?: string | string[]; conexao?: string | string[]; conectada?: string | string[]; conectadas_em?: string | string[] }>;
};

function first(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AccountsPage({ searchParams }: PageProps) {
  const user = await requireAdmin();
  const params = await searchParams;
  const sql = getSqlClient();
  const [accounts, groups, [setting]] = await Promise.all([
    sql<AccountRow[]>`
      SELECT account.id, account.username, account.display_name, account.profile_picture_url, account.account_type, account.status,
        account.token_expires_at, account.is_new_account, account.warmup_profile, account.connection_mode, account.created_at,
        account.instagram_user_id, account.authorized_at, account.active_started_at, account.active_ended_at,
        account.active_timing_estimated, account.disconnected_at, account.banned_at,
        now() AS activity_observed_at,
        EXISTS (SELECT 1 FROM loop_accounts linked WHERE linked.organization_id = account.organization_id
          AND linked.instagram_account_id = account.id) AS has_loop,
        account.last_error_at, account.last_error_message,
        account.publishing_limit_usage, account.publishing_limit_total,
        coalesce(array_agg(DISTINCT group_row.name ORDER BY group_row.name)
          FILTER (WHERE group_row.name IS NOT NULL), '{}') AS group_names,
        coalesce(array_agg(DISTINCT group_row.id::text)
          FILTER (WHERE group_row.id IS NOT NULL), '{}') AS group_ids,
        count(DISTINCT job.id) FILTER (WHERE job.status = 'PUBLISHED')::int AS published_count,
        max(job.published_at) FILTER (WHERE job.status = 'PUBLISHED') AS last_published_at,
        (SELECT app.name FROM meta_apps app WHERE app.id = account.meta_app_id) AS meta_app_name
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
    sql<Array<{ default_timezone: string }>>`
      SELECT coalesce((SELECT default_timezone FROM settings WHERE organization_id = ${user.organizationId}), 'America/Sao_Paulo') AS default_timezone
    `,
  ]);
  const fakeMode = process.env.INSTAGRAM_PROVIDER === "fake"
    && (process.env.NODE_ENV !== "production" || process.env.ALLOW_FAKE_PROVIDER_IN_PRODUCTION === "true");
  const connected = accounts.filter((account) => ["CONNECTED", "TOKEN_EXPIRING"].includes(account.status)).length;
  const needsAttention = accounts.filter((account) => ["REAUTH_REQUIRED", "ERROR"].includes(account.status)).length;
  const selectedFilter = first(params.filtro) ?? "todas";
  const periodFilterable = selectedFilter === "conectadas" || selectedFilter === "reconectar";
  const requestedPeriod = first(params.periodo);
  const selectedPeriod = periodFilterable && requestedPeriod && Object.hasOwn(ACTIVITY_PERIODS, requestedPeriod)
    ? requestedPeriod as ActivityPeriod : undefined;
  const periodRange = selectedPeriod ? activityPeriodRange(selectedPeriod, setting.default_timezone) : undefined;
  // Conectadas filtram pela data de conexão; Reconectar, pela data em que a conta parou de funcionar.
  const inPeriod = (account: AccountRow) => {
    if (!periodRange) return true;
    const activity = accountActivity(account);
    const date = selectedFilter === "conectadas" ? activity.startedAt : activity.endedAt;
    return Boolean(date && date >= periodRange.from && date < periodRange.to);
  };
  const unlinked = first(params.vinculo) === "nao_vinculadas";
  const requestedNiche = first(params.nicho);
  const selectedNiche = groups.some((group) => group.id === requestedNiche) ? requestedNiche : undefined;
  const search = (first(params.busca) ?? "").trim();
  const normalizedSearch = search.toLocaleLowerCase("pt-BR").replace(/^@/, "");
  const requestedType = first(params.tipo);
  const selectedType = requestedType === "novas" || requestedType === "antigas" ? requestedType : "todas";
  const requestedProfile = first(params.perfil);
  const selectedProfile = requestedProfile && (Object.hasOwn(WARMUP_PROFILES, requestedProfile) || requestedProfile === "OFF") ? requestedProfile : "";
  const requestedMode = first(params.conexao);
  const selectedMode = requestedMode && (Object.hasOwn(CONNECTION_MODES, requestedMode) || requestedMode === "NAO_INFORMADA") ? requestedMode : "";
  // Estatística de reconexões: coorte pela data em que a conta começou a funcionar, igual ao filtro "Conectadas em".
  const requestedStatsPeriod = first(params.conectadas_em);
  const statsPeriod = requestedStatsPeriod && Object.hasOwn(ACTIVITY_PERIODS, requestedStatsPeriod) ? requestedStatsPeriod as ActivityPeriod : undefined;
  const reconnectStats = reconnectStatsByMode(accounts, statsPeriod ? activityPeriodRange(statsPeriod, setting.default_timezone) : undefined);
  // Conta recém-conectada pelo OAuth ainda sem tipo: pergunta manual ou automática.
  const justConnectedId = first(params.conectada);
  const justConnected = justConnectedId ? accounts.find((account) => account.id === justConnectedId && !account.connection_mode) : undefined;
  const isNew = (account: AccountRow) => Boolean(accountWarmup(account.warmup_profile, account.created_at)?.active
    || (!account.warmup_profile && account.is_new_account));
  const matchingAccounts = accounts.filter((account) => {
    if (unlinked && account.has_loop) return false;
    if (selectedProfile && (account.warmup_profile ?? "OFF") !== selectedProfile) return false;
    if (selectedMode && (account.connection_mode ?? "NAO_INFORMADA") !== selectedMode) return false;
    if (selectedNiche && !account.group_ids.includes(selectedNiche)) return false;
    if (normalizedSearch && !account.username.toLocaleLowerCase("pt-BR").includes(normalizedSearch)
      && !account.display_name?.toLocaleLowerCase("pt-BR").includes(normalizedSearch)) return false;
    if (selectedFilter === "conectadas") return account.status === "CONNECTED" && inPeriod(account);
    if (selectedFilter === "problema") return ["ERROR", "DISABLED"].includes(account.status);
    if (selectedFilter === "expirando") return account.status === "TOKEN_EXPIRING";
    if (selectedFilter === "reconectar") return account.status === "REAUTH_REQUIRED" && inPeriod(account);
    if (selectedFilter === "banidas") return account.status === "BANNED";
    return true;
  });
  const newCount = matchingAccounts.filter(isNew).length;
  const filteredAccounts = matchingAccounts.filter((account) => selectedType === "todas"
    || isNew(account) === (selectedType === "novas"));
  const baseParams = {
    ...(unlinked ? { vinculo: "nao_vinculadas" } : {}),
    ...(selectedType !== "todas" ? { tipo: selectedType } : {}),
    ...(selectedProfile ? { perfil: selectedProfile } : {}),
    ...(selectedMode ? { conexao: selectedMode } : {}),
    ...(statsPeriod ? { conectadas_em: statsPeriod } : {}),
    ...(selectedNiche ? { nicho: selectedNiche } : {}), ...(search ? { busca: search } : {}),
  };
  const returnParams = new URLSearchParams({
    ...baseParams,
    ...(selectedFilter !== "todas" ? { filtro: selectedFilter } : {}),
    ...(selectedPeriod ? { periodo: selectedPeriod } : {}),
  });
  const returnTo = `/contas${returnParams.size ? `?${returnParams}` : ""}`;

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
      {justConnected ? (
        <Panel title={`Como @${justConnected.username} foi conectada?`} description="Informe se a conexão foi manual ou automática. Isso separa as contas nos filtros e na estatística de reconexões.">
          <form className="inline-form" action={setAccountsConnectionModeAction}>
            <input type="hidden" name="accountIds" value={justConnected.id} />
            <input type="hidden" name="returnTo" value="/contas" />
            <button className="button button-primary" type="submit" name="connectionMode" value="MANUAL">Manual</button>
            <button className="button button-secondary" type="submit" name="connectionMode" value="AUTO">Automática</button>
          </form>
        </Panel>
      ) : null}

      <form className="analytics-filters" method="get" action="/contas">
        {selectedFilter !== "todas" ? <input type="hidden" name="filtro" value={selectedFilter} /> : null}
        {selectedPeriod ? <input type="hidden" name="periodo" value={selectedPeriod} /> : null}
        {statsPeriod ? <input type="hidden" name="conectadas_em" value={statsPeriod} /> : null}
        <label>
          Buscar conta
          <input name="busca" type="search" defaultValue={search} placeholder="@usuario ou nome" />
        </label>
        <label>
          Vínculo com loop
          <select name="vinculo" defaultValue={unlinked ? "nao_vinculadas" : ""}>
            <option value="">Todas</option>
            <option value="nao_vinculadas">Não vinculadas</option>
          </select>
        </label>
        <label>
          Nicho / grupo
          <select name="nicho" defaultValue={selectedNiche ?? ""}>
            <option value="">Todos os nichos</option>
            {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
          </select>
        </label>
        <label>
          Tipo de conta
          <select name="tipo" defaultValue={selectedType}>
            <option value="todas">Todas ({matchingAccounts.length})</option>
            <option value="novas">Novas ({newCount})</option>
            <option value="antigas">Antigas ({matchingAccounts.length - newCount})</option>
          </select>
        </label>
        <label>Filtrar por perfil
          <select name="perfil" defaultValue={selectedProfile}>
            <option value="">Todos os perfis</option>
            {Object.entries(WARMUP_PROFILES).map(([value, profile]) => <option key={value} value={value}>{profile.label}</option>)}
            <option value="OFF">Desativado</option>
          </select>
        </label>
        <label>
          Tipo de conexão
          <select name="conexao" defaultValue={selectedMode}>
            <option value="">Todas</option>
            {Object.entries(CONNECTION_MODES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            <option value="NAO_INFORMADA">Não informada</option>
          </select>
        </label>
        <button className="button button-secondary" type="submit">Aplicar filtros</button>
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
              ...baseParams,
              ...(value === "todas" ? {} : { filtro: value }),
              ...(selectedPeriod && ["conectadas", "reconectar"].includes(value) ? { periodo: selectedPeriod } : {}),
            }).toString()}`.replace(/\?$/, "")}
            key={value}
          >
            {label}
          </Link>
        ))}
      </nav>
      {periodFilterable ? (
        <nav className="page-actions" aria-label={selectedFilter === "conectadas" ? "Filtrar por data de conexão" : "Filtrar por data de desconexão"}>
          <span className="muted">{selectedFilter === "conectadas" ? "Conectadas em:" : "Desconectadas em:"}</span>
          {[["", "Qualquer data"], ...Object.entries(ACTIVITY_PERIODS)].map(([value, label]) => (
            <Link
              className={`button button-small ${(selectedPeriod ?? "") === value ? "button-primary" : "button-secondary"}`}
              href={`/contas?${new URLSearchParams({ ...baseParams, filtro: selectedFilter, ...(value ? { periodo: value } : {}) })}`}
              key={value}
            >
              {label}
            </Link>
          ))}
        </nav>
      ) : null}

      <Panel title="Reconexões por tipo de conexão" description="Contas que começaram a funcionar no período e quantas estão pedindo reconexão agora.">
        <nav className="page-actions reconnect-stats-periods" aria-label="Período das conexões na estatística">
          <span className="muted">Conectadas em:</span>
          {[["", "Qualquer data"], ...Object.entries(ACTIVITY_PERIODS)].map(([value, label]) => {
            const statsParams = new URLSearchParams(returnParams);
            if (value) statsParams.set("conectadas_em", value); else statsParams.delete("conectadas_em");
            return (
              <Link
                className={`button button-small ${(statsPeriod ?? "") === value ? "button-primary" : "button-secondary"}`}
                href={`/contas${statsParams.size ? `?${statsParams}` : ""}`}
                key={value}
              >
                {label}
              </Link>
            );
          })}
        </nav>
        {/* Cards, não tabela: os testes E2E contam `tbody tr` da lista de contas. */}
        <div className="reconnect-stats">
          {[...reconnectStats.rows.map((row) => ({ ...row, label: connectionModeLabel(row.mode) })), { ...reconnectStats.total, label: "Total" }].map((row) => (
            <MetricCard
              key={row.label}
              label={row.label}
              value={row.percent === null ? "—" : `${row.percent}%`}
              detail={row.connected ? `${row.reauth} de ${row.connected} pedindo reconexão` : "Nenhuma conta conectada no período"}
              tone={row.label === "Total" ? "brand" : row.percent ? "warning" : "default"}
            />
          ))}
        </div>
      </Panel>

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
          <AccountBulkSelection key={`${returnTo}:${first(params.ok) ?? ""}:${filteredAccounts.map((account) => `${account.id}:${account.is_new_account}:${account.warmup_profile}`).join(",")}`} returnTo={returnTo} total={filteredAccounts.length}>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col" className="account-select-cell"><input type="checkbox" data-select-all aria-label={`Selecionar todas as ${filteredAccounts.length} contas deste filtro`} /></th>
                  <th scope="col">Conta</th>
                  <th scope="col">Status</th>
                  <th scope="col">Conexão / atividade</th>
                  <th scope="col">Limite de publicação</th>
                  <th scope="col">Nichos / grupos</th>
                  <th scope="col">Publicações</th>
                  <th scope="col" className="table-action-column">Ação</th>
                </tr>
              </thead>
              <tbody>
                {filteredAccounts.map((account) => {
                  const warmup = accountWarmup(account.warmup_profile, account.created_at);
                  const total = account.publishing_limit_total ?? 0;
                  const usage = account.publishing_limit_usage ?? 0;
                  const usagePercent = total ? Math.min(100, Math.round((usage / total) * 100)) : 0;
                  return (
                    <tr key={account.id}>
                      <td data-label="Selecionar" className="account-select-cell"><input type="checkbox" name="accountIds" value={account.id} form="account-classification-form" aria-label={`Selecionar @${account.username}`} /></td>
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
                            <AccountWarmupBadge profile={account.warmup_profile} />
                            {warmup?.active ? <small>Em aquecimento · dia {warmup.day}</small> : account.warmup_profile ? <small>Aquecimento concluído</small> : null}
                            {!account.warmup_profile && account.is_new_account ? <span className="new-account-badge">Nova · intervalo 2×</span> : null}
                            <small>
                              @{account.username}{account.account_type ? ` · ${account.account_type}` : ""}
                              {account.connection_mode ? ` · ${CONNECTION_MODES[account.connection_mode]}` : ""}
                              {account.meta_app_name ? ` · via ${account.meta_app_name}` : ""}
                            </small>
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
                      <td data-label="Conexão / atividade"><AccountActivity account={account} /></td>
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
          </AccountBulkSelection>
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
