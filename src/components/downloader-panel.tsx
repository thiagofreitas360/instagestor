"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// Protocolo do painel ↔ extensão (window.postMessage). A extensão injeta um
// content script que repassa estas mensagens pro service worker e devolve o
// resultado. Mesmos nomes que a extensão escuta/emite.
type Normalized = {
  id: string;
  type: "video" | "photo";
  origin: "reel" | "foto" | "story" | "destaque";
  thumbnail: string;
  mediaUrl: string;
  filename: string;
};

type ResolveItem = { type: string; mediaUrl: string; thumbnail?: string; filename?: string };

type RangeKey = "50" | "100" | "all";
const RANGES: { key: RangeKey; label: string; to: number }[] = [
  { key: "50", label: "Top 50", to: 50 },
  { key: "100", label: "Top 100", to: 100 },
  { key: "all", label: "Todos", to: 9999 },
];

function send(msg: Record<string, unknown>) {
  window.postMessage({ __instazip_panel: true, ...msg }, "*");
}

function proxyUrl(mediaUrl: string, filename: string) {
  return `/api/downloader/media?u=${encodeURIComponent(mediaUrl)}&name=${encodeURIComponent(filename)}`;
}

function parseInput(raw: string): { usuario: string; destaqueId: string; code: string } {
  const value = raw.trim();
  const empty = { usuario: "", destaqueId: "", code: "" };
  if (!value) return empty;
  const post = value.match(/instagram\.com\/(?:[^/]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i);
  if (post) return { ...empty, code: post[1]! };
  const highlight = value.match(/stories\/highlights\/(\d+)/i);
  if (highlight) return { ...empty, destaqueId: highlight[1]! };
  if (value.startsWith("@")) return { ...empty, usuario: value.slice(1).split(/[/?#]/)[0]! };
  const url = value.match(/instagram\.com\/([^/?#]+)/i);
  if (url && !["p", "reel", "reels", "stories", "explore", "tv"].includes(url[1]!.toLowerCase())) {
    return { ...empty, usuario: url[1]! };
  }
  if (/^[\w.]+$/.test(value)) return { ...empty, usuario: value };
  return empty;
}

function imgUrl(m: { image_versions2?: { candidates?: { url?: string }[] } }) {
  return m.image_versions2?.candidates?.[0]?.url ?? "";
}
function vidUrl(m: { video_versions?: { url?: string }[] }) {
  return m.video_versions?.[0]?.url ?? "";
}

export function DownloaderPanel() {
  const [extVersion, setExtVersion] = useState<string | null>(null);
  const [checkedExt, setCheckedExt] = useState(false);
  const [input, setInput] = useState("");
  const [range, setRange] = useState<RangeKey>("50");
  const [wantReels, setWantReels] = useState(true);
  const [wantPhotos, setWantPhotos] = useState(true);
  const [wantStories, setWantStories] = useState(false);
  const [wantDestaques, setWantDestaques] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [aviso, setAviso] = useState("");
  const [error, setError] = useState("");
  const [items, setItems] = useState<Normalized[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [zipping, setZipping] = useState(false);
  const pending = useRef({ scan: false, stories: false });

  const finishIfIdle = useCallback(() => {
    if (!pending.current.scan && !pending.current.stories) {
      setBusy(false);
      setProgress("");
    }
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data;
      if (event.source !== window || !data || data.__instazip !== true) return;
      switch (data.type) {
        case "INSTAZIP_PONG":
          setExtVersion(String(data.version ?? "?"));
          setCheckedExt(true);
          break;
        case "INSTAZIP_PROGRESS":
          setProgress(String(data.msg ?? ""));
          break;
        case "INSTAZIP_AVISO":
          setAviso(String(data.texto ?? ""));
          break;
        case "INSTAZIP_RESULT": {
          const videos = Array.isArray(data.videos) ? data.videos : [];
          const mapped: Normalized[] = videos
            .map((v: Record<string, string>) => {
              const isVideo = Boolean(v.videoUrl);
              const mediaUrl = String(v.mediaUrl || v.videoUrl || v.photoUrl || "");
              return {
                id: `post:${v.id}`,
                type: isVideo ? "video" : "photo",
                origin: isVideo ? "reel" : "foto",
                thumbnail: String(v.thumbnail || v.coverUrl || mediaUrl),
                mediaUrl,
                filename: String(v.filename || `${v.id}.${isVideo ? "mp4" : "jpg"}`),
              } as Normalized;
            })
            .filter((x: Normalized) => x.mediaUrl);
          setItems((prev) => dedupe([...prev, ...mapped]));
          pending.current.scan = false;
          finishIfIdle();
          break;
        }
        case "INSTAZIP_STORIES_RESULT": {
          const itens = Array.isArray(data.itens) ? data.itens : [];
          const mapped: Normalized[] = itens.flatMap((m: Record<string, never>) => expandStory(m));
          setItems((prev) => dedupe([...prev, ...mapped]));
          pending.current.stories = false;
          finishIfIdle();
          break;
        }
        case "INSTAZIP_ERROR":
          setError(String(data.error || data.detalhe || "Falha na busca."));
          pending.current.scan = false;
          pending.current.stories = false;
          finishIfIdle();
          break;
      }
    };
    window.addEventListener("message", onMessage);
    send({ type: "INSTA_PANEL_LANG", lang: "pt" });
    const ping = () => send({ type: "INSTA_PANEL_PING" });
    ping();
    const retries = [400, 1200].map((ms) => window.setTimeout(ping, ms));
    const giveUp = window.setTimeout(() => setCheckedExt(true), 2200);
    return () => {
      window.removeEventListener("message", onMessage);
      retries.forEach(clearTimeout);
      clearTimeout(giveUp);
    };
  }, [finishIfIdle]);

  const start = useCallback(() => {
    const { usuario, destaqueId, code } = parseInput(input);

    // Post/reel único: resolve pelo servidor (embed público), sem extensão.
    if (code) {
      setError("");
      setAviso("");
      setItems([]);
      setSelected(new Set());
      setBusy(true);
      setProgress("Buscando o post…");
      pending.current = { scan: false, stories: false };
      fetch(`/api/downloader/resolve?code=${encodeURIComponent(code)}`)
        .then(async (res) => {
          const data: { items?: ResolveItem[]; error?: string } = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || "Não consegui buscar o post.");
          const mapped: Normalized[] = (data.items ?? [])
            .map((it, idx) => ({
              id: `single:${code}:${idx}`,
              type: it.type === "video" ? "video" : "photo",
              origin: it.type === "video" ? "reel" : "foto",
              thumbnail: it.thumbnail || it.mediaUrl,
              mediaUrl: it.mediaUrl,
              filename: it.filename || `${code}.${it.type === "video" ? "mp4" : "jpg"}`,
            }) as Normalized)
            .filter((x) => x.mediaUrl);
          if (!mapped.length) throw new Error("Nenhuma mídia encontrada nesse post.");
          setItems(mapped);
        })
        .catch((err) => setError(err instanceof Error ? err.message : String(err)))
        .finally(() => {
          setBusy(false);
          setProgress("");
        });
      return;
    }

    if (!usuario && !destaqueId) {
      setError("Cole o @usuário, o link do perfil, um post/reel ou um destaque.");
      return;
    }
    const targets: string[] = [];
    if (wantReels) targets.push("reels");
    if (wantPhotos) targets.push("photos", "covers");
    const doScan = targets.length > 0 && !!usuario;
    const doStories = (wantStories || wantDestaques) && (!!usuario || !!destaqueId);
    if (!doScan && !doStories) {
      setError("Escolha o que buscar: reels, fotos, stories ou destaques.");
      return;
    }
    setError("");
    setAviso("");
    setItems([]);
    setSelected(new Set());
    setBusy(true);
    setProgress("Conectando à extensão…");
    pending.current = { scan: doScan, stories: doStories };
    if (doScan) {
      const to = RANGES.find((r) => r.key === range)!.to;
      send({ type: "INSTA_PANEL_SCAN_REQUEST", username: usuario, rangeFrom: 0, rangeTo: to, targets });
    }
    if (doStories) {
      send({ type: "INSTA_PANEL_STORIES_REQUEST", usuario, destaqueId, stories: wantStories, destaques: wantDestaques });
    }
  }, [input, range, wantReels, wantPhotos, wantStories, wantDestaques]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allSelected = items.length > 0 && selected.size === items.length;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(items.map((i) => i.id)));

  const downloadZip = useCallback(async () => {
    const chosen = items.filter((i) => selected.has(i.id));
    if (!chosen.length) return;
    setZipping(true);
    setError("");
    try {
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      let ok = 0;
      for (let i = 0; i < chosen.length; i++) {
        const item = chosen[i]!;
        setProgress(`Baixando ${i + 1}/${chosen.length}…`);
        try {
          const res = await fetch(proxyUrl(item.mediaUrl, item.filename));
          if (!res.ok) continue;
          zip.file(item.filename, await res.blob());
          ok++;
        } catch {
          /* pula o que falhar */
        }
      }
      if (!ok) {
        setError("Nenhum arquivo pôde ser baixado.");
        return;
      }
      setProgress("Montando o ZIP…");
      const blob = await zip.generateAsync({ type: "blob" });
      saveBlob(blob, `instagestor-download-${Date.now()}.zip`);
    } finally {
      setZipping(false);
      setProgress("");
    }
  }, [items, selected]);

  const hint = useMemo(() => {
    if (!checkedExt) return { tone: "wait", text: "Procurando a extensão InstaGestor Downloader neste navegador…" };
    if (extVersion) return { tone: "ok", text: `Extensão conectada (v${extVersion}).` };
    return { tone: "warn", text: "Extensão não encontrada. Instale pelo bloco abaixo e recarregue a página." };
  }, [checkedExt, extVersion]);

  return (
    <div className="dl-stack">
      <section className="panel dl-search">
        <div className={`dl-extbar dl-extbar-${hint.tone}`}>
          <span className="dl-dot" aria-hidden="true" />
          {hint.text}
        </div>
        <label className="dl-field">
          <span className="dl-label">Link do perfil, story, destaque, post ou reel</span>
          <input
            className="dl-input"
            placeholder="@usuario ou https://www.instagram.com/usuario/"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !busy) start();
            }}
          />
        </label>

        <div className="dl-controls">
          <div className="dl-chiprow" role="group" aria-label="Quantidade">
            {RANGES.map((r) => (
              <button
                key={r.key}
                type="button"
                className={`dl-chip${range === r.key ? " is-active" : ""}`}
                onClick={() => setRange(r.key)}
              >
                {r.label}
              </button>
            ))}
          </div>
          <div className="dl-toggles">
            <Toggle checked={wantReels} onChange={setWantReels} label="Reels/vídeos" />
            <Toggle checked={wantPhotos} onChange={setWantPhotos} label="Fotos" />
            <Toggle checked={wantStories} onChange={setWantStories} label="Stories" />
            <Toggle checked={wantDestaques} onChange={setWantDestaques} label="Destaques" />
          </div>
        </div>

        <button className="button button-primary button-hero dl-go" type="button" disabled={busy} onClick={start}>
          {busy ? "Buscando…" : "Buscar tudo"}
        </button>

        <p className="dl-warn">
          Não feche nem minimize a janela do Instagram que a extensão abre durante a busca. Ela fecha sozinha ao terminar.
        </p>
        {progress ? <p className="dl-progress">{progress}</p> : null}
        {aviso ? <p className="dl-aviso">{aviso}</p> : null}
        {error ? <p className="dl-error">{error}</p> : null}
      </section>

      {items.length > 0 ? (
        <section className="panel dl-results">
          <header className="dl-results-head">
            <div>
              <h2>{items.length} itens encontrados</h2>
              <p className="muted">Selecione os que quer e baixe em ZIP, ou baixe um a um.</p>
            </div>
            <div className="dl-results-actions">
              <button type="button" className="button button-secondary" onClick={toggleAll}>
                {allSelected ? "Limpar seleção" : "Selecionar todos"}
              </button>
              <button
                type="button"
                className="button button-primary"
                disabled={zipping || selected.size === 0}
                onClick={downloadZip}
              >
                {zipping ? "Preparando…" : `Baixar ZIP (${selected.size})`}
              </button>
            </div>
          </header>
          <ul className="dl-grid">
            {items.map((item) => {
              const isSel = selected.has(item.id);
              return (
                <li key={item.id} className={`dl-card${isSel ? " is-sel" : ""}`}>
                  <button type="button" className="dl-thumb" onClick={() => toggle(item.id)} aria-pressed={isSel}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={item.thumbnail} alt="" loading="lazy" />
                    <span className="dl-badge">{item.type === "video" ? "Vídeo" : "Foto"}</span>
                    {isSel ? <span className="dl-check" aria-hidden="true">✓</span> : null}
                  </button>
                  <a className="dl-dl" href={proxyUrl(item.mediaUrl, item.filename)} download={item.filename}>
                    Baixar
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className={`dl-toggle${checked ? " is-on" : ""}`}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function dedupe(list: Normalized[]) {
  const seen = new Set<string>();
  return list.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)));
}

type StoryMedia = {
  code?: string;
  pk?: string;
  media_type?: number;
  __origem?: "story" | "destaque";
  image_versions2?: { candidates?: { url?: string }[] };
  video_versions?: { url?: string }[];
  carousel_media?: StoryMedia[];
};

function expandStory(m: StoryMedia): Normalized[] {
  const origin: "story" | "destaque" = m.__origem === "destaque" ? "destaque" : "story";
  const base = m.code || m.pk || Math.random().toString(36).slice(2);
  const children = m.carousel_media?.length ? m.carousel_media : [m];
  return children
    .map((child, idx) => {
      const isVideo = child.media_type === 2;
      const mediaUrl = isVideo ? vidUrl(child) : imgUrl(child);
      if (!mediaUrl) return null;
      const ext = isVideo ? "mp4" : "jpg";
      return {
        id: `${origin}:${base}:${idx}`,
        type: isVideo ? "video" : "photo",
        origin,
        thumbnail: imgUrl(child) || mediaUrl,
        mediaUrl,
        filename: `${origin}_${base}${m.carousel_media?.length ? `_${idx + 1}` : ""}.${ext}`,
      } as Normalized;
    })
    .filter((x): x is Normalized => x !== null);
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
