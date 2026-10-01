import { sha256 } from "@/lib/crypto";
import { getSqlClient } from "@/db/client";
import { log } from "@/lib/logger";
import { getStorageProvider, newStorageKey } from "@/providers/storage";
import { validateMedia } from "./media-constraints";

export async function storeMedia(file: File, folderId?: string) {
  if (folderId) {
    const [folder] = await getSqlClient()<Array<{ id: string }>>`
      SELECT id FROM media_folders WHERE id = ${folderId}
    `;
    if (!folder) throw new Error("Pasta de mídia não encontrada");
  }
  const data = Buffer.from(await file.arrayBuffer());
  const metadata = await validateMedia(file.name, file.type, data);
  const key = newStorageKey();
  const storage = getStorageProvider();
  await storage.put(key, data, metadata.mimeType);
  try {
    const [asset] = await getSqlClient()<{ id: string }[]>`
      INSERT INTO media_assets (
        original_filename, storage_provider, storage_key, mime_type, media_kind, size_bytes,
        checksum_sha256, width, height, duration_seconds, folder_id, processing_status
      ) VALUES (
        ${file.name}, ${storage.name}, ${key}, ${metadata.mimeType}, ${metadata.kind}, ${data.length},
        ${sha256(data)}, ${metadata.width ?? null}, ${metadata.height ?? null}, ${metadata.durationSeconds ?? null},
        ${folderId ?? null}, 'READY'
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

function folderName(value: string) {
  const name = value.trim();
  if (!name) throw new Error("Nome da pasta é obrigatório");
  if (name.length > 120) throw new Error("Nome da pasta excede 120 caracteres");
  return name;
}

export async function createMediaFolder(name: string, actorUserId: string) {
  const normalized = folderName(name);
  return getSqlClient().begin(async (sql) => {
    const [folder] = await sql<{ id: string }[]>`
      INSERT INTO media_folders (name)
      VALUES (${normalized})
      ON CONFLICT DO NOTHING
      RETURNING id
    `;
    if (!folder) throw new Error("Já existe uma pasta com este nome");
    await sql`
      INSERT INTO audit_logs (actor_user_id, event_type, entity_type, entity_id)
      VALUES (${actorUserId}, 'MEDIA_FOLDER_CREATED', 'media_folder', ${folder.id})
    `;
    return folder.id;
  });
}

export async function renameMediaFolder(folderId: string, name: string, actorUserId: string) {
  const normalized = folderName(name);
  await getSqlClient().begin(async (sql) => {
    const duplicate = await sql`
      SELECT id FROM media_folders WHERE lower(name) = lower(${normalized}) AND id <> ${folderId} LIMIT 1
    `;
    if (duplicate.length) throw new Error("Já existe uma pasta com este nome");
    const updated = await sql`
      UPDATE media_folders SET name = ${normalized}, updated_at = now() WHERE id = ${folderId} RETURNING id
    `;
    if (!updated.length) throw new Error("Pasta de mídia não encontrada");
    await sql`
      INSERT INTO audit_logs (actor_user_id, event_type, entity_type, entity_id)
      VALUES (${actorUserId}, 'MEDIA_FOLDER_RENAMED', 'media_folder', ${folderId})
    `;
  });
}

export async function deleteMediaFolder(folderId: string, actorUserId: string) {
  await getSqlClient().begin(async (sql) => {
    const deleted = await sql`DELETE FROM media_folders WHERE id = ${folderId} RETURNING id`;
    if (!deleted.length) throw new Error("Pasta de mídia não encontrada");
    await sql`
      INSERT INTO audit_logs (actor_user_id, event_type, entity_type, entity_id)
      VALUES (${actorUserId}, 'MEDIA_FOLDER_DELETED', 'media_folder', ${folderId})
    `;
  });
}

export async function moveMedia(assetId: string, folderId: string | null, actorUserId: string) {
  await getSqlClient().begin(async (sql) => {
    if (folderId) {
      const folder = await sql`SELECT id FROM media_folders WHERE id = ${folderId}`;
      if (!folder.length) throw new Error("Pasta de mídia não encontrada");
    }
    const moved = await sql`
      UPDATE media_assets SET folder_id = ${folderId}, updated_at = now()
      WHERE id = ${assetId} AND deleted_at IS NULL RETURNING id
    `;
    if (!moved.length) throw new Error("Mídia não encontrada");
    await sql`
      INSERT INTO audit_logs (actor_user_id, event_type, entity_type, entity_id, metadata_json)
      VALUES (${actorUserId}, 'MEDIA_MOVED', 'media_asset', ${assetId},
        jsonb_build_object('folderId', ${folderId}))
    `;
  });
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
