import Link from "next/link";
import { createCampaignAction } from "@/app/actions";
import { getSqlClient } from "@/db/client";
import { CampaignMediaSelector } from "@/components/campaign-media-selector";
import { EmptyState, MessageBanner, PageHeader, Panel } from "@/components/ui";
import { getPrivateMediaUrl } from "@/providers/storage";

type MediaRow = {
  id: string;
  original_filename: string;
  media_kind: "IMAGE" | "VIDEO";
  size_bytes: number;
};
type PageProps = { searchParams: Promise<{ erro?: string | string[] }> };
function first(value?: string | string[]) { return Array.isArray(value) ? value[0] : value; }

export default async function NewCampaignPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const metaMode = process.env.INSTAGRAM_PROVIDER === "meta";
  const media = await getSqlClient()<MediaRow[]>`
    SELECT id, original_filename, media_kind, size_bytes
    FROM media_assets
    WHERE processing_status = 'READY' AND deleted_at IS NULL
    ORDER BY created_at DESC
  `;
  const mediaWithUrls = media.map((asset) => ({
    id: asset.id,
    original_filename: asset.original_filename,
    media_kind: asset.media_kind,
    size_bytes: asset.size_bytes,
    previewUrl: getPrivateMediaUrl(asset.id),
  }));

  return (
    <div className="page-stack">
      <nav className="breadcrumbs" aria-label="Navegação estrutural">
        <Link href="/campanhas">Campanhas</Link><span aria-hidden="true">/</span><span>Nova campanha</span>
      </nav>
      <PageHeader
        eyebrow="Nova campanha"
        title="Prepare o conteúdo"
        description="Nesta etapa você define o formato e a mídia. Contas e horários vêm na próxima tela."
      />
      <MessageBanner error={first(query.erro)} />

      {media.length ? (
        <form className="campaign-builder" action={createCampaignAction}>
          <div className="campaign-builder-main">
            <Panel title="1. Identificação" description="Um nome interno ajuda a encontrar esta operação depois.">
              <div className="form-grid form-grid-two">
                <label className="field-span-two">
                  Nome da campanha
                  <input name="name" type="text" maxLength={160} placeholder="Ex.: Story — Oferta de setembro" required />
                </label>
                <label>
                  Formato
                  <select name="publicationType" defaultValue="FEED_IMAGE" required>
                    <option value="FEED_IMAGE">Imagem no Feed</option>
                    {!metaMode ? <option value="FEED_VIDEO">Vídeo no Feed</option> : null}
                    <option value="REEL">Reel</option>
                    <option value="STORY_IMAGE">Story com imagem</option>
                    <option value="STORY_VIDEO">Story com vídeo</option>
                    <option value="CAROUSEL">Carrossel</option>
                  </select>
                </label>
                <label className="switch-field">
                  <input name="shareToFeed" type="checkbox" />
                  <span><strong>Compartilhar Reel no Feed</strong><small>Usado somente quando o formato for Reel.</small></span>
                </label>
              </div>
            </Panel>

            <Panel title="2. Mídia" description="Selecione um arquivo; para carrossel, a ordem dos cliques define a ordem publicada.">
              <CampaignMediaSelector media={mediaWithUrls} />
              <p className="form-hint">A compatibilidade entre formato e mídia será validada antes de salvar.</p>
            </Panel>

            <Panel title="3. Legenda" description="A legenda é opcional para Stories.">
              <label>
                Texto da publicação <span className="optional-label">até 2.200 caracteres</span>
                <textarea name="caption" rows={8} maxLength={2200} placeholder="Escreva a legenda exatamente como deve aparecer no Instagram…" />
              </label>
            </Panel>
          </div>

          <aside className="campaign-builder-aside">
            <div className="panel sticky-panel review-card">
              <p className="eyebrow">Resumo</p>
              <h2>Pronto para agendar?</h2>
              <ol className="step-list">
                <li className="is-current"><span>1</span><div><strong>Conteúdo</strong><small>Formato, mídia e legenda</small></div></li>
                <li><span>2</span><div><strong>Destinos</strong><small>Contas e grupos</small></div></li>
                <li><span>3</span><div><strong>Cronograma</strong><small>Prévia e confirmação</small></div></li>
              </ol>
              <button className="button button-primary button-block" type="submit">Salvar e continuar</button>
              <Link className="button button-ghost button-block" href="/campanhas">Cancelar</Link>
            </div>
          </aside>
        </form>
      ) : (
        <Panel>
          <EmptyState
            title="Envie uma mídia primeiro"
            description="A campanha precisa de pelo menos um arquivo validado e pronto."
            href="/midias"
            actionLabel="Ir para mídias"
          />
        </Panel>
      )}
    </div>
  );
}
