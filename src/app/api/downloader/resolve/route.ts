import { requireAdminApi } from "@/server/auth";

export const dynamic = "force-dynamic";

// Resolve um post/reel único pelo /embed/ PÚBLICO do Instagram (sem login).
// É o caminho que não passa pela extensão: dado o shortcode, buscamos o embed
// no servidor e extraímos a URL da mídia. Imagens quase sempre vêm; vídeo vem
// quando o embed expõe video_url (varia conforme o post).

export type ResolvedItem = {
  type: "video" | "photo";
  mediaUrl: string;
  thumbnail: string;
  filename: string;
};

function decodeJson(value: string) {
  return value
    .replace(/\\u0026/gi, "&")
    .replace(/\\\//g, "/")
    .replace(/\\u([\dA-Fa-f]{4})/g, (_m, h) => String.fromCharCode(parseInt(h, 16)));
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x([\dA-Fa-f]+);/g, (_m, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d) => String.fromCharCode(parseInt(d, 10)));
}

/** Extrai a mídia do HTML do /embed/. Pura, para dar pra testar sem rede. */
export function extractFromEmbed(html: string, code: string): ResolvedItem[] {
  const video = html.match(/"video_url":"([^"]+)"/) || html.match(/property="og:video"\s+content="([^"]+)"/i);
  const image =
    html.match(/"display_url":"([^"]+)"/) ||
    html.match(/property="og:image"\s+content="([^"]+)"/i) ||
    html.match(/<img[^>]+class="[^"]*EmbeddedMediaImage[^"]*"[^>]+src="([^"]+)"/i);

  const thumbnail = image ? (image[0].includes("og:image") ? decodeHtml(image[1]!) : decodeJson(image[1]!)) : "";

  if (video) {
    const url = video[0].includes("og:video") ? decodeHtml(video[1]!) : decodeJson(video[1]!);
    if (url) return [{ type: "video", mediaUrl: url, thumbnail, filename: `post_${code}.mp4` }];
  }
  if (thumbnail) {
    return [{ type: "photo", mediaUrl: thumbnail, thumbnail, filename: `foto_${code}.jpg` }];
  }
  return [];
}

export async function GET(request: Request) {
  try {
    await requireAdminApi();
  } catch (error) {
    if (error instanceof Response) return error;
    throw error;
  }

  const code = new URL(request.url).searchParams.get("code") ?? "";
  if (!/^[A-Za-z0-9_-]{5,24}$/.test(code)) {
    return Response.json({ error: "Código do post inválido." }, { status: 400 });
  }

  let html = "";
  try {
    const res = await fetch(`https://www.instagram.com/p/${code}/embed/captioned/`, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
      },
    });
    if (!res.ok) {
      return Response.json(
        { error: res.status === 404 ? "Post não encontrado ou privado." : "Instagram recusou a busca." },
        { status: res.status === 404 ? 404 : 502 },
      );
    }
    html = await res.text();
  } catch {
    return Response.json({ error: "Não consegui acessar o Instagram." }, { status: 502 });
  }

  const items = extractFromEmbed(html, code);
  if (!items.length) {
    return Response.json(
      { error: "Não achei a mídia desse post pelo embed. Para vídeos, use a busca por perfil com a extensão." },
      { status: 422 },
    );
  }
  return Response.json({ items });
}
