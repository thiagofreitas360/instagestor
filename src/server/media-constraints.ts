import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";
import { getEnv } from "@/lib/env";

export const FFPROBE_LIMITS = {
  timeoutMs: 15_000,
  maxBufferBytes: 1_048_576,
} as const;

type FfprobeExecutor = (
  file: string,
  args: string[],
  options: {
    encoding: "utf8";
    timeout: number;
    maxBuffer: number;
    killSignal: "SIGKILL";
    windowsHide: boolean;
    shell: false;
  },
  callback: (error: Error | null, stdout: string, stderr: string) => void,
) => unknown;

export const MEDIA_CONSTRAINTS = {
  IMAGE: { mimeTypes: ["image/jpeg"], maxBytes: 8_000_000, minWidth: 320, maxWidth: 1_440 },
  VIDEO: { mimeTypes: ["video/mp4", "video/quicktime"], maxBytes: 300_000_000, minDuration: 3, maxDuration: 900 },
} as const;

export type MediaMetadata = {
  kind: "IMAGE" | "VIDEO";
  mimeType: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
};

function extensionMatches(filename: string, mimeType: string) {
  const extension = path.extname(filename).toLowerCase();
  return mimeType === "image/jpeg"
    ? [".jpg", ".jpeg"].includes(extension)
    : mimeType === "video/mp4"
      ? extension === ".mp4"
      : mimeType === "video/quicktime" && extension === ".mov";
}

export function runFfprobe(temp: string, execute: FfprobeExecutor = execFile as unknown as FfprobeExecutor) {
  return new Promise<string>((resolve, reject) => {
    execute(
      "ffprobe",
      [
        "-nostdin",
        "-v",
        "error",
        "-show_entries",
        "format=duration,bit_rate:stream=codec_type,codec_name,width,height,avg_frame_rate,pix_fmt,field_order,sample_rate,channels",
        "-of",
        "json",
        temp,
      ],
      {
        encoding: "utf8",
        timeout: FFPROBE_LIMITS.timeoutMs,
        maxBuffer: FFPROBE_LIMITS.maxBufferBytes,
        killSignal: "SIGKILL",
        windowsHide: true,
        shell: false,
      },
      (error, output) => (error ? reject(error) : resolve(output)),
    );
  });
}

export async function inspectVideo(
  data: Buffer,
  extension: string,
  probeFile: (temp: string) => Promise<string> = runFfprobe,
) {
  const temp = path.join(os.tmpdir(), `instagestor-${randomUUID()}${extension}`);
  await writeFile(temp, data, { flag: "wx" });
  try {
    const stdout = await probeFile(temp);
    const probe = JSON.parse(stdout) as {
      format?: { duration?: string; bit_rate?: string };
      streams?: Array<{
        codec_type?: string;
        codec_name?: string;
        width?: number;
        height?: number;
        avg_frame_rate?: string;
        pix_fmt?: string;
        field_order?: string;
        sample_rate?: string;
        channels?: number;
      }>;
    };
    const video = probe.streams?.find((stream) => stream.codec_type === "video");
    const audio = probe.streams?.find((stream) => stream.codec_type === "audio");
    if (!video || !["h264", "hevc"].includes(video.codec_name ?? "")) throw new Error("Vídeo deve usar codec H.264 ou HEVC");
    if (audio && audio.codec_name !== "aac") throw new Error("Áudio do vídeo deve usar codec AAC");
    if ((video.width ?? 0) > 1920) throw new Error("Vídeo excede 1920 px de largura");
    if (video.pix_fmt && !video.pix_fmt.includes("420")) throw new Error("Vídeo deve usar chroma subsampling 4:2:0");
    if (video.field_order && !["progressive", "unknown"].includes(video.field_order)) throw new Error("Vídeo deve usar progressive scan");
    const [fpsNumerator = "0", fpsDenominator = "1"] = (video.avg_frame_rate ?? "0/1").split("/");
    const fps = Number(fpsNumerator) / Number(fpsDenominator);
    if (!Number.isFinite(fps) || fps < 23 || fps > 60) throw new Error("Vídeo deve ter entre 23 e 60 FPS");
    if (Number(probe.format?.bit_rate ?? 0) > 25_000_000) throw new Error("Bitrate de vídeo excede 25 Mbps");
    if (audio && (Number(audio.sample_rate ?? 0) > 48_000 || (audio.channels ?? 0) > 2)) {
      throw new Error("Áudio deve ter até 48 kHz e dois canais");
    }
    return { width: video.width, height: video.height, durationSeconds: Number(probe.format?.duration) };
  } finally {
    await rm(temp, { force: true });
  }
}

