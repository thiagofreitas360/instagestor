// i18n.js — idioma do popup segue o do painel (panelLang), não o do navegador.
(() => {
  const D = {
    title:        { pt: 'InstaGestor Downloader', en: 'InstaGestor Downloader', es: 'InstaGestor Downloader' },
    noProfile:    { pt: 'Nenhum perfil detectado', en: 'No profile detected', es: 'Ningún perfil detectado' },
    openProfile:  { pt: 'Abra um perfil do Instagram', en: 'Open an Instagram profile', es: 'Abre un perfil de Instagram' },
    warnOpen:     { pt: 'Abra um perfil público do Instagram primeiro', en: 'Open a public Instagram profile first', es: 'Abre primero un perfil público de Instagram' },
    scanBtn:      { pt: 'Scan Videos', en: 'Scan Videos', es: 'Escanear videos' },
    scanning:     { pt: 'Escaneando...', en: 'Scanning...', es: 'Escaneando...' },
    connecting:   { pt: 'Conectando ao Instagram', en: 'Connecting to Instagram', es: 'Conectando con Instagram' },
    videos:       { pt: 'vídeos', en: 'videos', es: 'videos' },
    estimated:    { pt: 'estimado', en: 'estimated', es: 'estimado' },
    selectedLbl:  { pt: 'selecionados', en: 'selected', es: 'seleccionados' },
    tabAll:       { pt: 'Todas', en: 'All', es: 'Todas' },
    tabPhotos:    { pt: 'Fotos', en: 'Photos', es: 'Fotos' },
    selectAll:    { pt: 'Selecionar todos', en: 'Select all', es: 'Seleccionar todos' },
    clear:        { pt: 'Limpar', en: 'Clear', es: 'Limpiar' },
    noMedia:      { pt: 'Nenhuma mídia encontrada', en: 'No media found', es: 'No se encontró ningún contenido' },
    doScan:       { pt: 'Faça o scan de um perfil do Instagram', en: 'Scan an Instagram profile', es: 'Escanea un perfil de Instagram' },
    dlReels:      { pt: '🎬 Baixar Reels ({n})', en: '🎬 Download Reels ({n})', es: '🎬 Descargar Reels ({n})' },
    dlReelsZip:   { pt: '🎬 Baixar Reels (ZIP)', en: '🎬 Download Reels (ZIP)', es: '🎬 Descargar Reels (ZIP)' },
    dlPhotos:     { pt: '📸 Baixar Fotos ({n})', en: '📸 Download Photos ({n})', es: '📸 Descargar fotos ({n})' },
    dlPhotosZip:  { pt: '📸 Baixar Fotos (ZIP)', en: '📸 Download Photos (ZIP)', es: '📸 Descargar fotos (ZIP)' },
    dlCovers:     { pt: '🖼️ Capas Reels ({n})', en: '🖼️ Reel Covers ({n})', es: '🖼️ Portadas de Reels ({n})' },
    dlCoversZip:  { pt: '🖼️ Capas Reels (ZIP)', en: '🖼️ Reel Covers (ZIP)', es: '🖼️ Portadas de Reels (ZIP)' },
    logs:         { pt: 'Logs', en: 'Logs', es: 'Registros' },
    madeBy:       { pt: 'Criada pela', en: 'Made by', es: 'Creada por' },
    createAcc:    { pt: 'Abrir o painel →', en: 'Open the panel →', es: 'Abrir el panel →' },
    goToProfile:  { pt: 'Navegue até um perfil', en: 'Go to a profile', es: 'Ve a un perfil' },
    exProfile:    { pt: 'Ex: instagram.com/username/', en: 'E.g. instagram.com/username/', es: 'Ej: instagram.com/username/' },
    public:       { pt: 'Público', en: 'Public', es: 'Público' },
    logDetected:  { pt: 'Perfil detectado: @{u}', en: 'Profile detected: @{u}', es: 'Perfil detectado: @{u}' },
    startingScan: { pt: 'Iniciando scan...', en: 'Starting scan...', es: 'Iniciando escaneo...' },
    logScanStart: { pt: 'Scan iniciado para @{u}', en: 'Scan started for @{u}', es: 'Escaneo iniciado para @{u}' },
    errTimeout:   { pt: 'Timeout: o scan demorou demais', en: 'Timeout: the scan took too long', es: 'Tiempo agotado: el escaneo tardó demasiado' },
    errReload:    { pt: 'Recarregue a aba do Instagram e tente novamente.', en: 'Reload the Instagram tab and try again.', es: 'Recarga la pestaña de Instagram e inténtalo de nuevo.' },
    errNoResp:    { pt: 'Content script não respondeu. Recarregue a aba do Instagram.', en: 'Content script did not respond. Reload the Instagram tab.', es: 'El content script no respondió. Recarga la pestaña de Instagram.' },
    errNoUser:    { pt: 'Não foi possível detectar o username do perfil', en: 'Could not detect the profile username', es: 'No se pudo detectar el nombre de usuario del perfil' },
    errNotLogged: { pt: 'Você não está logado no Instagram. Faça login em instagram.com e tente novamente.', en: 'You are not logged in to Instagram. Log in at instagram.com and try again.', es: 'No has iniciado sesión en Instagram. Inicia sesión en instagram.com e inténtalo de nuevo.' },
    errBusy:      { pt: 'Scan já em andamento', en: 'Scan already in progress', es: 'Escaneo ya en curso' },
    logFound:     { pt: '{t} mídias encontradas ({r} reels, {p} fotos)', en: '{t} media found ({r} reels, {p} photos)', es: '{t} contenidos encontrados ({r} reels, {p} fotos)' },
    scanDone:     { pt: 'Scan concluído!', en: 'Scan complete!', es: '¡Escaneo completado!' },
    subFound:     { pt: '{t} mídias ({r} reels, {p} fotos)', en: '{t} media ({r} reels, {p} photos)', es: '{t} contenidos ({r} reels, {p} fotos)' },
    toastNone:    { pt: 'Nenhuma mídia encontrada neste perfil', en: 'No media found on this profile', es: 'No se encontró contenido en este perfil' },
    logScanFail:  { pt: 'Scan falhou: {m}', en: 'Scan failed: {m}', es: 'El escaneo falló: {m}' },
    noReelSel:    { pt: 'Nenhum reel selecionado com link de vídeo.', en: 'No selected reel has a video link.', es: 'Ningún reel seleccionado tiene enlace de video.' },
    noPhotoSel:   { pt: 'Nenhuma foto selecionada.', en: 'No photo selected.', es: 'Ninguna foto seleccionada.' },
    noCover:      { pt: 'Nenhuma capa disponível para os itens selecionados.', en: 'No cover available for the selected items.', es: 'No hay portadas disponibles para los elementos seleccionados.' },
    logDlStart:   { pt: 'Iniciando download [{mode}] de {n} arquivos', en: 'Starting download [{mode}] of {n} files', es: 'Iniciando descarga [{mode}] de {n} archivos' },
    dlMode_reels: { pt: 'reels', en: 'reels', es: 'reels' },
    dlMode_photos:{ pt: 'fotos', en: 'photos', es: 'fotos' },
    dlMode_covers:{ pt: 'capas', en: 'covers', es: 'portadas' },
    dlProgress:   { pt: 'Baixando {mode}...', en: 'Downloading {mode}...', es: 'Descargando {mode}...' },
    dlDone:       { pt: '{c}/{t} concluídos', en: '{c}/{t} completed', es: '{c}/{t} completados' },
    dlFailed:     { pt: ' ({f} falhas)', en: ' ({f} failed)', es: ' ({f} fallos)' },
    logItemFail:  { pt: 'Falha em {f}: {m}', en: 'Failed on {f}: {m}', es: 'Fallo en {f}: {m}' },
    toastNoneOk:  { pt: 'Nenhum arquivo de {mode} foi baixado com sucesso', en: 'No {mode} file was downloaded successfully', es: 'Ningún archivo de {mode} se descargó correctamente' },
    zipping:      { pt: 'Compactando ZIP com metadados limpos...', en: 'Building ZIP with clean metadata...', es: 'Creando ZIP con metadatos limpios...' },
    wait:         { pt: 'Aguarde...', en: 'Please wait...', es: 'Espera...' },
    zippingShort: { pt: 'Compactando ZIP...', en: 'Building ZIP...', es: 'Creando ZIP...' },
    zipReady:     { pt: 'ZIP pronto! {n} arquivos salvos em {f}', en: 'ZIP ready! {n} files saved to {f}', es: '¡ZIP listo! {n} archivos guardados en {f}' },
    finished:     { pt: 'Concluído!', en: 'Done!', es: '¡Listo!' },
    zipErr:       { pt: 'Erro ao criar ZIP: {m}', en: 'Error creating ZIP: {m}', es: 'Error al crear el ZIP: {m}' },
    noReelFound:  { pt: 'Nenhum reel encontrado', en: 'No reel found', es: 'No se encontró ningún reel' },
    noPhotoFound: { pt: 'Nenhuma foto encontrada', en: 'No photo found', es: 'No se encontró ninguna foto' },
    typePhoto:    { pt: 'foto', en: 'photo', es: 'foto' },
    typeReel:     { pt: 'reel', en: 'reel', es: 'reel' },
    typeVideo:    { pt: 'vídeo', en: 'video', es: 'video' },
    selInfo:      { pt: '{n} selecionado(s) · {r} reel(s), {p} foto(s)', en: '{n} selected · {r} reel(s), {p} photo(s)', es: '{n} seleccionado(s) · {r} reel(s), {p} foto(s)' },
    noneSel:      { pt: 'Nenhuma mídia selecionada', en: 'No media selected', es: 'Ningún contenido seleccionado' },
    // services/*.js (aparecem no painel de logs do popup)
    zipLoad:      { pt: 'JSZip não carregado', en: 'JSZip not loaded', es: 'JSZip no cargado' },
    logZipStart:  { pt: 'Iniciando compressão ZIP...', en: 'Starting ZIP compression...', es: 'Iniciando compresión ZIP...' },
    logZipGen:    { pt: 'Gerando arquivo ZIP...', en: 'Generating ZIP file...', es: 'Generando archivo ZIP...' },
    logZipOk:     { pt: 'ZIP gerado: {s}', en: 'ZIP generated: {s}', es: 'ZIP generado: {s}' },
    logDlTrig:    { pt: 'Download iniciado: {f}', en: 'Download started: {f}', es: 'Descarga iniciada: {f}' },
    logQueue:     { pt: 'Download iniciado: {n} vídeos na fila', en: 'Download started: {n} videos queued', es: 'Descarga iniciada: {n} videos en cola' },
    logPaused:    { pt: 'Download pausado', en: 'Download paused', es: 'Descarga pausada' },
    logResumed:   { pt: 'Download retomado', en: 'Download resumed', es: 'Descarga reanudada' },
    logCanceled:  { pt: 'Download cancelado', en: 'Download canceled', es: 'Descarga cancelada' },
    logGetting:   { pt: 'Baixando: {f}', en: 'Downloading: {f}', es: 'Descargando: {f}' },
    logItemOk:    { pt: 'Concluído: {f}', en: 'Done: {f}', es: 'Listo: {f}' },
    logFailed:    { pt: 'Falhou: {f} — {m}', en: 'Failed: {f} — {m}', es: 'Falló: {f} — {m}' },
    logRetry:     { pt: 'Retry {a}/{t}: {f}', en: 'Retry {a}/{t}: {f}', es: 'Reintento {a}/{t}: {f}' },
    errNoTab:     { pt: 'Aba do Instagram não encontrada', en: 'Instagram tab not found', es: 'Pestaña de Instagram no encontrada' },
    errDlTimeout: { pt: 'Timeout ao baixar o vídeo', en: 'Timeout downloading the video', es: 'Tiempo agotado al descargar el video' },
    errNoCS:      { pt: 'Sem resposta do content script', en: 'No response from content script', es: 'Sin respuesta del content script' },
    errDlFail:    { pt: 'Falha no download', en: 'Download failed', es: 'Falló la descarga' }
  };
  const OK = ['pt', 'en', 'es'];
  const byNav = () => { const n = String(navigator.language || '').slice(0, 2).toLowerCase(); return OK.includes(n) ? n : 'pt'; };

  window.afyLang = byNav();
  window.afyT = (key, vars) => {
    const e = D[key];
    let s = e ? (e[window.afyLang] || e.pt) : key;
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
    return s;
  };
  window.afyApplyI18n = (root) => {
    const r = root || document;
    document.documentElement.lang = { pt: 'pt-BR', en: 'en', es: 'es' }[window.afyLang];
    r.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = afyT(el.dataset.i18n); });
    r.querySelectorAll('[data-i18n-placeholder]').forEach(el => { el.placeholder = afyT(el.dataset.i18nPlaceholder); });
    r.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = afyT(el.dataset.i18nTitle); });
  };

  const onLang = [];
  window.afyOnLang = fn => onLang.push(fn); // popup registra re-render dos textos dinâmicos
  window.afyI18nReady = (async () => {
    try {
      const { panelLang } = await chrome.storage.local.get('panelLang');
      if (OK.includes(panelLang)) window.afyLang = panelLang;
    } catch (e) { /* mantém o idioma do navegador */ }
    if (typeof document !== 'undefined' && document.querySelectorAll) afyApplyI18n();
  })();
  try {
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area !== 'local' || !ch.panelLang || !OK.includes(ch.panelLang.newValue)) return;
      window.afyLang = ch.panelLang.newValue;
      afyApplyI18n();
      onLang.forEach(fn => fn());
    });
  } catch (e) { /* fora de contexto de extensão */ }
})();
