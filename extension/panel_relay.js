// InstaGestor Downloader — Panel Relay (ponte página ↔ extensão via postMessage)
// Runs on panel pages. Bridges page ↔ extension background worker.

function notifyUnavailable() {
  window.postMessage(
    { __instazip: true, type: 'INSTAZIP_ERROR', error: 'Extension not available' },
    '*'
  );
}

function isIgnorableRuntimeError(message) {
  const text = String(message || '').toLowerCase();
  return text.includes('message port closed before a response was received');
}

function safeRuntimeSendMessage(payload) {
  try {
    chrome.runtime.sendMessage(payload, (response) => {
      if (chrome.runtime.lastError && !isIgnorableRuntimeError(chrome.runtime.lastError.message)) {
        notifyUnavailable();
        return;
      }

      if (response?.accepted) {
        window.postMessage(
          { __instazip: true, type: 'INSTAZIP_PROGRESS', msg: 'Extensao conectada. Iniciando busca...' },
          '*'
        );
      }
    });
  } catch (error) {
    notifyUnavailable();
  }
}

// Page → Extension: panel requests a scan
window.addEventListener('message', (e) => {
  if (e.source !== window || !e.data?.__instazip_panel) return;
  // O painel pergunta se a extensão está aí (e qual versão) antes de buscar.
  if (e.data.type === 'INSTA_PANEL_PING') {
    window.postMessage({ __instazip: true, type: 'INSTAZIP_PONG', version: chrome.runtime.getManifest().version }, '*');
    return;
  }
  // Idioma da interface do painel: o popup da extensão segue ele.
  if (e.data.type === 'INSTA_PANEL_LANG') {
    if (['pt', 'en', 'es'].includes(e.data.lang)) {
      try { chrome.storage.local.set({ panelLang: e.data.lang }); } catch (err) {}
    }
    return;
  }
  if (e.data.type === 'INSTA_PANEL_STORIES_REQUEST') {
    safeRuntimeSendMessage({
      type: 'INSTA_PANEL_STORIES_REQUEST',
      usuario: e.data.usuario || '',
      destaqueId: e.data.destaqueId || '',
      stories: !!e.data.stories,
      destaques: !!e.data.destaques
    });
    return;
  }
  if (e.data.type === 'INSTA_PANEL_SCAN_REQUEST') {
    safeRuntimeSendMessage({
      type: 'INSTA_PANEL_SCAN_REQUEST',
      username: e.data.username,
      rangeFrom: e.data.rangeFrom || 0,
      rangeTo: e.data.rangeTo || 9999,
      targets: e.data.targets || ['reels', 'photos', 'covers']
    });
  }
});

// Extension → Page: relay scan events
chrome.runtime.onMessage.addListener((message) => {
  const relayed = ['INSTAZIP_RESULT', 'INSTAZIP_ERROR', 'INSTAZIP_PROGRESS', 'INSTAZIP_AVISO', 'INSTAZIP_STORIES_RESULT'];
  if (relayed.includes(message.type)) {
    window.postMessage({ ...message, __instazip: true }, '*');
  }
});
