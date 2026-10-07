import { sha256 } from "@/lib/crypto";
import { getSqlClient } from "@/db/client";
import { log } from "@/lib/logger";
import { getStorageProvider, newStorageKey } from "@/providers/storage";
import { validateMedia } from "./media-constraints";

export async function storeMedia(file: File, organizationId: string, folderId?: string) {
  if (folderId) {
    const [folder] = await getSqlClient()<Array<{ id: string }>>`
      SELECT id FROM media_folders WHERE organization_id = ${organizationId} AND id = ${folderId}
    `;
    if (!folder) throw new Error("Pasta de mídia não encontrada");
  }
  const data = Buffer.from(await file.arrayBuffer());
  const metadata = await validateMedia(file.name, file.type, data);
  const key = newStorageKey(organizationId);
  const storage = getStorageProvider();
  await storage.put(key, data, metadata.mimeType);
  try {
    const [asset] = await getSqlClient()<{ id: string }[]>`
      INSERT INTO media_assets (
        organization_id, original_filename, storage_provider, storage_key, mime_type, media_kind, size_bytes,
        checksum_sha256, width, height, duration_seconds, folder_id, processing_status
      ) VALUES (
        ${organizationId}, ${file.name}, ${storage.name}, ${key}, ${metadata.mimeType}, ${metadata.kind}, ${data.length},
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

export async function createMediaFolder(name: string, actorUserId: string, organizationId: string) {
  const normalized = folderName(name);
  return getSqlClient().begin(async (sql) => {
    const [folder] = await sql<{ id: string }[]>`
      INSERT INTO media_folders (organization_id, name)
      VALUES (${organizationId}, ${normalized})
      ON CONFLICT DO NOTHING
      RETURNING id
    `;
    if (!folder) throw new Error("Já existe uma pasta com este nome");
    await sql`
      INSERT INTO audit_logs (organization_id, actor_user_id, event_type, entity_type, entity_id)
      VALUES (${organizationId}, ${actorUserId}, 'MEDIA_FOLDER_CREATED', 'media_folder', ${folder.id})
    `;
    return folder.id;
  });
}

export async function renameMediaFolder(folderId: string, name: string, actorUserId: string, organizationId: string) {
  const normalized = folderName(name);
  await getSqlClient().begin(async (sql) => {
    const duplicate = await sql`
      SELECT id FROM media_folders
      WHERE organization_id = ${organizationId} AND lower(name) = lower(${normalized}) AND id <> ${folderId} LIMIT 1
    `;
    if (duplicate.length) throw new Error("Já existe uma pasta com este nome");
    const updated = await sql`
      UPDATE media_folders SET name = ${normalized}, updated_at = now()
      WHERE organization_id = ${organizationId} AND id = ${folderId} RETURNING id
    `;
    if (!updated.length) throw new Error("Pasta de mídia não encontrada");
    await sql`
      INSERT INTO audit_logs (organization_id, actor_user_id, event_type, entity_type, entity_id)
      VALUES (${organizationId}, ${actorUserId}, 'MEDIA_FOLDER_RENAMED', 'media_folder', ${folderId})
    `;
  });
}

export async function deleteMediaFolder(folderId: string, actorUserId: string, organizationId: string) {
  await getSqlClient().begin(async (sql) => {
    const [folder] = await sql<Array<{ id: string }>>`
      SELECT id FROM media_folders
      WHERE organization_id = ${organizationId} AND id = ${folderId}
      FOR UPDATE
    `;
    if (!folder) throw new Error("Pasta de mídia não encontrada");
    const [loop] = await sql<Array<{ name: string }>>`
      SELECT name FROM loops
      WHERE organization_id = ${organizationId} AND media_folder_id = ${folderId}
      ORDER BY created_at LIMIT 1
    `;
    if (loop) throw new Error(`A pasta é usada pelo loop "${loop.name}" e não pode ser excluída`);
    const deleted = await sql`DELETE FROM media_folders WHERE organization_id = ${organizationId} AND id = ${folderId} RETURNING id`;
    if (!deleted.length) throw new Error("Pasta de mídia não encontrada");
    await sql`
      INSERT INTO audit_logs (organization_id, actor_user_id, event_type, entity_type, entity_id)
      VALUES (${organizationId}, ${actorUserId}, 'MEDIA_FOLDER_DELETED', 'media_folder', ${folderId})
    `;
  });
}

export async function moveMedia(assetId: string | string[], folderId: string | null, actorUserId: string, organizationId: string) {
  const assetIds = [...new Set(Array.isArray(assetId) ? assetId : [assetId])];
  if (!assetIds.length) throw new Error("Selecione ao menos uma mídia");
  return getSqlClient().begin(async (sql) => {
    if (folderId) {
      const folder = await sql`SELECT id FROM media_folders WHERE organization_id = ${organizationId} AND id = ${folderId}`;
      if (!folder.length) throw new Error("Pasta de mídia não encontrada");
    }
    const assets = await sql<Array<{ id: string; folder_id: string | null }>>`
      SELECT id, folder_id FROM media_assets
      WHERE organization_id = ${organizationId} AND id IN ${sql(assetIds)} AND deleted_at IS NULL
      ORDER BY id
      FOR UPDATE
    `;
    if (assets.length !== assetIds.length) throw new Error("Mídia não encontrada");
    const changedIds = assets.filter((asset) => asset.folder_id !== folderId).map((asset) => asset.id);
    if (changedIds.length) {
      const [loop] = await sql<Array<{ name: string }>>`
        SELECT loop.name FROM loop_media selected
        JOIN loops loop ON loop.organization_id = selected.organization_id AND loop.id = selected.loop_id
        WHERE selected.organization_id = ${organizationId} AND selected.media_asset_id IN ${sql(changedIds)}
        ORDER BY loop.created_at LIMIT 1
      `;
      if (loop) throw new Error(`A mídia é usada pelo loop "${loop.name}" e não pode ser movida`);
    }
    const moved = await sql`
      UPDATE media_assets SET folder_id = ${folderId}, updated_at = now()
      WHERE organization_id = ${organizationId} AND id IN ${sql(assetIds)} AND deleted_at IS NULL RETURNING id
    `;
    await sql`
      INSERT INTO audit_logs (organization_id, actor_user_id, event_type, entity_type, entity_id, metadata_json)
      SELECT organization_id, ${actorUserId}, 'MEDIA_MOVED', 'media_asset', id,
        ${JSON.stringify({ folderId })}::jsonb
      FROM media_assets WHERE organization_id = ${organizationId} AND id IN ${sql(assetIds)}
    `;
    return moved.length;
  });
}

export async function deleteMedia(assetId: string | string[], actorUserId: string, organizationId: string) {
  const assetIds = [...new Set(Array.isArray(assetId) ? assetId : [assetId])];
  if (!assetIds.length) throw new Error("Selecione ao menos uma mídia");
  const assets = await getSqlClient().begin(async (sql) => {
    const assets = await sql<Array<{ id: string; storage_key: string; storage_provider: "LOCAL" | "S3" }>>`
      SELECT id, storage_key, storage_provider
      FROM media_assets
      WHERE organization_id = ${organizationId} AND id IN ${sql(assetIds)} AND deleted_at IS NULL
      ORDER BY id
      FOR UPDATE
    `;
    if (assets.length !== assetIds.length) throw new Error("Mídia não encontrada");
    const [usage] = await sql<Array<{ campaign_count: number; loop_count: number; schedule_count: number }>>`
      SELECT
        (SELECT count(*)::int FROM campaign_media WHERE organization_id = ${organizationId} AND media_asset_id IN ${sql(assetIds)}) AS campaign_count,
        (SELECT count(*)::int FROM loop_media WHERE organization_id = ${organizationId} AND media_asset_id IN ${sql(assetIds)}) AS loop_count,
        (SELECT count(*)::int FROM schedule_media WHERE organization_id = ${organizationId} AND media_asset_id IN ${sql(assetIds)}) AS schedule_count
    `;
    if (usage.loop_count > 0) throw new Error("Mídia usada por loop não pode ser excluída");
    if (usage.schedule_count > 0) throw new Error("Mídia usada por escala não pode ser excluída");
    if (usage.campaign_count > 0) throw new Error("Mídia usada por campanha não pode ser excluída");

    await sql`
      UPDATE media_assets SET processing_status = 'DELETED', deleted_at = now(), updated_at = now()
      WHERE organization_id = ${organizationId} AND id IN ${sql(assetIds)}
    `;
    await sql`
      INSERT INTO audit_logs (organization_id, actor_user_id, event_type, entity_type, entity_id)
      SELECT organization_id, ${actorUserId}, 'MEDIA_DELETED', 'media_asset', id
      FROM media_assets WHERE organization_id = ${organizationId} AND id IN ${sql(assetIds)}
    `;
    return assets;
  });
  for (const asset of assets) {
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
  return assets.length;
}
