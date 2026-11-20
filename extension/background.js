// InstaGestor Downloader — Service Worker background.js
// Integra com o painel do InstaGestor (instagestor.orbih.shop).

let panelTabId = null;
let panelPort  = null; // 2026-07-29: conexão direta do painel via externally_connectable
let scanTabId  = null;
let scanWinId  = null;

function safeRuntimeSendMessage(message) {
  try {
    chrome.runtime.sendMessage(message, () => {
      void chrome.runtime.lastError;
    });
  } catch (error) {
    // Ignore relay errors when popup/panel is not listening.
  }
}

function safeTabSendMessage(tabId, message) {
  try {
    chrome.tabs.sendMessage(tabId, message, () => {
      void chrome.runtime.lastError;
    });
  } catch (error) {
    // Ignore relay errors when the tab is gone.
  }
}

function safeRemoveWindow(winId) {
  try {
    chrome.windows.remove(winId, () => {
      void chrome.runtime.lastError;
    });
  } catch (error) {
    // Ignore removal errors for already closed windows.
  }
}

function safeRemoveTab(tabId) {
  try {
    chrome.tabs.remove(tabId, () => {
      void chrome.runtime.lastError;
    });
  } catch (error) {
    // Ignore removal errors for already closed tabs.
  }
}

// ── Dispara o fluxo de scan (aberto tanto pela ponte antiga via tab quanto ──
// pela conexão externa direta do painel) ─────────────────────────────────────
function startScanFlow(username, rangeFrom, rangeTo, targets = ['reels', 'photos', 'covers']) {
  closeScan();
  forwardToPanel({ type: 'INSTAZIP_PROGRESS', msg: `Abrindo Instagram...` });

  const cleanUser = String(username || '').replace(/^@/, '').split('/')[0];
  const isOnlyPhotos = Array.isArray(targets) && targets.length === 1 && targets[0] === 'photos';
  const url = isOnlyPhotos
    ? `https://www.instagram.com/${encodeURIComponent(cleanUser)}/`
    : `https://www.instagram.com/${encodeURIComponent(cleanUser)}/reels/`;
  chrome.windows.create({
    url,
    type:    'popup',
    width:   800,
    height:  800,
    left:    30,
    top:     30,
    focused: false,
  }, (win) => {
    if (chrome.runtime.lastError || !win) {
      chrome.tabs.create({ url, active: false }, (tab) => {
        scanTabId = tab.id;
        setupScanListener(tab.id, username, rangeFrom, rangeTo, targets);
      });
      return;
    }
    scanWinId = win.id;
    scanTabId = win.tabs[0].id;
    setupScanListener(scanTabId, username, rangeFrom, rangeTo, targets);
  });
}

// Segurança: só o painel do InstaGestor comanda a extensão. Qualquer site que
// conseguisse falar com ela poderia usar a sessão logada do Instagram deste
// navegador — por isso a lista é fechada. O manifest também restringe; aqui é a
// 2ª trava. localhost fica só para o desenvolvimento local do painel.
const ORIGENS_DO_PAINEL = [
  'https://instagestor.orbih.shop',
  'https://www.instagestor.orbih.shop',
  'http://localhost:3100',
  'http://localhost:3000',
];
function vemDoPainel(sender) {
  try { return !!sender && ORIGENS_DO_PAINEL.includes(new URL(sender.url || sender.origin || '').origin); }
  catch (_e) { return false; }
}

