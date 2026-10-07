"use client";

import { useEffect, useRef, useState } from "react";
import { formatBytes, initials } from "@/components/ui";

type LoopAccount = { id: string; username: string; display_name: string | null; profile_picture_url: string | null };
type MediaType = "REELS" | "IMAGE" | "MIXED";
type LoopAsset = {
  id: string;
  original_filename: string;
  media_kind: "IMAGE" | "VIDEO";
  folder_id: string | null;
  folder_name: string | null;
};
type MediaFolder = { id: string; name: string; media_count: number };

/**
 * Checkboxes nativos em forma de chip. Na edição, contas fora do loop vêm primeiro e destacadas;
 * marcar/desmarcar só vale ao salvar.
 */
export function LoopAccountPicker({
  accounts,
  initialIds,
  editing,
}: {
  accounts: LoopAccount[];
  initialIds: string[];
  editing: boolean;
}) {
  const box = useRef<HTMLFieldSetElement>(null);
  const inLoop = new Set(initialIds);
  const outside = editing ? accounts.filter((account) => !inLoop.has(account.id)) : [];
  const ordered = editing ? [...outside, ...accounts.filter((account) => inLoop.has(account.id))] : accounts;

  function setAll(checked: boolean) {
    box.current?.querySelectorAll<HTMLInputElement>('input[name="accountIds"]').forEach((input) => {
      input.checked = checked;
    });
  }

  return (
    <fieldset ref={box} className="loop-accounts">
      <legend>Contas Instagram</legend>
      <div className="loop-accounts-toolbar">
        {outside.length ? (
          <span className="loop-outside-hint">{outside.length} conta(s) fora do loop, no topo. Clique para incluir.</span>
        ) : <span />}
        <span className="loop-accounts-buttons">
          <button className="button button-small button-secondary" type="button" onClick={() => setAll(true)}>Selecionar todas</button>
          <button className="button button-small button-ghost" type="button" onClick={() => setAll(false)}>Limpar</button>
        </span>
      </div>
      <div className="loop-account-grid">
        {ordered.map((account) => {
          const isOutside = editing && !inLoop.has(account.id);
          return (
            <label className={`loop-account${isOutside ? " loop-account-outside" : ""}`} key={account.id}>
              <input className="sr-only" type="checkbox" name="accountIds" value={account.id} defaultChecked={inLoop.has(account.id)} />
              <span className="account-avatar account-avatar-tiny" aria-hidden="true">
                {account.profile_picture_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={account.profile_picture_url} alt="" loading="lazy" referrerPolicy="no-referrer" />
                ) : initials(account.display_name ?? account.username)}
              </span>
              <span className="loop-account-name">@{account.username}</span>
              {isOutside ? (
                <>
                  <small className="loop-note-off">fora do loop</small>
                  <small className="loop-note-on">entra ao salvar</small>
                </>
              ) : editing ? <small className="loop-note-off">sai ao salvar</small> : null}
            </label>
          );
        })}
      </div>
      {!accounts.length ? <p className="form-hint">Nenhuma conta disponível. Remova uma conta de outro loop para utilizá-la aqui.</p> : null}
    </fieldset>
  );
}

const ACCEPTED_TYPES = "video/mp4,video/quicktime,image/jpeg";

function isCompatible(asset: LoopAsset, type: MediaType) {
  return type === "MIXED" || (type === "REELS" ? asset.media_kind === "VIDEO" : asset.media_kind === "IMAGE");
}

