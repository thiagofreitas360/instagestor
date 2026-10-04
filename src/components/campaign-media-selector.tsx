"use client";

import { useMemo, useState } from "react";
import { formatBytes } from "@/components/ui";

type MediaOption = {
  id: string;
  original_filename: string;
  media_kind: "IMAGE" | "VIDEO";
  size_bytes: number;
  previewUrl: string;
  folder_id: string | null;
  folder_name: string | null;
};

export function CampaignMediaSelector({ media, initialMediaIds = [] }: { media: MediaOption[]; initialMediaIds?: string[] }) {
  const [selected, setSelected] = useState<string[]>(() => initialMediaIds.filter((id) => media.some((asset) => asset.id === id)));
  const [folderId, setFolderId] = useState("");
  const folders = useMemo(() => Array.from(
    new Map(media.filter((asset) => asset.folder_id).map((asset) => [asset.folder_id!, asset.folder_name!])).entries(),
  ).map(([id, name]) => ({ id, name })).sort((left, right) => left.name.localeCompare(right.name)), [media]);
  const visible = media.filter((asset) => folderId === "unfiled" ? !asset.folder_id : !folderId || asset.folder_id === folderId);

  function toggle(id: string, checked: boolean) {
    setSelected((current) => checked ? [...current, id] : current.filter((selectedId) => selectedId !== id));
  }

  function selectVisible() {
    setSelected((current) => [...current, ...visible.map((asset) => asset.id).filter((id) => !current.includes(id))]);
  }

  return (
    <>
      {selected.map((id) => <input key={id} name="mediaIds" type="hidden" value={id} />)}
      <div className="page-actions">
        <label>
          Pasta de mídia
          <select value={folderId} onChange={(event) => setFolderId(event.currentTarget.value)}>
            <option value="">Todas as pastas</option>
            <option value="unfiled">Sem pasta</option>
            {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
          </select>
        </label>
        <button className="button button-small button-secondary" type="button" onClick={selectVisible} disabled={!visible.length}>
          Selecionar mídias visíveis
        </button>
      </div>
      <fieldset className="selectable-media-grid">
        <legend className="sr-only">Mídias da campanha</legend>
        {visible.map((asset) => {
          const position = selected.indexOf(asset.id);
          return (
            <label className="selectable-media" key={asset.id}>
              <input
                type="checkbox"
                checked={position >= 0}
                onChange={(event) => toggle(asset.id, event.currentTarget.checked)}
              />
              <span className={`media-thumb media-thumb-${asset.media_kind.toLowerCase()}`}>
                {position >= 0 ? <span className="selection-index" aria-label={`Posição ${position + 1}`}>{position + 1}</span> : null}
                {asset.media_kind === "VIDEO" ? (
                  <video className="media-real-preview" src={asset.previewUrl} muted playsInline preload="metadata" aria-label={`Prévia de ${asset.original_filename}`} />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="media-real-preview" src={asset.previewUrl} alt={`Prévia de ${asset.original_filename}`} loading="lazy" />
                )}
              </span>
              <span className="selectable-media-copy">
                <strong title={asset.original_filename}>{asset.original_filename}</strong>
                <small>{asset.media_kind === "VIDEO" ? "Vídeo" : "Imagem"} · {formatBytes(asset.size_bytes)} · {asset.folder_name ?? "Sem pasta"}</small>
              </span>
            </label>
          );
        })}
      </fieldset>
      <p className="form-hint">
        {selected.length
          ? `Ordem escolhida: ${selected.map((id) => media.find((asset) => asset.id === id)?.original_filename).join(" → ")}`
          : "Marque os arquivos na ordem em que devem aparecer; desmarque e marque novamente para reposicionar."}
      </p>
    </>
  );
}
