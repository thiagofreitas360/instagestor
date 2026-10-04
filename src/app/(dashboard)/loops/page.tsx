import Link from "next/link";
import { createLoopAction, deleteLoopAction, setLoopStatusAction, updateLoopAction } from "@/app/actions";
import { AutoRefresh } from "@/components/auto-refresh";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { LoopAccountPicker, LoopMediaPool } from "@/components/loop-editor";
import { EmptyState, formatDate, MessageBanner, PageHeader } from "@/components/ui";
import { getSqlClient } from "@/db/client";
import { requireAdmin } from "@/server/auth";
import { getEnv } from "@/lib/env";

type Account = { id: string; username: string; display_name: string | null; profile_picture_url: string | null };
type Media = { id: string; original_filename: string; media_kind: "IMAGE" | "VIDEO"; folder_name: string | null };
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
  media_count: number;
  finished_accounts: number;
  published_count: number;
  queued_count: number;
  next_publication_at: Date | null;
  account_ids: string[];
  account_usernames: string[];
  media_ids: string[];
};
type PageProps = {
  searchParams: Promise<{ erro?: string | string[]; ok?: string | string[]; modo?: string | string[]; editar?: string | string[]; novo?: string | string[] }>;
};
function first(value?: string | string[]) { return Array.isArray(value) ? value[0] : value; }

const MODE_COPY = {
  continuos: "Postagem contínua: cada conta posta uma mídia do pool, espera um intervalo aleatório e segue até o limite diário. Sem repetição até esgotar o pool — e depois reinicia.",
  limitados: "Postagem limitada: cada conta publica cada mídia do pool uma única vez e para quando termina a rodada.",
};
const MEDIA_TYPES = [["REELS", "Reels (vídeo)"], ["IMAGE", "Imagem"], ["MIXED", "Ambos"]] as const;
const POOL_NOUN = { REELS: "vídeos", IMAGE: "imagens", MIXED: "mídias" } as const;
const VISIBLE_CHIPS = 12;

function Icon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}
const ICONS = {
  pause: "M14 4h4v16h-4zM6 4h4v16H6z",
  play: "M6 4l14 8-14 8z",
  pencil: "M21.17 6.81a1 1 0 0 0-3.98-3.98L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5zM15 5l4 4",
  trash: "M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6",
};

