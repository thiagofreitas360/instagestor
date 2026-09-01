"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatBytes } from "@/components/ui";

const acceptedTypes = new Set(["image/jpeg", "video/mp4", "video/quicktime"]);

export function MediaUploadForm({ maxBytes }: { maxBytes: number }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previewUrl = useMemo(() => file ? URL.createObjectURL(file) : null, [file]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function validate(nextFile: File) {
    if (!acceptedTypes.has(nextFile.type)) return "Use uma imagem JPEG ou um vídeo MP4/MOV.";
    if (nextFile.size > maxBytes) return `O arquivo excede o limite de ${formatBytes(maxBytes)}.`;
    return null;
  }

  function selectFile(nextFile: File | null, fromDrop = false) {
    setDragging(false);
    setError(null);
    if (!nextFile) {
      setFile(null);
      return;
    }
    const validationError = validate(nextFile);
    if (validationError) {
      setError(validationError);
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    if (fromDrop && inputRef.current) {
      const transfer = new DataTransfer();
      transfer.items.add(nextFile);
      inputRef.current.files = transfer.files;
    }
    setFile(nextFile);
  }

  return (
    <form
      className={`upload-form upload-dropzone ${dragging ? "is-dragging" : ""}`}
      action="/api/media/upload"
      method="post"
      encType="multipart/form-data"
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
        selectFile(event.dataTransfer.files.item(0), true);
      }}
    >
      <div className="upload-mark" aria-hidden="true">↑</div>
      <div className="upload-copy">
        <h2>{dragging ? "Solte o arquivo aqui" : "Enviar nova mídia"}</h2>
        <p>Arraste uma imagem ou vídeo, ou escolha um arquivo no dispositivo.</p>
        {file ? <strong className="upload-file-name">{file.name} · {formatBytes(file.size)}</strong> : null}
        {error ? <span className="inline-error" role="alert">{error}</span> : null}
      </div>
      {previewUrl ? (
        <div className="upload-preview">
          {file?.type.startsWith("video/") ? (
            <video src={previewUrl} muted playsInline preload="metadata" aria-label={`Prévia de ${file.name}`} />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt={`Prévia de ${file?.name ?? "imagem selecionada"}`} />
          )}
        </div>
      ) : null}
      <label className="file-picker">
        <span>{file ? "Trocar arquivo" : "Escolher arquivo"}</span>
        <input
          ref={inputRef}
          name="file"
          type="file"
          accept="image/jpeg,video/mp4,video/quicktime"
          required
          onChange={(event) => selectFile(event.currentTarget.files?.item(0) ?? null)}
        />
      </label>
      <button className="button button-secondary" type="submit" disabled={!file || Boolean(error)}>Enviar mídia</button>
    </form>
  );
}
