"use client";

import { useState } from "react";

/** Vídeos só carregam ao clicar: com centenas de cards, buscar os metadados de todos travava a página inteira. */
export function MediaPreview({ src, kind, name }: { src: string; kind: "IMAGE" | "VIDEO"; name: string }) {
  const [playing, setPlaying] = useState(false);
  // eslint-disable-next-line @next/next/no-img-element
  if (kind === "IMAGE") return <img className="media-real-preview" src={src} alt={`Prévia de ${name}`} loading="lazy" />;
  if (playing) return <video className="media-real-preview" src={src} controls autoPlay playsInline aria-label={`Prévia de ${name}`} />;
  return (
    <button className="media-preview-button" type="button" onClick={() => setPlaying(true)} aria-label={`Ver prévia de ${name}`}>
      <span className="media-kind-mark" aria-hidden="true">▶</span>
      <span>Ver prévia</span>
    </button>
  );
}
