"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatBytes } from "@/components/ui";

const acceptedTypes = new Set(["image/jpeg", "video/mp4", "video/quicktime"]);
type UploadStatus = "WAITING" | "UPLOADING" | "DONE" | "ERROR";
type UploadItem = { id: string; file: File; status: UploadStatus; error?: string };
type Folder = { id: string; name: string };

export function MediaUploadForm({ maxBytes, folders }: { maxBytes: number; folders: Folder[] }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [folderId, setFolderId] = useState("");
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);

  function validate(file: File) {
    if (!acceptedTypes.has(file.type)) return "Use imagem JPEG ou vídeo MP4/MOV.";
    if (file.size > maxBytes) return `Excede o limite de ${formatBytes(maxBytes)}.`;
    return null;
  }

  function addFiles(files: FileList | File[]) {
    setDragging(false);
    setSummary(null);
    const next = Array.from(files).map((file) => {
      const error = validate(file);
      return {
        id: crypto.randomUUID(),
        file,
        status: error ? "ERROR" as const : "WAITING" as const,
        error: error ?? undefined,
      };
    });
    setItems((current) => [...current, ...next]);
    if (inputRef.current) inputRef.current.value = "";
  }

  function update(id: string, values: Partial<UploadItem>) {
    setItems((current) => current.map((item) => item.id === id ? { ...item, ...values } : item));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const pending = items.filter((item) => item.status !== "DONE" && !validate(item.file));
    if (!pending.length) return;
    setUploading(true);
    setSummary(null);
    let cursor = 0;
    let succeeded = 0;

    async function worker() {
      while (cursor < pending.length) {
        const item = pending[cursor++];
        update(item.id, { status: "UPLOADING", error: undefined });
        const data = new FormData();
        data.set("file", item.file);
        if (folderId) data.set("folderId", folderId);
        try {
          const response = await fetch("/api/media/upload", {
            method: "POST",
            body: data,
            headers: { accept: "application/json" },
          });
          const result = await response.json() as { error?: string };
          if (!response.ok) throw new Error(result.error ?? "Upload não concluído");
          succeeded++;
          update(item.id, { status: "DONE", error: undefined });
        } catch (error) {
          update(item.id, { status: "ERROR", error: error instanceof Error ? error.message : "Upload não concluído" });
        }
      }
    }

    await Promise.all([worker(), worker()]);
    setUploading(false);
    setSummary(`${succeeded} de ${pending.length} arquivo(s) enviado(s).`);
    if (succeeded) router.refresh();
  }

  return (
    <form
      className={`upload-form upload-dropzone ${dragging ? "is-dragging" : ""}`}
      onSubmit={submit}
      onDragEnter={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        addFiles(event.dataTransfer.files);
      }}
    >
      <div className="upload-mark" aria-hidden="true">↑</div>
      <div className="upload-copy">
        <h2>{dragging ? "Solte os arquivos aqui" : "Enviar novas mídias"}</h2>
        <p>Arraste imagens e vídeos ou selecione vários arquivos no dispositivo.</p>
        {summary ? <strong className="upload-file-name" role="status">{summary}</strong> : null}
      </div>
      <label>
        Pasta
        <select aria-label="Pasta" value={folderId} onChange={(event) => setFolderId(event.currentTarget.value)} disabled={uploading}>
          <option value="">Sem pasta</option>
          {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
        </select>
      </label>
      <label className="file-picker">
        <span>Escolher arquivos</span>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,video/mp4,video/quicktime"
          multiple
          disabled={uploading}
          onChange={(event) => event.currentTarget.files && addFiles(event.currentTarget.files)}
        />
      </label>
      {items.length ? (
        <ul className="upload-file-list" aria-live="polite">
          {items.map((item) => (
            <li key={item.id}>
              <span><strong>{item.file.name}</strong><small>{formatBytes(item.file.size)}</small></span>
              <span className={item.status === "ERROR" ? "inline-error" : "muted"}>
                {item.status === "WAITING" ? "Aguardando" : item.status === "UPLOADING" ? "Enviando…" : item.status === "DONE" ? "Concluído" : item.error}
              </span>
              {!uploading && item.status !== "DONE" ? (
                <button className="button button-small button-ghost" type="button" onClick={() => setItems((current) => current.filter(({ id }) => id !== item.id))}>Remover</button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      <button className="button button-secondary" type="submit" disabled={uploading || !items.some((item) => item.status !== "DONE" && !validate(item.file))}>
        {uploading ? "Enviando…" : "Enviar mídias"}
      </button>
    </form>
  );
}
