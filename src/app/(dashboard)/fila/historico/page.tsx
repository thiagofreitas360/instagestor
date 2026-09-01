import Link from "next/link";
import { getSqlClient } from "@/db/client";
import { PageHeader, Panel } from "@/components/ui";
import { QueueRow, QueueTable } from "@/components/queue-table";

function first(value?: string | string[]) { return Array.isArray(value) ? value[0] : value; }

const statusFilters: Record<string, string[]> = {
  todos: ["PUBLISHED", "FAILED", "CANCELLED"],
  published: ["PUBLISHED"],
  failed: ["FAILED"],
  cancelled: ["CANCELLED"],
};

export default async function QueueHistoryPage({ searchParams }: { searchParams: Promise<{ status?: string | string[] }> }) {
  const query = await searchParams;
  const requestedStatus = first(query.status) ?? "todos";
  const selectedStatus = requestedStatus in statusFilters ? requestedStatus : "todos";
  const selectedStatuses = statusFilters[selectedStatus];
  const rows = await getSqlClient()<QueueRow[]>`
    SELECT job.id, job.campaign_id, campaign.name AS campaign_name,
      account.id AS account_id, account.username, job.status, job.scheduled_at,
      job.attempt_count, job.max_attempts, job.next_attempt_at, job.published_at,
      job.finished_at, job.last_error_code, job.last_error_message, job.meta_media_id
    FROM publication_jobs job
    JOIN campaigns campaign ON campaign.id = job.campaign_id
    JOIN instagram_accounts account ON account.id = job.instagram_account_id
    WHERE job.status::text = ANY(${selectedStatuses}::text[])
    ORDER BY COALESCE(job.finished_at, job.published_at, job.updated_at) DESC
    LIMIT 300
  `;
  return (
    <div className="page-stack">
      <nav className="breadcrumbs" aria-label="Navegação estrutural">
        <Link href="/fila">Fila</Link><span aria-hidden="true">/</span><span>Histórico</span>
      </nav>
      <PageHeader
        eyebrow="Operação"
        title="Histórico da fila"
        description="Últimas publicações concluídas, canceladas ou encerradas com falha."
        actions={<Link className="button button-secondary" href="/fila">Voltar à fila ativa</Link>}
      />
      <nav className="page-actions" aria-label="Filtrar histórico">
        {[["todos", "Todos"], ["published", "Publicados"], ["failed", "Falharam"], ["cancelled", "Cancelados"]].map(([value, label]) => (
          <Link
            className={`button button-small ${selectedStatus === value ? "button-primary" : "button-secondary"}`}
            href={value === "todos" ? "/fila/historico" : `/fila/historico?status=${value}`}
            key={value}
          >{label}</Link>
        ))}
      </nav>
      <Panel title="Jobs finalizados" description="Até 300 registros, do mais recente para o mais antigo.">
        <QueueTable rows={rows} history />
      </Panel>
    </div>
  );
}
