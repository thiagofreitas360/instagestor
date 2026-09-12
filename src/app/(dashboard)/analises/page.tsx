import Link from "next/link";
import { z } from "zod";
import { refreshInsightsAction } from "@/app/actions";
import { getSqlClient } from "@/db/client";
import { BarChart, LineChart } from "@/components/charts";
import { Delta, EmptyState, formatDate, formatNumber, MessageBanner, MetricCard, PageHeader, Panel, StatusBadge, initials } from "@/components/ui";
import {
  deltaPercent, loadAnalytics, MEDIA_ORDERS, RANKING_ORDERS, resolvePeriod,
  type MediaOrder, type MediaRow, type PeriodDays, type RankingOrder, type Totals,
} from "@/server/analytics";

type Query = Record<string, string | string[] | undefined>;
type PageProps = { searchParams: Promise<Query> };

const PERIODS: PeriodDays[] = [7, 30, 90];
const MEDIA_TYPES = [
  ["", "Todas"], ["REELS", "Reels"], ["FEED", "Posts"], ["STORY", "Stories"],
] as const;

const PRIMARY_CARDS: Array<{ label: string; key: keyof Totals; tone?: "success" | "danger" | "brand"; invert?: true }> = [
  { label: "Seguidores", key: "followers", tone: "brand" },
  { label: "Seguidores ganhos", key: "gains", tone: "success" },
  { label: "Seguidores perdidos", key: "lost", tone: "danger", invert: true },
  { label: "Variação líquida", key: "netChange" },
  { label: "Alcance", key: "reach" },
  { label: "Visualizações", key: "views" },
  { label: "Visitas ao perfil", key: "profileViews" },
  { label: "Interações", key: "totalInteractions" },
  { label: "Curtidas", key: "likes" },
  { label: "Comentários", key: "comments" },
  { label: "Compartilhamentos", key: "shares" },
  { label: "Salvamentos", key: "saves" },
];

const SECONDARY_CARDS: Array<{ label: string; key: keyof Totals }> = [
  { label: "Cliques no link", key: "websiteClicks" },
  { label: "Toques em links do perfil", key: "profileLinksTaps" },
  { label: "Respostas de story", key: "replies" },
  { label: "Contas engajadas", key: "accountsEngaged" },
  { label: "Mídias no período", key: "mediaCount" },
  { label: "Publicadas via InstaGestor", key: "mediaByTool" },
];

function first(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

function pick<T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined {
  return allowed.find((item) => item === value);
}

function buildHref(base: Record<string, string | undefined>, overrides: Record<string, string | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...base, ...overrides })) if (value) params.set(key, value);
  const query = params.toString();
  return query ? `/analises?${query}` : "/analises";
}

function shortDay(day: string) {
  const [, month, dayOfMonth] = day.split("-");
  return `${dayOfMonth}/${month}`;
}

function minutesAgo(date: Date | null) {
  return date ? Math.max(0, Math.round((Date.now() - new Date(date).getTime()) / 60_000)) : null;
}

function safeUrl(value: string | null | undefined) {
  return value && /^https?:\/\//i.test(value) ? value : undefined;
}

function productLabel(productType: string) {
  return ({ REELS: "Reel", FEED: "Post", STORY: "Story" } as Record<string, string>)[productType] ?? productType;
}

function extraMetric(row: MediaRow) {
  if (row.product_type === "REELS") {
    return row.reels_avg_watch_time_ms === null ? "—" : `${(row.reels_avg_watch_time_ms / 1000).toFixed(1)}s assistidos`;
  }
  if (row.product_type === "STORY") {
    return `${formatNumber(row.story_taps_forward)} avanços · ${formatNumber(row.story_taps_back)} voltas · ${formatNumber(row.story_exits)} saídas`;
  }
  return `${formatNumber(row.follows)} seguidores ganhos`;
}

