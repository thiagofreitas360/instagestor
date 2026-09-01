import Link from "next/link";
import { duplicateCampaignAction } from "@/app/actions";
import { getSqlClient } from "@/db/client";
import { EmptyState, formatDate, formatPublicationType, MessageBanner, PageHeader, Panel, StatusBadge } from "@/components/ui";

type CampaignRow = {
  id: string;
  name: string;
  publication_type: string;
  status: string;
  start_at: Date | null;
  created_at: Date;
  target_count: number;
  jobs_total: number;
  jobs_published: number;
  jobs_failed: number;
};

type PageProps = { searchParams: Promise<{ erro?: string | string[]; ok?: string | string[] }> };
function first(value?: string | string[]) { return Array.isArray(value) ? value[0] : value; }

export default async function CampaignsPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const campaigns = await getSqlClient()<CampaignRow[]>`
    SELECT campaign.id, campaign.name, campaign.publication_type, campaign.status,
      campaign.start_at, campaign.created_at,
      count(DISTINCT target.instagram_account_id)::int AS target_count,
      count(DISTINCT job.id)::int AS jobs_total,
      count(DISTINCT job.id) FILTER (WHERE job.status = 'PUBLISHED')::int AS jobs_published,
      count(DISTINCT job.id) FILTER (WHERE job.status IN ('FAILED', 'RECONCILIATION_REQUIRED'))::int AS jobs_failed
    FROM campaigns campaign
    LEFT JOIN campaign_targets target ON target.campaign_id = campaign.id
    LEFT JOIN publication_jobs job ON job.campaign_id = campaign.id
    GROUP BY campaign.id
    ORDER BY campaign.updated_at DESC
  `;

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Publicação"
        title="Campanhas"
        description="Crie uma vez, selecione as contas e acompanhe cada publicação individualmente."
        actions={<Link className="button button-primary" href="/campanhas/nova">Nova campanha</Link>}
      />
      <MessageBanner error={first(query.erro)} success={first(query.ok)} />

      <Panel>
        {campaigns.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Campanha</th>
                  <th scope="col">Status</th>
                  <th scope="col">Início</th>
                  <th scope="col">Destinos</th>
                  <th scope="col">Progresso</th>
                  <th scope="col">Falhas</th>
                  <th scope="col" className="table-action-column">Ação</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((campaign) => {
                  const progress = campaign.jobs_total ? Math.round((campaign.jobs_published / campaign.jobs_total) * 100) : 0;
                  return (
                    <tr key={campaign.id}>
                      <td data-label="Campanha">
                        <Link className="table-primary-link" href={`/campanhas/${campaign.id}`}>{campaign.name}</Link>
                        <small>{formatPublicationType(campaign.publication_type)}</small>
                      </td>
                      <td data-label="Status"><StatusBadge status={campaign.status} /></td>
                      <td data-label="Início">{campaign.start_at ? formatDate(campaign.start_at) : <span className="muted">Não agendada</span>}</td>
                      <td data-label="Destinos">{campaign.target_count || "—"}</td>
                      <td data-label="Progresso">
                        {campaign.jobs_total ? (
                          <div className="quota-cell">
                            <span>{campaign.jobs_published} de {campaign.jobs_total}</span>
                            <div className="progress-track progress-compact" aria-label={`${progress}% publicado`}>
                              <div className="progress-value" style={{ width: `${progress}%` }} />
                            </div>
                          </div>
                        ) : <span className="muted">—</span>}
                      </td>
                      <td data-label="Falhas"><span className={campaign.jobs_failed ? "danger-count" : "muted"}>{campaign.jobs_failed}</span></td>
                      <td data-label="Ação" className="table-action-column">
                        <div className="table-actions">
                          <Link className="button button-small button-secondary" href={`/campanhas/${campaign.id}`}>Abrir</Link>
                          <form action={duplicateCampaignAction}>
                            <input type="hidden" name="campaignId" value={campaign.id} />
                            <button className="button button-small button-ghost" type="submit">Duplicar</button>
                          </form>
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
            title="Nenhuma campanha criada"
            description="Monte uma campanha com mídia, legenda e formato. O agendamento acontece na etapa seguinte."
            href="/campanhas/nova"
            actionLabel="Criar primeira campanha"
          />
        )}
      </Panel>
    </div>
  );
}
