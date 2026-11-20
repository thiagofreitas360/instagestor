// InstaGestor Downloader — popup.js (controlador do popup da extensão).

(async () => {
  await window.afyI18nReady; // idioma do painel antes de qualquer texto
  // ── State ──
  let currentTab       = null;
  let username         = null;
  let videos           = [];
  let selected         = new Set();
  let downloadManager  = null;
  let scanning         = false;
  let downloading      = false;

  // ── DOM Refs ──
  const $ = id => document.getElementById(id);
  const statusDot       = $('statusDot');
  const profileUsername = $('profileUsername');
  const profileUrl      = $('profileUrl');
  const profileBadge    = $('profileBadge');
  const warningCard     = $('warningCard');
  const btnScan         = $('btnScan');
  const btnScanText     = $('btnScanText');
  const progressSection = $('progressSection');
  const progressFill    = $('progressFill');
  const progressLabel   = $('progressLabel');
  const progressPercent = $('progressPercent');
  const progressSub     = $('progressSub');
  const statsBar        = $('statsBar');
  const statCount       = $('statCount');
  const statSize        = $('statSize');
  const statSelected    = $('statSelected');
  const selectAllBar    = $('selectAllBar');
  const checkAll        = $('checkAll');
  const btnClearAll     = $('btnClearAll');
  const videoItems      = $('videoItems');
  const emptyState      = $('emptyState');
  const skeletonList    = $('skeletonList');
  const footerActions   = $('footerActions');
  const modeTabs        = $('modeTabs');
  const tabAll          = $('tabAll');
  const tabReels        = $('tabReels');
  const tabPhotos       = $('tabPhotos');
  const countAll        = $('countAll');
  const countReels      = $('countReels');
  const countPhotos     = $('countPhotos');
  const btnDownloadReels      = $('btnDownloadReels');
  const btnDownloadReelsText  = $('btnDownloadReelsText');
  const btnDownloadPhotos     = $('btnDownloadPhotos');
  const btnDownloadPhotosText = $('btnDownloadPhotosText');
  const btnDownloadCovers     = $('btnDownloadCovers');
  const btnDownloadCoversText = $('btnDownloadCoversText');
  const downloadInfo    = $('downloadInfo');
  const logsPanel       = $('logsPanel');
  const logsContent     = $('logsContent');
  const btnLogsToggle   = $('btnLogsToggle');
  const btnClearLogs    = $('btnClearLogs');
  let currentFilter     = 'all';

  // ── Logger UI ──
  Logger.onLog(entry => appendLog(entry));

  function appendLog({ level, message }) {
    const row = document.createElement('div');
    row.className = 'log-entry';
    row.innerHTML = `<span class="log-level ${level}">[${level.toUpperCase()}]</span><span class="log-msg">${escapeHtml(message)}</span>`;
    logsContent.appendChild(row);
    logsContent.scrollTop = logsContent.scrollHeight;
  }

  btnLogsToggle.addEventListener('click', () => {
    logsPanel.style.display = logsPanel.style.display === 'none' ? 'block' : 'none';
  });

  btnClearLogs.addEventListener('click', () => { logsContent.innerHTML = ''; });

  // ── Init: detect current tab ──
  await detectCurrentTab();

  // ── Scan button ──
  btnScan.addEventListener('click', async () => {
    if (scanning || downloading) return;
    await startScan();
  });

  // ── Mode Filter Tabs ──
  [tabAll, tabReels, tabPhotos].forEach(tab => {
    if (!tab) return;
    tab.addEventListener('click', () => {
      [tabAll, tabReels, tabPhotos].forEach(t => t?.classList.remove('active'));
      tab.classList.add('active');
      currentFilter = tab.dataset.filter || 'all';
      renderVideoList();
    });
  });

  // ── Select All ──
  checkAll.addEventListener('change', () => {
    const checked = checkAll.checked;
    const visiveis = getFilteredVideos();
    visiveis.forEach(v => {
      if (checked) selected.add(v.id);
      else selected.delete(v.id);
    });
    document.querySelectorAll('.video-item-cb').forEach(cb => cb.checked = checked);
    updateStats();
  });

  btnClearAll.addEventListener('click', () => {
    selected.clear();
    checkAll.checked = false;
    document.querySelectorAll('.video-item-cb').forEach(cb => cb.checked = false);
    updateStats();
  });

  // ── 3 Download Modes (Reels, Fotos, Capas) ──
  btnDownloadReels?.addEventListener('click', async () => {
    if (downloading) return;
    await startDownloadMode('reels');
  });

  btnDownloadPhotos?.addEventListener('click', async () => {
    if (downloading) return;
    await startDownloadMode('photos');
  });

  btnDownloadCovers?.addEventListener('click', async () => {
    if (downloading) return;
    await startDownloadMode('covers');
  });

  // ── Progress messages from content script (relayed via background) ──
  chrome.runtime.onMessage.addListener(msg => {
    if (msg.action === 'SCAN_PROGRESS') {
      if (msg.percent !== null) setProgress(msg.percent, afyT('scanning'), msg.label || '');
    }
  });

  // ──────────────────────────────────────────────────
  // FUNCTIONS
  // ──────────────────────────────────────────────────

  async function injectContentScript(tabId) {
    try {
      await new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, { action: 'PING' }, res => {
          if (chrome.runtime.lastError || !res) reject();
          else resolve();
        });
      });
    } catch {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      await Helpers.sleep(500);
    }
  }

  async function detectCurrentTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTab = tab;

    if (!tab?.url?.includes('instagram.com')) {
      warningCard.style.display = 'flex';
      setStatus('idle');
      return;
    }

    const u         = Helpers.extractUsername(tab.url);
    const isProfile = Helpers.isProfilePage(tab.url);

    if (!isProfile || !u) {
      profileUsername.textContent = afyT('goToProfile');
      profileUrl.textContent      = afyT('exProfile');
      warningCard.style.display   = 'flex';
      btnScan.disabled            = true;
      setStatus('idle');
      return;
    }

    username                    = u;
    profileUsername.textContent = `@${username}`;
    profileUrl.textContent      = `instagram.com/${username}`;
    profileBadge.textContent    = afyT('public');
    profileBadge.classList.add('public');
    warningCard.style.display   = 'none';
    btnScan.disabled            = false;
    setStatus('active');
    Logger.info(afyT('logDetected', { u: username }));
  }

  async function startScan() {
    scanning = true;
    videos   = [];
    selected.clear();
    videoItems.innerHTML        = '';
    emptyState.style.display    = 'none';
    skeletonList.style.display  = 'flex';

    setBtnScanLoading(true);
    progressSection.style.display = 'block';
    modeTabs.style.display        = 'none';
    statsBar.style.display        = 'none';
    selectAllBar.style.display    = 'none';
    footerActions.style.display   = 'none';
    setStatus('scanning');
    setProgress(0, afyT('startingScan'), afyT('connecting'));

    Logger.info(afyT('logScanStart', { u: username }));

    try {
      await injectContentScript(currentTab.id);

      const result = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(afyT('errTimeout'))), 180000);
        chrome.tabs.sendMessage(currentTab.id, { action: 'SCAN_PROFILE', username }, response => {
          clearTimeout(timer);
          if (chrome.runtime.lastError)  return reject(new Error(afyT('errReload')));
          if (!response)                 return reject(new Error(afyT('errNoResp')));
          if (response.error)            return reject(new Error(traduzErro(response.error)));
          resolve(response.posts || []);
        });
      });

      videos = result.filter(v => v && (v.videoUrl || v.photoUrl || v.mediaUrl));
      videos.forEach(v => selected.add(v.id));

      const totalReels = videos.filter(v => v.type !== 'photo').length;
      const totalPhotos = videos.filter(v => v.type === 'photo').length;
      Logger.success(afyT('logFound', { t: videos.length, r: totalReels, p: totalPhotos }));
      skeletonList.style.display = 'none';
      setProgress(100, afyT('scanDone'), afyT('subFound', { t: videos.length, r: totalReels, p: totalPhotos }));

      if (videos.length === 0) {
        emptyState.style.display = 'flex';
        showToast(afyT('toastNone'), 'info');
      } else {
        renderVideoList();
        modeTabs.style.display     = 'flex';
        statsBar.style.display     = 'flex';
        selectAllBar.style.display = 'flex';
        footerActions.style.display = 'flex';
        updateStats();
      }

      setStatus('active');
    } catch (err) {
      Logger.error(afyT('logScanFail', { m: err.message }));
      showToast(err.message, 'error');
      skeletonList.style.display = 'none';
      emptyState.style.display   = 'flex';
      setStatus('error');
    } finally {
      scanning = false;
      setBtnScanLoading(false);
    }
  }

  function getFilteredVideos() {
    if (currentFilter === 'reel') return videos.filter(v => v.type !== 'photo');
    if (currentFilter === 'photo') return videos.filter(v => v.type === 'photo');
    return videos;
  }

  async function startDownloadMode(mode) {
    let itemsToProcess = [];
    let zipBase = '';
    let folder = '';

    if (mode === 'reels') {
      itemsToProcess = videos
        .filter(v => selected.has(v.id) && v.type !== 'photo' && v.videoUrl)
        .map(v => ({
          id: v.id,
          videoUrl: v.videoUrl,
          filename: v.filename && v.filename.endsWith('.mp4') ? v.filename : `reel_${v.id}.mp4`
        }));
      zipBase = 'reels';
      folder = 'reels';
      if (itemsToProcess.length === 0) {
        showToast(afyT('noReelSel'), 'info');
        return;
      }
    } else if (mode === 'photos') {
      itemsToProcess = videos
        .filter(v => selected.has(v.id) && v.type === 'photo')
        .map(v => ({
          id: v.id,
          videoUrl: v.photoUrl || v.mediaUrl || v.videoUrl,
          filename: v.filename && v.filename.endsWith('.jpg') ? v.filename : `foto_${v.id}.jpg`
        }));
      zipBase = 'fotos';
      folder = 'fotos';
      if (itemsToProcess.length === 0) {
        showToast(afyT('noPhotoSel'), 'info');
        return;
      }
    } else if (mode === 'covers') {
      // Capas dos reels selecionados (ou de todos selecionados se não houver reel)
      itemsToProcess = videos
        .filter(v => selected.has(v.id) && (v.coverUrl || v.thumbnail || v.photoUrl || v.mediaUrl))
        .map(v => ({
          id: v.id,
          videoUrl: v.coverUrl || v.thumbnail || v.photoUrl || v.mediaUrl,
          filename: `capa_${v.type === 'reel' ? 'reel_' : ''}${v.id}.jpg`
        }));
      zipBase = 'capas';
      folder = 'capas';
      if (itemsToProcess.length === 0) {
        showToast(afyT('noCover'), 'info');
        return;
      }
    }

    downloading = true;
    if (btnDownloadReels) btnDownloadReels.disabled = true;
    if (btnDownloadPhotos) btnDownloadPhotos.disabled = true;
    if (btnDownloadCovers) btnDownloadCovers.disabled = true;
    btnScan.disabled = true;
    setStatus('scanning');

    const modeTxt = afyT('dlMode_' + mode);
    Logger.info(afyT('logDlStart', { mode: modeTxt, n: itemsToProcess.length }));
    progressSection.style.display = 'block';
    setProgress(0, afyT('dlProgress', { mode: modeTxt }), `0 / ${itemsToProcess.length}`);

    const { maxConcurrent = 6, maxRetries = 3 } = await chrome.storage.local.get(['maxConcurrent', 'maxRetries']);
    downloadManager = new DownloadManager({
      tabId: currentTab.id,
      maxConcurrent,
      maxRetries,
      onProgress: ({ completed, total, percent, failed }) => {
        setProgress(percent, afyT('dlProgress', { mode: modeTxt }), afyT('dlDone', { c: completed, t: total }) + (failed ? afyT('dlFailed', { f: failed }) : ''));
        progressFill.style.width    = `${percent}%`;
        progressPercent.textContent = `${percent}%`;
      },
      onItemDone: (id, blob, status) => {
        updateItemStatus(id, status);
      },
      onError: (item, err) => {
        Logger.error(afyT('logItemFail', { f: item.filename, m: err.message }));
      }
    });

    itemsToProcess.forEach(item => downloadManager.add(item));
    await downloadManager.start();

    const results = downloadManager.getResults();
    const filesToZip = [];
    results.forEach((val) => {
      if (val.blob) filesToZip.push({ blob: val.blob, filename: val.filename });
    });

    if (filesToZip.length === 0) {
      showToast(afyT('toastNoneOk', { mode: modeTxt }), 'error');
      downloading = false;
      btnScan.disabled = false;
      updateStats();
      setStatus('active');
      return;
    }

    setProgress(0, afyT('zipping'), afyT('wait'));

    try {
      const zipBlob = await ZipManager.createZip(filesToZip, username, pct => {
        setProgress(pct, afyT('zippingShort'), `${pct}%`);
      }, folder);

      const zipFilename = `instagram_${zipBase}.zip`;
      ZipManager.triggerDownload(zipBlob, zipFilename);
      showToast(afyT('zipReady', { n: filesToZip.length, f: zipFilename }), 'success');
      setProgress(100, afyT('finished'), `${zipFilename} — ${Helpers.formatBytes(zipBlob.size)}`);
    } catch (err) {
      Logger.error(afyT('zipErr', { m: err.message }));
      showToast(afyT('zipErr', { m: err.message }), 'error');
    } finally {
      downloading = false;
      btnScan.disabled = false;
      updateStats();
      setStatus('active');
    }
  }

  function renderVideoList() {
    videoItems.innerHTML = '';
    const list = getFilteredVideos();
    if (list.length === 0) {
      emptyState.style.display = 'flex';
      const msg = afyT(currentFilter === 'reel' ? 'noReelFound' : (currentFilter === 'photo' ? 'noPhotoFound' : 'noMedia'));
      const p = emptyState.querySelector('p');
      if (p) p.textContent = msg;
    } else {
      emptyState.style.display = 'none';
      list.forEach((v, i) => {
        const item = createVideoItem(v, i);
        videoItems.appendChild(item);
      });
    }
  }

  function createVideoItem(v, index) {
    const div       = document.createElement('div');
    div.className   = selected.has(v.id) ? 'video-item selected' : 'video-item';
    div.dataset.id  = v.id;

    const isPhoto   = v.type === 'photo' || (v.filename && v.filename.endsWith('.jpg'));
    const typeLabel = afyT(isPhoto ? 'typePhoto' : (v.type === 'reel' ? 'typeReel' : 'typeVideo'));
    const typeClass = isPhoto ? 'photo' : (v.type === 'reel' ? 'reel' : '');
    const sizeText  = v.sizeEstimate > 0 ? Helpers.formatBytes(v.sizeEstimate) : (isPhoto ? '~500 KB' : '~MB');
    const badgeIcon = isPhoto
      ? `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`
      : `<svg width="10" height="10" viewBox="0 0 24 24" fill="white"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;

    div.innerHTML = `
      <div class="video-thumb">
        ${(v.thumbnail || v.coverUrl)
          ? `<img src="${escapeAttr(v.coverUrl || v.thumbnail)}" alt="" loading="lazy" onerror="this.style.display='none'">`
          : `<div class="video-thumb-placeholder"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg></div>`
        }
        <div class="video-play-icon" style="${isPhoto ? 'background:rgba(59,130,246,0.6);' : ''}">
          ${badgeIcon}
        </div>
      </div>
      <div class="video-info">
        <div class="video-name">${escapeHtml(v.filename)}</div>
        <div class="video-meta">
          <span class="video-size" id="size-${v.id}">${sizeText}</span>
          <span class="video-type ${typeClass}">${typeLabel}</span>
        </div>
        <div class="dl-progress" id="dlprog-${v.id}" style="display:none">
          <div class="dl-progress-fill" id="dlprogfill-${v.id}" style="width:0%"></div>
        </div>
      </div>
      <label class="checkbox-label video-cb">
        <input type="checkbox" class="video-item-cb" data-id="${v.id}" ${selected.has(v.id) ? 'checked' : ''}>
        <span class="checkmark"></span>
      </label>
    `;

    div.querySelector('.video-item-cb').addEventListener('change', e => {
      const id = e.target.dataset.id;
      if (e.target.checked) { selected.add(id);    div.classList.add('selected'); }
      else                   { selected.delete(id); div.classList.remove('selected'); }
      const visiveis = getFilteredVideos();
      checkAll.checked = visiveis.length > 0 && visiveis.every(v => selected.has(v.id));
      updateStats();
    });

    div.addEventListener('click', e => {
      if (e.target.closest('.video-cb')) return;
      const cb = div.querySelector('.video-item-cb');
      cb.checked = !cb.checked;
      cb.dispatchEvent(new Event('change'));
    });

    return div;
  }

  function updateItemStatus(id, status) {
    const row = document.querySelector(`.video-item[data-id="${id}"]`);
    if (!row) return;
    if (status === 'success') row.style.borderColor = 'rgba(16,185,129,0.4)';
    else if (status === 'error') row.style.borderColor = 'rgba(255,0,14,0.4)';
  }

  function updateStats() {
    const totalReels  = videos.filter(v => v.type !== 'photo').length;
    const totalPhotos = videos.filter(v => v.type === 'photo').length;
    const selReels    = videos.filter(v => selected.has(v.id) && v.type !== 'photo').length;
    const selPhotos   = videos.filter(v => selected.has(v.id) && v.type === 'photo').length;
    const selCovers   = selReels > 0 ? selReels : selected.size;

    statCount.textContent    = videos.length;
    statSelected.textContent = selected.size;
    const totalEst           = videos.reduce((s, v) => s + (v.sizeEstimate || 0), 0);
    statSize.textContent     = totalEst > 0 ? Helpers.formatBytes(totalEst) : '~MB';

    if (countAll) countAll.textContent       = videos.length;
    if (countReels) countReels.textContent   = totalReels;
    if (countPhotos) countPhotos.textContent = totalPhotos;

    if (downloadInfo) {
      downloadInfo.textContent = selected.size > 0
        ? afyT('selInfo', { n: selected.size, r: selReels, p: selPhotos })
        : afyT('noneSel');
    }

    if (btnDownloadReels) {
      btnDownloadReels.disabled = selReels === 0;
      if (btnDownloadReelsText) btnDownloadReelsText.textContent = afyT('dlReels', { n: selReels });
    }

    if (btnDownloadPhotos) {
      btnDownloadPhotos.disabled = selPhotos === 0;
      if (btnDownloadPhotosText) btnDownloadPhotosText.textContent = afyT('dlPhotos', { n: selPhotos });
    }

    if (btnDownloadCovers) {
      btnDownloadCovers.disabled = selCovers === 0;
      if (btnDownloadCoversText) btnDownloadCoversText.textContent = afyT('dlCovers', { n: selCovers });
    }
  }

  function setProgress(pct, label, sub) {
    if (label)            progressLabel.textContent   = label;
    if (sub !== undefined) progressSub.textContent    = sub;
    if (pct !== null) {
      progressFill.style.width    = `${pct}%`;
      progressPercent.textContent = `${pct}%`;
    }
  }

  function setStatus(state) {
    statusDot.className = 'status-dot';
    if (state === 'active')   statusDot.classList.add('active');
    if (state === 'scanning') statusDot.classList.add('scanning');
    if (state === 'error')    statusDot.classList.add('error');
  }

  function setBtnScanLoading(loading) {
    if (loading) {
      btnScan.innerHTML = `<div class="spinner"></div><span>${afyT('scanning')}</span>`;
      btnScan.disabled  = true;
    } else {
      btnScan.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><span>${afyT('scanBtn')}</span>`;
      btnScan.disabled  = false;
    }
  }

  function showToast(msg, type = 'info') {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();
    const t       = document.createElement('div');
    t.className   = `toast ${type}`;
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3500);
  }

  // Erros do content.js chegam em português: traduz os conhecidos no ponto de exibição.
  function traduzErro(m) {
    const mapa = {
      'Scan já em andamento': 'errBusy',
      'Não foi possível detectar o username do perfil': 'errNoUser',
      'Você não está logado no Instagram. Faça login em instagram.com e tente novamente.': 'errNotLogged'
    };
    return mapa[m] ? afyT(mapa[m]) : m;
  }

  // Painel mudou de idioma com o popup aberto: refaz os textos dinâmicos.
  afyOnLang(() => {
    if (videos.length) { renderVideoList(); updateStats(); }
    else if (!scanning && !downloading) { setBtnScanLoading(false); btnScan.disabled = !username; }
  });

  function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function escapeAttr(str) {
    return String(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

})();