// ── Conexão externa direta do painel (2026-07-29) ─────────────────────────────
// Substitui a ponte via content script panel_relay.js/window.postMessage, que
// falhava porque o Instagram manda Cross-Origin-Opener-Policy (não afeta essa
// conexão, já que chrome.runtime.connect não passa por window nenhuma).
// Exige "externally_connectable" no manifest apontando pro domínio do painel.
chrome.runtime.onConnectExternal.addListener((port) => {
  if (!vemDoPainel(port.sender)) { try { port.disconnect(); } catch (_e) {} return; }
  panelPort = port;
  panelTabId = null; // a ponte antiga não é mais usada quando a porta existe
  port.onMessage.addListener((message) => {
    if (message.type === 'INSTA_PANEL_SCAN_REQUEST') {
      startScanFlow(message.username, message.rangeFrom || 0, message.rangeTo || 9999, message.targets || ['reels', 'photos', 'covers']);
    }
    if (message.type === 'INSTA_PANEL_STORIES_REQUEST') startStoriesFlow(pedidoDeStories(message));
  });
  port.onDisconnect.addListener(() => {
    if (panelPort === port) panelPort = null;
  });
});

// ── Message handler ───────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // ── Legacy relay from content script → popup ──────────────────────────────
  if (message.action === 'SCAN_PROGRESS') {
    safeRuntimeSendMessage(message);
    forwardToPanel({ type: 'INSTAZIP_PROGRESS', msg: message.label || 'Coletando vídeos...' });
    return false;
  }
  if (message.action === 'SCAN_DONE') {
    safeRuntimeSendMessage(message);
    return false;
  }

  // Resultado parcial: a busca terminou com vídeos, mas parou antes do fim.
  // Vai por um canal próprio pra não ser sobrescrito pelo texto de progresso.
  if (message.action === 'SCAN_WARN') {
    forwardToPanel({ type: 'INSTAZIP_AVISO', texto: message.texto || '' });
    return false;
  }

  // ── Panel requests scan (ponte antiga via panel_relay.js, mantida por
  // compatibilidade — o caminho novo usa onConnectExternal acima) ────────────
  if (typeof message.type === 'string' && message.type.startsWith('INSTA_PANEL_') && !vemDoPainel(sender)) {
    sendResponse({ accepted: false });
    return false;
  }
  if (message.type === 'INSTA_PANEL_SCAN_REQUEST') {
    sendResponse({ accepted: true });
    panelTabId = sender.tab?.id ?? null;
    startScanFlow(message.username, message.rangeFrom || 0, message.rangeTo || 9999, message.targets || ['reels', 'photos', 'covers']);
    return false;
  }

  if (message.type === 'INSTA_PANEL_STORIES_REQUEST') {
    sendResponse({ accepted: true });
    panelTabId = sender.tab?.id ?? null;
    startStoriesFlow(pedidoDeStories(message));
    return false;
  }

  return false;
});

// Só os campos esperados, já limpos (vêm de uma página web).
function pedidoDeStories(m) {
  return {
    usuario: String(m.usuario || '').replace(/[^A-Za-z0-9._]/g, '').slice(0, 30),
    destaqueId: String(m.destaqueId || '').replace(/\D/g, '').slice(0, 25),
    stories: !!m.stories,
    destaques: !!m.destaques,
  };
}

// ── Stories e destaques (2.6.0, 13/10/2026) ──────────────────────────────────
// Usa a conta do Instagram que está logada NESTE navegador. Abre uma janelinha
// em instagram.com/robots.txt (mesma origem, cookies da sessão, mas sem o app
// do Instagram rodando — então nenhum story é aberto nem marcado como visto),
// e de lá chama a API web com os cabeçalhos do próprio site. Ritmo: pausa de
// 0,8 a 2s entre chamadas; nada é gravado.
let storiesWinId = null;

function fecharStoriesWin() {
  if (storiesWinId != null) { safeRemoveWindow(storiesWinId); storiesWinId = null; }
}

