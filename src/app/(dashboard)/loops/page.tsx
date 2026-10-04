import Link from "next/link";
import { createLoopAction, deleteLoopAction, setLoopStatusAction, updateLoopAction } from "@/app/actions";
import { AutoRefresh } from "@/components/auto-refresh";
import { CampaignMediaSelector } from "@/components/campaign-media-selector";
import { CampaignTargetsSelector } from "@/components/campaign-schedule-fields";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { EmptyState, formatDate, MessageBanner, PageHeader, Panel, StatusBadge } from "@/components/ui";
import { getSqlClient } from "@/db/client";
import { getPrivateMediaUrl } from "@/providers/storage";
import { requireAdmin } from "@/server/auth";
import { getEnv } from "@/lib/env";

type Account = { id: string; username: string; display_name: string | null; status: string };
type Group = { id: string; name: string; member_count: number; account_ids: string[] };
type Media = {
  id: string;
  original_filename: string;
  media_kind: "IMAGE" | "VIDEO";
  size_bytes: number;
  folder_id: string | null;
  folder_name: string | null;
};
type LoopRow = {
  id: string;
  name: string;
  status: "ACTIVE" | "PAUSED";
  media_type: "REELS" | "IMAGE" | "MIXED";
  no_repeat: boolean;
  default_caption: string;
  auto_comment_text: string;
  auto_comment_delay_minutes: number;
  image_every_n: number;
  min_interval_minutes: number;
  max_interval_minutes: number;
  daily_limit_per_account: number;
  tiered_limits: boolean;
  tier_follower_threshold: number;
  tier1_daily_limit: number;
  tier1_min_interval_minutes: number;
  tier1_max_interval_minutes: number;
  account_count: number;
  media_count: number;
  finished_accounts: number;
  published_count: number;
  next_publication_at: Date | null;
  account_ids: string[];
  media_ids: string[];
};
type PageProps = { searchParams: Promise<{ erro?: string | string[]; ok?: string | string[]; modo?: string | string[]; editar?: string | string[] }> };
function first(value?: string | string[]) { return Array.isArray(value) ? value[0] : value; }