export default async function AnalyticsPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const periodDays = PERIODS.find((days) => String(days) === first(query.periodo)) ?? 30;
  const accountId = z.uuid().safeParse(first(query.conta)).data;
  const groupId = z.uuid().safeParse(first(query.grupo)).data;
  const mediaType = pick(first(query.tipo), ["FEED", "REELS", "STORY"] as const);
  const rankingOrder: RankingOrder = pick(first(query.ordem), RANKING_ORDERS) ?? "reach";
  const mediaOrder: MediaOrder = pick(first(query.ordem_midia), MEDIA_ORDERS) ?? "views";
  const base = {
    periodo: String(periodDays), conta: accountId, grupo: accountId ? undefined : groupId, tipo: mediaType,
    ordem: rankingOrder === "reach" ? undefined : rankingOrder, ordem_midia: mediaOrder === "views" ? undefined : mediaOrder,
  };

  const sql = getSqlClient();
  const [accounts, groups] = await Promise.all([
    sql<Array<{ id: string; username: string; display_name: string | null; profile_picture_url: string | null; status: string; biography: string | null; website: string | null; followers_count: number | null; follows_count: number | null; media_count: number | null }>>`
      SELECT account.id, account.username, account.display_name, account.profile_picture_url, account.status, account.biography, account.website,
        latest.followers_count, latest.follows_count, latest.media_count
      FROM instagram_accounts account
      LEFT JOIN LATERAL (
        SELECT followers_count, follows_count, media_count FROM account_daily_metrics
        WHERE instagram_account_id = account.id AND followers_count IS NOT NULL ORDER BY day DESC LIMIT 1
      ) latest ON true
      WHERE account.status <> 'DISCONNECTED' OR account.insights_synced_at IS NOT NULL
      ORDER BY account.username
    `,
    sql<Array<{ id: string; name: string }>>`SELECT id, name FROM account_groups ORDER BY name`,
  ]);

  const selectedAccount = accountId ? accounts.find((account) => account.id === accountId) : undefined;
  const selectedGroup = !selectedAccount && groupId ? groups.find((group) => group.id === groupId) : undefined;
  let accountIds: string[] | null = null;
  let title = "Todas as contas";
  if (selectedAccount) {
    accountIds = [selectedAccount.id];
    title = selectedAccount.display_name ?? `@${selectedAccount.username}`;
  } else if (selectedGroup) {
    const members = await sql<Array<{ instagram_account_id: string }>>`
      SELECT instagram_account_id FROM account_group_members WHERE group_id = ${selectedGroup.id}
    `;
    accountIds = members.map((member) => member.instagram_account_id);
    title = `Grupo ${selectedGroup.name}`;
  }

  const period = resolvePeriod(periodDays);
  const data = await loadAnalytics({ accountIds, period, mediaType, rankingOrder, mediaOrder });
  const ago = minutesAgo(data.syncedAt);
  const stale = ago !== null && ago > 180;
  const nothingToShow = !data.ranking.length && !data.missingScope.length;

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Análises"
        title={title}
        description={
          ago === null
            ? "Nenhum sync de insights concluído ainda."
            : `Dados atualizados há ${ago < 60 ? `${ago} min` : `${Math.round(ago / 60)} h`} · os últimos 2 dias ainda podem mudar.`
        }
        actions={
          <>
            <form action={refreshInsightsAction}>
              {selectedAccount ? <input type="hidden" name="accountId" value={selectedAccount.id} /> : null}
              <input type="hidden" name="returnTo" value={buildHref(base, {})} />
              <button className="button button-secondary" type="submit">Atualizar agora</button>
            </form>
            <Link className="button button-ghost" href="/analises/banidas">Histórico de banidas</Link>
          </>
        }
      />
      <MessageBanner error={first(query.erro)} success={first(query.ok)} />
      {stale ? (
        <div className="message-banner message-error" role="status">
          <strong>Sync atrasado</strong>
          <span>O último sync foi há mais de 3 horas. Verifique se o worker está rodando.</span>
        </div>
      ) : null}

      <form className="analytics-filters" method="get" action="/analises">
        <label>
          Período
          <select name="periodo" defaultValue={String(periodDays)}>
            {PERIODS.map((days) => <option key={days} value={days}>Últimos {days} dias</option>)}
          </select>
        </label>
        <label>
          Conta
          <select name="conta" defaultValue={selectedAccount?.id ?? ""}>
            <option value="">Todas</option>
            {accounts.map((account) => <option key={account.id} value={account.id}>@{account.username}</option>)}
          </select>
        </label>
        <label>
          Grupo
          <select name="grupo" defaultValue={selectedGroup?.id ?? ""}>
            <option value="">Nenhum</option>
            {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
          </select>
        </label>
        <button className="button button-primary" type="submit">Aplicar</button>
      </form>

      {data.missingScope.length ? (
        <Panel title={`${data.missingScope.length} conta(s) precisam reconectar para habilitar análises`} description="A permissão de insights só é concedida em uma nova conexão via Meta.">
          <ul className="tag-list">
            {data.missingScope.map((account) => <li key={account.id}>@{account.username}</li>)}
          </ul>
          <Link className="button button-secondary" href="/api/instagram/oauth/start">Reconectar via Meta</Link>
        </Panel>
      ) : null}
      {data.syncErrors.length ? (
        <Panel title={`${data.syncErrors.length} conta(s) com erro no último sync`}>
          <ul className="tag-list">
            {data.syncErrors.map((account) => <li key={account.id}>@{account.username} · <span className="mono-copy">{account.code}</span></li>)}
          </ul>
        </Panel>
      ) : null}

      {selectedAccount ? (
        <section className="account-hero panel">
          <span className="account-avatar account-avatar-large" aria-hidden="true">
            {selectedAccount.profile_picture_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={selectedAccount.profile_picture_url} alt="" referrerPolicy="no-referrer" />
            ) : initials(selectedAccount.display_name ?? selectedAccount.username)}
          </span>
          <div className="account-hero-main">
            <StatusBadge status={selectedAccount.status} />
            <p>@{selectedAccount.username} · {formatNumber(selectedAccount.followers_count)} seguidores · {formatNumber(selectedAccount.follows_count)} seguindo · {formatNumber(selectedAccount.media_count)} publicações</p>
            {selectedAccount.biography ? <p className="muted">{selectedAccount.biography}</p> : null}
            {safeUrl(selectedAccount.website) ? <a className="text-link" href={safeUrl(selectedAccount.website)} rel="noreferrer" target="_blank">{selectedAccount.website}</a> : null}
            <Link className="text-link" href={`/contas/${selectedAccount.id}`}>Ver detalhes operacionais</Link>
          </div>
        </section>
      ) : null}

      {nothingToShow ? (
        <EmptyState
          title="Nenhuma conta com análises"
          description="Conecte (ou reconecte) contas concedendo a permissão de insights. O worker sincroniza automaticamente em até 1 minuto."
          href="/api/instagram/oauth/start"
          actionLabel="Conectar Instagram"
        />
      ) : (
        <>
          <section className="metric-grid-analytics" aria-label="Indicadores do período">
            {PRIMARY_CARDS.map((card) => (
              <MetricCard
                key={card.key}
                label={card.label}
                value={formatNumber(data.totals[card.key])}
                tone={card.tone ?? "default"}
                detail={<Delta value={deltaPercent(data.totals[card.key], data.previous[card.key])} invert={card.invert} />}
              />
            ))}
          </section>
          <section className="metric-grid metric-grid-compact" aria-label="Indicadores secundários">
            {SECONDARY_CARDS.map((card) => (
              <MetricCard key={card.key} label={card.label} value={formatNumber(data.totals[card.key])} detail={<Delta value={deltaPercent(data.totals[card.key], data.previous[card.key])} />} />
            ))}
          </section>

          <section className="two-column-grid">
            <Panel>
              <LineChart title="Seguidores por dia" points={data.series.map((point) => ({ label: shortDay(point.day), value: point.followers }))} />
            </Panel>
            <Panel>
              <BarChart
                title="Alcance e visualizações por dia"
                seriesLabels={["Alcance", "Visualizações"]}
                groups={data.series.map((point) => ({ label: shortDay(point.day), values: [point.reach, point.views] }))}
              />
            </Panel>
          </section>

          {!selectedAccount ? (
            <Panel title="Ranking de contas" description="Clique em uma conta para ver só ela">
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Conta</th>
                      <th scope="col">Status</th>
                      {([
                        ["followers", "Seguidores"], ["net_change", "Δ seguidores"], ["reach", "Alcance"],
                        ["views", "Views"], ["total_interactions", "Interações"], ["media_count", "Mídias"],
                      ] as const).map(([key, label]) => (
                        <th scope="col" key={key} aria-sort={rankingOrder === key ? "descending" : undefined}>
                          <Link className="text-link" href={buildHref(base, { ordem: key })}>{label}</Link>
                        </th>
                      ))}
                      <th scope="col">Último sync</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.ranking.map((row) => (
                      <tr key={row.id}>
                        <td data-label="Conta"><Link className="table-primary-link" href={buildHref(base, { conta: row.id, grupo: undefined })}>@{row.username}</Link></td>
                        <td data-label="Status"><StatusBadge status={row.status} /></td>
                        <td data-label="Seguidores">{formatNumber(row.followers)}</td>
                        <td data-label="Δ seguidores">{row.net_change === null ? "—" : `${row.net_change > 0 ? "+" : ""}${formatNumber(row.net_change)}`}</td>
                        <td data-label="Alcance">{formatNumber(row.reach)}</td>
                        <td data-label="Views">{formatNumber(row.views)}</td>
                        <td data-label="Interações">{formatNumber(row.total_interactions)}</td>
                        <td data-label="Mídias">{formatNumber(row.media_count)}</td>
                        <td data-label="Último sync">{formatDate(row.insights_synced_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          ) : null}

          <Panel
            title="Mídias no período"
            description="Até 20 mídias, ordenadas pela coluna escolhida"
            action={
              <nav className="analytics-tabs" aria-label="Tipo de mídia">
                {MEDIA_TYPES.map(([value, label]) => (
                  <Link key={value || "todas"} className={`button button-small ${(mediaType ?? "") === value ? "button-primary" : "button-secondary"}`} href={buildHref(base, { tipo: value || undefined })}>{label}</Link>
                ))}
              </nav>
            }
          >
            {data.media.length ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Mídia</th>
                      <th scope="col">Conta</th>
                      <th scope="col">Tipo</th>
                      {([
                        ["posted_at", "Data"], ["views", "Views"], ["reach", "Alcance"], ["like_count", "Curtidas"],
                        ["comments_count", "Coment."], ["shares", "Compart."], ["saved", "Salv."],
                      ] as const).map(([key, label]) => (
                        <th scope="col" key={key} aria-sort={mediaOrder === key ? "descending" : undefined}>
                          <Link className="text-link" href={buildHref(base, { ordem_midia: key })}>{label}</Link>
                        </th>
                      ))}
                      <th scope="col">Detalhe</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.media.map((row) => (
                      <tr key={row.id}>
                        <td data-label="Mídia">
                          <a className="table-primary-link" href={safeUrl(row.permalink) ?? "#"} rel="noreferrer" target="_blank">
                            {safeUrl(row.thumbnail_url) ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img className="media-thumb-small" src={safeUrl(row.thumbnail_url)} alt="" referrerPolicy="no-referrer" />
                            ) : null}
                            <span className="cell-wrap">{row.caption?.slice(0, 60) || row.id}</span>
                          </a>
                          {row.published_job_id ? <span className="status-badge status-success">via InstaGestor</span> : null}
                        </td>
                        <td data-label="Conta">@{row.username}</td>
                        <td data-label="Tipo">{productLabel(row.product_type)}</td>
                        <td data-label="Data">{formatDate(row.posted_at)}</td>
                        <td data-label="Views">{formatNumber(row.views)}</td>
                        <td data-label="Alcance">{formatNumber(row.reach)}</td>
                        <td data-label="Curtidas">{formatNumber(row.like_count)}</td>
                        <td data-label="Coment.">{formatNumber(row.comments_count)}</td>
                        <td data-label="Compart.">{formatNumber(row.shares)}</td>
                        <td data-label="Salv.">{formatNumber(row.saved)}</td>
                        <td data-label="Detalhe" className="cell-wrap">{extraMetric(row)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="panel-placeholder">Nenhuma mídia sincronizada no período.</p>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
