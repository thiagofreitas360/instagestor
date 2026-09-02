import { access } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { FFPROBE_LIMITS, inspectVideo, runFfprobe } from "@/server/media-constraints";

const validProbe = JSON.stringify({
  format: { duration: "30.5", bit_rate: "5000000" },
  streams: [
    {
      codec_type: "video",
      codec_name: "h264",
      width: 1080,
      height: 1920,
      avg_frame_rate: "30/1",
      pix_fmt: "yuv420p",
      field_order: "progressive",
    },
    { codec_type: "audio", codec_name: "aac", sample_rate: "48000", channels: 2 },
  ],
});

describe("ffprobe hardening", () => {
  it("executa sem shell, limita tempo/saída e usa somente o arquivo explícito", async () => {
    const execute = vi.fn((file, args, options, callback) => {
      callback(null, validProbe, "");
      return undefined;
    });

    await expect(runFfprobe("C:\\safe\\video.mp4", execute)).resolves.toBe(validProbe);

    expect(execute).toHaveBeenCalledOnce();
    const [file, args, options] = execute.mock.calls[0]!;
    expect(file).toBe("ffprobe");
    expect(args).not.toContain("-nostdin");
    expect(args.at(-1)).toBe("C:\\safe\\video.mp4");
    expect(options).toMatchObject({
      encoding: "utf8",
      timeout: FFPROBE_LIMITS.timeoutMs,
      maxBuffer: FFPROBE_LIMITS.maxBufferBytes,
      killSignal: "SIGKILL",
      windowsHide: true,
      shell: false,
    });
  });

  it("não devolve a saída técnica do ffprobe ao usuário", async () => {
    const execute = vi.fn((file, args, options, callback) => {
      callback(new Error("Command failed: ffprobe -- configuração interna extensa"), "", "");
      return undefined;
    });

    const result = runFfprobe("C:\\safe\\video.mp4", execute);
    await expect(result).rejects.toThrow("Não foi possível analisar o vídeo enviado");
    await expect(result).rejects.not.toThrow("configuração interna extensa");
  });

  it("propaga timeout do processo e sempre remove o arquivo temporário", async () => {
    let temporaryPath = "";
    const timeout = Object.assign(new Error("ffprobe timeout"), { killed: true, signal: "SIGKILL" });
    const probe = vi.fn(async (path: string) => {
      temporaryPath = path;
      throw timeout;
    });

    await expect(inspectVideo(Buffer.from("video"), ".mov", probe)).rejects.toBe(timeout);
    await expect(access(temporaryPath)).rejects.toThrow();
  });

  it("interpreta a saída validada e remove o temporário no sucesso", async () => {
    let temporaryPath = "";
    const probe = vi.fn(async (path: string) => {
      temporaryPath = path;
      return validProbe;
    });

    await expect(inspectVideo(Buffer.from("video"), ".mp4", probe)).resolves.toEqual({
      width: 1080,
      height: 1920,
      durationSeconds: 30.5,
    });
    await expect(access(temporaryPath)).rejects.toThrow();
  });
});
