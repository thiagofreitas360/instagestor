import Link from "next/link";
import {
  createMediaFolderAction,
  deleteMediaAction,
  deleteMediaFolderAction,
  moveMediaAction,
  renameMediaFolderAction,
} from "@/app/actions";
import { getSqlClient } from "@/db/client";
import { EmptyState, formatBytes, formatDate, MessageBanner, PageHeader, Panel, StatusBadge } from "@/components/ui";
import { MediaUploadForm } from "@/components/media-upload-form";
import { getEnv } from "@/lib/env";
import { getPrivateMediaUrl } from "@/providers/storage";

type MediaRow = {
  id: string;
  original_filename: string;
  mime_type: string;
  media_kind: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  processing_status: string;
  validation_error: string | null;
  created_at: Date;
  campaign_count: number;
  folder_id: string | null;
  folder_name: string | null;
};
type FolderRow = { id: string; name: string; media_count: number };

type PageProps = { searchParams: Promise<{ erro?: string | string[]; ok?: string | string[]; pasta?: string | string[] }> };
function first(value?: string | string[]) { return Array.isArray(value) ? value[0] : value; }

export default async function MediaPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const sql = getSqlClient();
  const [media, folders] = await Promise.all([
    sql<MediaRow[]>`
      SELECT asset.id, asset.original_filename, asset.mime_type, asset.media_kind, asset.size_bytes,
        asset.width, asset.height, asset.duration_seconds, asset.processing_status,
        asset.validation_error, asset.created_at, asset.folder_id, folder.name AS folder_name,
        count(DISTINCT campaign_media.campaign_id)::int AS campaign_count
      FROM media_assets asset
      LEFT JOIN media_folders folder ON folder.id = asset.folder_id
      LEFT JOIN campaign_media ON campaign_media.media_asset_id = asset.id
      WHERE asset.deleted_at IS NULL
      GROUP BY asset.id, folder.name
      ORDER BY asset.created_at DESC
    `,
    sql<FolderRow[]>`
      SELECT folder.id, folder.name,
        count(asset.id) FILTER (WHERE asset.deleted_at IS NULL)::int AS media_count
      FROM media_folders folder
      LEFT JOIN media_assets asset ON asset.folder_id = folder.id
      GROUP BY folder.id ORDER BY folder.name
    `,
  ]);
  const requestedFolder = first(query.pasta);
  const selectedFolder = requestedFolder === "sem-pasta" || folders.some((folder) => folder.id === requestedFolder)
    ? requestedFolder
    : undefined;
  const filteredMedia = media.filter((asset) => selectedFolder === "sem-pasta"
    ? asset.folder_id === null
    : selectedFolder ? asset.folder_id === selectedFolder : true);
  const mediaWithUrls = filteredMedia.map((asset) => ({
    ...asset,
    previewUrl: asset.processing_status === "READY"
      ? getPrivateMediaUrl(asset.id)
      : null,
  }));
  const readyCount = media.filter((asset) => asset.processing_status === "READY").length;

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Biblioteca"
        title="Mídias"
        description={`${readyCount} ${readyCount === 1 ? "arquivo pronto" : "arquivos prontos"} para usar em campanhas.`}
        actions={<Link className="button button-primary" href="/campanhas/nova">Nova campanha</Link>}
      />
      <MessageBanner error={first(query.erro)} success={first(query.ok)} />

      <Panel title="Pastas" description="Organize a biblioteca por nicho sem duplicar arquivos.">
        <form className="inline-form" action={createMediaFolderAction}>
          <label>
            Nova pasta
            <input name="name" type="text" maxLength={120} placeholder="Ex.: Fitness" required />
          </label>
          <button className="button button-secondary" type="submit">Criar pasta</button>
        </form>
        <nav className="page-actions" aria-label="Filtrar mídias por pasta">
          <Link className={`button button-small ${!selectedFolder ? "button-primary" : "button-secondary"}`} href="/midias">Todas ({media.length})</Link>
          <Link className={`button button-small ${selectedFolder === "sem-pasta" ? "button-primary" : "button-secondary"}`} href="/midias?pasta=sem-pasta">
            Sem pasta ({media.filter((asset) => asset.folder_id === null).length})
          </Link>
          {folders.map((folder) => (
            <Link className={`button button-small ${selectedFolder === folder.id ? "button-primary" : "button-secondary"}`} href={`/midias?pasta=${folder.id}`} key={folder.id}>
              {folder.name} ({folder.media_count})
            </Link>
          ))}
        </nav>
        {folders.length ? (
          <div className="folder-editor-list">
            {folders.map((folder) => (
              <details className="native-disclosure" key={folder.id}>
                <summary>Editar {folder.name}</summary>
                <div className="inline-form">
                  <form className="inline-form" action={renameMediaFolderAction}>
                    <input type="hidden" name="folderId" value={folder.id} />
                    <input name="name" type="text" maxLength={120} defaultValue={folder.name} required aria-label={`Nome da pasta ${folder.name}`} />
                    <button className="button button-small button-secondary" type="submit">Renomear</button>
                  </form>
                  <form action={deleteMediaFolderAction}>
                    <input type="hidden" name="folderId" value={folder.id} />
                    <button className="button button-small button-quiet-danger" type="submit">Excluir pasta</button>
                  </form>
                </div>
              </details>
            ))}
          </div>
        ) : null}
      </Panel>

      <Panel className="upload-panel">
        <MediaUploadForm maxBytes={getEnv().UPLOAD_MAX_BYTES} folders={folders.map(({ id, name }) => ({ id, name }))} />
        <p className="form-hint">O arquivo é validado no servidor antes de entrar na biblioteca. Não alteramos nem transcodificamos o conteúdo.</p>
      </Panel>

      {filteredMedia.length ? (
        <section className="media-grid" aria-label="Arquivos da biblioteca">
          {mediaWithUrls.map((asset) => (
            <article className="media-card" key={asset.id}>
              <div className={`media-thumb media-thumb-${asset.media_kind.toLowerCase()}`}>
                {asset.previewUrl ? (
                  asset.media_kind === "VIDEO" ? (
                    <video className="media-real-preview" src={asset.previewUrl} controls playsInline preload="metadata" aria-label={`Prévia de ${asset.original_filename}`} />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="media-real-preview" src={asset.previewUrl} alt={`Prévia de ${asset.original_filename}`} loading="lazy" />
                  )
                ) : (
                  <><span className="media-kind-mark" aria-hidden="true">{asset.media_kind === "VIDEO" ? "▶" : "▧"}</span><span>{asset.media_kind === "VIDEO" ? "Vídeo" : "Imagem"}</span></>
                )}
              </div>
              <div className="media-card-body">
                <div className="media-card-heading">
                  <h2 title={asset.original_filename}>{asset.original_filename}</h2>
                  <StatusBadge status={asset.processing_status} />
                </div>
                <span className="status-badge">{asset.folder_name ?? "Sem pasta"}</span>
                <dl className="media-metadata">
                  <div><dt>Tamanho</dt><dd>{formatBytes(asset.size_bytes)}</dd></div>
                  <div><dt>Dimensões</dt><dd>{asset.width && asset.height ? `${asset.width} × ${asset.height}` : "—"}</dd></div>
                  <div><dt>Duração</dt><dd>{asset.duration_seconds ? `${Math.round(asset.duration_seconds)} s` : "—"}</dd></div>
                  <div><dt>Uso</dt><dd>{asset.campaign_count} {asset.campaign_count === 1 ? "campanha" : "campanhas"}</dd></div>
                </dl>
                {asset.validation_error ? <p className="inline-error">{asset.validation_error}</p> : null}
                <form className="inline-form media-folder-form" action={moveMediaAction}>
                  <input type="hidden" name="mediaId" value={asset.id} />
                  <select name="folderId" defaultValue={asset.folder_id ?? ""} aria-label={`Pasta de ${asset.original_filename}`}>
                    <option value="">Sem pasta</option>
                    {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
                  </select>
                  <button className="button button-small button-secondary" type="submit">Mover</button>
                </form>
                <footer>
                  <span>{asset.mime_type}</span>
                  <time dateTime={asset.created_at.toISOString()}>{formatDate(asset.created_at)}</time>
                  {asset.campaign_count === 0 ? (
                    <form action={deleteMediaAction}>
                      <input type="hidden" name="mediaId" value={asset.id} />
                      <button className="button button-small button-quiet-danger" type="submit">Excluir</button>
                    </form>
                  ) : null}
                </footer>
              </div>
            </article>
          ))}
        </section>
      ) : (
        <Panel>
          <EmptyState
            title={media.length ? "Nenhuma mídia nesta pasta" : "Biblioteca vazia"}
            description={media.length ? "Escolha outra pasta ou mova arquivos para esta pasta." : "Envie a primeira imagem ou vídeo para montar uma campanha."}
            href={media.length ? "/midias" : undefined}
            actionLabel={media.length ? "Mostrar todas" : undefined}
          />
        </Panel>
      )}
    </div>
  );
}