export async function validateMedia(filename: string, declaredMime: string, data: Buffer): Promise<MediaMetadata> {
  if (!data.length || data.length > getEnv().UPLOAD_MAX_BYTES) throw new Error("Arquivo vazio ou maior que o limite de upload");
  const detected = await fileTypeFromBuffer(data);
  if (!detected || detected.mime !== declaredMime || !extensionMatches(filename, detected.mime)) {
    throw new Error("MIME, conteúdo e extensão do arquivo não correspondem");
  }

  if (MEDIA_CONSTRAINTS.IMAGE.mimeTypes.includes(detected.mime as "image/jpeg")) {
    if (data.length > MEDIA_CONSTRAINTS.IMAGE.maxBytes) throw new Error("Imagem excede 8 MB");
    const metadata = await sharp(data, { failOn: "error" }).metadata();
    if (!metadata.width || !metadata.height) throw new Error("Dimensões da imagem não identificadas");
    if (metadata.width < MEDIA_CONSTRAINTS.IMAGE.minWidth || metadata.width > MEDIA_CONSTRAINTS.IMAGE.maxWidth) {
      throw new Error("Largura da imagem deve ficar entre 320 e 1440 px");
    }
    if (metadata.space && metadata.space !== "srgb") throw new Error("Imagem deve usar o espaço de cores sRGB");
    return { kind: "IMAGE", mimeType: detected.mime, width: metadata.width, height: metadata.height };
  }

  if (MEDIA_CONSTRAINTS.VIDEO.mimeTypes.includes(detected.mime as "video/mp4" | "video/quicktime")) {
    if (data.length > MEDIA_CONSTRAINTS.VIDEO.maxBytes) throw new Error("Vídeo excede 300 MB");
    const metadata = await inspectVideo(data, path.extname(filename));
    if (!Number.isFinite(metadata.durationSeconds) || metadata.durationSeconds! < 3 || metadata.durationSeconds! > 900) {
      throw new Error("Duração do vídeo fora do limite de 3 a 900 segundos");
    }
    return { kind: "VIDEO", mimeType: detected.mime, ...metadata };
  }
  throw new Error("Formato de mídia não suportado");
}

export function validateCampaignMedia(
  type: string,
  media: Array<{
    mediaKind: "IMAGE" | "VIDEO";
    sizeBytes?: number;
    width?: number | null;
    height?: number | null;
    durationSeconds?: number | null;
  }>,
) {
  const requiredKind = type.endsWith("IMAGE") ? "IMAGE" : type === "CAROUSEL" ? null : "VIDEO";
  if (requiredKind && (media.length !== 1 || media[0]?.mediaKind !== requiredKind)) {
    throw new Error(`Esta publicação exige exatamente uma mídia ${requiredKind === "IMAGE" ? "de imagem" : "de vídeo"}`);
  }
  if (type === "CAROUSEL" && (media.length < 2 || media.length > 10)) throw new Error("Carousel exige de 2 a 10 mídias");
  if (type === "FEED_IMAGE" || type === "CAROUSEL") {
    for (const asset of media.filter((item) => item.mediaKind === "IMAGE")) {
      if (!asset.width || !asset.height || asset.width < MEDIA_CONSTRAINTS.IMAGE.minWidth) {
        throw new Error("Imagem de Feed/Carousel exige largura mínima de 320 px");
      }
      const ratio = asset.width / asset.height;
      if (ratio < 0.8 || ratio > 1.91) throw new Error("Imagem de Feed/Carousel deve ficar entre 4:5 e 1.91:1");
    }
  }
  if (["REEL", "STORY_VIDEO"].includes(type)) {
    const video = media[0];
    const ratio = video?.width && video.height ? video.width / video.height : 0;
    const minimum = type === "STORY_VIDEO" ? 0.1 : 0.01;
    if (!ratio || ratio < minimum || ratio > 10) throw new Error("Proporção do vídeo fora do limite suportado");
  }
  if (type === "STORY_VIDEO") {
    const video = media[0];
    if ((video.sizeBytes ?? 0) > 100_000_000 || (video.durationSeconds ?? 0) > 60) {
      throw new Error("Story de vídeo aceita até 60 segundos e 100 MB");
    }
  }
}
