import Link from "next/link";
import { getSqlClient } from "@/db/client";
import { EmptyState, formatDate, MetricCard, PageHeader, Panel, StatusBadge } from "@/components/ui";

type Summary = {
  accounts_total: number;
  accounts_available: number;
  accounts_problem: number;
  active_campaigns: number;
  jobs_pending: number;
  jobs_processing: number;
  jobs_retrying: number;
  published_today: number;
  failed_today: number;
  last_worker_seen: Date | null;
  active_workers: number;
  default_timezone: string;
};

type RecentCampaign = {
  id: string;
  name: string;
  status: string;
  created_at: Date;
  start_at: Date | null;
  timezone: string;
  jobs_total: number;
  jobs_published: number;
};

type UpcomingJob = {
  id: string;
  scheduled_at: Date;
  campaign_id: string;
  campaign_name: string;
  username: string;
  timezone: string;
};

type AuditActivity = {
  id: string;
  event_type: string;
  entity_type: string;
  created_at: Date;
  actor_email: string | null;
};

function auditLabel(eventType: string) {
  const labels: Record<string, string> = {
    ACCOUNT_CONNECTED: "Conta conectada",
    ACCOUNT_DISCONNECTED: "Conta desconectada",
    ACCOUNT_DEAUTHORIZED: "Conta desautorizada",
    CAMPAIGN_CREATED: "Campanha criada",
    CAMPAIGN_SCHEDULED: "Campanha agendada",
    CAMPAIGN_PAUSED: "Campanha pausada",
    CAMPAIGN_RESUMED: "Campanha retomada",
    CAMPAIGN_CANCELLED: "Campanha cancelada",
    GROUP_CREATED: "Grupo criado",
    GROUP_UPDATED: "Grupo atualizado",
    MEDIA_DELETED: "Mídia excluída",
    JOB_MANUAL_RETRY: "Job reenfileirado",
    JOB_CANCELLED: "Job cancelado",
    DATA_DELETION_REQUESTED: "Exclusão de dados solicitada",
  };
  return labels[eventType] ?? eventType.replaceAll("_", " ").toLocaleLowerCase("pt-BR");
}

