import Link from "next/link";
import { cancelHighlightCheckAction, createFakeAccountsAction, disconnectAccountAction, hideDisconnectedAccountsAction, requestHighlightCheckAction, setAccountsConnectionModeAction, verifyConnectedAccountsAction } from "@/app/actions";
import { AutoRefresh } from "@/components/auto-refresh";
import { highlightCheckStatus } from "@/server/highlight-checker";
import { getSqlClient } from "@/db/client";
import { EmptyState, formatDate, MessageBanner, MetricCard, Panel, StatusBadge, initials } from "@/components/ui";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { AccountGroupSelect } from "@/components/account-group-select";
import { InstagramConnectButton } from "@/components/instagram-connect-button";
import { listMetaApps } from "@/server/meta-apps";
import { AccountBulkSelection } from "@/components/account-bulk-selection";
import { AccountWarmupBadge } from "@/components/account-warmup-badge";
import { AccountActivity } from "@/components/account-activity";
import { accountActivity, ACTIVITY_PERIODS, activityPeriodRange, customPeriodRange, inDateRange, type AccountActivityDates, type ActivityPeriod } from "@/lib/account-activity";
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
  highlight_count: number | null;
  highlight_checked_at: Date | null;
  highlight_check_error: string | null;
  hidden_at: Date | null;
  groups: GroupRow[] | string;
};
type GroupRow = { id: string; name: string; color: string };

const usersIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);
const instagramIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2" y="2" width="20" height="20" rx="5" /><circle cx="12" cy="12" r="4" /><line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
  </svg>
);
const NO_GROUP: GroupRow = { id: "sem-grupo", name: "Sem grupo", color: "#64748b" };

type PageProps = {
  searchParams: Promise<{ erro?: string | string[]; ok?: string | string[]; filtro?: string | string[]; nicho?: string | string[]; busca?: string | string[]; tipo?: string | string[]; perfil?: string | string[]; vinculo?: string | string[]; periodo?: string | string[]; de?: string | string[]; ate?: string | string[]; conexao?: string | string[]; conectada?: string | string[]; conectadas_em?: string | string[]; conectadas_de?: string | string[]; conectadas_ate?: string | string[] }>;
};