// Roda DENTRO da página do Instagram (mundo MAIN). Não pode usar nada de fora.
async function coletarStoriesNaPagina(o) {
  const cookie = document.cookie || '';
  if (!/(?:^|;\s*)ds_user_id=/.test(cookie)) return { erro: 'deslogado' };
  const csrf = (cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/) || [])[1] || '';
  // Os mesmos cabeçalhos que o site do Instagram manda nas chamadas dele.
  const H = { 'X-IG-App-ID': '936619743392459', 'X-CSRFToken': csrf, 'X-Requested-With': 'XMLHttpRequest',
              'X-IG-WWW-Claim': '0', 'X-ASBD-ID': '129477', 'Accept': '*/*' };
  const pausa = () => new Promise((r) => setTimeout(r, 800 + Math.random() * 1200));
  // Erro sempre leva o detalhe (rota, HTTP, mensagem do Instagram) para o painel mostrar.
  const rota = (url) => String(url).split('?')[0].replace(/\/\d+\//g, '/<id>/');
  const get = async (url) => {
    const r = await fetch(url, { credentials: 'include', headers: H });
    let j = null, texto = '';
    try { texto = await r.text(); j = JSON.parse(texto); } catch (e) {}
    const msg = String((j && j.message) || texto || '').slice(0, 140);
    const det = rota(url) + ' → HTTP ' + r.status + (msg ? ' · ' + msg : '');
    if (r.status === 429 || /wait a few minutes|please wait|tente novamente mais tarde/i.test(msg)) throw { erro: 'limite', detalhe: det };
    if (r.status === 401 || r.status === 403 || (j && (j.require_login || /login_required|checkpoint|challenge/i.test(msg)))) throw { erro: 'sessao', detalhe: det };
    if (r.status === 404) throw { erro: 'nao_existe', detalhe: det };
    if (!r.ok || !j) throw { erro: 'erro', detalhe: /^\s*</.test(texto) ? rota(url) + ' → HTTP ' + r.status + ' · devolveu página HTML (rota fora do ar)' : det };
    return j;
  };
  // username → id fica guardado no navegador: a consulta de perfil é a que o
  // Instagram mais limita, e o id de uma conta nunca muda.
  const chaveId = (u) => 'autofy_igid_' + String(u).toLowerCase();
  const idGuardado = (u) => { try { return localStorage.getItem(chaveId(u)) || ''; } catch (e) { return ''; } };
  const guardarId = (u, id) => { try { localStorage.setItem(chaveId(u), String(id)); } catch (e) {} };
  // Só o necessário para baixar — o objeto inteiro do Instagram é enorme.
  const enxuto = (m) => ({
    pk: m.pk, id: m.id, code: m.code, media_type: m.media_type, taken_at: m.taken_at,
    product_type: m.product_type, video_duration: m.video_duration,
    user: { username: m.user && m.user.username },
    image_versions2: { candidates: ((m.image_versions2 && m.image_versions2.candidates) || []).slice(0, 3) },
    video_versions: (m.video_versions || []).slice(0, 3),
    carousel_media: (m.carousel_media || []).map((c) => ({
      pk: c.pk, id: c.id, media_type: c.media_type, video_duration: c.video_duration,
      image_versions2: { candidates: ((c.image_versions2 && c.image_versions2.candidates) || []).slice(0, 3) },
      video_versions: (c.video_versions || []).slice(0, 3),
    })),
  });
  try {
    let usuario = o.usuario || '';
    let aviso = '';
    const reelIds = [];
    if (o.destaqueId) {
      reelIds.push('highlight:' + o.destaqueId);
    } else {
      let userId = idGuardado(usuario);
      // 1º: o id na própria página do perfil (carregamento normal de página,
      // bem menos limitado que a API web_profile_info, que dava "aguarde").
      if (!userId) {
        try {
          const r = await fetch('/' + encodeURIComponent(usuario) + '/', { credentials: 'include', headers: { 'Accept': 'text/html' } });
          if (r.status === 404) return { erro: 'nao_existe', usuario };
          const html = r.ok ? await r.text() : '';
          // Só padrões que identificam o PERFIL (nunca "user_id": pode ser a conta logada).
          const m = html.match(new RegExp('"id":"(\\d{3,25})","username":"' + usuario.replace(/\./g, '\\.') + '"', 'i'))
                 || html.match(/"profilePage_(\d{3,25})"/) || html.match(/"profile_id":"(\d{3,25})"/);
          if (m) { userId = m[1]; guardarId(usuario, userId); await pausa(); }
        } catch (e) {}
      }
      // 2º: a busca do Instagram, pegando só o @ exato.
      if (!userId) {
        try {
          const r = await fetch('/web/search/topsearch/?context=blended&query=' + encodeURIComponent(usuario), { credentials: 'include', headers: H });
          const j = r.ok ? await r.json() : null;
          const achado = ((j && j.users) || []).map((x) => x.user || x).find((u) => String(u.username || '').toLowerCase() === usuario.toLowerCase());
          if (achado && achado.pk) {
            if (achado.is_private && !(achado.friendship_status && achado.friendship_status.following)) return { erro: 'privado', usuario };
            userId = String(achado.pk || achado.pk_id); guardarId(usuario, userId); await pausa();
          }
        } catch (e) {}
      }
      // 3º: a API (plano B — é a que o Instagram mais limita).
      if (!userId) {
        const p = await get('/api/v1/users/web_profile_info/?username=' + encodeURIComponent(usuario));
        const u = p && p.data && p.data.user;
        if (!u || !u.id) return { erro: 'nao_existe', usuario };
        if (u.is_private && !u.followed_by_viewer) return { erro: 'privado', usuario };
        userId = String(u.id);
        guardarId(usuario, userId);
        await pausa();
      }
      if (o.stories) reelIds.push(userId);
      if (o.destaques) {
        if (o.stories) await pausa();
        // A lista de destaques: o GraphQL que o site usa e, de reserva, a rota
        // da API (no www ela pode devolver HTML). Destaque que falha não derruba
        // os stories — vira aviso.
        const tentativas = [
          async () => {
            const v = encodeURIComponent(JSON.stringify({ user_id: userId, include_chaining: false, include_reel: false,
              include_suggested_users: false, include_logged_out_extras: false, include_highlight_reels: true, include_live_status: false }));
            const j = await get('/graphql/query/?query_hash=d4d88dc1500312af6f937f7b804c68c3&variables=' + v);
            const edges = (j && j.data && j.data.user && j.data.user.edge_highlight_reels && j.data.user.edge_highlight_reels.edges) || [];
            return edges.map((e) => e && e.node && e.node.id).filter(Boolean).map((id) => 'highlight:' + id);
          },
          async () => {
            const t = await get('/api/v1/highlights/' + encodeURIComponent(userId) + '/highlights_tray/');
            return (t.tray || []).map((h) => h && h.id).filter(Boolean).map(String);
          },
        ];
        let ids = [], falhaDestaques = null, respondeu = false;
        for (const tentar of tentativas) {
          try { ids = await tentar(); respondeu = true; if (ids.length) break; }
          catch (e) { if (e && e.erro === 'limite') throw e; falhaDestaques = e; }
          await pausa();
        }
        if (!ids.length && !respondeu) {
          if (!o.stories) throw falhaDestaques || { erro: 'erro' };
          aviso = 'Os destaques não vieram agora (o Instagram não respondeu a lista). Os stories vieram normalmente.'
                + (falhaDestaques && falhaDestaques.detalhe ? ' [' + falhaDestaques.detalhe + ']' : '');
        }
        reelIds.push(...ids);
      }
    }
    const itens = [];
    for (let i = 0; i < reelIds.length; i += 10) {
      await pausa();
      const lote = reelIds.slice(i, i + 10);
      let lista = null;
      const falhas = [];
      const qs = lote.map((id) => 'reel_ids=' + encodeURIComponent(id)).join('&');
      // 2.7.4 (03/11/2026): rotas em ordem; a reserva antiga por query_hash passou a devolver a página HTML.
      const rotas = [
        () => get('/api/v1/feed/reels_media/?' + qs),
        () => get('https://i.instagram.com/api/v1/feed/reels_media/?' + qs),
      ];
      const soUsuario = lote.filter((id) => !id.startsWith('highlight:'));
      if (soUsuario.length === 1) rotas.push(() => get('/api/v1/feed/user/' + encodeURIComponent(soUsuario[0]) + '/reel_media/').then((r) => ({ reels_media: r && r.items ? [Object.assign({ id: soUsuario[0] }, r)] : [] })));
      for (const tentar of rotas) {
        try {
          const j = await tentar();
          lista = Array.isArray(j.reels_media) ? j.reels_media : Object.values(j.reels || {});
          break;
        } catch (e) {
          if (e && (e.erro === 'limite' || e.erro === 'sessao')) throw e;
          falhas.push((e && e.detalhe) || String((e && e.message) || e));
          await pausa();
        }
      }
      if (lista === null) throw { erro: 'erro', detalhe: falhas.join(' | ') };
      for (const r of lista) {
        const origem = String(r.id || '').startsWith('highlight:') ? 'destaque' : 'story';
        if (!usuario && r.user && r.user.username) usuario = r.user.username;
        for (const m of (r.items || [])) itens.push({ ...enxuto(m), __origem: origem, __titulo: r.title || '' });
      }
    }
    return { itens, usuario, aviso };
  } catch (e) {
    return { erro: (e && e.erro) || 'erro', detalhe: (e && e.detalhe) || String((e && e.message) || ''), usuario: o.usuario || '' };
  }
}

