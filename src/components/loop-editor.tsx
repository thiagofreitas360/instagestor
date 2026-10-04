"use client";

import { useRef, useState } from "react";
import { formatBytes, initials } from "@/components/ui";

type LoopAccount = { id: string; username: string; display_name: string | null; profile_picture_url: string | null };
type LoopAsset = { id: string; original_filename: string; media_kind: "IMAGE" | "VIDEO"; folder_name: string | null };

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
    </fieldset>
  );
}

const ACCEPTED_TYPES = "video/mp4,video/quicktime,image/jpeg";

/** Pool do loop: clique remove; envio novo entra direto no pool; acervo adiciona o que já está em Mídias. */
export function LoopMediaPool({
  library,
  initialIds,
  maxBytes,
}: {
  library: LoopAsset[];
  initialIds: string[];
  maxBytes: number;
}) {
  const [assets, setAssets] = useState(library);
  const [pool, setPool] = useState(() => initialIds.filter((id) => library.some((asset) => asset.id === id)));
  const [search, setSearch] = useState("");
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const term = search.trim().toLocaleLowerCase("pt-BR");
  const available = assets.filter((asset) => !pool.includes(asset.id) && (
    !term || `${asset.original_filename} ${asset.folder_name ?? ""}`.toLocaleLowerCase("pt-BR").includes(term)
  ));

  async function upload(input: HTMLInputElement) {
    const files = Array.from(input.files ?? []);
    input.value = "";
    if (!files.length) return;
    setUploading(true);
    const failures: string[] = [];
    let sent = 0;
    for (const [index, file] of files.entries()) {
      setStatus(`Enviando ${index + 1} de ${files.length}…`);
      if (file.size > maxBytes) {
        failures.push(`${file.name}: excede ${formatBytes(maxBytes)}`);
        continue;
      }
      const data = new FormData();
      data.set("file", file);
      try {
        const response = await fetch("/api/media/upload", { method: "POST", body: data, headers: { accept: "application/json" } });
        const body = await response.json().catch(() => ({})) as { id?: string; error?: string };
        if (!response.ok || !body.id) throw new Error(body.error ?? "envio não concluído");
        const asset: LoopAsset = {
          id: body.id,
          original_filename: file.name,
          media_kind: file.type.startsWith("video/") ? "VIDEO" : "IMAGE",
          folder_name: null,
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
    <div className="loop-media">
      {pool.map((id) => <input key={id} type="hidden" name="mediaIds" value={id} />)}
      <span className="loop-section-label">Mídias atuais no pool ({pool.length})</span>
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
        <input className="sr-only" type="file" accept={ACCEPTED_TYPES} multiple disabled={uploading} onChange={(event) => upload(event.currentTarget)} />
        <span aria-hidden="true">⇪</span>
        <span>{uploading ? "Enviando…" : "Adicionar novos vídeos ou imagens"}</span>
      </label>
      {status ? <p className="form-hint" role="status">{status}</p> : null}

      <details className="native-disclosure loop-library">
        <summary>Adicionar do acervo ({assets.length - pool.length} disponível(is))</summary>
        <div className="loop-library-body">
          <input type="search" value={search} onChange={(event) => setSearch(event.currentTarget.value)} placeholder="Buscar por nome ou pasta" aria-label="Buscar no acervo" />
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
      </details>
    </div>
  );
}
