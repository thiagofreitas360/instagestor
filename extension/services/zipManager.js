const ZipManager = (() => {


  // ── Limpeza de metadados do MP4 ─────────────────────────────────────────
  // Neutraliza as caixas de metadado (udta/meta/uuid/Xtra) renomeando pra 'free'
  // e zerando o conteúdo, E zera os dois nomes que sobreviviam a isso e apareciam
  // no ffprobe do arquivo baixado (medido em 2026-09-10, em 3 vídeos reais):
  //     handler_name = VideoHandler / SoundHandler   (caixa hdlr, a partir de +32)
  //     encoder      = AVC Coding                    (compressorname da avc1, +50)
  // Nenhum byte muda de posição e nenhuma caixa muda de tamanho → offsets
  // intactos, MP4 100% válido, sem re-encode. Verificado: o vídeo e o áudio
  // decodificam com md5 IDÊNTICO ao original depois da limpeza.
  function cleanMp4Metadata(bytes) {
    try {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const KILL = new Set(['udta', 'meta', 'uuid', 'Xtra']);
      const CONTAINERS = new Set(['moov', 'trak', 'edts', 'mdia', 'minf', 'dinf', 'stbl', 'moof', 'traf', 'mvex']);
      // Só entrada de amostra de VÍDEO tem compressorname. A de áudio (mp4a) tem
      // outro leiaute e escrever no byte 50 dela corromperia o esds.
      const VISUAIS = new Set(['avc1', 'avc3', 'hev1', 'hvc1', 'hvc2', 'mp4v', 'av01', 'vp08', 'vp09', 'encv', 'dvav', 'dva1']);
      const type4 = (off) => String.fromCharCode(bytes[off], bytes[off + 1], bytes[off + 2], bytes[off + 3]);

      function walk(start, end, depth) {
        let off = start;
        while (off + 8 <= end) {
          let size = view.getUint32(off);
          const type = type4(off + 4);
          let header = 8;
          if (size === 1) {
            if (off + 16 > end) break;
            size = view.getUint32(off + 8) * 4294967296 + view.getUint32(off + 12);
            header = 16;
          } else if (size === 0) {
            size = end - off;
          }
          if (size < header || off + size > end) break;
          if (KILL.has(type)) {
            bytes[off + 4] = 0x66; bytes[off + 5] = 0x72; bytes[off + 6] = 0x65; bytes[off + 7] = 0x65;
            bytes.fill(0, off + header, off + size);
          } else if (type === 'hdlr') {
            // hdlr: 32 bytes de cabeçalho/campos e daí o nome ("VideoHandler",
            // "SoundHandler"), terminado em \0.
            if (size > 32) bytes.fill(0, off + 32, off + size);
          } else if (VISUAIS.has(type) && size >= 86) {
            // VisualSampleEntry: compressorname ("AVC Coding") é um Pascal string
            // de 32 bytes começando em +50.
            if (bytes[off + 50] <= 31) bytes.fill(0, off + 50, off + 82);
          } else if (type === 'stsd') {
            // stsd: as entradas começam em +16 e são caixas normais.
            if (size > 16 && depth < 8) walk(off + 16, off + size, depth + 1);
          } else if (CONTAINERS.has(type) && depth < 8) {
            walk(off + header, off + size, depth + 1);
          }
          off += size;
        }
      }
      walk(0, bytes.byteLength, 0);
    } catch (e) { /* limpeza nunca pode quebrar o vídeo */ }
    return bytes;
  }

  // ── Limpeza de metadados de imagens JPEG ─────────────────────────────────
  // Remove com segurança segmentos EXIF (APP1 - 0xE1), IPTC (APP13 - 0xED) e
  // comentários (COM - 0xFE), mantendo apenas os dados de imagem puros.
  function cleanJpegMetadata(bytes) {
    try {
      if (bytes.length < 4 || bytes[0] !== 0xFF || bytes[1] !== 0xD8) return bytes;
      const chunks = [new Uint8Array([0xFF, 0xD8])];
      let pos = 2;
      const len = bytes.length;
      while (pos + 4 <= len) {
        if (bytes[pos] !== 0xFF) break;
        const marker = bytes[pos + 1];
        if (marker === 0xDA || marker === 0xD9) {
          chunks.push(bytes.subarray(pos));
          break;
        }
        if (marker === 0x00 || (marker >= 0xD0 && marker <= 0xD7)) {
          chunks.push(bytes.subarray(pos, pos + 2));
          pos += 2;
          continue;
        }
        const segLen = (bytes[pos + 2] << 8) | bytes[pos + 3];
        if (segLen < 2 || pos + 2 + segLen > len) break;
        // Pula APP1 (Exif/XMP 0xE1), APP13 (IPTC 0xED) e COM (0xFE)
        if (marker === 0xE1 || marker === 0xED || marker === 0xFE) {
          pos += 2 + segLen;
          continue;
        }
        chunks.push(bytes.subarray(pos, pos + 2 + segLen));
        pos += 2 + segLen;
      }
      let total = 0;
      for (const c of chunks) total += c.length;
      const out = new Uint8Array(total);
      let offset = 0;
      for (const c of chunks) {
        out.set(c, offset);
        offset += c.length;
      }
      return out;
    } catch (e) {
      return bytes;
    }
  }

  // JSZip is loaded from CDN via popup.html script tag — see libs/jszip.min.js
  async function createZip(files, username, onProgress, folderName = 'midias') {
    if (typeof JSZip === 'undefined') throw new Error(afyT('zipLoad'));

    Logger.info(afyT('logZipStart'));
    const zip = new JSZip();
    const folder = zip.folder(folderName);

    // Add blobs in chunks to avoid memory spikes (limpando metadados de cada arquivo)
    const CHUNK = 10;
    const chunks = Helpers.chunkArray(files, CHUNK);
    let added = 0;

    for (const chunk of chunks) {
      for (const { blob, filename } of chunk) {
        let bytes = new Uint8Array(await blob.arrayBuffer());
        if (filename.toLowerCase().endsWith('.mp4')) {
          bytes = cleanMp4Metadata(bytes);
        } else if (filename.toLowerCase().endsWith('.jpg') || filename.toLowerCase().endsWith('.jpeg')) {
          bytes = cleanJpegMetadata(bytes);
        }
        folder.file(filename, bytes, { binary: true });
        added++;
        if (onProgress) onProgress(Math.round((added / files.length) * 50)); // 0-50%
      }
      await Helpers.sleep(10); // yield to browser
    }

    Logger.info(afyT('logZipGen'));
    const zipBlob = await zip.generateAsync(
      {
        type: 'blob',
        compression: 'STORE',
      },
      meta => {
        if (onProgress) onProgress(50 + Math.round(meta.percent / 2)); // 50-100%
      }
    );

    Logger.success(afyT('logZipOk', { s: Helpers.formatBytes(zipBlob.size) }));
    return zipBlob;
  }

  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    Logger.success(afyT('logDlTrig', { f: filename }));
  }

  return { createZip, triggerDownload };
})();