function startStoriesFlow(pedido) {
  fecharStoriesWin();
  forwardToPanel({ type: 'INSTAZIP_PROGRESS', msg: 'Abrindo o Instagram com a sua conta...' });
  const url = 'https://www.instagram.com/robots.txt';
  const timer = setTimeout(() => {
    fecharStoriesWin();
    forwardToPanel({ type: 'INSTAZIP_ERROR', motivo: 'erro', error: 'Tempo esgotado buscando os stories.' });
  }, 90000);
  const rodar = (tabId) => {
    forwardToPanel({ type: 'INSTAZIP_PROGRESS', msg: 'Buscando stories e destaques...' });
    chrome.scripting.executeScript(
      { target: { tabId }, world: 'MAIN', func: coletarStoriesNaPagina, args: [pedido] },
      (res) => {
        clearTimeout(timer);
        fecharStoriesWin();
        const r = (!chrome.runtime.lastError && res && res[0] && res[0].result) || { erro: 'erro' };
        if (r.erro) {
          forwardToPanel({ type: 'INSTAZIP_ERROR', motivo: r.erro, usuario: r.usuario || '', error: r.erro, detalhe: r.detalhe || '' });
          return;
        }
        forwardToPanel({ type: 'INSTAZIP_STORIES_RESULT', itens: r.itens || [], usuario: r.usuario || '', aviso: r.aviso || '' });
      }
    );
  };
  chrome.windows.create({ url, type: 'popup', width: 420, height: 320, left: 30, top: 30, focused: false }, (win) => {
    if (chrome.runtime.lastError || !win) {
      clearTimeout(timer);
      forwardToPanel({ type: 'INSTAZIP_ERROR', motivo: 'erro', error: 'Não consegui abrir o Instagram.' });
      return;
    }
    storiesWinId = win.id;
    const tabId = win.tabs[0].id;
    const ouvir = (id, info) => {
      if (id !== tabId || info.status !== 'complete') return;
      chrome.tabs.onUpdated.removeListener(ouvir);
      rodar(tabId);
    };
    chrome.tabs.onUpdated.addListener(ouvir);
  });
}