function first(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AccountsPage({ searchParams }: PageProps) {
  const user = await requireAdmin();
  const params = await searchParams;
  const sql = getSqlClient();
  const [allAccounts, groups, [setting], highlight, apps] = await Promise.all([
    sql<AccountRow[]>`
      SELECT account.id, account.username, account.display_name, account.profile_picture_url, account.account_type, account.status,
        account.token_expires_at, account.is_new_account, account.warmup_profile, account.connection_mode, account.created_at,
        account.instagram_user_id, account.authorized_at, account.active_started_at, account.active_ended_at,
        account.active_timing_estimated, account.disconnected_at, account.banned_at,
        now() AS activity_observed_at,
        EXISTS (SELECT 1 FROM loop_accounts linked WHERE linked.organization_id = account.organization_id
          AND linked.instagram_account_id = account.id) AS has_loop,
        account.last_error_at, account.last_error_message,
        account.highlight_count, account.highlight_checked_at, account.highlight_check_error, account.hidden_at,
        account.publishing_limit_usage, account.publishing_limit_total,
        coalesce(array_agg(DISTINCT group_row.name ORDER BY group_row.name)
          FILTER (WHERE group_row.name IS NOT NULL), '{}') AS group_names,
        coalesce(array_agg(DISTINCT group_row.id::text)
          FILTER (WHERE group_row.id IS NOT NULL), '{}') AS group_ids,
        coalesce(jsonb_agg(DISTINCT jsonb_build_object('id', group_row.id, 'name', group_row.name, 'color', group_row.color))
          FILTER (WHERE group_row.id IS NOT NULL), '[]'::jsonb) AS groups,
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
    sql<GroupRow[]>`SELECT id, name, color FROM account_groups WHERE organization_id = ${user.organizationId} ORDER BY name`,
    sql<Array<{ default_timezone: string }>>`
      SELECT coalesce((SELECT default_timezone FROM settings WHERE organization_id = ${user.organizationId}), 'America/Sao_Paulo') AS default_timezone
    `,
    highlightCheckStatus(user.organizationId),
    listMetaApps(user.organizationId),
  ]);
  // Ocultadas pelo botão somem da página, mas continuam na estatística de reconexões.
  const hideable = (account: AccountRow) => ["REAUTH_REQUIRED", "DISCONNECTED"].includes(account.status);
  const accounts = allAccounts.filter((account) => !(hideable(account) && account.hidden_at));
  const highlightPercent = highlight?.run_total ? Math.min(100, Math.round((highlight.done / highlight.run_total) * 100)) : 0;
  const fakeMode = process.env.INSTAGRAM_PROVIDER === "fake"
    && (process.env.NODE_ENV !== "production" || process.env.ALLOW_FAKE_PROVIDER_IN_PRODUCTION === "true");
  const connected = accounts.filter((account) => ["CONNECTED", "TOKEN_EXPIRING"].includes(account.status)).length;
  const needsAttention = accounts.filter((account) => ["REAUTH_REQUIRED", "ERROR"].includes(account.status)).length;
  const hideableCount = accounts.filter(hideable).length;
  const selectedFilter = first(params.filtro) ?? "todas";
  // Filtro por data em qualquer aba: presets ou intervalo personalizado (de/até, só quando periodo=personalizado).
  const requestedPeriod = first(params.periodo);
  const selectedPeriod = requestedPeriod && (Object.hasOwn(ACTIVITY_PERIODS, requestedPeriod) || requestedPeriod === "personalizado")
    ? requestedPeriod as ActivityPeriod | "personalizado" : undefined;
  const customFrom = selectedPeriod === "personalizado" ? (first(params.de) ?? "") : "";
  const customTo = selectedPeriod === "personalizado" ? (first(params.ate) ?? "") : "";
  const periodRange = selectedPeriod === "personalizado" ? customPeriodRange(customFrom, customTo, setting.default_timezone)
    : selectedPeriod ? activityPeriodRange(selectedPeriod, setting.default_timezone) : undefined;
  // A data é sempre a de conexão, inclusive na aba Reconectar.
  const inPeriod = (account: AccountRow) => inDateRange(accountActivity(account).startedAt, periodRange);
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
  const statsPeriod = requestedStatsPeriod && (Object.hasOwn(ACTIVITY_PERIODS, requestedStatsPeriod) || requestedStatsPeriod === "personalizado")
    ? requestedStatsPeriod as ActivityPeriod | "personalizado" : undefined;
  const statsFrom = statsPeriod === "personalizado" ? (first(params.conectadas_de) ?? "") : "";
  const statsTo = statsPeriod === "personalizado" ? (first(params.conectadas_ate) ?? "") : "";
  const reconnectStats = reconnectStatsByMode(allAccounts, statsPeriod === "personalizado" ? customPeriodRange(statsFrom, statsTo, setting.default_timezone)
    : statsPeriod ? activityPeriodRange(statsPeriod, setting.default_timezone) : undefined);
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
    if (!inPeriod(account)) return false;
    if (selectedFilter === "conectadas") return account.status === "CONNECTED";
    if (selectedFilter === "problema") return ["ERROR", "DISABLED"].includes(account.status);
    if (selectedFilter === "expirando") return account.status === "TOKEN_EXPIRING";
    if (selectedFilter === "reconectar") return account.status === "REAUTH_REQUIRED";
    if (selectedFilter === "banidas") return account.status === "BANNED";
    if (selectedFilter === "sem_destaque") return account.highlight_count === 0;
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
    ...(statsFrom ? { conectadas_de: statsFrom } : {}), ...(statsTo ? { conectadas_ate: statsTo } : {}),
    ...(selectedPeriod ? { periodo: selectedPeriod } : {}),
    ...(customFrom ? { de: customFrom } : {}), ...(customTo ? { ate: customTo } : {}),
    ...(selectedNiche ? { nicho: selectedNiche } : {}), ...(search ? { busca: search } : {}),
  };
  const returnParams = new URLSearchParams({
    ...baseParams,
    ...(selectedFilter !== "todas" ? { filtro: selectedFilter } : {}),
  });
  const returnTo = `/contas${returnParams.size ? `?${returnParams}` : ""}`;

  // Cada conta aparece uma vez, na seção do seu primeiro grupo (por nome); contagens seguem a mesma regra.
  const groupsOf = (account: AccountRow): GroupRow[] =>
    (typeof account.groups === "string" ? (JSON.parse(account.groups) as GroupRow[]) : account.groups)
      .slice().sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const isActive = (account: AccountRow) => ["CONNECTED", "TOKEN_EXPIRING"].includes(account.status);
  const byGroup = (list: AccountRow[]) => {
    const buckets = new Map<string, { group: GroupRow; accounts: AccountRow[]; active: number }>();
    for (const account of list) {
      const group = groupsOf(account)[0] ?? NO_GROUP;
      const bucket = buckets.get(group.id) ?? { group, accounts: [], active: 0 };
      bucket.accounts.push(account);
      if (isActive(account)) bucket.active += 1;
      buckets.set(group.id, bucket);
    }
    return [...buckets.values()].sort((a, b) =>
      a.group.id === NO_GROUP.id ? 1 : b.group.id === NO_GROUP.id ? -1 : a.group.name.localeCompare(b.group.name, "pt-BR"));
  };
  const groupSummary = byGroup(accounts);
  const sections = byGroup(filteredAccounts);
  const percent = (part: number, whole: number) => `${whole ? Math.round((part / whole) * 100) : 0}%`;

  const renderRow = (account: AccountRow) => {
    const warmup = accountWarmup(account.warmup_profile, account.created_at);
    const total = account.publishing_limit_total ?? 0;
    const usage = account.publishing_limit_usage ?? 0;
    const usagePercent = total ? Math.min(100, Math.round((usage / total) * 100)) : 0;
    const accountGroupList = groupsOf(account);
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
          {account.highlight_check_error ? (
            <small className="muted" title={account.highlight_check_error}>Destaque: não deu para conferir</small>
          ) : account.highlight_count === 0 ? (
            <span className="highlight-missing-badge" title={`Conferido em ${formatDate(account.highlight_checked_at)}`}>Sem destaque</span>
          ) : account.highlight_count ? (
            <small>{account.highlight_count} destaque(s) · {formatDate(account.highlight_checked_at, { dateOnly: true })}</small>
          ) : null}
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
        <td data-label="Grupo">
          <AccountGroupSelect
            accountId={account.id}
            username={account.username}
            groups={groups}
            currentIds={accountGroupList.map((group) => group.id)}
            returnTo={returnTo}
          />
          {accountGroupList.length > 1 ? <small title={accountGroupList.map((group) => group.name).join(", ")}>{accountGroupList.map((group) => group.name).join(", ")}</small> : null}
        </td>
        <td data-label="Publicações">
          <span className="table-main-value">{account.published_count}</span>
          {account.published_count ? <small>Última: {formatDate(account.last_published_at)}</small> : <span className="never-posted-tag">Ainda não publicou</span>}
        </td>
        <td data-label="Ação" className="table-action-column">
          <div className="table-actions">
            {account.status === "REAUTH_REQUIRED" ? <InstagramConnectButton accountId={account.id} apps={apps} className="button button-small button-primary">Reconectar</InstagramConnectButton> : null}
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
  };

  return (
    <div className="page-stack">
      <header className="page-hero">
        <div className="page-hero-copy">
          <p className="eyebrow">Canais</p>
          <h1>Gestão de <em className="text-gradient">Contas do Instagram</em></h1>
          <p className="page-description">Conecte, organize por grupo e acompanhe a saúde de cada conta.</p>
          <span className="count-chip">
            <span className="count-chip-dot" aria-hidden="true" />
            <b>{connected}/{accounts.length}</b> contas ativas{needsAttention ? ` · ${needsAttention} precisam de atenção` : ""}
          </span>
        </div>
        <div className="page-hero-actions">
          <form action={verifyConnectedAccountsAction}>
            <button className="button button-secondary" type="submit">Verificar conexões</button>
          </form>
          {highlight?.running ? null : (
            <form action={requestHighlightCheckAction}>
              <button className="button button-secondary" type="submit">Conferir destaques</button>
            </form>
          )}
          {hideableCount ? (
            <form action={hideDisconnectedAccountsAction}>
              <span title={`Tirar da lista as ${hideableCount} conta(s) pedindo reconexão ou desconectadas`}>
                <ConfirmSubmitButton className="button button-danger" message={`Tem certeza? As ${hideableCount} conta(s) pedindo reconexão ou desconectadas vão sair da lista. As contas conectadas não mudam. Se reconectar uma delas pelo "Conectar Instagram", ela volta a aparecer.`}>
                  Limpar desconectadas ({hideableCount})
                </ConfirmSubmitButton>
              </span>
            </form>
          ) : (
            <button className="button button-quiet-danger" type="button" disabled title="Nenhuma conta pedindo reconexão ou desconectada agora">
              Limpar desconectadas
            </button>
          )}
          <InstagramConnectButton apps={apps} className="button button-primary button-hero">{instagramIcon}Conectar Instagram</InstagramConnectButton>
        </div>
      </header>
      <MessageBanner error={first(params.erro)} success={first(params.ok)} />
      {highlight?.running ? (
        <Panel title="Conferindo destaques" description="O conferidor no seu PC abre o perfil de cada conta conectada, um por vez.">
          <div className="form-stack">
            <AutoRefresh intervalMs={5_000} />
            <div className="quota-cell highlight-check-progress">
              <span><strong>{highlight.done} de {highlight.run_total}</strong> contas conferidas{highlight.missing ? ` · ${highlight.missing} sem destaque` : ""}{highlight.failed ? ` · ${highlight.failed} não deu para conferir` : ""}</span>
              <div className="progress-track" aria-label={`${highlightPercent}% das contas conferidas`}>
                <div className="progress-value" style={{ width: `${highlightPercent}%` }} />
              </div>
            </div>
            {!highlight.online ? <p className="error-copy">Conferidor desligado. Abra o programa no seu PC: ele começa, ou continua de onde parou.</p>
              : !highlight.done ? <p className="muted">Aguardando o conferidor começar (até 30 segundos)…</p> : null}
            <form action={cancelHighlightCheckAction}>
              <button className="button button-small button-secondary" type="submit">Cancelar conferência</button>
            </form>
          </div>
        </Panel>
      ) : highlight?.run_finished_at ? (
        <Panel
          title="Última conferência de destaques"
          description={`${formatDate(highlight.run_finished_at)} · ${highlight.done} de ${highlight.run_total} contas conferidas`}
          action={highlight.missing ? <Link className="button button-small button-secondary" href="/contas?filtro=sem_destaque">Ver contas sem destaque</Link> : undefined}
        >
          <p>
            <strong className={highlight.missing ? "danger-count" : undefined}>{highlight.missing} sem destaque</strong>
            {highlight.failed ? <span className="muted"> · {highlight.failed} não deu para conferir</span> : null}
          </p>
          {highlight.run_error ? <p className="error-copy">{highlight.run_error}</p> : null}
        </Panel>
      ) : null}
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

      <section className="group-summary" aria-label="Contas por grupo">
        <div className="group-stat group-stat-total">
          <span className="group-stat-label">Total de contas</span>
          <strong>{accounts.length}</strong>
          <span className="group-stat-meta"><b>{connected}</b> ativas · {accounts.length - connected} inativas</span>
          <span className="mini-progress" aria-hidden="true"><i style={{ width: percent(connected, accounts.length) }} /></span>
        </div>
        {groupSummary.map(({ group, accounts: members, active }) => {
          const body = (
            <>
              <span className="group-stat-label"><span className="group-dot" style={{ background: group.color }} aria-hidden="true" />{group.name}</span>
              <strong>{active}<small> ativas</small></strong>
              <span className="group-stat-meta">de {members.length} {members.length === 1 ? "conta" : "contas"} no grupo</span>
              <span className="mini-progress" aria-hidden="true"><i style={{ width: percent(active, members.length), background: group.color }} /></span>
            </>
          );
          return group.id === NO_GROUP.id
            ? <div className="group-stat" key={group.id}>{body}</div>
            : (
              <Link className={`group-stat${selectedNiche === group.id ? " is-active" : ""}`} href={`/contas?nicho=${group.id}`} key={group.id} title={`Mostrar só ${group.name}`}>
                {body}
              </Link>
            );
        })}
      </section>

      <form className="analytics-filters filter-bar" method="get" action="/contas">
        {selectedFilter !== "todas" ? <input type="hidden" name="filtro" value={selectedFilter} /> : null}
        {statsPeriod ? <input type="hidden" name="conectadas_em" value={statsPeriod} /> : null}
        {statsFrom ? <input type="hidden" name="conectadas_de" value={statsFrom} /> : null}
        {statsTo ? <input type="hidden" name="conectadas_ate" value={statsTo} /> : null}
        <label>
          Buscar conta
          <input name="busca" type="search" defaultValue={search} placeholder="@usuario ou nome" />
        </label>
        <label>
          Conectadas em
          <select name="periodo" defaultValue={selectedPeriod ?? ""}>
            <option value="">Qualquer data</option>
            {Object.entries(ACTIVITY_PERIODS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            <option value="personalizado">Personalizado</option>
          </select>
        </label>
        {/* Visível só com "Personalizado" (CSS :has); sem suporte a :has fica sempre visível. */}
        <span className="custom-range">
          <label>
            De
            <input name="de" type="date" defaultValue={customFrom} />
          </label>
          <label>
            Até
            <input name="ate" type="date" defaultValue={customTo} />
          </label>
        </span>
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

      <nav className="chip-bar" aria-label="Filtrar contas">
        {[
          ["todas", "Todas"],
          ["conectadas", "Conectadas"],
          ["problema", "Problema"],
          ["expirando", "Expirando"],
          ["reconectar", "Reconectar"],
          ["banidas", "Banidas"],
          ["sem_destaque", "Sem destaque"],
        ].map(([value, label]) => (
          <Link
            className={`period-chip${selectedFilter === value ? " is-active" : ""}`}
            href={`/contas?${new URLSearchParams({
              ...baseParams,
              ...(value === "todas" ? {} : { filtro: value }),
            }).toString()}`.replace(/\?$/, "")}
            key={value}
          >
            {label}
          </Link>
        ))}
      </nav>
      <Panel title="Reconexões por tipo de conexão" description="Contas que começaram a funcionar no período e quantas estão pedindo reconexão agora.">
        <nav className="page-actions reconnect-stats-periods" aria-label="Período das conexões na estatística">
          <span className="muted">Conectadas em:</span>
          {[["", "Qualquer data"], ...Object.entries(ACTIVITY_PERIODS)].map(([value, label]) => {
            const statsParams = new URLSearchParams(returnParams);
            statsParams.delete("conectadas_de");
            statsParams.delete("conectadas_ate");
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
          {/* Dia único: mesma data em De e Até. */}
          <form method="get" action="/contas">
            {[...returnParams].filter(([key]) => !key.startsWith("conectadas_")).map(([key, value]) => (
              <input key={key} type="hidden" name={key} value={value} />
            ))}
            <input type="hidden" name="conectadas_em" value="personalizado" />
            <input name="conectadas_de" type="date" aria-label="Conectadas de" defaultValue={statsFrom} />
            <input name="conectadas_ate" type="date" aria-label="Conectadas até" defaultValue={statsTo} />
            <button className={`button button-small ${statsPeriod === "personalizado" ? "button-primary" : "button-secondary"}`} type="submit">
              Personalizado
            </button>
          </form>
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

      <section className="dcard accounts-card">
        <header className="dcard-head">
          <span className="dcard-ico tone-blue" aria-hidden="true">{usersIcon}</span>
          <h2>Contas conectadas</h2>
          <span className="dcard-meta">
            {filteredAccounts.length} {filteredAccounts.length === 1 ? "conta" : "contas"} nesta lista
            {sections.length ? ` · ${sections.length} ${sections.length === 1 ? "grupo" : "grupos"}` : ""}
          </span>
        </header>
        <div className="dcard-body">
          {filteredAccounts.length ? (
            <AccountBulkSelection key={`${returnTo}:${first(params.ok) ?? ""}:${filteredAccounts.map((account) => `${account.id}:${account.is_new_account}:${account.warmup_profile}`).join(",")}`} returnTo={returnTo} total={filteredAccounts.length}>
              <div className="account-sections">
                {sections.map((section, sectionIndex) => (
                  <div className="account-section" key={section.group.id} id={`grupo-${section.group.id}`}>
                    <div className="account-section-head">
                      <span className="group-dot" style={{ background: section.group.color }} aria-hidden="true" />
                      <h3>{section.group.name}</h3>
                      <span className="account-section-count"><b>{section.active}</b> ativas de {section.accounts.length}</span>
                      <span className="mini-progress" aria-hidden="true">
                        <i style={{ width: percent(section.active, section.accounts.length), background: section.group.color }} />
                      </span>
                    </div>
                    <div className="table-scroll">
                      <table className="accounts-table">
                        <colgroup>
                          <col style={{ width: 44 }} />
                          <col />
                          <col style={{ width: "14%" }} />
                          <col style={{ width: "15%" }} />
                          <col style={{ width: "11%" }} />
                          <col style={{ width: "14%" }} />
                          <col style={{ width: "10%" }} />
                          <col style={{ width: 176 }} />
                        </colgroup>
                        <thead>
                          <tr>
                            <th scope="col" className="account-select-cell">
                              {/* Um único "selecionar todas" na página: os testes e o AccountBulkSelection esperam um só. */}
                              {sectionIndex === 0
                                ? <input type="checkbox" data-select-all aria-label={`Selecionar todas as ${filteredAccounts.length} contas deste filtro`} />
                                : <span className="sr-only">Selecionar</span>}
                            </th>
                            <th scope="col">Conta</th>
                            <th scope="col">Status</th>
                            <th scope="col">Conexão / atividade</th>
                            <th scope="col">Limite de publicação</th>
                            <th scope="col">Grupo</th>
                            <th scope="col">Publicações</th>
                            <th scope="col" className="table-action-column">Ação</th>
                          </tr>
                        </thead>
                        <tbody>{section.accounts.map(renderRow)}</tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            </AccountBulkSelection>
          ) : (
            <EmptyState
              title={accounts.length ? "Nenhuma conta neste filtro" : "Nenhuma conta conectada"}
              description={accounts.length ? "Escolha outro filtro para ver as demais contas." : "Conecte uma conta profissional do Instagram para começar a publicar."}
              href={accounts.length ? "/contas" : undefined}
              actionLabel={accounts.length ? "Mostrar todas" : undefined}
              action={<InstagramConnectButton apps={apps} className="button button-secondary">Conectar Instagram</InstagramConnectButton>}
            />
          )}
        </div>
      </section>
    </div>
  );
}
