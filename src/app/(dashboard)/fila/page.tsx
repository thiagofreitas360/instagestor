import Link from "next/link";
import { getSqlClient } from "@/db/client";
import { MessageBanner, MetricCard, PageHeader, Panel, StatusBadge, formatDate } from "@/components/ui";
import { QueueRow, QueueTable } from "@/components/queue-table";
import { AutoRefresh } from "@/components/auto-refresh";

type Counts = { queued: number; processing: number; retrying: number; attention: number };
type Worker = { worker_id: string; last_seen_at: Date; active_jobs: number; version: string | null; is_online: boolean };
type PageProps = { searchParams: Promise<{ erro?: string | string[]; ok?: string | string[]; status?: string | string[] }> };
function first(value?: string | string[]) { return Array.isArray(value) ? value[0] : value; }

const statusFilters: Record<string, string[]> = {
  todos: ["QUEUED", "CLAIMED", "CREATING_CONTAINER", "WAITING_FOR_CONTAINER", "READY_TO_PUBLISH", "PUBLISHING", "RETRY_WAIT", "RECONCILIATION_REQUIRED"],
  queued: ["QUEUED"],
  processing: ["CLAIMED", "CREATING_CONTAINER", "WAITING_FOR_CONTAINER", "READY_TO_PUBLISH", "PUBLISHING"],
  retry: ["RETRY_WAIT"],
  attention: ["RECONCILIATION_REQUIRED"],
};

export default async function QueuePage({ searchParams }: PageProps) {
  const query = await searchParams;
  const requestedStatus = first(query.status) ?? "todos";
  const selectedStatus = requestedStatus in statusFilters ? requestedStatus : "todos";
  const selectedStatuses = statusFilters[selectedStatus];
  const sql = getSqlClient();
  const [rows, [counts], workers] = await Promise.all([
    sql<QueueRow[]>`
      SELECT job.id, job.campaign_id, campaign.name AS campaign_name,
        account.id AS account_id, account.username, job.status, job.scheduled_at,
        job.attempt_count, job.max_attempts, job.next_attempt_at, job.published_at,
        job.finished_at, job.last_error_code, job.last_error_message, job.meta_media_id
      FROM publication_jobs job
      JOIN campaigns campaign ON campaign.id = job.campaign_id
      JOIN instagram_accounts account ON account.id = job.instagram_account_id
      WHERE job.status::text = ANY(${selectedStatuses}::text[])
      ORDER BY
        CASE job.status WHEN 'RECONCILIATION_REQUIRED' THEN 0 WHEN 'PUBLISHING' THEN 1 WHEN 'READY_TO_PUBLISH' THEN 2 WHEN 'RETRY_WAIT' THEN 3 ELSE 4 END,
        COALESCE(job.next_attempt_at, job.scheduled_at)
      LIMIT 200
    `,
    sql<Counts[]>`
      SELECT
        count(*) FILTER (WHERE status = 'QUEUED')::int AS queued,
        count(*) FILTER (WHERE status IN ('CLAIMED', 'CREATING_CONTAINER', 'WAITING_FOR_CONTAINER', 'READY_TO_PUBLISH', 'PUBLISHING'))::int AS processing,
        count(*) FILTER (WHERE status = 'RETRY_WAIT')::int AS retrying,
        count(*) FILTER (WHERE status = 'RECONCILIATION_REQUIRED')::int AS attention
      FROM publication_jobs
    `,
    sql<Worker[]>`
      SELECT worker_id, last_seen_at, active_jobs, version,
        (last_seen_at >= now() - interval '90 seconds') AS is_online
      FROM worker_heartbeats ORDER BY last_seen_at DESC
    `,
  ]);
  const activeWorkers = workers.filter((worker) => worker.is_online);

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Operação"
        title="Fila de publicação"
        description="Cada linha representa uma publicação independente em uma conta."
        actions={
          <>
            <Link className="button button-secondary" href="/fila">Atualizar</Link>
            <Link className="button button-ghost" href="/fila/historico">Ver histórico</Link>
          </>
        }
      />
      <MessageBanner error={first(query.erro)} success={first(query.ok)} />

      <AutoRefresh intervalMs={8_000} />

      <nav className="page-actions" aria-label="Filtrar fila ativa">
        {[["todos", "Todos"], ["queued", "Na fila"], ["processing", "Processando"], ["retry", "Retry"], ["attention", "Revisão manual"]].map(([value, label]) => (
          <Link
            className={`button button-small ${selectedStatus === value ? "button-primary" : "button-secondary"}`}
            href={value === "todos" ? "/fila" : `/fila?status=${value}`}
            key={value}
          >{label}</Link>
        ))}
      </nav>

      <section className="metric-grid metric-grid-compact" aria-label="Estado da fila">
        <MetricCard label="Aguardando" value={counts.queued} />
        <MetricCard label="Processando" value={counts.processing} tone="warning" />
        <MetricCard label="Nova tentativa" value={counts.retrying} tone="warning" />
        <MetricCard label="Verificação manual" value={counts.attention} tone={counts.attention ? "danger" : "default"} />
      </section>

      <Panel
        title="Jobs ativos"
        description={`Até 200 itens · ${activeWorkers.length} worker${activeWorkers.length === 1 ? "" : "s"} online`}
        action={<StatusBadge status={activeWorkers.length ? "ONLINE" : "OFFLINE"} />}
      >
        <QueueTable rows={rows} />
      </Panel>

      {workers.length ? (
        <Panel title="Workers" description="Sinais registrados pelos processos que consomem a fila.">
          <div className="worker-list">
            {workers.map((worker) => {
              const online = worker.is_online;
              return (
                <div key={worker.worker_id}>
                  <span className={`worker-orb ${online ? "is-online" : "is-offline"}`} aria-hidden="true" />
                  <div><strong>{worker.worker_id}</strong><small>Último sinal: {formatDate(worker.last_seen_at)}{worker.version ? ` · v${worker.version}` : ""}</small></div>
                  <span>{worker.active_jobs} {worker.active_jobs === 1 ? "job ativo" : "jobs ativos"}</span>
                </div>
              );
            })}
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
