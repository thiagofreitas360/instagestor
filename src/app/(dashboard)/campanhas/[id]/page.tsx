import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import {
  cancelCampaignAction,
  duplicateCampaignAction,
  pauseCampaignAction,
  resumeCampaignAction,
  scheduleCampaignAction,
} from "@/app/actions";
import { getSqlClient } from "@/db/client";
import {
  DefinitionList,
  EmptyState,
  formatBytes,
  formatDate,
  formatPublicationType,
  MessageBanner,
  MetricCard,
  PageHeader,
  Panel,
  StatusBadge,
  initials,
} from "@/components/ui";
import { CampaignRhythmFields, CampaignTargetsSelector } from "@/components/campaign-schedule-fields";
import { getPrivateMediaUrl } from "@/providers/storage";

type Campaign = {
  id: string;
  name: string;
  publication_type: string;
  caption: string | null;
  status: string;
  start_at: Date | null;
  timezone: string;
  delay_mode: "FIXED" | "RANDOM";
  delay_fixed_seconds: number | null;
  delay_min_seconds: number | null;
  delay_max_seconds: number | null;
  target_order: "SELECTED" | "RANDOM" | "USERNAME";
  share_to_feed: boolean;
  created_at: Date;
  scheduled_at: Date | null;
  paused_at: Date | null;
  cancelled_at: Date | null;
};
type Media = {
  id: string;
  original_filename: string;
  media_kind: "IMAGE" | "VIDEO";
  size_bytes: number;
  width: number | null;
  height: number | null;
};
type Account = { id: string; username: string; display_name: string | null; status: string };
type Group = { id: string; name: string; member_count: number; account_ids: string[] };
type Target = { id: string; username: string; display_name: string | null; position: number; scheduled_at: Date | null };
type Job = {
  id: string;
  account_id: string;
  username: string;
  status: string;
  scheduled_at: Date;
  published_at: Date | null;
  attempt_count: number;
  max_attempts: number;
  meta_media_id: string | null;
  last_error_message: string | null;
};
type JobStats = { total: number; published: number; pending: number; failed: number; cancelled: number };
type Setting = { default_timezone: string; default_delay_mode: "FIXED" | "RANDOM"; default_delay_min: number; default_delay_max: number };

type SearchParams = {
  erro?: string | string[];
  ok?: string | string[];
  preview?: string | string[];
};
type PageProps = { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> };

function first(value?: string | string[]) { return Array.isArray(value) ? value[0] : value; }
function localInputValue(timezone: string) {
  return DateTime.now().setZone(timezone).plus({ minutes: 10 }).startOf("minute").toFormat("yyyy-MM-dd'T'HH:mm");
}

