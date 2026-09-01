"use client";

import { useState } from "react";
import { formatBytes } from "@/components/ui";

type MediaOption = {
  id: string;
  original_filename: string;
  media_kind: "IMAGE" | "VIDEO";
  size_bytes: number;
  previewUrl: string;
};

export function CampaignMediaSelector({ media }: { media: MediaOption[] }) {
  const [selected, setSelected] = useState<string[]>([]);

  function toggle(id: string, checked: boolean) {
    setSelected((current) => checked ? [...current, id] : current.filter((selectedId) => selectedId !== id));
  }

  return (
    <>
      {selected.map((id) => <input key={id} name="mediaIds" type="hidden" value={id} />)}
      <fieldset className="selectable-media-grid">
        <legend className="sr-only">Mídias da campanha</legend>
        {media.map((asset) => {
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
                <small>{asset.media_kind === "VIDEO" ? "Vídeo" : "Imagem"} · {formatBytes(asset.size_bytes)}</small>
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
