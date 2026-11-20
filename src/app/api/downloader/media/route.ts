import { requireAdminApi } from "@/server/auth";

export const dynamic = "force-dynamic";

// Só domínios de mídia do Instagram/Meta. Trava de SSRF: o navegador manda a
// URL do CDN que a extensão coletou; aqui só repassamos o que for desses hosts.
const ALLOWED_SUFFIXES = [".cdninstagram.com", ".fbcdn.net"];

function isAllowed(url: URL) {
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  return ALLOWED_SUFFIXES.some((suffix) => host === suffix.slice(1) || host.endsWith(suffix));
}

function safeName(raw: string | null, fallback: string) {
  const name = (raw ?? "").replace(/[^\w.\-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 120);
  return name || fallback;
}

export async function GET(request: Request) {
  try {
    await requireAdminApi();
  } catch (error) {
    if (error instanceof Response) return error;
    throw error;
  }

  const params = new URL(request.url).searchParams;
  const target = params.get("u");
  if (!target) return new Response("Faltou a URL da mídia", { status: 400 });

  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return new Response("URL inválida", { status: 400 });
  }
  if (!isAllowed(url)) return new Response("Host não permitido", { status: 400 });

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      headers: { Referer: "https://www.instagram.com/", "User-Agent": "Mozilla/5.0" },
      redirect: "follow",
    });
  } catch {
    return new Response("Não consegui buscar a mídia", { status: 502 });
  }
  if (!upstream.ok || !upstream.body) {
    return new Response("Mídia indisponível", { status: upstream.status === 404 ? 404 : 502 });
  }

  const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
  const fallback = contentType.startsWith("video/") ? "video.mp4" : "midia.jpg";
  const filename = safeName(params.get("name"), fallback);

  // Sem Content-Length de propósito: o fetch descomprime, então o tamanho do
  // upstream pode não bater com os bytes transmitidos. Stream chunked é seguro.
  const headers = new Headers({
    "Content-Type": contentType,
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "no-store",
  });

  return new Response(upstream.body, { status: 200, headers });
}
