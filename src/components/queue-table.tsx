import Link from "next/link";
import { cancelJobAction, retryJobAction } from "@/app/actions";
import { EmptyState, formatDate, StatusBadge } from "@/components/ui";

export type QueueRow = {
  id: string;
  campaign_id: string;
  campaign_name: string;
  account_id: string;
  username: string;
  status: string;
  scheduled_at: Date;
  attempt_count: number;
  max_attempts: number;
  next_attempt_at: Date | null;
  published_at: Date | null;
  finished_at: Date | null;
  last_error_code: string | null;
  last_error_message: string | null;
  meta_media_id: string | null;
};

export function QueueTable({ rows, history = false }: { rows: QueueRow[]; history?: boolean }) {
  if (!rows.length) {
    return (
      <EmptyState
        title={history ? "Nenhuma publicação no histórico" : "A fila está livre"}
        description={
          history
            ? "Publicações concluídas, canceladas ou com falha aparecerão aqui."
            : "Quando uma campanha for agendada, cada conta terá um job acompanhado nesta tela."
        }
      />
    );
  }

  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th scope="col">Status</th>
            <th scope="col">Campanha</th>
            <th scope="col">Conta</th>
            <th scope="col">Horário</th>
            <th scope="col">Tentativas</th>
            <th scope="col">Detalhes</th>
            <th scope="col" className="table-action-column">
              Ação
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((job) => (
            <tr key={job.id}>
              <td data-label="Status">
                <StatusBadge status={job.status} />
              </td>
              <td data-label="Campanha">
                <Link className="table-primary-link" href={`/campanhas/${job.campaign_id}`}>
                  {job.campaign_name}
                </Link>
              </td>
              <td data-label="Conta">
                <Link className="quiet-link" href={`/contas/${job.account_id}`}>
                  @{job.username}
                </Link>
              </td>
              <td data-label="Horário">
                <span className="table-main-value">
                  {formatDate(job.published_at ?? job.finished_at ?? job.scheduled_at)}
                </span>
                {job.next_attempt_at ? <small>Nova tentativa: {formatDate(job.next_attempt_at)}</small> : null}
              </td>
              <td data-label="Tentativas">
                {job.attempt_count}/{job.max_attempts}
              </td>
              <td data-label="Detalhes" className="cell-wrap">
                {job.last_error_message ? (
                  <span className="error-copy" title={job.last_error_message}>
                    {job.last_error_code ? `${job.last_error_code}: ` : ""}
                    {job.last_error_message}
                  </span>
                ) : job.meta_media_id ? (
                  <span className="mono-copy" title={job.meta_media_id}>
                    Meta ID {job.meta_media_id}
                  </span>
                ) : (
                  <span className="muted">Sem ocorrências</span>
                )}
              </td>
              <td data-label="Ação" className="table-action-column">
                {job.status === "FAILED" ? (
                  <form action={retryJobAction}>
                    <input type="hidden" name="jobId" value={job.id} />
                    <button className="button button-small button-secondary" type="submit">
                      Tentar novamente
                    </button>
                  </form>
                ) : ["QUEUED", "RETRY_WAIT"].includes(job.status) ? (
                  <form action={cancelJobAction}>
                    <input type="hidden" name="jobId" value={job.id} />
                    <button className="button button-small button-quiet-danger" type="submit">
                      Cancelar pendente
                    </button>
                  </form>
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
