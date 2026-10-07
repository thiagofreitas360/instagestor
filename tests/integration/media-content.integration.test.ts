import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/media/[id]/content/route";
import { getSqlClient } from "@/db/client";
import { resetEnvForTests } from "@/lib/env";
import { getStorageProvider, newStorageKey } from "@/providers/storage";
import { createMediaFolder, deleteMedia, deleteMediaFolder, moveMedia, renameMediaFolder } from "@/server/media";
import { createCampaign, createOrganization, createUser, TEST_ORGANIZATION_ID } from "./helpers";

let storageRoot: string;

beforeEach(async () => {
  storageRoot = await mkdtemp(path.join(tmpdir(), "instagestor-media-test-"));
  process.env.LOCAL_STORAGE_PATH = storageRoot;
  resetEnvForTests();
});

afterEach(async () => {
  await rm(storageRoot, { recursive: true, force: true });
  delete process.env.LOCAL_STORAGE_PATH;
  resetEnvForTests();
});

describe("download temporário de mídia local", () => {
  it("transmite somente o intervalo solicitado e rejeita Range inválido", async () => {
    const id = randomUUID();
    await createOrganization(TEST_ORGANIZATION_ID, "InstaGestor Teste", "instagestor-teste");
    const key = newStorageKey(TEST_ORGANIZATION_ID);
    const bytes = Buffer.from("0123456789", "utf8");
    const storage = getStorageProvider("LOCAL");
    await storage.put(key, bytes, "image/jpeg");
    await getSqlClient()`
      INSERT INTO media_assets (
        id, organization_id, original_filename, storage_provider, storage_key, mime_type, media_kind,
        size_bytes, checksum_sha256, width, height, processing_status
      ) VALUES (
        ${id}, ${TEST_ORGANIZATION_ID}, 'range.jpg', 'LOCAL', ${key}, 'image/jpeg', 'IMAGE', ${bytes.length},
        ${"b".repeat(64)}, 1, 1, 'READY'
      )
    `;
    const signedUrl = await storage.getPublishableUrl({ id, organizationId: TEST_ORGANIZATION_ID, storageKey: key });

    const partial = await GET(
      new Request(signedUrl, { headers: { range: "bytes=2-5" } }),
      { params: Promise.resolve({ id }) },
    );
    expect(partial.status).toBe(206);
    expect(partial.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(partial.headers.get("content-length")).toBe("4");
    expect(Buffer.from(await partial.arrayBuffer()).toString("utf8")).toBe("2345");

    const invalid = await GET(
      new Request(signedUrl, { headers: { range: "bytes=20-30" } }),
      { params: Promise.resolve({ id }) },
    );
    expect(invalid.status).toBe(416);
    expect(invalid.headers.get("content-range")).toBe("bytes */10");
  });
});

describe("pastas de mídia", () => {
  it("cria, renomeia e exclui a pasta sem excluir suas mídias", async () => {
    const sql = getSqlClient();
    const actorUserId = await createUser("media-folder@example.test");
    const folderId = await createMediaFolder("Fitness", actorUserId, TEST_ORGANIZATION_ID);
    const [asset] = await sql<Array<{ id: string }>>`
      INSERT INTO media_assets (
        organization_id, original_filename, storage_provider, storage_key, mime_type, media_kind,
        size_bytes, checksum_sha256, width, height, folder_id, processing_status
      ) VALUES (
        ${TEST_ORGANIZATION_ID}, 'fitness.jpg', 'LOCAL', 'folder/fitness.jpg', 'image/jpeg', 'IMAGE',
        1024, ${"f".repeat(64)}, 1080, 1080, ${folderId}, 'READY'
      ) RETURNING id
    `;

    await renameMediaFolder(folderId, "Fitness Brasil", actorUserId, TEST_ORGANIZATION_ID);
    await deleteMediaFolder(folderId, actorUserId, TEST_ORGANIZATION_ID);

    const [persisted] = await sql<Array<{ folder_id: string | null; deleted_at: Date | null }>>`
      SELECT folder_id, deleted_at FROM media_assets WHERE id = ${asset.id}
    `;
    expect(persisted).toEqual({ folder_id: null, deleted_at: null });
  });
});

async function seedAssets(count: number, organizationId = TEST_ORGANIZATION_ID) {
  await createOrganization(organizationId);
  const sql = getSqlClient();
  return sql<Array<{ id: string; storage_key: string }>>`
    INSERT INTO media_assets ${sql(Array.from({ length: count }, (_, index) => ({
      organization_id: organizationId,
      original_filename: `video-${index}.mp4`,
      storage_provider: "LOCAL",
      storage_key: newStorageKey(organizationId),
      mime_type: "video/mp4",
      media_kind: "VIDEO",
      size_bytes: 1024,
      checksum_sha256: "a".repeat(64),
      processing_status: "READY",
    })))} RETURNING id, storage_key
  `;
}

describe("ações em mídias", () => {
  it("move uma mídia para uma pasta nova e de volta para sem pasta, registrando ambos os destinos", async () => {
    const actor = await createUser();
    const folder = await createMediaFolder("Nova pasta", actor, TEST_ORGANIZATION_ID);
    const [asset] = await seedAssets(1);
    const sql = getSqlClient();

    await expect(moveMedia(asset.id, folder, actor, TEST_ORGANIZATION_ID)).resolves.toBe(1);
    const [moved] = await sql`SELECT folder_id FROM media_assets WHERE id = ${asset.id}`;
    expect(moved.folder_id).toBe(folder);
    await expect(moveMedia(asset.id, null, actor, TEST_ORGANIZATION_ID)).resolves.toBe(1);
    const logs = await sql`SELECT metadata_json FROM audit_logs WHERE event_type = 'MEDIA_MOVED' ORDER BY created_at`;
    expect(logs.map((entry) => entry.metadata_json)).toEqual([{ folderId: folder }, { folderId: null }]);
    const [unfiled] = await sql`SELECT folder_id FROM media_assets WHERE id = ${asset.id}`;
    expect(unfiled.folder_id).toBeNull();
  });

  it("move apenas as mídias selecionadas, sem duplicar IDs ou registros de auditoria", async () => {
    const actor = await createUser();
    const folder = await createMediaFolder("Lote", actor, TEST_ORGANIZATION_ID);
    const [first, second, unselected] = await seedAssets(3);
    const ids = [first.id, second.id, first.id];
    const sql = getSqlClient();

    await expect(moveMedia(ids, folder, actor, TEST_ORGANIZATION_ID)).resolves.toBe(2);
    const selected = await sql`SELECT folder_id FROM media_assets WHERE id IN ${sql([first.id, second.id])}`;
    expect(selected.map((asset) => asset.folder_id)).toEqual([folder, folder]);
    const [untouched] = await sql`SELECT folder_id FROM media_assets WHERE id = ${unselected.id}`;
    expect(untouched.folder_id).toBeNull();
    const logs = await sql`SELECT entity_id FROM audit_logs WHERE event_type = 'MEDIA_MOVED'`;
    expect(logs).toHaveLength(2);
    await expect(moveMedia(ids, null, actor, TEST_ORGANIZATION_ID)).resolves.toBe(2);
  });

  it("rejeita destinos inexistentes ou de outro cliente sem alterar mídias", async () => {
    const actor = await createUser();
    const [asset] = await seedAssets(1);
    const otherOrganization = await createOrganization();
    const otherFolder = await createMediaFolder("Outra pasta", actor, otherOrganization);
    for (const destination of [randomUUID(), otherFolder]) {
      await expect(moveMedia(asset.id, destination, actor, TEST_ORGANIZATION_ID)).rejects.toThrow("Pasta de mídia não encontrada");
    }
    const [persisted] = await getSqlClient()`SELECT folder_id FROM media_assets WHERE id = ${asset.id}`;
    expect(persisted.folder_id).toBeNull();
  });

  it("rejeita o lote inteiro se contiver uma mídia inexistente ou de outro cliente", async () => {
    const actor = await createUser();
    const folder = await createMediaFolder("Destino", actor, TEST_ORGANIZATION_ID);
    const [asset] = await seedAssets(1);
    const [foreign] = await seedAssets(1, await createOrganization());
    for (const invalidId of [randomUUID(), foreign.id]) {
      await expect(moveMedia([asset.id, invalidId], folder, actor, TEST_ORGANIZATION_ID)).rejects.toThrow("Mídia não encontrada");
      await expect(deleteMedia([asset.id, invalidId], actor, TEST_ORGANIZATION_ID)).rejects.toThrow("Mídia não encontrada");
    }
    const [persisted] = await getSqlClient()`SELECT folder_id, deleted_at FROM media_assets WHERE id = ${asset.id}`;
    expect(persisted).toEqual({ folder_id: null, deleted_at: null });
  });

  it("exclui somente as selecionadas e remove os objetos locais após confirmar a transação", async () => {
    const actor = await createUser();
    const assets = await seedAssets(3);
    for (const asset of assets) await getStorageProvider("LOCAL").put(asset.storage_key, Buffer.from("video"), "video/mp4");
    const sql = getSqlClient();

    await expect(deleteMedia([assets[0].id, assets[1].id, assets[0].id], actor, TEST_ORGANIZATION_ID)).resolves.toBe(2);
    const deleted = await sql`SELECT processing_status, deleted_at FROM media_assets WHERE id IN ${sql(assets.slice(0, 2).map((asset) => asset.id))}`;
    expect(deleted.every((asset) => asset.processing_status === "DELETED" && asset.deleted_at)).toBe(true);
    expect(assets.map((asset) => existsSync(path.join(storageRoot, asset.storage_key)))).toEqual([false, false, true]);
    const [untouched] = await sql`SELECT deleted_at FROM media_assets WHERE id = ${assets[2].id}`;
    expect(untouched.deleted_at).toBeNull();
    expect(await sql`SELECT id FROM audit_logs WHERE event_type = 'MEDIA_DELETED'`).toHaveLength(2);
    await expect(deleteMedia([assets[2].id, assets[0].id], actor, TEST_ORGANIZATION_ID)).rejects.toThrow("Mídia não encontrada");
    expect(existsSync(path.join(storageRoot, assets[2].storage_key))).toBe(true);
  });

  it.each(["campanha", "loop", "escala"])("não exclui nenhuma mídia do lote quando uma é usada por %s", async (usage) => {
    const actor = await createUser();
    const [free, used] = await seedAssets(2);
    const campaignId = await createCampaign(actor);
    const sql = getSqlClient();
    if (usage === "campanha") {
      await sql`INSERT INTO campaign_media (organization_id, campaign_id, media_asset_id, position)
        VALUES (${TEST_ORGANIZATION_ID}, ${campaignId}, ${used.id}, 0)`;
    } else if (usage === "loop") {
      const [loop] = await sql`INSERT INTO loops (organization_id, campaign_id, name, created_by)
        VALUES (${TEST_ORGANIZATION_ID}, ${campaignId}, 'Loop protegido', ${actor}) RETURNING id`;
      await sql`INSERT INTO loop_media (organization_id, loop_id, media_asset_id, position)
        VALUES (${TEST_ORGANIZATION_ID}, ${loop.id}, ${used.id}, 0)`;
    } else {
      const [schedule] = await sql`INSERT INTO schedules (
          organization_id, campaign_id, name, created_by, start_date, end_date, times, days_of_week, media_type
        ) VALUES (${TEST_ORGANIZATION_ID}, ${campaignId}, 'Escala protegida', ${actor}, current_date, current_date,
          ARRAY['12:00'], ARRAY[1], 'REELS') RETURNING id`;
      await sql`INSERT INTO schedule_media (organization_id, schedule_id, media_asset_id, position)
        VALUES (${TEST_ORGANIZATION_ID}, ${schedule.id}, ${used.id}, 0)`;
    }
    for (const asset of [free, used]) await getStorageProvider("LOCAL").put(asset.storage_key, Buffer.from("video"), "video/mp4");

    await expect(deleteMedia([free.id, used.id], actor, TEST_ORGANIZATION_ID)).rejects.toThrow(`Mídia usada por ${usage} não pode ser excluída`);
    const persisted = await sql`SELECT deleted_at FROM media_assets`;
    expect(persisted.every((asset) => asset.deleted_at === null)).toBe(true);
    expect([free, used].every((asset) => existsSync(path.join(storageRoot, asset.storage_key)))).toBe(true);
    expect(await sql`SELECT id FROM audit_logs WHERE event_type = 'MEDIA_DELETED'`).toHaveLength(0);
  });

  it("bloqueia todo o movimento se uma mídia está em loop, mas permite manter a pasta atual", async () => {
    const actor = await createUser();
    const folder = await createMediaFolder("Destino", actor, TEST_ORGANIZATION_ID);
    const [free, used] = await seedAssets(2);
    const campaignId = await createCampaign(actor);
    const sql = getSqlClient();
    const [loop] = await sql`INSERT INTO loops (organization_id, campaign_id, name, created_by)
      VALUES (${TEST_ORGANIZATION_ID}, ${campaignId}, 'Loop protegido', ${actor}) RETURNING id`;
    await sql`INSERT INTO loop_media (organization_id, loop_id, media_asset_id, position)
      VALUES (${TEST_ORGANIZATION_ID}, ${loop.id}, ${used.id}, 0)`;

    await expect(moveMedia([free.id, used.id], folder, actor, TEST_ORGANIZATION_ID)).rejects.toThrow('A mídia é usada pelo loop "Loop protegido" e não pode ser movida');
    expect((await sql`SELECT folder_id FROM media_assets`).every((asset) => asset.folder_id === null)).toBe(true);
    expect(await sql`SELECT id FROM audit_logs WHERE event_type = 'MEDIA_MOVED'`).toHaveLength(0);
    await expect(moveMedia([free.id, used.id], null, actor, TEST_ORGANIZATION_ID)).resolves.toBe(2);
  });

  it("rejeita uma seleção vazia", async () => {
    const actor = await createUser();
    await expect(moveMedia([], null, actor, TEST_ORGANIZATION_ID)).rejects.toThrow("Selecione ao menos uma mídia");
    await expect(deleteMedia([], actor, TEST_ORGANIZATION_ID)).rejects.toThrow("Selecione ao menos uma mídia");
  });
});