export default async function LoopsPage({ searchParams }: PageProps) {
  const user = await requireAdmin();
  const env = getEnv();
  const commentsAvailable = env.INSTAGRAM_PROVIDER !== "meta";
  const query = await searchParams;
  const [accounts, media, allLoops] = await Promise.all([
    getSqlClient()<Account[]>`
      SELECT id, username, display_name, profile_picture_url FROM instagram_accounts
      WHERE organization_id = ${user.organizationId} AND status IN ('CONNECTED', 'TOKEN_EXPIRING')
      ORDER BY username
    `,
    getSqlClient()<Media[]>`
      SELECT asset.id, asset.original_filename, asset.media_kind, folder.name AS folder_name
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
        (SELECT count(*)::int FROM loop_media selected_media
          WHERE selected_media.organization_id = loop.organization_id AND selected_media.loop_id = loop.id) AS media_count,
        (SELECT count(*)::int FROM loop_account_state state
          WHERE state.organization_id = loop.organization_id AND state.loop_id = loop.id AND state.finished) AS finished_accounts,
        (SELECT count(*)::int FROM publication_jobs job
          WHERE job.organization_id = loop.organization_id AND job.loop_id = loop.id AND job.status = 'PUBLISHED'
            AND job.published_at >= date_trunc('day', timezone(config.default_timezone, now())) AT TIME ZONE config.default_timezone
        ) AS published_count,
        (SELECT count(*)::int FROM publication_jobs job
          WHERE job.organization_id = loop.organization_id AND job.loop_id = loop.id
            AND job.status IN ('QUEUED', 'RETRY_WAIT')) AS queued_count,
        (SELECT min(job.scheduled_at) FROM publication_jobs job
          WHERE job.organization_id = loop.organization_id AND job.loop_id = loop.id
            AND job.status IN ('QUEUED', 'RETRY_WAIT')) AS next_publication_at
        , ARRAY(SELECT selected_account.instagram_account_id::text FROM loop_accounts selected_account
          WHERE selected_account.organization_id = loop.organization_id AND selected_account.loop_id = loop.id
          ORDER BY selected_account.created_at) AS account_ids
        , ARRAY(SELECT account.username FROM loop_accounts selected_account
          JOIN instagram_accounts account ON account.organization_id = selected_account.organization_id
            AND account.id = selected_account.instagram_account_id
          WHERE selected_account.organization_id = loop.organization_id AND selected_account.loop_id = loop.id
          ORDER BY selected_account.created_at) AS account_usernames
        , ARRAY(SELECT selected_media.media_asset_id::text FROM loop_media selected_media
          WHERE selected_media.organization_id = loop.organization_id AND selected_media.loop_id = loop.id
          ORDER BY selected_media.position) AS media_ids
      FROM loops loop CROSS JOIN config WHERE loop.organization_id = ${user.organizationId}
      ORDER BY loop.created_at DESC
    `,
  ]);
  const mode = first(query.modo) === "limitados" ? "limitados" : "continuos";
  const modeQuery: Record<string, string> = mode === "limitados" ? { modo: mode } : {};
  const href = (extra: Record<string, string> = {}) => {
    const search = new URLSearchParams({ ...modeQuery, ...extra }).toString();
    return `/loops${search ? `?${search}` : ""}`;
  };
  const loops = allLoops.filter((loop) => loop.no_repeat === (mode === "limitados"));
  const editing = allLoops.find((loop) => loop.id === first(query.editar));
  const creating = !editing && first(query.novo) === "1";
  const canCreate = accounts.length > 0;

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Automação"
        title="Loops"
        actions={canCreate ? <Link className="button button-primary" href={`${href({ novo: "1" })}#editar-loop`}>Novo loop</Link> : undefined}
      />
      {/* Atualizar com o editor aberto atrapalharia a edição. */}
      {editing || creating ? null : <AutoRefresh intervalMs={15_000} />}
      <MessageBanner error={first(query.erro)} success={first(query.ok)} />

      <nav className="loop-tabs" aria-label="Tipo de loop">
        <Link className={mode === "continuos" ? "is-active" : ""} href="/loops" aria-current={mode === "continuos" ? "page" : undefined}>Contínuos</Link>
        <Link className={mode === "limitados" ? "is-active" : ""} href="/loops?modo=limitados" aria-current={mode === "limitados" ? "page" : undefined}>Limitados</Link>
      </nav>
      <p className="loop-tab-copy">{MODE_COPY[mode]}</p>

      {editing || creating ? (
        <section className="panel loop-editor" id="editar-loop" aria-labelledby="loop-editor-title">
          <header className="loop-editor-header">
            <h2 id="loop-editor-title">{editing ? `Editando: ${editing.name}` : "Novo loop"}</h2>
            <Link className="text-link" href={href()}>Cancelar</Link>
          </header>
          <form key={editing?.id ?? "new"} className="loop-form" action={editing ? updateLoopAction : createLoopAction}>
            {editing ? <input name="loopId" type="hidden" value={editing.id} /> : null}
            <label>Nome do loop<input name="name" type="text" maxLength={160} placeholder="Ex.: Reels evergreen" defaultValue={editing?.name} required /></label>
            <div className="loop-options">
              <fieldset className="loop-segmented">
                <legend>Tipo</legend>
                {MEDIA_TYPES.map(([value, label]) => (
                  <label key={value}>
                    <input className="sr-only" type="radio" name="mediaType" value={value} defaultChecked={(editing?.media_type ?? "REELS") === value} />
                    <span>{label}</span>
                  </label>
                ))}
              </fieldset>
              <label className="loop-check">
                <input name="noRepeat" type="checkbox" defaultChecked={editing ? editing.no_repeat : mode === "limitados"} />
                Limitado (não repetir mídias)
              </label>
            </div>
            <div className="loop-grid-three">
              <label>Intervalo mín (min)<input name="minIntervalMinutes" type="number" min={1} max={1440} defaultValue={editing?.min_interval_minutes ?? 25} required /></label>
              <label>Intervalo máx (min)<input name="maxIntervalMinutes" type="number" min={1} max={1440} defaultValue={editing?.max_interval_minutes ?? 60} required /></label>
              <label>Limite diário/conta<input name="dailyLimitPerAccount" type="number" min={1} max={200} defaultValue={editing?.daily_limit_per_account ?? 10} required /></label>
              <label className="loop-only-mixed">1 imagem a cada N vídeos<input name="imageEveryN" type="number" min={1} max={100} defaultValue={editing?.image_every_n || 3} required /></label>
            </div>
            <div className="loop-box loop-tiers">
              <label className="loop-check">
                <input name="tieredLimits" type="checkbox" defaultChecked={editing?.tiered_limits ?? false} />
                Limites por faixa de seguidores
              </label>
              <div className="loop-tier-fields">
                <p className="form-hint">Contas pequenas usam estes limites; contas sem métrica sincronizada seguem os limites padrão.</p>
                <div className="form-grid form-grid-four">
                  <label>Até quantos seguidores<input name="tierFollowerThreshold" type="number" min={0} max={100000000} defaultValue={editing?.tier_follower_threshold ?? 10000} required /></label>
                  <label>Limite diário da faixa<input name="tier1DailyLimit" type="number" min={1} max={200} defaultValue={editing?.tier1_daily_limit ?? 10} required /></label>
                  <label>Intervalo mín. da faixa<input name="tier1MinIntervalMinutes" type="number" min={1} max={1440} defaultValue={editing?.tier1_min_interval_minutes ?? 60} required /></label>
                  <label>Intervalo máx. da faixa<input name="tier1MaxIntervalMinutes" type="number" min={1} max={1440} defaultValue={editing?.tier1_max_interval_minutes ?? 120} required /></label>
                </div>
              </div>
            </div>
            <LoopAccountPicker accounts={accounts} initialIds={editing?.account_ids ?? []} editing={Boolean(editing)} />
            <label>Legenda padrão<textarea name="defaultCaption" rows={3} maxLength={2200} placeholder="Opcional" defaultValue={editing?.default_caption} /></label>
            <div className="loop-box">
              <label>
                Auto-comentário
                <textarea
                  name="autoCommentText"
                  rows={2}
                  maxLength={2200}
                  disabled={!commentsAvailable}
                  placeholder={commentsAvailable ? "Ex.: Link na bio 👉 … (deixe vazio para desativar)" : "Indisponível: a permissão de comentários não é solicitada nesta versão"}
                  defaultValue={commentsAvailable ? editing?.auto_comment_text : ""}
                />
              </label>
              <label className="loop-inline-number">
                Esperar
                <input name="autoCommentDelayMinutes" type="number" min={0} max={10080} defaultValue={editing?.auto_comment_delay_minutes ?? 5} required />
                min após a publicação
              </label>
            </div>
            <LoopMediaPool key={editing?.id ?? "new"} library={media} initialIds={editing?.media_ids ?? []} maxBytes={env.UPLOAD_MAX_BYTES} />
            <button className="button button-primary button-block" type="submit">{editing ? "Salvar alterações" : "Criar e iniciar loop"}</button>
          </form>
        </section>
      ) : null}

      {loops.length ? (
        <div className="loop-card-list">
          {loops.map((loop) => {
            const editHref = `${href({ editar: loop.id })}#editar-loop`;
            const inLoop = new Set(loop.account_ids);
            const outsideCount = accounts.filter((account) => !inLoop.has(account.id)).length;
            const active = loop.status === "ACTIVE";
            return (
              <article className={`panel loop-card${editing?.id === loop.id ? " is-editing" : ""}`} key={loop.id}>
                <div className="loop-card-main">
                  <div className="loop-card-title">
                    <h3>{loop.name}</h3>
                    <span className={`loop-status ${active ? "is-active" : "is-paused"}`}>{active ? "ativo" : "pausado"}</span>
                  </div>
                  <div className="loop-card-meta">
                    <span>{loop.min_interval_minutes}–{loop.max_interval_minutes} min entre posts</span>
                    <span>limite {loop.daily_limit_per_account}/dia/conta</span>
                    <span>{loop.media_count} {POOL_NOUN[loop.media_type]} no pool</span>
                    {loop.tiered_limits ? <span>faixa até {loop.tier_follower_threshold.toLocaleString("pt-BR")} seguidores</span> : null}
                    {loop.finished_accounts ? <span>{loop.finished_accounts} conta(s) concluída(s)</span> : null}
                  </div>
                  {loop.account_usernames.length ? (
                    <div className="loop-card-accounts">
                      {loop.account_usernames.slice(0, VISIBLE_CHIPS).map((username) => <span key={username}>@{username}</span>)}
                      {loop.account_usernames.length > VISIBLE_CHIPS ? <span>+{loop.account_usernames.length - VISIBLE_CHIPS}</span> : null}
                    </div>
                  ) : null}
                  <div className="loop-card-stats">
                    <span className="loop-stat-published">{loop.published_count} publicados hoje</span>
                    {" · "}
                    <span className="loop-stat-queued">{loop.queued_count} na fila</span>
                    {loop.next_publication_at ? <span className="muted"> · próximo {formatDate(loop.next_publication_at)}</span> : null}
                  </div>
                  {outsideCount ? (
                    <Link className="loop-card-outside" href={editHref}>{outsideCount} conta(s) conectada(s) fora deste loop →</Link>
                  ) : null}
                </div>
                <div className="loop-card-actions">
                  <form action={setLoopStatusAction}>
                    <input name="loopId" type="hidden" value={loop.id} />
                    <input name="status" type="hidden" value={active ? "PAUSED" : "ACTIVE"} />
                    <button className="loop-icon-button" type="submit" title={active ? "Pausar" : "Retomar"} aria-label={`${active ? "Pausar" : "Retomar"} ${loop.name}`}>
                      <Icon path={active ? ICONS.pause : ICONS.play} />
                    </button>
                  </form>
                  <Link className="loop-icon-button" href={editHref} title="Editar" aria-label={`Editar ${loop.name}`}>
                    <Icon path={ICONS.pencil} />
                  </Link>
                  <form action={deleteLoopAction}>
                    <input name="loopId" type="hidden" value={loop.id} />
                    <ConfirmSubmitButton className="loop-icon-button loop-icon-danger" message={`Remover o loop "${loop.name}" e cancelar as publicações pendentes?`}>
                      <Icon path={ICONS.trash} />
                      <span className="sr-only">Remover {loop.name}</span>
                    </ConfirmSubmitButton>
                  </form>
                </div>
              </article>
            );
          })}
        </div>
      ) : editing || creating ? null : (
        <div className="panel">
          <EmptyState
            title={mode === "limitados" ? "Nenhum loop limitado" : "Nenhum loop contínuo"}
            description={canCreate ? "Clique em Novo loop para criar uma rotina para as contas." : "Conecte pelo menos uma conta antes de criar um loop."}
            href={canCreate ? undefined : "/contas"}
            actionLabel={canCreate ? undefined : "Ir para contas"}
          />
        </div>
      )}
    </div>
  );
}
