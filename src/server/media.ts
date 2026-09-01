import { sha256 } from "@/lib/crypto";
import { getSqlClient } from "@/db/client";
import { log } from "@/lib/logger";
import { getStorageProvider, newStorageKey } from "@/providers/storage";
import { validateMedia } from "./media-constraints";

export async function storeMedia(file: File) {
  const data = Buffer.from(await file.arrayBuffer());
  const metadata = await validateMedia(file.name, file.type, data);
  const key = newStorageKey();
  const storage = getStorageProvider();
  await storage.put(key, data, metadata.mimeType);
  try {
    const [asset] = await getSqlClient()<{ id: string }[]>`
      INSERT INTO media_assets (
        original_filename, storage_provider, storage_key, mime_type, media_kind, size_bytes,
        checksum_sha256, width, height, duration_seconds, processing_status
      ) VALUES (
        ${file.name}, ${storage.name}, ${key}, ${metadata.mimeType}, ${metadata.kind}, ${data.length},
        ${sha256(data)}, ${metadata.width ?? null}, ${metadata.height ?? null}, ${metadata.durationSeconds ?? null}, 'READY'
      ) RETURNING id
    `;
    return asset.id;
  } catch (error) {
    try {
      await storage.delete(key);
    } catch (cleanupError) {
      log("warn", "media", "failed_upload_cleanup_failed", {
        storage_provider: storage.name,
        error: cleanupError instanceof Error ? cleanupError.message : "unknown",
      });
    }
    throw error;
  }
}

export async function deleteMedia(assetId: string, actorUserId: string) {
  const asset = await getSqlClient().begin(async (sql) => {
    const [asset] = await sql<Array<{ id: string; storage_key: string; storage_provider: "LOCAL" | "S3" }>>`
      SELECT id, storage_key, storage_provider
      FROM media_assets
      WHERE id = ${assetId} AND deleted_at IS NULL
      FOR UPDATE
    `;
    if (!asset) throw new Error("Mídia não encontrada");
    const [usage] = await sql<Array<{ count: number }>>`
      SELECT count(*)::int AS count FROM campaign_media WHERE media_asset_id = ${assetId}
    `;
    if (usage.count > 0) throw new Error("Mídia usada por campanha não pode ser excluída");

    await sql`
      UPDATE media_assets SET processing_status = 'DELETED', deleted_at = now(), updated_at = now()
      WHERE id = ${assetId}
    `;
    await sql`
      INSERT INTO audit_logs (actor_user_id, event_type, entity_type, entity_id)
      VALUES (${actorUserId}, 'MEDIA_DELETED', 'media_asset', ${assetId})
    `;
    return asset;
  });
  try {
    await getStorageProvider(asset.storage_provider).delete(asset.storage_key);
  } catch (error) {
    log("warn", "media", "deleted_object_cleanup_failed", {
      media_id: asset.id,
      storage_provider: asset.storage_provider,
      error: error instanceof Error ? error.message : "unknown",
    });
  }
}