export default async function CampaignDetailPage({ params, searchParams }: PageProps) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const sql = getSqlClient();
  const [[campaign], media, accounts, groups, targets, jobs, [stats], [setting]] = await Promise.all([
    sql<Campaign[]>`SELECT * FROM campaigns WHERE id = ${id} LIMIT 1`,
    sql<Media[]>`
      SELECT asset.id, asset.original_filename, asset.media_kind, asset.size_bytes,
        asset.width, asset.height
      FROM campaign_media relation
      JOIN media_assets asset ON asset.id = relation.media_asset_id
      WHERE relation.campaign_id = ${id}
      ORDER BY relation.position
    `,
    sql<Account[]>`
      SELECT id, username, display_name, status
      FROM instagram_accounts
      WHERE status IN ('CONNECTED', 'TOKEN_EXPIRING')
      ORDER BY username
    `,
    sql<Group[]>`
      SELECT group_row.id, group_row.name,
        count(grouped_account.id) FILTER (WHERE grouped_account.status IN ('CONNECTED', 'TOKEN_EXPIRING'))::int AS member_count,
        coalesce(array_agg(grouped_account.id::text)
          FILTER (WHERE grouped_account.status IN ('CONNECTED', 'TOKEN_EXPIRING')), '{}') AS account_ids
      FROM account_groups group_row
      LEFT JOIN account_group_members member ON member.group_id = group_row.id
      LEFT JOIN instagram_accounts grouped_account ON grouped_account.id = member.instagram_account_id
      GROUP BY group_row.id ORDER BY group_row.name
    `,
    sql<Target[]>`
      SELECT account.id, account.username, account.display_name, target.position, target.scheduled_at
      FROM campaign_targets target
      JOIN instagram_accounts account ON account.id = target.instagram_account_id
      WHERE target.campaign_id = ${id}
      ORDER BY target.position
    `,
    sql<Job[]>`
      SELECT job.id, account.id AS account_id, account.username, job.status, job.scheduled_at,
        job.published_at, job.attempt_count, job.max_attempts, job.meta_media_id, job.last_error_message
      FROM publication_jobs job
      JOIN instagram_accounts account ON account.id = job.instagram_account_id
      WHERE job.campaign_id = ${id}
      ORDER BY job.scheduled_at
      LIMIT 100
    `,
    sql<JobStats[]>`
      SELECT count(*)::int AS total,
        count(*) FILTER (WHERE status = 'PUBLISHED')::int AS published,
        count(*) FILTER (WHERE status IN ('QUEUED', 'CLAIMED', 'CREATING_CONTAINER', 'WAITING_FOR_CONTAINER', 'READY_TO_PUBLISH', 'PUBLISHING', 'RETRY_WAIT'))::int AS pending,
        count(*) FILTER (WHERE status IN ('FAILED', 'RECONCILIATION_REQUIRED'))::int AS failed,
        count(*) FILTER (WHERE status = 'CANCELLED')::int AS cancelled
      FROM publication_jobs WHERE campaign_id = ${id}
    `,
    sql<Setting[]>`SELECT default_timezone, default_delay_mode, default_delay_min, default_delay_max FROM settings WHERE id = true`,
  ]);
  if (!campaign) notFound();
  const mediaWithUrls = media.map((asset) => ({
    ...asset,
    previewUrl: getPrivateMediaUrl(asset.id),
  }));

  const timezone = campaign.start_at ? campaign.timezone : setting?.default_timezone || campaign.timezone || "America/Sao_Paulo";
  const startAt = campaign.start_at
    ? DateTime.fromJSDate(campaign.start_at).setZone(timezone).toFormat("yyyy-MM-dd'T'HH:mm")
    : localInputValue(timezone);
  const delayMode = campaign.start_at ? campaign.delay_mode : setting?.default_delay_mode ?? "FIXED";
  const delayFixedSeconds = campaign.start_at ? campaign.delay_fixed_seconds ?? 120 : setting?.default_delay_min ?? 120;
  const delayMinSeconds = campaign.start_at ? campaign.delay_min_seconds ?? 120 : setting?.default_delay_min ?? 120;
  const delayMaxSeconds = campaign.start_at ? campaign.delay_max_seconds ?? 300 : setting?.default_delay_max ?? 300;
  const targetOrder = campaign.target_order;
  const selectedAccountIds = new Set(targets.map((target) => target.id));
  const previewRequested = first(query.preview) === "1";
  const previewTargets = targets.filter((target): target is Target & { scheduled_at: Date } => target.scheduled_at !== null);

  const progress = stats.total ? Math.round((stats.published / stats.total) * 100) : 0;
  const canPause = ["SCHEDULED", "RUNNING"].includes(campaign.status);
  const canResume = campaign.status === "PAUSED";
  const canCancel = !["COMPLETED", "CANCELLED"].includes(campaign.status);

  return (
    <div className="page-stack">
      <nav className="breadcrumbs" aria-label="Navegação estrutural">
        <Link href="/campanhas">Campanhas</Link><span aria-hidden="true">/</span><span>{campaign.name}</span>
      </nav>
      <PageHeader
        eyebrow={formatPublicationType(campaign.publication_type)}
        title={campaign.name}
        description={campaign.start_at ? `Início em ${formatDate(campaign.start_at, { timezone: campaign.timezone })} · ${campaign.timezone}` : "Campanha em preparação — defina destinos e cronograma."}
        actions={
          <>
            <StatusBadge status={campaign.status} />
            {canPause ? <form action={pauseCampaignAction}><input type="hidden" name="campaignId" value={campaign.id} /><button className="button button-secondary" type="submit">Pausar</button></form> : null}
            {canResume ? <form action={resumeCampaignAction}><input type="hidden" name="campaignId" value={campaign.id} /><button className="button button-primary" type="submit">Retomar</button></form> : null}
            <form action={duplicateCampaignAction}><input type="hidden" name="campaignId" value={campaign.id} /><button className="button button-ghost" type="submit">Duplicar</button></form>
          </>
        }
      />
      <MessageBanner error={first(query.erro)} success={first(query.ok) === "agendada" ? "Campanha agendada e jobs criados." : first(query.ok)} />

      <section className="campaign-detail-grid">
        <Panel title="Prévia da publicação" description="Representação do conteúdo que será enviado à Meta." className="preview-panel">
          <div className="instagram-preview">
            <header>
              <span className="account-avatar account-avatar-small" aria-hidden="true">IG</span>
              <div><strong>conta_selecionada</strong><small>Instagram</small></div>
              <span aria-hidden="true">•••</span>
            </header>
            <div className={`instagram-media instagram-media-${campaign.publication_type.toLowerCase()}`}>
              {mediaWithUrls.map((asset) => (
                <div className="instagram-media-item" key={asset.id} title={asset.original_filename}>
                  {asset.previewUrl ? (
                    asset.media_kind === "VIDEO" ? (
                      <video src={asset.previewUrl} controls playsInline preload="metadata" aria-label={`Prévia de ${asset.original_filename}`} />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={asset.previewUrl} alt={`Prévia de ${asset.original_filename}`} />
                    )
                  ) : (
                    <><span aria-hidden="true">{asset.media_kind === "VIDEO" ? "▶" : "▧"}</span><small>{asset.original_filename}</small></>
                  )}
                </div>
              ))}
            </div>
            <div className="instagram-copy">
              <div className="instagram-actions" aria-hidden="true"><span>♡</span><span>○</span><span>⌁</span><span>▱</span></div>
              {campaign.caption ? <p><strong>conta_selecionada</strong> {campaign.caption}</p> : <p className="muted">Sem legenda</p>}
            </div>
          </div>
          <div className="preview-assets">
            {media.map((asset) => (
              <div key={asset.id}>
                <span className="media-file-icon" aria-hidden="true">{asset.media_kind === "VIDEO" ? "▶" : "▧"}</span>
                <span><strong>{asset.original_filename}</strong><small>{formatBytes(asset.size_bytes)}{asset.width && asset.height ? ` · ${asset.width} × ${asset.height}` : ""}</small></span>
              </div>
            ))}
          </div>
        </Panel>

        <div className="campaign-detail-side">
          <Panel title="Configuração">
            <DefinitionList items={[
              { label: "Formato", value: formatPublicationType(campaign.publication_type) },
              { label: "Mídias", value: media.length },
              { label: "Compartilhar no Feed", value: campaign.share_to_feed ? "Sim" : "Não" },
              { label: "Criada em", value: formatDate(campaign.created_at) },
              { label: "Ordem", value: campaign.target_order === "USERNAME" ? "Por usuário" : campaign.target_order === "RANDOM" ? "Aleatória" : "Selecionada" },
            ]} />
          </Panel>
          {canCancel ? (
            <Panel className="danger-zone" title="Interromper campanha" description="Publicações já concluídas permanecem no Instagram.">
              <form action={cancelCampaignAction}>
                <input type="hidden" name="campaignId" value={campaign.id} />
                <button className="button button-danger button-block" type="submit">Cancelar campanha</button>
              </form>
            </Panel>
          ) : null}
        </div>
      </section>

      {campaign.status === "DRAFT" ? (
        <Panel title="Destinos e cronograma" description="Gere uma prévia para revisar todos os horários antes da confirmação final.">
          <form className="schedule-form" action={scheduleCampaignAction}>
            <input type="hidden" name="campaignId" value={campaign.id} />
            <div className="schedule-section">
              <div className="schedule-section-heading"><span>1</span><div><h3>Selecione os destinos</h3><p>Contas repetidas entre grupos serão incluídas apenas uma vez.</p></div></div>
              <CampaignTargetsSelector accounts={accounts} groups={groups} initialAccountIds={[...selectedAccountIds]} />
            </div>

            <div className="schedule-section">
              <div className="schedule-section-heading"><span>2</span><div><h3>Defina o ritmo</h3><p>Todos os horários são interpretados no fuso escolhido e gravados em UTC.</p></div></div>
              <CampaignRhythmFields
                startAt={startAt}
                timezone={timezone}
                delayMode={delayMode}
                delayFixedSeconds={delayFixedSeconds}
                delayMinSeconds={delayMinSeconds}
                delayMaxSeconds={delayMaxSeconds}
                targetOrder={targetOrder}
              />
              <label className="switch-field">
                <input name="publishNow" type="checkbox" />
                <span><strong>Publicar assim que possível</strong><small>Ignora a data acima e inicia o cronograma ao gerar esta prévia.</small></span>
              </label>
              <p className="form-hint">No modo fixo, use “intervalo fixo”. No aleatório, os valores mínimo e máximo definem a janela possível.</p>
            </div>
            <button className="button button-secondary" type="submit" name="intent" value="preview">Gerar prévia do cronograma</button>
          </form>

          {previewTargets.length ? (
            <section className="schedule-preview" aria-labelledby="schedule-preview-title">
              <header>
                <div><p className="eyebrow">Prévia antes da confirmação</p><h3 id="schedule-preview-title">Cronograma de {previewTargets.length} publicações</h3></div>
                <span className="preview-exact">Horários exatos</span>
              </header>
              <div className="table-scroll schedule-preview-table">
                <table>
                  <thead><tr><th scope="col">Ordem</th><th scope="col">Conta</th><th scope="col">Publicação prevista</th><th scope="col">Intervalo</th></tr></thead>
                  <tbody>
                    {previewTargets.map((target, index) => {
                      const previous = previewTargets[index - 1]?.scheduled_at;
                      const intervalSeconds = previous ? Math.round((target.scheduled_at.getTime() - previous.getTime()) / 1000) : null;
                      return (
                        <tr key={target.id}>
                          <td data-label="Ordem">{target.position + 1}</td>
                          <td data-label="Conta"><span className="account-cell"><span className="account-avatar account-avatar-small" aria-hidden="true">{initials(target.display_name ?? target.username)}</span><span><strong>@{target.username}</strong><small>{target.display_name}</small></span></span></td>
                          <td data-label="Publicação prevista"><strong>{formatDate(target.scheduled_at, { timezone })}</strong></td>
                          <td data-label="Intervalo">{intervalSeconds === null ? "Início" : `${intervalSeconds} s`}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="schedule-confirmation">
                <div><strong>Revise antes de criar os jobs</strong><p>Esta prévia está persistida. Confirmar cria um job por conta exatamente nos horários exibidos.</p></div>
                <form action={scheduleCampaignAction}>
                  <input type="hidden" name="campaignId" value={campaign.id} />
                  <button className="button button-primary" type="submit" name="intent" value="confirm">Confirmar e agendar {previewTargets.length} publicações</button>
                </form>
              </div>
            </section>
          ) : previewRequested ? (
            <div className="message-banner message-error" role="alert"><strong>Prévia indisponível</strong><span>Gere novamente o cronograma e confira se há contas disponíveis.</span></div>
          ) : null}
        </Panel>
      ) : (
        <>
          <section className="metric-grid metric-grid-compact" aria-label="Resultados da campanha">
            <MetricCard label="Destinos" value={targets.length} />
            <MetricCard label="Publicadas" value={stats.published} tone="success" detail={`${progress}% concluído`} />
            <MetricCard label="Em processamento" value={stats.pending} tone="warning" />
            <MetricCard label="Com atenção" value={stats.failed} tone={stats.failed ? "danger" : "default"} />
          </section>
          <Panel title="Publicações por conta" description={`Exibindo ${jobs.length} de ${stats.total} jobs`} action={<Link className="text-link" href="/fila">Abrir fila completa</Link>}>
            {jobs.length ? (
              <div className="table-scroll">
                <table>
                  <thead><tr><th scope="col">Ordem</th><th scope="col">Conta</th><th scope="col">Status</th><th scope="col">Agendamento</th><th scope="col">Tentativas</th><th scope="col">Meta ID / ocorrência</th></tr></thead>
                  <tbody>
                    {jobs.map((job, index) => (
                      <tr key={job.id}>
                        <td data-label="Ordem">{index + 1}</td>
                        <td data-label="Conta"><Link className="quiet-link" href={`/contas/${job.account_id}`}>@{job.username}</Link></td>
                        <td data-label="Status"><StatusBadge status={job.status} /></td>
                        <td data-label="Agendamento">{formatDate(job.published_at ?? job.scheduled_at, { timezone: campaign.timezone })}</td>
                        <td data-label="Tentativas">{job.attempt_count}/{job.max_attempts}</td>
                        <td data-label="Meta ID / ocorrência" className="cell-wrap">
                          {job.last_error_message ?? (job.meta_media_id ? <span className="mono-copy">{job.meta_media_id}</span> : <span className="muted">—</span>)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <EmptyState title="Nenhum job criado" description="A campanha ainda não possui publicações individuais." />}
          </Panel>
        </>
      )}
    </div>
  );
}