/** Pool do loop: clique remove; envio novo entra direto no pool; acervo adiciona o que já está em Mídias. */
export function LoopMediaPool({
  library,
  folders,
  initialFolderId,
  initialIds,
  initialMediaType,
  maxBytes,
}: {
  library: LoopAsset[];
  folders: MediaFolder[];
  initialFolderId: string;
  initialIds: string[];
  initialMediaType: MediaType;
  maxBytes: number;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [assets, setAssets] = useState(library);
  const [folderId, setFolderId] = useState(initialFolderId);
  const [mediaType, setMediaType] = useState<MediaType>(initialMediaType);
  const [pool, setPool] = useState(() => initialIds.filter((id) => library.some((asset) => asset.id === id)));
  const [search, setSearch] = useState("");
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const selectedFolder = folders.find((folder) => folder.id === folderId);
  const term = search.trim().toLocaleLowerCase("pt-BR");
  const inSelectedFolder = assets.filter((asset) => asset.folder_id === folderId && isCompatible(asset, mediaType));
  const available = inSelectedFolder.filter((asset) => !pool.includes(asset.id) && (
    !term || `${asset.original_filename} ${asset.folder_name ?? ""}`.toLocaleLowerCase("pt-BR").includes(term)
  ));

  useEffect(() => {
    const form = root.current?.closest("form");
    if (!form) return;
    const onChange = (event: Event) => {
      const input = event.target as HTMLInputElement;
      if (input.name !== "mediaType" || !input.checked) return;
      const nextType = input.value as MediaType;
      setMediaType(nextType);
      if (folderId) setPool(assets.filter((asset) => asset.folder_id === folderId && isCompatible(asset, nextType)).map((asset) => asset.id));
    };
    form.addEventListener("change", onChange);
    return () => form.removeEventListener("change", onChange);
  }, [assets, folderId]);

  function selectFolder(nextFolderId: string) {
    setFolderId(nextFolderId);
    setSearch("");
    setStatus(null);
    setPool(nextFolderId
      ? assets.filter((asset) => asset.folder_id === nextFolderId && isCompatible(asset, mediaType)).map((asset) => asset.id)
      : []);
  }

  async function upload(input: HTMLInputElement) {
    const files = Array.from(input.files ?? []);
    input.value = "";
    if (!files.length) return;
    if (!folderId) {
      setStatus("Selecione uma pasta antes de enviar mídias.");
      return;
    }
    setUploading(true);
    const failures: string[] = [];
    let sent = 0;
    for (const [index, file] of files.entries()) {
      setStatus(`Enviando ${index + 1} de ${files.length}…`);
      if (file.size > maxBytes) {
        failures.push(`${file.name}: excede ${formatBytes(maxBytes)}`);
        continue;
      }
      const kind = file.type.startsWith("video/") ? "VIDEO" : "IMAGE";
      if (!isCompatible({ id: "", original_filename: file.name, media_kind: kind, folder_id: folderId, folder_name: selectedFolder?.name ?? null }, mediaType)) {
        failures.push(`${file.name}: tipo incompatível com o loop`);
        continue;
      }
      const data = new FormData();
      data.set("file", file);
      data.set("folderId", folderId);
      try {
        const response = await fetch("/api/media/upload", { method: "POST", body: data, headers: { accept: "application/json" } });
        const body = await response.json().catch(() => ({})) as { id?: string; error?: string };
        if (!response.ok || !body.id) throw new Error(body.error ?? "envio não concluído");
        const asset: LoopAsset = {
          id: body.id,
          original_filename: file.name,
          media_kind: kind,
          folder_id: folderId,
          folder_name: selectedFolder?.name ?? null,
        };
        setAssets((current) => [asset, ...current]);
        setPool((current) => [...current, asset.id]);
        sent += 1;
      } catch (error) {
        failures.push(`${file.name}: ${error instanceof Error ? error.message : "envio não concluído"}`);
      }
    }
    setUploading(false);
    setStatus(failures.length
      ? `${sent} enviado(s) para o pool. Falharam: ${failures.join("; ")}`
      : `${sent} arquivo(s) enviado(s) e adicionado(s) ao pool. Salve para aplicar.`);
  }

  return (
    <div ref={root} className="loop-media">
      <label>
        Pasta de mídias
        <select name="mediaFolderId" value={folderId} onChange={(event) => selectFolder(event.currentTarget.value)} required>
          <option value="">Selecione uma pasta</option>
          {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name} ({folder.media_count})</option>)}
        </select>
      </label>
      {!folders.length ? <p className="form-hint">Nenhuma pasta disponível. <a className="text-link" href="/midias">Crie uma pasta em Mídias</a>.</p> : null}
      {!initialFolderId && initialIds.length ? <p className="form-hint">Este loop é legado. Escolha uma pasta para substituir o pool atual antes de salvar.</p> : null}
      {pool.map((id) => <input key={id} type="hidden" name="mediaIds" value={id} />)}
      <span className="loop-section-label">Mídias atuais no pool ({pool.length}){selectedFolder ? ` · ${selectedFolder.name}` : ""}</span>
      {pool.length ? (
        <ul className="loop-pool-list">
          {pool.map((id) => {
            const asset = byId.get(id);
            if (!asset) return null;
            return (
              <li key={id}>
                <button
                  className="loop-pool-item"
                  type="button"
                  title="Clique para remover do pool"
                  onClick={() => setPool((current) => current.filter((value) => value !== id))}
                >
                  <span className="loop-kind">{asset.media_kind === "VIDEO" ? "VÍDEO" : "IMAGEM"}</span>
                  <span className="loop-pool-name">{asset.original_filename}</span>
                  <span className="loop-pool-remove" aria-hidden="true">×</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : <p className="form-hint">Nenhuma mídia no pool. Envie arquivos ou adicione do acervo.</p>}

      <label className={`loop-upload${uploading ? " is-busy" : ""}`}>
        <input className="sr-only" type="file" accept={ACCEPTED_TYPES} multiple disabled={uploading || !folderId} onChange={(event) => upload(event.currentTarget)} />
        <span aria-hidden="true">⇪</span>
        <span>{uploading ? "Enviando…" : folderId ? "Adicionar novos vídeos ou imagens" : "Selecione uma pasta para enviar"}</span>
      </label>
      {status ? <p className="form-hint" role="status">{status}</p> : null}

      {folderId ? <details className="native-disclosure loop-library">
        <summary>Adicionar da pasta ({available.length} disponível(is))</summary>
        <div className="loop-library-body">
          <input type="search" value={search} onChange={(event) => setSearch(event.currentTarget.value)} placeholder="Buscar por nome" aria-label="Buscar na pasta" />
          <ul className="loop-pool-list">
            {available.map((asset) => (
              <li key={asset.id}>
                <button className="loop-pool-item" type="button" title="Clique para adicionar ao pool" onClick={() => setPool((current) => [...current, asset.id])}>
                  <span className="loop-kind">{asset.media_kind === "VIDEO" ? "VÍDEO" : "IMAGEM"}</span>
                  <span className="loop-pool-name">{asset.original_filename}</span>
                  <span className="loop-pool-add" aria-hidden="true">+</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </details> : null}
    </div>
  );
}