export default async function DashboardPage() {
  const sql = getSqlClient();
  const [[summary], campaigns, upcomingJobs, auditActivity] = await Promise.all([
    sql<Summary[]>`
      WITH config AS (
        SELECT coalesce((SELECT default_timezone FROM settings WHERE id = true), 'America/Sao_Paulo') AS default_timezone
      )
      SELECT
        (SELECT count(*)::int FROM instagram_accounts) AS accounts_total,
        (SELECT count(*)::int FROM instagram_accounts WHERE status IN ('CONNECTED', 'TOKEN_EXPIRING')) AS accounts_available,
        (SELECT count(*)::int FROM instagram_accounts WHERE status IN ('REAUTH_REQUIRED', 'ERROR', 'DISABLED')) AS accounts_problem,
        (SELECT count(*)::int FROM campaigns WHERE status IN ('SCHEDULED', 'RUNNING', 'PAUSED')) AS active_campaigns,
        (SELECT count(*)::int FROM publication_jobs WHERE status IN (
          'QUEUED', 'CLAIMED', 'CREATING_CONTAINER', 'WAITING_FOR_CONTAINER',
          'READY_TO_PUBLISH', 'PUBLISHING', 'RETRY_WAIT'
        )) AS jobs_pending,
        (SELECT count(*)::int FROM publication_jobs WHERE status IN (
          'CLAIMED', 'CREATING_CONTAINER', 'WAITING_FOR_CONTAINER', 'READY_TO_PUBLISH', 'PUBLISHING'
        )) AS jobs_processing,
        (SELECT count(*)::int FROM publication_jobs WHERE status = 'RETRY_WAIT') AS jobs_retrying,
        (SELECT count(*)::int FROM publication_jobs
          WHERE status = 'PUBLISHED'
            AND published_at >= date_trunc('day', timezone(config.default_timezone, now())) AT TIME ZONE config.default_timezone
        ) AS published_today,
        (SELECT count(*)::int FROM publication_jobs
          WHERE status IN ('FAILED', 'RECONCILIATION_REQUIRED')
            AND updated_at >= date_trunc('day', timezone(config.default_timezone, now())) AT TIME ZONE config.default_timezone
        ) AS failed_today,
        (SELECT max(last_seen_at) FROM worker_heartbeats) AS last_worker_seen,
        (SELECT count(*)::int FROM worker_heartbeats WHERE last_seen_at >= now() - interval '90 seconds') AS active_workers,
        config.default_timezone
      FROM config
    `,
    sql<RecentCampaign[]>`
      SELECT campaign.id, campaign.name, campaign.status,
        campaign.created_at, campaign.start_at, campaign.timezone,
        count(job.id)::int AS jobs_total,
        count(job.id) FILTER (WHERE job.status = 'PUBLISHED')::int AS jobs_published
      FROM campaigns campaign
      LEFT JOIN publication_jobs job ON job.campaign_id = campaign.id
      GROUP BY campaign.id
      ORDER BY campaign.updated_at DESC
      LIMIT 5
    `,
    sql<UpcomingJob[]>`
      SELECT job.id, job.scheduled_at,
        campaign.id AS campaign_id, campaign.name AS campaign_name,
        account.username, campaign.timezone
      FROM publication_jobs job
      JOIN campaigns campaign ON campaign.id = job.campaign_id
      JOIN instagram_accounts account ON account.id = job.instagram_account_id
      WHERE job.status IN ('QUEUED', 'RETRY_WAIT')
      ORDER BY COALESCE(job.next_attempt_at, job.scheduled_at) ASC
      LIMIT 6
    `,
    sql<AuditActivity[]>`
      SELECT audit.id, audit.event_type, audit.entity_type, audit.created_at,
        actor.email AS actor_email
      FROM audit_logs audit
      LEFT JOIN users actor ON actor.id = audit.actor_user_id
      ORDER BY audit.created_at DESC
      LIMIT 7
    `,
  ]);

  const workerOnline = summary.active_workers > 0;
  const accountReadiness = summary.accounts_total
    ? Math.round((summary.accounts_available / summary.accounts_total) * 100)
    : 0;

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Visão geral"
        title="Operação do Instagram"
        description="Acompanhe contas, campanhas e publicações em um só lugar."
        actions={
          <>
            <Link className="button button-secondary" href="/midias">
              Enviar mídia
            </Link>
            <Link className="button button-primary" href="/campanhas/nova">
              Nova campanha
            </Link>
          </>
        }
      />

      <section className="metric-grid dashboard-metrics" aria-label="Resumo da operação">
        <MetricCard
          label="Contas disponíveis"
          value={`${summary.accounts_available}/${summary.accounts_total}`}
          detail={`${accountReadiness}% prontas para publicar`}
          tone="brand"
        />
        <MetricCard
          label="Contas com atenção"
          value={summary.accounts_problem}
          detail={summary.accounts_problem ? "Reconexão, erro ou desativação" : "Todas as contas operacionais"}
          tone={summary.accounts_problem ? "danger" : "default"}
        />
        <MetricCard
          label="Campanhas ativas"
          value={summary.active_campaigns}
          detail="Agendadas, executando ou pausadas"
        />
        <MetricCard label="Publicações na fila" value={summary.jobs_pending} detail="Inclui novas tentativas" tone="warning" />
        <MetricCard label="Jobs processando" value={summary.jobs_processing} detail="Reservados ou em publicação" tone={summary.jobs_processing ? "brand" : "default"} />
        <MetricCard label="Novas tentativas" value={summary.jobs_retrying} detail="Jobs em backoff controlado" tone="warning" />
        <MetricCard label="Publicadas hoje" value={summary.published_today} detail={`Desde 00:00 · ${summary.default_timezone}`} tone="success" />
        <MetricCard
          label="Atenção hoje"
          value={summary.failed_today}
          detail={summary.failed_today ? "Falhas ou verificações pendentes" : "Nenhuma falha registrada"}
          tone={summary.failed_today ? "danger" : "default"}
        />
      </section>

      <section className="dashboard-grid">
        <Panel
          title="Campanhas recentes"
          description="Progresso das últimas operações"
          action={
            <Link className="text-link" href="/campanhas">
              Ver todas
            </Link>
          }
        >
          {campaigns.length ? (
            <div className="campaign-list">
              {campaigns.map((campaign) => {
                const progress = campaign.jobs_total
                  ? Math.round((campaign.jobs_published / campaign.jobs_total) * 100)
                  : campaign.status === "DRAFT"
                    ? 0
                    : 100;
                return (
                  <Link className="campaign-row" href={`/campanhas/${campaign.id}`} key={campaign.id}>
                    <div className="campaign-row-main">
                      <span className="campaign-row-title">{campaign.name}</span>
                      <span className="campaign-row-meta">
                        {campaign.start_at
                          ? formatDate(campaign.start_at, { timezone: campaign.timezone })
                          : `Criada em ${formatDate(campaign.created_at, { timezone: summary.default_timezone })}`}
                      </span>
                    </div>
                    <div className="campaign-row-progress" aria-label={`${progress}% concluído`}>
                      <span>
                        {campaign.jobs_published}/{campaign.jobs_total || "—"}
                      </span>
                      <div className="progress-track" aria-hidden="true">
                        <div className="progress-value" style={{ width: `${progress}%` }} />
                      </div>
                    </div>
                    <StatusBadge status={campaign.status} />
                  </Link>
                );
              })}
            </div>
          ) : (
            <EmptyState
              title="Sua primeira campanha começa aqui"
              description="Envie uma mídia, escolha as contas e defina o agendamento."
              href="/campanhas/nova"
              actionLabel="Criar campanha"
            />
          )}
        </Panel>

        <div className="dashboard-side-stack">
          <Panel title="Worker de publicação" description="Processamento da fila">
            <div className="worker-status">
              <span className={`worker-orb ${workerOnline ? "is-online" : "is-offline"}`} aria-hidden="true" />
              <div>
                <StatusBadge status={workerOnline ? "ONLINE" : "OFFLINE"} />
                <p>
                  {workerOnline
                    ? `${summary.active_workers} worker${summary.active_workers === 1 ? "" : "s"} ativo${summary.active_workers === 1 ? "" : "s"}`
                    : summary.last_worker_seen
                      ? `Último sinal em ${formatDate(summary.last_worker_seen, { timezone: summary.default_timezone })}`
                      : "Nenhum worker registrado"}
                </p>
              </div>
            </div>
          </Panel>

          <Panel
            title="Próximas publicações"
            action={
              <Link className="text-link" href="/fila">
                Abrir fila
              </Link>
            }
          >
            {upcomingJobs.length ? (
              <ol className="upcoming-list">
                {upcomingJobs.map((job) => (
                  <li key={job.id}>
                    <span className="timeline-dot" aria-hidden="true" />
                    <div>
                      <Link href={`/campanhas/${job.campaign_id}`}>{job.campaign_name}</Link>
                      <small>@{job.username}</small>
                    </div>
                    <time dateTime={job.scheduled_at.toISOString()}>{formatDate(job.scheduled_at, { timezone: job.timezone })}</time>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="panel-placeholder">Nenhuma publicação aguardando processamento.</p>
            )}
          </Panel>

          <Panel title="Atividade administrativa" description="Eventos recentes do registro de auditoria">
            {auditActivity.length ? (
              <ol className="audit-activity-list">
                {auditActivity.map((activity) => (
                  <li key={activity.id}>
                    <span className="timeline-dot" aria-hidden="true" />
                    <div>
                      <strong>{auditLabel(activity.event_type)}</strong>
                      <small>{activity.actor_email ?? "Sistema"} · {activity.entity_type}</small>
                    </div>
                    <time dateTime={activity.created_at.toISOString()}>{formatDate(activity.created_at, { timezone: summary.default_timezone })}</time>
                  </li>
                ))}
              </ol>
            ) : <p className="panel-placeholder">Nenhuma atividade registrada.</p>}
          </Panel>
        </div>
      </section>
    </div>
  );
}
