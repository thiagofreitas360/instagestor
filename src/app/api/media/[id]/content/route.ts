import { getSqlClient } from "@/db/client";
import { verifySignature } from "@/lib/crypto";
import { getStorageProvider } from "@/providers/storage";

export const dynamic = "force-dynamic";

function parseRange(value: string, size: number) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || size < 1) return null;
  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return null;

  let start: number;
  let end: number;
  if (!rawStart) {
    const suffixLength = Number(rawEnd);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd ? Number(rawEnd) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size) {
      return null;
    }
    end = Math.min(end, size - 1);
  }
  return { start, end };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const query = new URL(request.url).searchParams;
  const expires = Number(query.get("expires"));
  const signature = query.get("signature") ?? "";
  if (!Number.isInteger(expires) || expires < Math.floor(Date.now() / 1000) || !verifySignature(`${id}.${expires}`, signature)) {
    return new Response("URL expirada ou inválida", { status: 403 });
  }
  const [asset] = await getSqlClient()<Array<{
    storage_key: string;
    storage_provider: "LOCAL" | "S3";
    mime_type: string;
    size_bytes: number;
  }>>`
    SELECT storage_key, storage_provider, mime_type, size_bytes FROM media_assets
    WHERE id = ${id} AND processing_status = 'READY' AND deleted_at IS NULL
  `;
  if (!asset) return new Response("Mídia não encontrada", { status: 404 });
  try {
    const size = Number(asset.size_bytes);
    const requestedRange = request.headers.get("range");
    const range = requestedRange ? parseRange(requestedRange, size) : undefined;
    if (requestedRange && !range) {
      return new Response(null, {
        status: 416,
        headers: { "content-range": `bytes */${size}`, "cache-control": "no-store" },
      });
    }
    const body = await getStorageProvider(asset.storage_provider).open(asset.storage_key, range ?? undefined);
    const contentLength = range ? range.end - range.start + 1 : size;
    return new Response(body, {
      status: range ? 206 : 200,
      headers: {
        "content-type": asset.mime_type,
        "content-length": String(contentLength),
        "accept-ranges": "bytes",
        ...(range ? { "content-range": `bytes ${range.start}-${range.end}/${size}` } : {}),
        "cache-control": "private, max-age=300",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return new Response("Mídia não encontrada", { status: 404 });
  }
}
