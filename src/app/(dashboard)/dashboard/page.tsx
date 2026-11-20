import Link from "next/link";
import { DateTime } from "luxon";
import { getSqlClient } from "@/db/client";
import { stopOperationAction } from "@/app/actions";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { CopyWebhook } from "@/components/copy-webhook";
import { QueueTable, type QueueRow } from "@/components/queue-table";
import { SalesChart } from "@/components/sales-chart";
import { formatDate, formatNumber, initials, MessageBanner } from "@/components/ui";
import { requireAdmin } from "@/server/auth";
import {
  getOrCreateSalesToken,
  loadSalesDashboard,
  SALES_PRESET_LABELS,
  SALES_PRESETS,
  salesWebhookUrl,
  type CustomRange,
  type SalesPreset,
} from "@/server/sales";

const brl = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
const brlNum = (cents: number) => new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100);
const brlReais = (reais: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(reais);
const brlCompact = (cents: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", notation: "compact", maximumFractionDigits: 1 }).format(cents / 100);
const pct = (value: number) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value);

const svg = (paths: React.ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {paths}
  </svg>
);
const icons = {
  money: svg(<><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></>),
  trend: svg(<><polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" /></>),
  video: svg(<><path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z" /><path d="m6.2 5.3 3.1 3.9" /><path d="m12.4 3.4 3.1 4" /><path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /></>),
  pix: svg(<><rect x="2" y="5" width="20" height="14" rx="2" /><line x1="2" y1="10" x2="22" y2="10" /></>),
  lead: svg(<><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>),
  card: svg(<><rect x="2" y="5" width="20" height="14" rx="2" /><line x1="2" y1="10" x2="22" y2="10" /><line x1="6" y1="15" x2="10" y2="15" /></>),
  refresh: svg(<><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" /><path d="M16 16h5v5" /></>),
  stop: svg(<><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>),
  flame: svg(<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5Z" />),
  eye: svg(<><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></>),
  funnel: svg(<path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />),
  webhook: svg(<><path d="M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c.01-.7.2-1.4.57-2" /><path d="m6 17 3.13-5.78c.53-.97.1-2.18-.5-3.1a4 4 0 1 1 6.89-4.06" /><path d="m12 6 3.13 5.73C15.66 12.7 16.9 13 18 13a4 4 0 0 1 0 8" /></>),
  activity: svg(<polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />),
  queue: svg(<><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></>),
  user: svg(<><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>),
};

const activityLabels: Record<string, string> = { LEAD: "Lead cadastrado", PIX: "PIX gerado", SALE: "Venda aprovada", UPSELL: "Upsell" };
const funnelLabels = ["Visualizações", "Leads iniciados", "PIX gerados", "Vendas fechadas", "Upsell"];

function Money({ cents }: { cents: number }) {
  return (
    <span className="kpi-money">
      <i>R$</i>
      {brlNum(cents)}
    </span>
  );
}

type Tone = "blue" | "green" | "cyan" | "indigo" | "teal";

function Kpi({ hero, sublabel, label, icon, value, foot, tone = "blue" }: {
  hero?: boolean; sublabel?: string; label: string; icon: React.ReactNode; value: React.ReactNode; foot?: React.ReactNode; tone?: Tone;
}) {
  return (
    <article className={`kpi${hero ? " kpi-hero" : ""}`}>
      <header>
        <span className="kpi-labels">
          {sublabel ? <span className="kpi-sub">{sublabel}</span> : null}
          <span className="kpi-label">{label}</span>
        </span>
        <span className={`kpi-icon tone-${tone}`} aria-hidden="true">{icon}</span>
      </header>
      <strong className="kpi-value">{value}</strong>
      {hero ? null : <div className="kpi-foot">{foot}</div>}
    </article>
  );
}

function Card({ icon, plainIcon, title, meta, action, children, className = "", tone = "blue" }: {
  icon?: React.ReactNode; plainIcon?: boolean; title: string; meta?: string; action?: React.ReactNode; children: React.ReactNode; className?: string; tone?: Tone;
}) {
  return (
    <section className={`dcard ${className}`.trim()}>
      <header className="dcard-head">
        {icon ? <span className={plainIcon ? "dcard-ico-plain" : `dcard-ico tone-${tone}`} aria-hidden="true">{icon}</span> : null}
        <h2>{title}</h2>
        {meta ? <span className="dcard-meta">{meta}</span> : null}
        {action ? <div className="dcard-action">{action}</div> : null}
      </header>
      <div className="dcard-body">{children}</div>
    </section>
  );
}

type Search = { periodo?: string; de?: string; ate?: string; grafico?: string; ok?: string; erro?: string };
const isDate = (value?: string): value is string => !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireAdmin();
  const sql = getSqlClient();
  const params = await searchParams;

  const [settingsRow] = await sql<Array<{ default_timezone: string; revenue_goal_cents: number | null }>>`
    SELECT default_timezone, revenue_goal_cents FROM settings WHERE organization_id = ${user.organizationId}
  `;
  const timezone = settingsRow?.default_timezone ?? "America/Sao_Paulo";
  const goalCents = settingsRow?.revenue_goal_cents ?? null;

  const custom: CustomRange | undefined =
    isDate(params.de) && isDate(params.ate) ? { from: params.de, to: params.ate, label: "Personalizado" } : undefined;
  const preset: SalesPreset = SALES_PRESETS.includes(params.periodo as SalesPreset) ? (params.periodo as SalesPreset) : "today";
  const chartDays = params.grafico === "30d" ? 30 : 7;

  const [dashboard, token, queue] = await Promise.all([
    loadSalesDashboard(user.organizationId, preset, timezone, { custom, chartDays }),
    getOrCreateSalesToken(user.organizationId),
    sql<QueueRow[]>`
      SELECT job.id, job.campaign_id, campaign.name AS campaign_name, job.instagram_account_id AS account_id,
        account.username, job.status, job.scheduled_at, job.attempt_count, job.max_attempts, job.next_attempt_at,
        job.published_at, job.finished_at, job.last_error_code, job.last_error_message, job.meta_media_id,
        job.auto_comment_status, job.auto_comment_last_error_message
      FROM publication_jobs job
      JOIN campaigns campaign ON campaign.organization_id = job.organization_id AND campaign.id = job.campaign_id
      JOIN instagram_accounts account ON account.organization_id = job.organization_id AND account.id = job.instagram_account_id
      WHERE job.organization_id = ${user.organizationId}
      ORDER BY coalesce(job.published_at, job.finished_at, job.next_attempt_at, job.scheduled_at) DESC
      LIMIT 6
    `,
  ]);

  const webhookUrl = salesWebhookUrl(token);
  const now = DateTime.now().setZone(timezone);
  const greeting = now.hour < 12 ? "Bom dia" : now.hour < 18 ? "Boa tarde" : "Boa noite";
  const today = new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeZone: timezone }).format(new Date());
  const goalPct = goalCents ? Math.min(100, (dashboard.allTimeRevenueCents / goalCents) * 100) : 0;

  const fmt = (d: DateTime) => d.toISODate()!;
  const inputFrom = custom ? custom.from
    : preset === "today" ? fmt(now)
    : preset === "yesterday" ? fmt(now.minus({ days: 1 }))
    : preset === "7d" ? fmt(now.minus({ days: 6 }))
    : fmt(now.minus({ days: 29 }));
  const inputTo = custom ? custom.to : preset === "yesterday" ? fmt(now.minus({ days: 1 })) : fmt(now);
  const currentHref = custom ? `/dashboard?de=${custom.from}&ate=${custom.to}` : `/dashboard?periodo=${preset}`;
  const chartHref = (days: "7d" | "30d") => `${currentHref}&grafico=${days}`;

  const values = dashboard.series.map((point) => point.value ?? 0);
  const chartTotal = values.reduce((sum, value) => sum + value, 0);
  const best = values.reduce((bestIndex, value, index) => (value > values[bestIndex] ? index : bestIndex), 0);
  const chartAvg = values.length ? chartTotal / values.length : 0;
  const funnelMax = Math.max(1, ...dashboard.funnel.values);

  return (
    <div className="page-stack dash">
      <MessageBanner error={params.erro} success={params.ok} />

      <header className="dash-head">
        {goalCents ? (
          <div className="goal-card">
            <span className="goal-avatar" aria-hidden="true">{icons.user}</span>
            <div className="goal-body">
              <div className="goal-top">
                <strong title={user.organizationName}>{user.organizationName}</strong>
                <span className="goal-amount"><i>R$</i>{brlNum(dashboard.allTimeRevenueCents)}</span>
              </div>
              <div className="goal-mid">
                <div className="goal-track" aria-hidden="true">
                  <div className="goal-fill" style={{ width: `${goalPct}%` }} />
                  <span className="goal-pct" style={{ left: `${Math.min(Math.max(goalPct, 12), 88)}%` }}>{pct(goalPct)}%</span>
                </div>
              </div>
              <div className="goal-foot">
                <span className="goal-dots" aria-hidden="true">
                  {[1, 2, 3, 4, 5].map((step) => <i key={step} className={goalPct >= step * 20 ? "on" : undefined} />)}
                </span>
                <span>
                  Meta {brlCompact(goalCents)}
                  {" · "}
                  {dashboard.allTimeRevenueCents >= goalCents ? <b>atingida</b> : <>faltam <b>{brlCompact(goalCents - dashboard.allTimeRevenueCents)}</b></>}
                </span>
              </div>
            </div>
          </div>
        ) : (
          <Link className="tb-btn goal-empty" href="/configuracoes">Definir meta de faturamento</Link>
        )}
        <div className="dash-hello">
          <h1>{greeting}, <em>{user.organizationName}</em></h1>
          <p className="dash-date">{today}</p>
        </div>
        <span aria-hidden="true" />
      </header>

      <div className="dash-toolbar">
        <nav className="period-chips" aria-label="Período">
          {SALES_PRESETS.map((item) => (
            <Link
              key={item}
              href={`/dashboard?periodo=${item}`}
              className={`period-chip${!custom && item === preset ? " is-active" : ""}`}
              aria-current={!custom && item === preset ? "page" : undefined}
            >
              {SALES_PRESET_LABELS[item]}
            </Link>
          ))}
        </nav>
        <div className="dash-filters">
          <form method="get" className="date-range">
            <input type="date" name="de" defaultValue={inputFrom} aria-label="Data inicial" />
            <span>até</span>
            <input type="date" name="ate" defaultValue={inputTo} aria-label="Data final" />
            <button className="tb-btn tb-filter" type="submit">Filtrar</button>
          </form>
          <Link className="tb-btn" href="/dashboard">Limpar</Link>
          <Link className="tb-btn tb-refresh" href={currentHref}>{icons.refresh}Atualizar</Link>
          <form action={stopOperationAction}>
            <ConfirmSubmitButton
              className="tb-btn tb-stop"
              message="Parar as postagens pendentes e em andamento? As campanhas ativas serão pausadas e a fila será limpa."
            >
              {icons.stop}Parar operação
            </ConfirmSubmitButton>
          </form>
        </div>
      </div>

      <section className="kpi-heroes" aria-label={`Destaques · ${dashboard.periodLabel}`}>
        <Kpi hero tone="green" sublabel="Vendas aprovadas" label="Receita total" icon={icons.money} value={<Money cents={dashboard.revenueCents} />} />
        <Kpi hero tone="blue" sublabel="Engajamento geral" label="Views dos posts" icon={icons.trend} value={formatNumber(dashboard.viewsTotal)} />
      </section>

      <section className="kpi-row" aria-label="Indicadores do período">
        <Kpi tone="indigo" label="Vídeos postados" icon={icons.video} value={formatNumber(dashboard.videosPosted)} />
        <Kpi
          tone="cyan" label="PIX gerados" icon={icons.pix} value={<Money cents={dashboard.pixAmountCents} />}
          foot={<span className="kpi-tag">{dashboard.pixCount} {dashboard.pixCount === 1 ? "gerado" : "gerados"}</span>}
        />
        <Kpi tone="blue" label="Leads cadastrados" icon={icons.lead} value={formatNumber(dashboard.leads)} />
        <Kpi
          tone="green" label="Pagamento" icon={icons.card} value={formatNumber(dashboard.salesCount)}
          foot={<span className="kpi-tag kpi-tag-success">{pct(dashboard.conversionRate)}% conv</span>}
        />
      </section>

      <section className="dash-grid">
        <Card
          icon={icons.trend}
          title="Histórico de Vendas"
          action={
            <span className="seg-toggle" role="group" aria-label="Janela do gráfico">
              <Link className={`seg${dashboard.chartDays === 7 ? " is-active" : ""}`} href={chartHref("7d")}>7D</Link>
              <Link className={`seg${dashboard.chartDays === 30 ? " is-active" : ""}`} href={chartHref("30d")}>30D</Link>
            </span>
          }
        >
          <div className="chart-stats">
            <div><span>Total no período</span><strong>{brlReais(chartTotal)}</strong></div>
            <div><span>Melhor dia</span><strong>{brlReais(values[best] ?? 0)}<small>{dashboard.series[best]?.label ?? "—"}</small></strong></div>
            <div><span>Média por dia</span><strong>{brlReais(chartAvg)}</strong></div>
          </div>
          <SalesChart points={dashboard.series.map((point) => ({ label: point.label, value: point.value ?? 0 }))} />
        </Card>

        <Card
          icon={icons.flame}
          plainIcon
          title="Perfis Viralizando"
          meta="últimos 3 dias"
          action={<Link className="dcard-icon-btn" href="/analises" aria-label="Ver análises" title="Ver análises">{icons.eye}</Link>}
        >
          {dashboard.viral.length ? (
            <ol className="viral-list">
              {dashboard.viral.map((profile, index) => (
                <li key={profile.id}>
                  <span className="viral-rank">{index + 1}</span>
                  <span className="account-avatar account-avatar-small" aria-hidden="true">
                    {profile.profile_picture_url ? <img src={profile.profile_picture_url} alt="" /> : initials(profile.username)}
                  </span>
                  <Link className="quiet-link" href={`/contas/${profile.id}`}>@{profile.username}</Link>
                  <strong>{formatNumber(Number(profile.views))}</strong>
                </li>
              ))}
            </ol>
          ) : (
            <p className="dcard-empty">Sem dados de engajamento nos últimos 3 dias.</p>
          )}
        </Card>
      </section>

      <section className="dash-grid">
        <div className="dash-stack">
          <Card icon={icons.funnel} tone="indigo" title="Funil de Conversão" meta={dashboard.periodLabel}>
            <ol className="funnel">
              {funnelLabels.map((label, index) => (
                <li key={label} className="funnel-stage">
                  <div className="funnel-row">
                    <span className="funnel-label">{label}</span>
                    <div className="funnel-track" aria-hidden="true">
                      <div
                        className={`funnel-fill funnel-fill-${index}`}
                        style={{ width: `${Math.max(3, (dashboard.funnel.values[index] / funnelMax) * 100)}%` }}
                      />
                    </div>
                    <strong className="funnel-value">{formatNumber(dashboard.funnel.values[index])}</strong>
                  </div>
                  {index < funnelLabels.length - 1 ? (
                    <span className="funnel-rate">
                      {dashboard.funnel.rates[index] === null ? "—" : `${pct(dashboard.funnel.rates[index]!)}%`} de conversão
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
          </Card>

          <Card icon={icons.queue} title="Fila de Postagens" meta="últimos disparos" action={<Link className="text-link" href="/fila">Abrir fila</Link>}>
            <QueueTable rows={queue} />
          </Card>
        </div>

        <div className="dash-stack">
          <Card icon={icons.webhook} tone="cyan" title="Rastrear Vendas" meta="PIX → venda">
            <div className="webhook-box">
              <CopyWebhook url={webhookUrl} />
              <p>Cole esta URL no webhook do seu bot (XyronBot, SharkBot, MadBot ou genérico). Cada evento aparece no log abaixo.</p>
            </div>
          </Card>

          <Card icon={icons.activity} tone="teal" title="Log de Atividades" meta="tempo real">
            {dashboard.activity.length ? (
              <ol className="activity-list">
                {dashboard.activity.map((event) => (
                  <li key={event.id}>
                    <span className={`activity-dot dot-${event.event_type.toLowerCase()}`} aria-hidden="true" />
                    <div>
                      <strong>{activityLabels[event.event_type] ?? event.event_type}</strong>
                      <small>{event.product_name ?? (event.amount_cents ? brl(event.amount_cents) : "Sem valor")}</small>
                    </div>
                    <time dateTime={new Date(event.occurred_at).toISOString()}>{formatDate(event.occurred_at, { timezone })}</time>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="dcard-empty">Nenhum evento recebido ainda. Gere um PIX de teste no seu bot.</p>
            )}
          </Card>
        </div>
      </section>
    </div>
  );
}
