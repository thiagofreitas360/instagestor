import Link from "next/link";
import { deleteMediaAction } from "@/app/actions";
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
};

type PageProps = { searchParams: Promise<{ erro?: string | string[]; ok?: string | string[] }> };
function first(value?: string | string[]) { return Array.isArray(value) ? value[0] : value; }

export default async function MediaPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const media = await getSqlClient()<MediaRow[]>`
    SELECT asset.id, asset.original_filename, asset.mime_type, asset.media_kind, asset.size_bytes,
      asset.width, asset.height, asset.duration_seconds, asset.processing_status,
      asset.validation_error, asset.created_at,
      count(DISTINCT campaign_media.campaign_id)::int AS campaign_count
    FROM media_assets asset
    LEFT JOIN campaign_media ON campaign_media.media_asset_id = asset.id
    WHERE asset.deleted_at IS NULL
    GROUP BY asset.id
    ORDER BY asset.created_at DESC
  `;
  const mediaWithUrls = media.map((asset) => ({
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

      <Panel className="upload-panel">
        <MediaUploadForm maxBytes={getEnv().UPLOAD_MAX_BYTES} />
        <p className="form-hint">O arquivo é validado no servidor antes de entrar na biblioteca. Não alteramos nem transcodificamos o conteúdo.</p>
      </Panel>

      {media.length ? (
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
                <dl className="media-metadata">
                  <div><dt>Tamanho</dt><dd>{formatBytes(asset.size_bytes)}</dd></div>
                  <div><dt>Dimensões</dt><dd>{asset.width && asset.height ? `${asset.width} × ${asset.height}` : "—"}</dd></div>
                  <div><dt>Duração</dt><dd>{asset.duration_seconds ? `${Math.round(asset.duration_seconds)} s` : "—"}</dd></div>
                  <div><dt>Uso</dt><dd>{asset.campaign_count} {asset.campaign_count === 1 ? "campanha" : "campanhas"}</dd></div>
                </dl>
                {asset.validation_error ? <p className="inline-error">{asset.validation_error}</p> : null}
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
          <EmptyState title="Biblioteca vazia" description="Envie a primeira imagem ou vídeo para montar uma campanha." />
        </Panel>
      )}
    </div>
  );
}