// ── Wait for Instagram to fully load, then ask content.js to scan ─────────────
function setupScanListener(tabId, username, rangeFrom, rangeTo, targets = ['reels', 'photos', 'covers']) {
  // Ranges pequenos terminam rápido; "Todos" (perfis com 1000+ vídeos) leva minutos
  const timeoutMs = (rangeTo >= 9999 || rangeTo > 300) ? 600000 : 150000;
  const safetyTimer = setTimeout(() => {
    closeScan();
    forwardToPanel({ type: 'INSTAZIP_ERROR', error: 'Tempo esgotado. Tente novamente ou um range menor.' });
  }, timeoutMs);

  const tabListener = (changedTabId, info) => {
    if (changedTabId !== tabId || info.status !== 'complete') return;
    chrome.tabs.onUpdated.removeListener(tabListener);

    forwardToPanel({ type: 'INSTAZIP_PROGRESS', msg: `Buscando vídeos de @${username}...` });

    // Give Instagram time to fully initialize (cookies, session) then scan
    setTimeout(() => {
      forwardToPanel({ type: 'INSTAZIP_PROGRESS', msg: `Coletando vídeos de @${username}...` });
      chrome.tabs.sendMessage(tabId, { action: 'SCAN_PROFILE', username, rangeFrom, rangeTo, targets }, (response) => {
        if (chrome.runtime.lastError || !response) {
          // Retry once after 4 more seconds (page might still be loading)
          forwardToPanel({ type: 'INSTAZIP_PROGRESS', msg: 'Aguardando Instagram carregar...' });
          setTimeout(() => {
            chrome.tabs.sendMessage(tabId, { action: 'SCAN_PROFILE', username, rangeFrom, rangeTo, targets }, (response2) => {
              clearTimeout(safetyTimer);
              closeScan();
              if (chrome.runtime.lastError || !response2) {
                forwardToPanel({ type: 'INSTAZIP_ERROR', error: 'Não foi possível acessar o Instagram. Certifique-se de estar logado.' });
                return;
              }
              handleScanResponse(response2);
            });
          }, 4000);
          return;
        }
        clearTimeout(safetyTimer);
        closeScan();
        handleScanResponse(response);
      });
    }, 6000);
  };

  chrome.tabs.onUpdated.addListener(tabListener);
}

