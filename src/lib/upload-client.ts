export const UPLOAD_CHUNK_BYTES = 5 * 1024 * 1024;
const ATTEMPTS = 3;
const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function sendChunk(url: string, chunk: Blob) {
  for (let attempt = 1; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        body: chunk,
        headers: { accept: "application/json", "content-type": "application/octet-stream" },
      });
    } catch {
      if (attempt >= ATTEMPTS) throw new Error("Falha de rede durante o envio");
      await wait(1000 * attempt);
      continue;
    }
    const body = await response.json().catch(() => ({})) as { id?: string; error?: string };
    if (response.ok) return body;
    const retryable = response.status >= 500 || response.status === 408 || response.status === 429;
    if (!retryable || attempt >= ATTEMPTS) throw new Error(body.error ?? `O servidor respondeu ${response.status}`);
    await wait(1000 * attempt);
  }
}

/**
 * Envia o arquivo em partes de 5 MB: uma requisição longa estourava o limite de tempo do proxy e do Node
 * (5 min) em vídeos grandes. Cada parte tenta até 3 vezes; a última parte dispara a validação e devolve o id.
 */
export async function uploadMedia(file: File, folderId: string, onProgress?: (fraction: number) => void) {
  const upload = crypto.randomUUID();
  const parts = Math.max(1, Math.ceil(file.size / UPLOAD_CHUNK_BYTES));
  for (let index = 0; index < parts; index++) {
    const offset = index * UPLOAD_CHUNK_BYTES;
    const params = new URLSearchParams({ upload, offset: String(offset) });
    if (index === parts - 1) {
      params.set("last", "1");
      params.set("name", file.name);
      params.set("type", file.type);
      if (folderId) params.set("folderId", folderId);
    }
    const body = await sendChunk(`/api/media/upload?${params}`, file.slice(offset, offset + UPLOAD_CHUNK_BYTES));
    onProgress?.((index + 1) / parts);
    if (body.id) return body.id;
  }
  throw new Error("Upload não concluído");
}
