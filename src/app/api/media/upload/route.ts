import { mkdir, open, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { getEnv } from "@/lib/env";
import { log } from "@/lib/logger";
import { requireAdminApi } from "@/server/auth";
import { storeMedia, type UploadedFile } from "@/server/media";

export const runtime = "nodejs";

const CHUNK_DIR = path.join(os.tmpdir(), "instagestor-uploads");
const STALE_UPLOAD_MS = 60 * 60 * 1000;
const id = z.uuid();
const finalQuery = z.object({
  name: z.string().trim().min(1).max(255),
  type: z.enum(["image/jpeg", "video/mp4", "video/quicktime"]),
  folderId: z.union([id, z.literal("")]),
});
type Received = { file: UploadedFile; folderId?: string };

function redirectToMedia(message: string, error = false) {
  const url = new URL("/midias", getEnv().APP_URL);
  url.searchParams.set(error ? "erro" : "ok", message);
  return Response.redirect(url, 303);
}

async function sweepStaleUploads() {
  for (const name of await readdir(CHUNK_DIR).catch(() => [] as string[])) {
    const target = path.join(CHUNK_DIR, name);
    const info = await stat(target).catch(() => null);
    if (info && Date.now() - info.mtimeMs > STALE_UPLOAD_MS) await rm(target, { force: true });
  }
}

/** Partes de um mesmo arquivo chegam em sequência; a última traz nome, tipo e pasta e fecha o envio. */
async function receiveChunk(request: Request, organizationId: string): Promise<Received | null> {
  const query = new URL(request.url).searchParams;
  const upload = id.parse(query.get("upload"));
  const offset = z.coerce.number().int().min(0).max(getEnv().UPLOAD_MAX_BYTES).parse(query.get("offset"));
  const data = Buffer.from(await request.arrayBuffer());
  if (offset + data.length > getEnv().UPLOAD_MAX_BYTES) throw new Error("Arquivo maior que o limite de upload");
  const target = path.join(CHUNK_DIR, `${organizationId}-${upload}`);
  if (offset === 0) {
    await mkdir(CHUNK_DIR, { recursive: true });
    await sweepStaleUploads();
    await writeFile(target, data);
  } else {
    const handle = await open(target, "r+").catch(() => { throw new Error("Envio expirado, reinicie o upload"); });
    try {
      await handle.write(data, 0, data.length, offset);
    } finally {
      await handle.close();
    }
  }
  if (query.get("last") !== "1") return null;
  const final = finalQuery.parse({ name: query.get("name"), type: query.get("type"), folderId: query.get("folderId") ?? "" });
  try {
    return { file: { name: final.name, type: final.type, data: await readFile(target) }, folderId: final.folderId || undefined };
  } finally {
    await rm(target, { force: true });
  }
}

async function receiveForm(request: Request): Promise<Received> {
  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("Selecione um arquivo");
  const folderValue = String(formData.get("folderId") ?? "");
  return {
    file: { name: file.name, type: file.type, data: Buffer.from(await file.arrayBuffer()) },
    folderId: folderValue ? id.parse(folderValue) : undefined,
  };
}

export async function POST(request: Request) {
  const wantsJson = request.headers.get("accept")?.includes("application/json") ?? false;
  let user: Awaited<ReturnType<typeof requireAdminApi>>;
  try {
    user = await requireAdminApi();
  } catch (error) {
    if (error instanceof Response) return error;
    throw error;
  }

  const expectedOrigin = new URL(getEnv().APP_URL).origin;
  if (request.headers.get("origin") !== expectedOrigin) return new Response("Origem não autorizada", { status: 403 });
  const contentLength = Number(request.headers.get("content-length"));
  const maximumRequestBytes = getEnv().UPLOAD_MAX_BYTES + 1_000_000;
  if (!Number.isFinite(contentLength) || contentLength < 1 || contentLength > maximumRequestBytes) {
    return wantsJson
      ? Response.json({ error: "Tamanho da requisição inválido" }, { status: 413 })
      : new Response("Tamanho da requisição inválido", { status: 413 });
  }

  try {
    const multipart = request.headers.get("content-type")?.startsWith("multipart/form-data") ?? false;
    const received = multipart ? await receiveForm(request) : await receiveChunk(request, user.organizationId);
    if (!received) return Response.json({ ok: true }, { status: 202 });
    const mediaId = await storeMedia(received.file, user.organizationId, received.folderId);
    if (wantsJson) return Response.json({ id: mediaId }, { status: 201 });
    return redirectToMedia("Mídia enviada com sucesso.");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Upload não concluído";
    log("warn", "media", "upload_failed", {
      organization_id: user.organizationId,
      error: errorMessage,
      cause: error instanceof Error && error.cause instanceof Error ? error.cause.message : undefined,
    });
    return wantsJson ? Response.json({ error: errorMessage }, { status: 400 }) : redirectToMedia(errorMessage, true);
  }
}
