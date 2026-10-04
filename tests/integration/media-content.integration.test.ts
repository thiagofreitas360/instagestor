import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/media/[id]/content/route";
import { getSqlClient } from "@/db/client";
import { resetEnvForTests } from "@/lib/env";
import { getStorageProvider, newStorageKey } from "@/providers/storage";
import { createMediaFolder, deleteMediaFolder, renameMediaFolder } from "@/server/media";
import { createOrganization, createUser, TEST_ORGANIZATION_ID } from "./helpers";

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
