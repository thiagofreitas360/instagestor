import Link from "next/link";
import { EmptyState, formatDate, formatNumber, MetricCard, PageHeader, Panel, StatusBadge } from "@/components/ui";
import { loadBanHistory } from "@/server/analytics";

export default async function BannedAccountsPage() {
  const history = await loadBanHistory();
  return (
    <div className="page-stack">
      <nav className="breadcrumbs" aria-label="Navegação estrutural">
        <Link href="/analises">Análises</Link><span aria-hidden="true">/</span><span>Banidas</span>
      </nav>
      <PageHeader
        eyebrow="Análises"
        title="Histórico de banidas"
        description="Cada marcação manual fica registrada com o contexto da conta naquele momento."
      />
      <section className="metric-grid metric-grid-compact" aria-label="Resumo de banimentos">
        <MetricCard label="Total de banimentos" value={history.total} tone={history.total ? "danger" : "default"} />
        <MetricCard label="Nos últimos 30 dias" value={history.last30} />
        <MetricCard label="Média de dias de vida" value={history.avgDaysAlive === null ? "—" : formatNumber(history.avgDaysAlive)} />
        <MetricCard label="Média de seguidores no ban" value={formatNumber(history.avgFollowers)} />
      </section>
      <Panel>
        {history.records.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Conta</th>
                  <th scope="col">Banida em</th>
                  <th scope="col">Motivo</th>
                  <th scope="col">Seguidores</th>
                  <th scope="col">Dias de vida</th>
                  <th scope="col">Publicações via ferramenta</th>
                  <th scope="col">Último erro da Meta</th>
                  <th scope="col">Situação atual</th>
                </tr>
              </thead>
              <tbody>
                {history.records.map((record) => (
                  <tr key={record.id}>
                    <td data-label="Conta"><Link className="table-primary-link" href={`/contas/${record.account_id}`}>@{record.username}</Link></td>
                    <td data-label="Banida em">{formatDate(record.banned_at)}</td>
                    <td data-label="Motivo" className="cell-wrap">{record.reason ?? "—"}</td>
                    <td data-label="Seguidores">{formatNumber(record.followers_count)}</td>
                    <td data-label="Dias de vida">{formatNumber(record.days_alive)}</td>
                    <td data-label="Publicações via ferramenta">{formatNumber(record.published_by_tool)}</td>
                    <td data-label="Último erro da Meta" className="cell-wrap">
                      {record.last_error_code ? (
                        <>
                          <span className="mono-copy">{record.last_error_code}</span>
                          {record.last_error_at ? <small className="muted"> · {formatDate(record.last_error_at)}</small> : null}
                        </>
                      ) : <span className="muted">—</span>}
                    </td>
                    <td data-label="Situação atual"><StatusBadge status={record.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="Nenhuma conta banida" description="Marque uma conta como banida na tela de detalhes da conta e ela aparecerá aqui." href="/contas" actionLabel="Ir para contas" />
        )}
      </Panel>
    </div>
  );
}
