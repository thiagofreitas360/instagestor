import { getEnv } from "@/lib/env";
import { requireAdminApi } from "@/server/auth";
import { storeMedia } from "@/server/media";

export const runtime = "nodejs";

function redirectToMedia(message: string, error = false) {
  const url = new URL("/midias", getEnv().APP_URL);
  url.searchParams.set(error ? "erro" : "ok", message);
  return Response.redirect(url, 303);
}

export async function POST(request: Request) {
  try {
    await requireAdminApi();
  } catch (error) {
    if (error instanceof Response) return error;
    throw error;
  }

  const expectedOrigin = new URL(getEnv().APP_URL).origin;
  if (request.headers.get("origin") !== expectedOrigin) return new Response("Origem não autorizada", { status: 403 });
  const contentLength = Number(request.headers.get("content-length"));
  const maximumRequestBytes = getEnv().UPLOAD_MAX_BYTES + 1_000_000;
  if (!Number.isFinite(contentLength) || contentLength < 1 || contentLength > maximumRequestBytes) {
    return new Response("Tamanho da requisição inválido", { status: 413 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) throw new Error("Selecione um arquivo");
    await storeMedia(file);
    return redirectToMedia("Mídia enviada com sucesso.");
  } catch (error) {
    return redirectToMedia(error instanceof Error ? error.message : "Upload não concluído", true);
  }
}