// ── Handle scan response from content.js ──────────────────────────────────────
function handleScanResponse(response) {
  // 'codigos' são os shortcodes que a grade do perfil mostrou. Vão junto SEMPRE,
  // inclusive no erro: o painel usa essa lista pra pedir os vídeos ao servidor,
  // que resolve cada post pelo /embed/ público (2026-09-10).
  const codigos = response.codigos || [];
  if (response.error) {
    forwardToPanel({ type: 'INSTAZIP_ERROR', error: response.error, codigos });
    return;
  }
  const videos = response.posts || [];
  forwardToPanel({ type: 'INSTAZIP_RESULT', success: true, videos, codigos });
}

// ── Forward message to panel — porta externa (preferida) ou aba/content script ──
function forwardToPanel(msg) {
  if (panelPort) {
    try { panelPort.postMessage(msg); } catch { panelPort = null; }
    return;
  }
  if (panelTabId != null) {
    safeTabSendMessage(panelTabId, msg);
  }
}

// ── Close scan window/tab ─────────────────────────────────────────────────────
function closeScan() {
  if (scanWinId != null) {
    safeRemoveWindow(scanWinId);
    scanWinId = null; scanTabId = null;
  } else if (scanTabId != null) {
    safeRemoveTab(scanTabId);
    scanTabId = null;
  }
}

// ── Clean up if tracked window/tab closes ────────────────────────────────────
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === scanTabId)  { scanTabId = null; scanWinId = null; }
  if (tabId === panelTabId) panelTabId = null;
});
chrome.windows.onRemoved.addListener((winId) => {
  if (winId === scanWinId) { scanWinId = null; scanTabId = null; }
  if (winId === storiesWinId) storiesWinId = null;
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ maxConcurrent: 6, maxRetries: 3 });
});