export default async function LoopsPage({ searchParams }: PageProps) {
  const user = await requireAdmin();
  const commentsAvailable = getEnv().INSTAGRAM_PROVIDER !== "meta";
  const query = await searchParams;
  const [accounts, groups, media, allLoops] = await Promise.all([
    getSqlClient()<Account[]>`
      SELECT id, username, display_name, status FROM instagram_accounts
      WHERE organization_id = ${user.organizationId} AND status IN ('CONNECTED', 'TOKEN_EXPIRING')
      ORDER BY username
    `,
    getSqlClient()<Group[]>`
      SELECT selected_group.id, selected_group.name,
        count(member.instagram_account_id)::int AS member_count,
        COALESCE(json_agg(member.instagram_account_id ORDER BY member.created_at)
          FILTER (WHERE member.instagram_account_id IS NOT NULL), '[]') AS account_ids
      FROM account_groups selected_group
      LEFT JOIN account_group_members member ON member.organization_id = selected_group.organization_id
        AND member.group_id = selected_group.id
      WHERE selected_group.organization_id = ${user.organizationId}
      GROUP BY selected_group.id ORDER BY selected_group.name
    `,
    getSqlClient()<Media[]>`
      SELECT asset.id, asset.original_filename, asset.media_kind, asset.size_bytes,
        asset.folder_id, folder.name AS folder_name
      FROM media_assets asset
      LEFT JOIN media_folders folder ON folder.organization_id = asset.organization_id AND folder.id = asset.folder_id
      WHERE asset.organization_id = ${user.organizationId}
        AND asset.processing_status = 'READY' AND asset.deleted_at IS NULL
      ORDER BY asset.created_at DESC
    `,
    getSqlClient()<LoopRow[]>`
      WITH config AS (
        SELECT coalesce((SELECT default_timezone FROM settings WHERE organization_id = ${user.organizationId}), 'America/Sao_Paulo') AS default_timezone
      )
      SELECT loop.id, loop.name, loop.status, loop.media_type, loop.no_repeat, loop.default_caption,
        loop.auto_comment_text, loop.auto_comment_delay_minutes, loop.image_every_n,
        loop.min_interval_minutes, loop.max_interval_minutes, loop.daily_limit_per_account,
        loop.tiered_limits, loop.tier_follower_threshold, loop.tier1_daily_limit,
        loop.tier1_min_interval_minutes, loop.tier1_max_interval_minutes,
        (SELECT count(*)::int FROM loop_accounts selected_account
          WHERE selected_account.organization_id = loop.organization_id AND selected_account.loop_id = loop.id) AS account_count,
        (SELECT count(*)::int FROM loop_media selected_media
          WHERE selected_media.organization_id = loop.organization_id AND selected_media.loop_id = loop.id) AS media_count,
        (SELECT count(*)::int FROM loop_account_state state
          WHERE state.organization_id = loop.organization_id AND state.loop_id = loop.id AND state.finished) AS finished_accounts,
        (SELECT count(*)::int FROM publication_jobs job
          WHERE job.organization_id = loop.organization_id AND job.loop_id = loop.id AND job.status = 'PUBLISHED'
            AND job.published_at >= date_trunc('day', timezone(config.default_timezone, now())) AT TIME ZONE config.default_timezone
        ) AS published_count,
        (SELECT min(job.scheduled_at) FROM publication_jobs job
          WHERE job.organization_id = loop.organization_id AND job.loop_id = loop.id
            AND job.status IN ('QUEUED', 'RETRY_WAIT')) AS next_publication_at
        , ARRAY(SELECT selected_account.instagram_account_id::text FROM loop_accounts selected_account
          WHERE selected_account.organization_id = loop.organization_id AND selected_account.loop_id = loop.id
          ORDER BY selected_account.created_at) AS account_ids
        , ARRAY(SELECT selected_media.media_asset_id::text FROM loop_media selected_media
          WHERE selected_media.organization_id = loop.organization_id AND selected_media.loop_id = loop.id
          ORDER BY selected_media.position) AS media_ids
      FROM loops loop CROSS JOIN config WHERE loop.organization_id = ${user.organizationId}
      ORDER BY loop.created_at DESC
    `,
  ]);
  const mediaWithUrls = media.map((asset) => ({
    ...asset,
    previewUrl: getPrivateMediaUrl(asset.id, user.organizationId),
  }));
  const mode = first(query.modo) === "limitados" ? "limitados" : "continuos";
  const loops = allLoops.filter((loop) => loop.no_repeat === (mode === "limitados"));
  const editing = allLoops.find((loop) => loop.id === first(query.editar));
  const canCreate = accounts.length > 0 && media.length > 0;

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Automação"
        title="Loops de publicação"
        description="Mantenha uma publicação futura por conta, sem repetir a mídia antes de concluir o conjunto."
        actions={canCreate ? <Link className="button button-primary" href="/loops#editar-loop">Novo loop</Link> : undefined}
      />
      <AutoRefresh intervalMs={15_000} />
      <MessageBanner error={first(query.erro)} success={first(query.ok)} />

      <nav className="page-actions" aria-label="Filtrar loops">
        <Link className={`button button-small ${mode === "continuos" ? "button-primary" : "button-secondary"}`} href="/loops">Contínuos</Link>
        <Link className={`button button-small ${mode === "limitados" ? "button-primary" : "button-secondary"}`} href="/loops?modo=limitados">Limitados</Link>
      </nav>

      <Panel title={mode === "limitados" ? "Loops limitados" : "Loops contínuos"} description="Pausar preserva o progresso; excluir cancela somente itens que ainda não começaram.">
        {loops.length ? (
          <div className="table-scroll">
            <table>
              <thead><tr><th>Loop</th><th>Status</th><th>Conteúdo</th><th>Contas</th><th>Publicados hoje</th><th>Próximo</th><th>Ações</th></tr></thead>
              <tbody>
                {loops.map((loop) => (
                  <tr key={loop.id}>
                    <td data-label="Loop"><strong>{loop.name}</strong><small>{loop.no_repeat ? "Limitado" : "Contínuo"} · {loop.min_interval_minutes}–{loop.max_interval_minutes} min</small>{loop.tiered_limits ? <small>Faixa até {loop.tier_follower_threshold.toLocaleString("pt-BR")} seguidores</small> : null}</td>
                    <td data-label="Status"><StatusBadge status={loop.status} /></td>
                    <td data-label="Conteúdo">{loop.media_count} {loop.media_count === 1 ? "mídia" : "mídias"}<small>{loop.media_type === "MIXED" ? "Misto" : loop.media_type === "REELS" ? "Reels" : "Imagens"}</small></td>
                    <td data-label="Contas">{loop.account_count}<small>{loop.finished_accounts ? `${loop.finished_accounts} concluída(s)` : `até ${loop.daily_limit_per_account}/dia`}</small></td>
                    <td data-label="Publicados hoje">{loop.published_count}</td>
                    <td data-label="Próximo">{loop.next_publication_at ? formatDate(loop.next_publication_at) : <span className="muted">—</span>}</td>
                    <td data-label="Ações">
                      <div className="table-actions">
                        <form action={setLoopStatusAction}>
                          <input name="loopId" type="hidden" value={loop.id} />
                          <input name="status" type="hidden" value={loop.status === "ACTIVE" ? "PAUSED" : "ACTIVE"} />
                          <button className="button button-small button-secondary" type="submit">{loop.status === "ACTIVE" ? "Pausar" : "Retomar"}</button>
                        </form>
                        <Link className="button button-small button-secondary" href={`/loops?${new URLSearchParams({ ...(mode === "limitados" ? { modo: mode } : {}), editar: loop.id })}#editar-loop`}>Editar</Link>
                        <form action={deleteLoopAction}>
                          <input name="loopId" type="hidden" value={loop.id} />
                          <ConfirmSubmitButton className="button button-small button-ghost" message="Remover o loop e cancelar publicações pendentes?">Excluir</ConfirmSubmitButton>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState title={mode === "limitados" ? "Nenhum loop limitado" : "Nenhum loop contínuo"} description="Crie uma rotina para as contas selecionadas." />}
      </Panel>

      <Panel
        title={editing ? `Editando: ${editing.name}` : "Novo loop"}
        description={editing ? "Contas e mídias são atualizadas sem recriar o loop." : "O primeiro item entra na fila imediatamente; os seguintes respeitam o intervalo aleatório."}
        action={editing ? <Link className="button button-small button-secondary" href={mode === "limitados" ? "/loops?modo=limitados" : "/loops"}>Cancelar edição</Link> : undefined}
        className="form-panel"
      >
        <div id="editar-loop" />
        {canCreate ? (
          <form key={editing?.id ?? "new"} className="form-stack" action={editing ? updateLoopAction : createLoopAction}>
            {editing ? <input name="loopId" type="hidden" value={editing.id} /> : null}
            <div className="form-grid form-grid-four">
              <label className="field-span-two">Nome<input name="name" maxLength={160} placeholder="Ex.: Reels evergreen" defaultValue={editing?.name} required /></label>
              <label>Modo<select name="mode" defaultValue={editing?.no_repeat ? "LIMITED" : mode === "limitados" ? "LIMITED" : "CONTINUOUS"}><option value="CONTINUOUS">Contínuo</option><option value="LIMITED">Limitado (uma rodada)</option></select></label>
              <label>Tipo de mídia<select name="mediaType" defaultValue={editing?.media_type ?? "REELS"}><option value="REELS">Reels</option><option value="IMAGE">Imagens</option><option value="MIXED">Misto</option></select></label>
              <label>Intervalo mínimo (min)<input name="minIntervalMinutes" type="number" min={1} max={1440} defaultValue={editing?.min_interval_minutes ?? 25} required /></label>
              <label>Intervalo máximo (min)<input name="maxIntervalMinutes" type="number" min={1} max={1440} defaultValue={editing?.max_interval_minutes ?? 60} required /></label>
              <label>Limite por conta/dia<input name="dailyLimitPerAccount" type="number" min={1} max={200} defaultValue={editing?.daily_limit_per_account ?? 10} required /></label>
              <label>1 imagem a cada N vídeos<input name="imageEveryN" type="number" min={1} max={100} defaultValue={editing?.image_every_n || 3} required /></label>
            </div>
            <fieldset className="form-section">
              <legend>Limites por faixa de seguidores</legend>
              <label className="choice-card"><input name="tieredLimits" type="checkbox" defaultChecked={editing?.tiered_limits ?? false} /><span><strong>Usar limites menores para contas pequenas</strong><small>Contas sem métrica sincronizada continuam usando os limites padrão.</small></span></label>
              <div className="form-grid form-grid-four">
                <label>Até quantos seguidores<input name="tierFollowerThreshold" type="number" min={0} max={100000000} defaultValue={editing?.tier_follower_threshold ?? 10000} required /></label>
                <label>Limite diário da faixa<input name="tier1DailyLimit" type="number" min={1} max={200} defaultValue={editing?.tier1_daily_limit ?? 10} required /></label>
                <label>Intervalo mín. da faixa<input name="tier1MinIntervalMinutes" type="number" min={1} max={1440} defaultValue={editing?.tier1_min_interval_minutes ?? 60} required /></label>
                <label>Intervalo máx. da faixa<input name="tier1MaxIntervalMinutes" type="number" min={1} max={1440} defaultValue={editing?.tier1_max_interval_minutes ?? 120} required /></label>
              </div>
            </fieldset>
            <label>Legenda padrão<textarea name="defaultCaption" rows={4} maxLength={2200} placeholder="Opcional" defaultValue={editing?.default_caption} /></label>
            <div className="form-grid form-grid-four">
              <label className="field-span-two">Auto-comentário<textarea name="autoCommentText" rows={3} maxLength={2200} disabled={!commentsAvailable} placeholder={commentsAvailable ? "Ex.: Link na bio — deixe vazio para desativar" : "Indisponível: a permissão de comentários não é solicitada nesta versão"} defaultValue={commentsAvailable ? editing?.auto_comment_text : ""} /></label>
              <label>Esperar após publicar (min)<input name="autoCommentDelayMinutes" type="number" min={0} max={10080} defaultValue={editing?.auto_comment_delay_minutes ?? 5} required /></label>
            </div>
            <fieldset className="form-section"><legend>Contas e grupos</legend><CampaignTargetsSelector key={editing?.id ?? "new"} accounts={accounts} groups={groups} initialAccountIds={editing?.account_ids ?? []} /></fieldset>
            <fieldset className="form-section"><legend>Mídias na ordem do loop</legend><CampaignMediaSelector key={editing?.id ?? "new"} media={mediaWithUrls} initialMediaIds={editing?.media_ids ?? []} /></fieldset>
            <button className="button button-primary" type="submit">{editing ? "Salvar alterações" : "Criar e iniciar loop"}</button>
          </form>
        ) : (
          <EmptyState
            title="Faltam contas ou mídias prontas"
            description="Conecte pelo menos uma conta e envie uma mídia válida antes de criar o loop."
            href={accounts.length ? "/midias" : "/contas"}
            actionLabel={accounts.length ? "Ir para mídias" : "Ir para contas"}
          />
        )}
      </Panel>
    </div>
  );
}
