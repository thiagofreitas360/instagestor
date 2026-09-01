import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { GetObjectCommand, PutObjectCommand, S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getEnv } from "@/lib/env";
import { sign } from "@/lib/crypto";

export type StoredAsset = { id: string; storageKey: string };

export interface StorageProvider {
  readonly name: "LOCAL" | "S3";
  put(key: string, data: Buffer, mimeType: string): Promise<void>;
  delete(key: string): Promise<void>;
  getPublishableUrl(asset: StoredAsset): Promise<string>;
  open(key: string, range?: { start: number; end: number }): Promise<ReadableStream<Uint8Array>>;
}

function safeLocalPath(key: string) {
  const root = path.resolve(getEnv().LOCAL_STORAGE_PATH);
  const target = path.resolve(root, key);
  if (!target.startsWith(`${root}${path.sep}`)) throw new Error("Storage key inválida");
  return target;
}

class LocalStorageProvider implements StorageProvider {
  readonly name = "LOCAL" as const;

  async put(key: string, data: Buffer) {
    const target = safeLocalPath(key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data, { flag: "wx" });
  }

  async delete(key: string) {
    await rm(safeLocalPath(key), { force: true });
  }

  async getPublishableUrl(asset: StoredAsset) {
    return getPrivateMediaUrl(asset.id);
  }

  async open(key: string, range?: { start: number; end: number }) {
    const target = safeLocalPath(key);
    const metadata = await stat(target);
    if (!metadata.isFile()) throw new Error("Storage key não aponta para um arquivo");
    return Readable.toWeb(createReadStream(target, range)) as ReadableStream<Uint8Array>;
  }
}

class S3CompatibleStorageProvider implements StorageProvider {
  readonly name = "S3" as const;
  private readonly env = getEnv();
  private readonly clientOptions = {
    region: this.env.S3_REGION,
    forcePathStyle: this.env.S3_FORCE_PATH_STYLE,
    credentials: { accessKeyId: this.env.S3_ACCESS_KEY_ID!, secretAccessKey: this.env.S3_SECRET_ACCESS_KEY! },
  };
  private readonly client = new S3Client({ ...this.clientOptions, endpoint: this.env.S3_ENDPOINT });
  private readonly publicClient = new S3Client({
    ...this.clientOptions,
    endpoint: this.env.S3_PUBLIC_ENDPOINT ?? this.env.S3_ENDPOINT,
  });

  async put(key: string, data: Buffer, mimeType: string) {
    await this.client.send(new PutObjectCommand({ Bucket: this.env.S3_BUCKET!, Key: key, Body: data, ContentType: mimeType }));
  }

  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.env.S3_BUCKET!, Key: key }));
  }

  getPublishableUrl(asset: StoredAsset) {
    return getSignedUrl(this.publicClient, new GetObjectCommand({ Bucket: this.env.S3_BUCKET!, Key: asset.storageKey }), {
      expiresIn: this.env.PUBLISHABLE_URL_TTL_SECONDS,
    });
  }

  async open(key: string, range?: { start: number; end: number }) {
    const response = await this.client.send(new GetObjectCommand({
      Bucket: this.env.S3_BUCKET!,
      Key: key,
      ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}),
    }));
    if (!response.Body) throw new Error("Objeto sem conteúdo no storage");
    return response.Body.transformToWebStream() as ReadableStream<Uint8Array>;
  }
}

const providers = new Map<"LOCAL" | "S3", StorageProvider>();

export function getStorageProvider(name?: "LOCAL" | "S3") {
  const selected = name ?? (getEnv().STORAGE_PROVIDER === "s3" ? "S3" : "LOCAL");
  if (!providers.has(selected)) {
    providers.set(selected, selected === "S3" ? new S3CompatibleStorageProvider() : new LocalStorageProvider());
  }
  return providers.get(selected)!;
}

export function newStorageKey() {
  return `media/${randomUUID()}`;
}

export function getPrivateMediaUrl(id: string) {
  const expires = Math.floor(Date.now() / 1000) + getEnv().PUBLISHABLE_URL_TTL_SECONDS;
  const signature = sign(`${id}.${expires}`);
  return `${getEnv().APP_URL}/api/media/${id}/content?expires=${expires}&signature=${signature}`;
}
