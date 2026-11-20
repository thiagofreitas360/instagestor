class DownloadManager {
  constructor({ tabId, maxConcurrent = 3, maxRetries = 3, onProgress, onItemDone, onError } = {}) {
    this.tabId = tabId;
    this.maxConcurrent = maxConcurrent;
    this.maxRetries = maxRetries;
    this.onProgress = onProgress || (() => {});
    this.onItemDone = onItemDone || (() => {});
    this.onError = onError || (() => {});

    this.queue = [];
    this.active = 0;
    this.results = new Map(); // id -> { blob, filename }
    this.paused = false;
    this.cancelled = false;
    this.completed = 0;
    this.failed = 0;
    this.total = 0;
  }

  add(item) {
    this.queue.push({ ...item, retries: 0 });
    this.total++;
  }

  async start() {
    this.paused = false;
    this.cancelled = false;
    Logger.info(afyT('logQueue', { n: this.total }));
    await this._drain();
  }

  pause() {
    this.paused = true;
    Logger.warning(afyT('logPaused'));
  }

  resume() {
    this.paused = false;
    Logger.info(afyT('logResumed'));
    this._drain();
  }

  cancel() {
    this.cancelled = true;
    this.queue = [];
    Logger.warning(afyT('logCanceled'));
  }

  async _drain() {
    while ((this.queue.length > 0 || this.active > 0) && !this.cancelled) {
      if (this.paused) {
        await Helpers.sleep(300);
        continue;
      }

      while (this.active < this.maxConcurrent && this.queue.length > 0 && !this.paused) {
        const item = this.queue.shift();
        this.active++;
        this._downloadItem(item).finally(() => {
          this.active--;
        });
      }

      await Helpers.sleep(100);
    }
  }

  // 2026-07-23: tabId da aba do Instagram — os downloads são delegados pro
  // content script rodando lá (ver DOWNLOAD_VIDEO em content.js), não mais
  // feitos direto daqui (contexto chrome-extension://, sem o Referer/
  // Origin correto que o CDN da Meta espera).
  async _downloadItem(item) {
    Logger.download(afyT('logGetting', { f: item.filename }));
    try {
      const blob = await this._fetchWithRetry(item);
      this.results.set(item.id, { blob, filename: item.filename });
      this.completed++;
      this.onItemDone(item.id, blob, 'success');
      Logger.success(afyT('logItemOk', { f: item.filename }));
    } catch (err) {
      this.failed++;
      this.onItemDone(item.id, null, 'error');
      this.onError(item, err);
      Logger.error(afyT('logFailed', { f: item.filename, m: err.message }));
    }
    this._reportProgress();
  }

  async _fetchWithRetry(item) {
    let lastErr;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const buffer = await this._fetchViaContentScript(item.videoUrl, 30000);
        return new Blob([buffer]);
      } catch (err) {
        lastErr = err;
        if (attempt < this.maxRetries) {
          Logger.warning(afyT('logRetry', { a: attempt + 1, t: this.maxRetries, f: item.filename }));
          await Helpers.sleep(1000 * (attempt + 1));
        }
      }
    }
    throw lastErr;
  }

  // Pede pro content script (rodando em instagram.com) buscar os bytes do
  // vídeo — herda cookies/Referer/Origin corretos automaticamente, sem
  // precisar (nem conseguir) simular nada daqui.
  _fetchViaContentScript(url, timeoutMs) {
    return new Promise((resolve, reject) => {
      if (!this.tabId) { reject(new Error(afyT('errNoTab'))); return; }
      const timer = setTimeout(() => reject(new Error(afyT('errDlTimeout'))), timeoutMs);
      chrome.tabs.sendMessage(this.tabId, { action: 'DOWNLOAD_VIDEO', url }, (response) => {
        clearTimeout(timer);
        if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
        if (!response) { reject(new Error(afyT('errNoCS'))); return; }
        if (!response.ok) { reject(new Error(response.error || afyT('errDlFail'))); return; }
        resolve(response.buffer);
      });
    });
  }

  _reportProgress() {
    const done = this.completed + this.failed;
    const pct = this.total > 0 ? Math.round((done / this.total) * 100) : 0;
    this.onProgress({ completed: this.completed, failed: this.failed, total: this.total, percent: pct });
  }

  getResults() {
    return this.results;
  }
}
