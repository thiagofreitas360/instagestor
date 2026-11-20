// InstaGestor Downloader — content.js (coleta na página do Instagram).
// Content script — coleta os vídeos/reels de um perfil.
// Roda no contexto da aba do Instagram (com cookies de sessão ativos).
(() => {
  'use strict';

  // Timestamp do Instagram → ISO. Um valor ausente, em ms ou fora do intervalo fazia
  // toISOString() lançar "Invalid time value" e derrubava a varredura inteira (filtro "Todos").
  function isoFromTs(ts) {
    let n = Number(ts);
    if (!Number.isFinite(n) || n <= 0) return '';
    if (n > 1e11) n = Math.floor(n / 1000);   // veio em milissegundos
    const d = new Date(n * 1000);
    return Number.isNaN(d.getTime()) ? '' : d.toISOString();
  }

  let scanning = false;

  // Motivo real da última falha de API. Antes cada erro era engolido
  // (`catch { return null }`) e a busca terminava em "0 vídeos" sem dizer
  // nada — o usuário via um spinner e um zero, e não dava pra saber se era
  // sessão, bloqueio da Meta ou perfil vazio.
  const erros = [];
  let apiFalhou = false;   // alguma chamada direta de API não respondeu
  let ignorados = 0;       // vídeos descartados por serem de outro perfil
  let capturasTotais = 0;  // respostas do app que o ig_hook entregou
  let prazoScan = 0;
  const codigosVistos = new Set(); // shortcodes vistos durante a rolagem inteira
  const codigosReels = new Set();  // shortcodes que vieram de /reel/ ou da aba de reels
  let limiteAtingido = false;  // o Instagram devolveu 429 nesta coleta
  let comVideo = 0;        // objetos com video_versions/video_url encontrados
  function registrarErro(onde, e) {
    apiFalhou = true;

    // 429 tem explicação própria: despejar o HTML da resposta não ajuda
    // ninguém, e o que o usuário precisa saber é que a cota da sessão dele
    // fechou e como contornar.
    if (e && e.status === 429) {
      const msg = 'o Instagram limitou temporariamente as buscas desta sessão (429). '
                + 'Costuma liberar sozinho em alguns minutos — tente de novo mais tarde, '
                + 'ou busque numa faixa menor (Top 50) em vez de "Todos".';
      if (!erros.includes(msg)) erros.unshift(msg);
      return;
    }

    // O status sozinho não basta: um 200 que veio com HTML é o caso mais
    // confuso de todos, e a explicação está na MENSAGEM, não no código.
    const partes = [];
    if (e && e.status) partes.push(`HTTP ${e.status}`);
    if (e && e.message && !(e.status && e.message.startsWith(`HTTP ${e.status}`))) partes.push(e.message);
    if (e && e.html && !partes.some(x => x.includes('HTML'))) partes.push('devolveu HTML, não JSON');
    if (!partes.length) partes.push('falha');
    const detalhe = (e && e.corpo) ? ` — ${String(e.corpo).slice(0, 100)}` : '';
    const msg = `${onde}: ${partes.join(' · ')}${detalhe}`;
    if (!erros.includes(msg)) erros.push(msg);
  }

  // ── Respostas que o PRÓPRIO Instagram busca, capturadas pelo ig_hook.js ────
  // (ver ig_hook.js: as chamadas montadas por nós são bloqueadas de tempos em
  // tempos; as do app nunca são, porque são as legítimas)
  const capturado = [];
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || !e.data.__autofy_ig) return;
    capturado.push(e.data.dados);
    capturasTotais++;
    if (capturado.length > 400) capturado.shift();
  });

  // ── Responde mensagens do popup / background ──
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'PING') {
      sendResponse({ ok: true });
      return true;
    }
    if (msg.action === 'SCAN_PROFILE') {
      if (scanning) { sendResponse({ error: 'Scan já em andamento' }); return true; }
      scanning = true;
      const targets = msg.targets || ['reels', 'photos', 'covers'];
      runScan(msg.username, msg.rangeFrom || 0, msg.rangeTo || 9999, targets)
        .then(r  => { scanning = false; sendResponse({ posts: r.posts, codigos: r.codigos }); })
        // Mesmo falhando, os shortcodes que a grade mostrou valem ouro: o
        // servidor resolve cada um pelo /embed/ público. Perder essa lista era
        // jogar fora a única parte que tinha dado certo.
        .catch(err  => { scanning = false; sendResponse({ error: err.message, codigos: (acumularGrade(), [...codigosVistos]) }); });
      return true;
    }
    // 2026-07-23 (pedido explícito: "quero 90% de precisão" — causa raiz da
    // taxa de falha alta) — os downloads de vídeo PRECISAM sair daqui (o
    // content script, rodando dentro de instagram.com), não do popup da
    // extensão. Baixar do popup usa o contexto chrome-extension://, que não
    // manda o Referer/Origin de instagram.com — e o CDN da Meta às vezes
    // recusa ou degrada requisições sem esse referrer válido (proteção
    // anti-hotlink). A tentativa antiga de forçar `headers:{Referer:...}`
    // no fetch() do popup NUNCA funcionava — "Referer" é um header proibido
    // que o navegador ignora silenciosamente quando definido via JS. Aqui,
    // rodando na própria página do Instagram, o Referer correto já sai
    // sozinho, de graça, sem precisar simular nada.
    if (msg.action === 'DOWNLOAD_VIDEO') {
      fetch(msg.url, { credentials: 'include' })
        .then(res => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.arrayBuffer();
        })
        .then(buffer => sendResponse({ ok: true, buffer }))
        .catch(err => sendResponse({ ok: false, error: err.message }));
      return true;
    }
  });

  // ──────────────────────────────────────────────────────────────
  // SCAN PRINCIPAL
  // ──────────────────────────────────────────────────────────────
  async function runScan(usernameFromPopup, rangeFrom = 0, rangeTo = 9999, targets = ['reels', 'photos', 'covers']) {
    erros.length = 0;
    apiFalhou = false;
    ignorados = 0;
    limiteAtingido = false;
    // O background mata o scan em 600s e nesse caso o usuário perde TUDO que
    // já tinha sido coletado. Parando por conta própria antes disso, o que já
    // foi encontrado é entregue com o aviso de parcial.
    prazoScan = Date.now() + 8.5 * 60 * 1000;
    codigosVistos.clear();
    codigosReels.clear();
    capturasTotais = 0;
    comVideo = 0;
    const rawUser = usernameFromPopup || extractUsernameFromUrl() || '';
    const username = String(rawUser).replace(/^@/, '').split('/')[0].trim().toLowerCase();
    if (!username) throw new Error('Não foi possível detectar o username do perfil');

    const collectLimit = rangeTo >= 9999 ? Infinity : rangeTo;

    const csrf = getCsrfToken();
    if (!csrf) {
      throw new Error('Você não está logado no Instagram. Faça login em instagram.com e tente novamente.');
    }

    progress(5, `Buscando perfil @${username}...`);

    const headers = igHeaders(username, csrf);

    // 1. Obter o userId — tenta do HTML embutido e, se não encontrar, tenta pela API interna
    let userId = extractUserIdFromPage(username);
    if (!userId) {
      try {
        const rProfile = await fetch(`https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`, {
          credentials: 'include',
          headers
        });
        if (rProfile.ok) {
          const jProfile = await rProfile.json();
          userId = jProfile?.data?.user?.id || null;
        }
      } catch {}
    }
    const alvo = { username: String(username).toLowerCase(), userId: userId || null };

    const collected = new Map(); // shortcode -> VideoItem

    if (userId) {
      progress(15, `Perfil encontrado (ID: ${userId}). Coletando vídeos...`);
      // collectReels faz chamadas diretas à API do Instagram e traz URLs de vídeo
      // quando funciona. Em caso de 429, o próprio fetchClipsPage seta limiteAtingido=true
      // e a coleta cai automaticamente pro Plano B (rolagem passiva + ig_hook).
      await collectReels(userId, alvo, headers, collected, collectLimit);
      if (collected.size < collectLimit && !limiteAtingido) {
        await collectTimelineMedia(userId, alvo, headers, collected, collectLimit);
      }
    } else {
      registrarErro('user_id', new Error('não encontrado no HTML da página'));
    }

    // 2. Plano B — deixa o PRÓPRIO Instagram carregar os reels e aproveita as
    // respostas dele (ig_hook.js) + o JSON que já veio embutido na página.
    // É o caminho que sobrevive a bloqueio de API, porque não é a extensão
    // que faz a requisição: é o app.
    // Se a API não trouxe todos os vídeos que poderiam existir (ou porque
    // omitiu itens sem dar erro, ou porque rate-limitou), rolar a página é
    // a garantia de varrer a grade inteira e resgatar os shortcodes.
    const valeRolar = collected.size < collectLimit;
    if (valeRolar) {
      const antes = collected.size;
      await coletarRolandoAPagina(alvo, collected, collectLimit);
      if (collected.size > antes) {
        progress(null, `Recuperados ${collected.size - antes} vídeo(s) pela rolagem da página.`);
      }

      // Plano C: sobraram posts na grade que ainda não viraram vídeo.
      // Nunca depois de um 429 — ele faz UMA requisição POR POST e era o maior
      // consumidor de cota da extensão; rodá-lo com o limite já estourado
      // afundaria a sessão de vez.
      // Sem resgate. A extensão NÃO abre post, NÃO abre player, NÃO navega
      // (2026-09-10, pedido explícito e repetido do dono do produto). Ela lê a
      // API e aproveita, de forma passiva, o que o próprio Instagram carrega
      // enquanto a página rola. Se a API recusar, o resultado vem incompleto e
      // a mensagem diz o motivo — melhor do que uma busca que parece travada
      // enquanto percorre post a post.
    }

    acumularGrade();
    // Recorte do painel aplicado AQUI também (2026-09-12).
    const codigos = [...codigosVistos].slice(rangeFrom, collectLimit === Infinity ? undefined : collectLimit);

    // 3. Resolução no Navegador — Se a grade mostrou posts mas ainda faltam links de vídeo:
    // Resolvemos diretamente na sessão logada do usuário, em segundo plano e em paralelo.
    const faltantes = codigos.filter(c => !collected.has(c));
    if (faltantes.length > 0 && collected.size < collectLimit && Date.now() < prazoScan) {
      progress(null, `Resolvendo ${faltantes.length} vídeo(s) diretamente no navegador...`);
      await resolverLoteNoNavegador(faltantes, headers, collected, collectLimit);
    }

    // Mapear os itens na ordem exata da grade/recorte selecionado
    let result = [];
    for (const c of codigos) {
      if (collected.has(c)) {
        result.push(collected.get(c));
      }
    }
    // Se o recorte era amplo (Todos) e houver outros itens em collected
    if (rangeFrom === 0 && result.length < collected.size) {
      for (const [sc, v] of collected.entries()) {
        if (!result.some(r => r.id === sc)) result.push(v);
      }
      if (collectLimit !== Infinity) {
        result = result.slice(0, collectLimit);
      }
    }

    if (result.length === 0) {
      // Se mesmo após a resolução direta não vier nenhum vídeo, envia os shortcodes pro servidor
      if (codigos.length) {
        chrome.runtime.sendMessage({ action: 'SCAN_DONE', total: 0 });
        progress(100, `${codigos.length} post(s) na grade — tentando servidor...`);
        return { posts: [], codigos };
      }
      throw new Error(
        `Nenhum vídeo de @${username} foi encontrado. ` +
        (erros.length ? `Motivo: ${erros.slice(0, 3).join(' | ')}. ` :
          'O perfil pode não ter Reels públicos, ou a sessão do Instagram expirou. ') +
        `[${diagnostico()}]`
      );
    }

    // Resultado com erro pelo caminho é resultado PARCIAL. Antes isso ficava
    // mudo: a busca devolvia 12 de 77 e ninguém sabia que tinha faltado.
    if (erros.length) {
      const abertura = 'A coleta parou antes do fim';
      chrome.runtime.sendMessage({
        action: 'SCAN_WARN',
        texto: `${abertura}: ${erros.slice(0, 2).join(' | ')} [${diagnostico()}]`,
      });
    }

    // Filtrar pelo tipo de mídia selecionado (reels, photos, covers)
    if (targets && Array.isArray(targets) && targets.length > 0) {
      const wantReels = targets.includes('reels');
      const wantPhotos = targets.includes('photos');
      const wantCovers = targets.includes('covers');
      result = result.filter(p => {
        if (p.type === 'photo') return wantPhotos;
        return wantReels || wantCovers;
      });
    }

    chrome.runtime.sendMessage({ action: 'SCAN_DONE', total: result.length });
    progress(100, `Concluído: ${result.length} mídias encontradas`);
    return { posts: result, codigos };
  }

  // ──────────────────────────────────────────────────────────────
  // PLANO B — rolar a página e aproveitar o que o Instagram carrega
  // ──────────────────────────────────────────────────────────────
  async function coletarRolandoAPagina(alvo, collected, limit = Infinity) {
    // O que já veio no HTML servido (primeira leva de reels)
    varrerJsonDaPagina(alvo, collected);
    drenarCapturado(alvo, collected);

    // Rolagem no modelo do TikZip, que é o que funciona na prática:
    //   • scrollBy em incrementos, não scrollTo até o fim — a grade carrega por
    //     IntersectionObserver e um salto direto pro fim pula os gatilhos;
    //   • tolera MUITAS rolagens sem ganho antes de desistir (a grade demora);
    //   • a cada 3 vazias, dá um empurrão maior e espera mais;
    //   • teto de tempo bruto, pra nunca ficar preso;
    //   • volta ao topo no fim.
    const LIMITE_VAZIAS = 20;
    let vazias = 0;
    acumularGrade();

    while (vazias < LIMITE_VAZIAS && codigosVistos.size < limit && Date.now() < prazoScan) {
      const antes = collected.size;
      const codigosAntes = codigosVistos.size;
      progress(null, `Rolando perfil: ${codigosVistos.size} post(s) na grade, ${collected.size} vídeo(s)...`);

      // 1. Rola a janela, document.scrollingElement e containers internos
      try {
        window.scrollBy({ top: 3500, behavior: 'smooth' });
        if (document.scrollingElement) document.scrollingElement.scrollTop += 3500;
        document.querySelectorAll('main, [role="main"], div[style*="overflow"]').forEach(el => {
          try { el.scrollTop += 3500; } catch {}
        });
      } catch {}

      // 2. Rola até o último link visível
      const links = document.querySelectorAll('a[href*="/reel/"], a[href*="/p/"]');
      if (links.length > 0) {
        try { links[links.length - 1].scrollIntoView({ behavior: 'smooth', block: 'end' }); } catch {}
      }

      // 3. Dispara evento scroll explícito para notificar observers do React/Instagram
      try {
        window.dispatchEvent(new Event('scroll'));
        document.dispatchEvent(new Event('scroll'));
      } catch {}
      
      await sleep(2200);
      drenarCapturado(alvo, collected);
      varrerJsonDaPagina(alvo, collected);
      acumularGrade();

      const ganhou = collected.size > antes || codigosVistos.size > codigosAntes;
      vazias = ganhou ? 0 : vazias + 1;

      if (vazias >= 5 && codigosVistos.size === 0 && capturasTotais === 0) break;

      if (vazias > 0 && vazias % 3 === 0) {
        try {
          window.scrollBy({ top: 7000, behavior: 'instant' });
          if (document.scrollingElement) document.scrollingElement.scrollTop += 7000;
          document.querySelectorAll('main, [role="main"], div[style*="overflow"]').forEach(el => {
            try { el.scrollTop += 7000; } catch {}
          });
          if (links.length > 0) {
            links[links.length - 1].scrollIntoView({ behavior: 'instant', block: 'end' });
          }
          window.dispatchEvent(new Event('scroll'));
          document.dispatchEvent(new Event('scroll'));
        } catch {}
        await sleep(3200);
        drenarCapturado(alvo, collected);
        varrerJsonDaPagina(alvo, collected);
        acumularGrade();
        if (collected.size > antes || codigosVistos.size > codigosAntes) vazias = 0;
      }
    }

    try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch {}
  }

  // Percorre as respostas capturadas do app e extrai tudo que for vídeo
  function drenarCapturado(alvo, collected) {
    while (capturado.length) {
      const dados = capturado.shift();
      varrerObjeto(dados, alvo, collected, 0);
    }
  }

  // Lê os blocos JSON que o Instagram embute no próprio HTML da página
  function varrerJsonDaPagina(alvo, collected) {
    try {
      for (const s of document.querySelectorAll('script[type="application/json"]')) {
        const txt = s.textContent || '';
        if (txt.length < 200) continue;
        if (!CHAVES_VIDEO.some(k => txt.includes(k)) && !txt.includes('video_versions')) continue;
        let obj;
        try { obj = JSON.parse(txt); } catch { continue; }
        varrerObjeto(obj, alvo, collected, 0);
      }
    } catch {}
  }

  // Caminha por qualquer estrutura procurando mídia de vídeo. Os formatos do
  // Instagram mudam de nome com frequência (items/media/node/clips_media...),
  // então procurar pela FORMA (tem video_versions e tem code) é mais durável
  // do que decorar o caminho da vez.
  function varrerObjeto(no, alvo, map, profundidade) {
    if (!no || typeof no !== 'object' || profundidade > 14) return;
    if (Array.isArray(no)) {
      for (const x of no) varrerObjeto(x, alvo, map, profundidade + 1);
      return;
    }
    const temVideo = temDadosDeVideo(no);
    const isVideoPost = no.is_video === true || no.media_type === 2 || no.__typename === 'GraphVideo' || no.product_type === 'clips' || !!no.is_video_clip;
    const isPhotoPost = no.media_type === 1 || no.__typename === 'GraphImage' || (no.is_video === false && !isVideoPost);

    if (temVideo) comVideo++;
    const sc = no.code || no.shortcode || String(no.pk || no.id || '');
    if (sc) {
      if (temVideo) {
        addVideoV1(no, alvo, map, true);
      } else if (isPhotoPost && urlDeImagem(no)) {
        addVideoV1(no, alvo, map, true);
      } else if (isVideoPost) {
        // É sabidamente um vídeo/reel sem URL de vídeo no objeto atual:
        // Registra o shortcode para resolução como VÍDEO, nunca como foto!
        codigosVistos.add(sc);
      }
    }
    for (const k in no) {
      const v = no[k];
      if (v && typeof v === 'object') varrerObjeto(v, alvo, map, profundidade + 1);
    }
  }

  // Quantos posts a grade está mostrando. Usada pela rolagem (pra saber se
  // ainda está carregando), pelo diagnóstico e pelo resgate.
  // Ficava no bloco do plano C e foi removida junto com ele — o teste pegou:
  // "shortcodesDaGrade is not defined", que teria quebrado toda busca em que a
  // API falha.
  function shortcodesDaGrade() {
    const codigos = [];
    try {
      const isReelsTab = window.location.pathname.includes('/reels');
      for (const a of document.querySelectorAll('a[href*="/reel/"], a[href*="/p/"]')) {
        const href = a.getAttribute('href') || '';
        const m = href.match(/\/(?:reel|p)\/([A-Za-z0-9_-]{5,})\//);
        if (m) {
          const sc = m[1];
          if (href.includes('/reel/') || isReelsTab) {
            codigosReels.add(sc);
          }
          if (!codigos.includes(sc)) codigos.push(sc);
        }
      }
    } catch {}
    return codigos;
  }

  // Acumula os shortcodes vistos durante a rolagem inteira (2026-09-12).
  // A grade do Instagram é virtualizada — o que sai da tela sai do DOM —,
  // então ler shortcodesDaGrade() só no fim devolvia os ~30 posts renderizados
  // naquele instante, não os 98 do perfil. O Set guarda a ordem de chegada,
  // que é a ordem da grade (mais recente primeiro), então o recorte do painel
  // (Top 50, 101–300…) continua valendo sobre ela.
  function acumularGrade() {
    for (const c of shortcodesDaGrade()) codigosVistos.add(c);
    return codigosVistos.size;
  }

  // ──────────────────────────────────────────────────────────────
  // TIMELINE MEDIA (posts + carrosséis com vídeo)
  // ──────────────────────────────────────────────────────────────
  async function collectTimelineMedia(userId, alvo, headers, collected, limit = Infinity) {
    let endCursor = null;
    let hasNext   = true;
    let page      = 0;

    while (hasNext && collected.size < limit) {
      if (Date.now() > prazoScan) {
        registrarErro('tempo', new Error('a coleta atingiu o tempo limite — o que já foi encontrado vai abaixo'));
        break;
      }
      page++;
      progress(null, `Timeline: página ${page} (${collected.size} vídeos até agora)...`);

      const data = await fetchTimelinePage(userId, endCursor, headers);
      if (!data) break;

      const media = data.edges || [];
      for (const edge of media) {
        const node = edge.node;
        if (!node) continue;

        addVideo(node, alvo, collected, false);

        // Carrossel: iterar filhos
        if (node.__typename === 'GraphSidecar' && node.edge_sidecar_to_children?.edges) {
          for (const child of node.edge_sidecar_to_children.edges) {
            if (child.node) {
              addVideo({ ...child.node, owner: node.owner, shortcode: child.node.shortcode || node.shortcode }, alvo, collected, false);
            }
          }
        }
      }

      hasNext   = data.page_info?.has_next_page ?? false;
      endCursor = data.page_info?.end_cursor ?? null;

      if (!endCursor) break;
      await sleep(1000); // ritmo mais seguro contra rate limit
    }
  }

  async function fetchTimelinePage(userId, after, headers) {
    // Feed v1 direto (o GraphQL com query_hash foi descontinuado pelo IG).
    const params = new URLSearchParams({ count: '33' });
    if (after) params.set('max_id', after);
    try {
      const json = await withRetry(() =>
        apiFetch(`https://www.instagram.com/api/v1/feed/user/${userId}/?${params}`, headers)
      );
      const items = json?.items || [];
      return {
        edges: items.map(item => ({ node: adaptV1Item(item) })),
        page_info: {
          has_next_page: !!json?.next_max_id,
          end_cursor: json?.next_max_id || null,
        },
      };
    } catch (e) {
      registrarErro('feed/user', e);
      return null;
    }
  }

  // ──────────────────────────────────────────────────────────────
  // REELS via endpoint /api/v1/clips/user/
  // ──────────────────────────────────────────────────────────────
  async function collectReels(userId, alvo, headers, collected, limit = Infinity) {
    let maxId = null;
    let page  = 0;
    let semNovos = 0;

    while (collected.size < limit && page < 80) {
      if (Date.now() > prazoScan) {
        registrarErro('tempo', new Error('a coleta atingiu o tempo limite — o que já foi encontrado vai abaixo'));
        break;
      }
      page++;
      progress(null, `Reels: página ${page} (${collected.size} vídeos até agora)...`);

      const json = await fetchClipsPage(userId, maxId, headers);
      if (!json) break;   // erro real já registrado — cai pro plano B

      const items = json?.items || [];
      const antes = collected.size;
      for (const item of items) {
        const media = item.media || item;
        const sc = media.code || media.shortcode || String(media.pk || media.id || '');
        if (sc) {
          codigosReels.add(sc);
          codigosVistos.add(sc);
        }
        addVideoV1(media, alvo, collected, false);
      }
      const novos = collected.size - antes;

      // O cursor aparece em três lugares diferentes conforme a versão do IG:
      // dentro de paging_info, dentro de paging, ou solto na raiz da resposta.
      // A versão anterior só olhava dentro de paging_info — quando o cursor vem
      // na raiz, a busca parava na primeira página (medido: 12 vídeos de um
      // perfil com 77 posts).
      const paging = json?.paging_info || json?.paging || {};
      const proximo = paging.max_id ?? paging.next_max_id ?? paging.maxId
                   ?? json?.next_max_id ?? json?.max_id ?? null;
      const temMais = paging.more_available ?? paging.moreAvailable ?? !!proximo;

      if (!temMais) break;                       // o Instagram disse que acabou
      if (!proximo) {
        registrarErro('clips paginação', new Error(`a página ${page} disse que há mais, mas não mandou o cursor`));
        break;
      }
      if (proximo === maxId) {
        registrarErro('clips paginação', new Error('o cursor voltou repetido — o Instagram parou de avançar'));
        break;
      }
      maxId = proximo;

      if (novos === 0) { semNovos++; if (semNovos >= 2) break; } else { semNovos = 0; }
      await sleep(1200 + Math.floor(Math.random() * 400));
    }
  }

  // GET primeiro. Medido em produção (2026-09-09): o POST em
  // /api/v1/clips/user/ devolve 200 com a casca HTML do app — o endpoint web
  // não aceita POST, e o Instagram responde a página em vez de 405. Quem usa
  // POST é a API mobile, com outra autenticação. Tinha invertido a ordem
  // baseado num comentário antigo do próprio código; o POST fica só como
  // reserva, caso o GET seja bloqueado.
  async function fetchClipsPage(userId, maxId, headers) {
    const corpo = {
      target_user_id: String(userId),
      page_size: '33',
      include_feed_video: 'true',
    };
    if (maxId) corpo.max_id = String(maxId);

    // Só GET. O POST foi medido duas vezes em produção e SEMPRE devolveu a
    // casca HTML com status 200 — o endpoint web não aceita POST. Mantê-lo
    // como reserva custava uma requisição a mais contra a mesma cota do
    // Instagram, que é justamente o recurso escasso aqui.
    try {
      const params = new URLSearchParams(corpo);
      return await withRetry(() =>
        apiFetch(`https://www.instagram.com/api/v1/clips/user/?${params}`, headers));
    } catch (e) {
      registrarErro('clips GET', e);
      if (e && e.status === 429) limiteAtingido = true;
      return null;
    }
  }

  // ──────────────────────────────────────────────────────────────
  // DE QUEM É ESTE VÍDEO?
  // ──────────────────────────────────────────────────────────────
  // O plano B varre TODO JSON da página, e a página do Instagram carrega muito
  // mais do que o perfil pedido: reels sugeridos, stories de quem você segue,
  // prévia do feed. Sem conferir o dono, uma busca por um perfil trouxe 1 vídeo
  // de outra conta (2026-09-09). Agora só entra o que é comprovadamente do
  // perfil alvo.
  function donoDoMedia(media) {
    const u = media.user || media.owner || {};
    return {
      nome: String(u.username || media.username || '').toLowerCase(),
      id:   String(u.pk || u.pk_id || u.id || media.user_id || ''),
    };
  }

  function donoBate(media, alvo, exigir) {
    const sc = media.code || media.shortcode || '';
    // Se o shortcode foi visto na grade do perfil exibido na tela, pertence ao perfil com certeza!
    if (sc && (codigosVistos.has(sc) || codigosReels.has(sc))) return true;

    const { nome, id } = donoDoMedia(media);
    const cleanAlvoUser = String(alvo.username || '').replace(/^@/, '').toLowerCase().trim();
    const cleanNome = String(nome || '').replace(/^@/, '').toLowerCase().trim();

    // divergência explícita reprova sempre, venha de onde vier
    if (cleanNome && cleanAlvoUser && cleanNome !== cleanAlvoUser) return false;
    if (!cleanNome && id && alvo.userId && id !== String(alvo.userId)) return false;
    const provado = (cleanNome && cleanAlvoUser && cleanNome === cleanAlvoUser)
                 || (id && alvo.userId && id === String(alvo.userId));
    return provado || !exigir;
  }

  // Maior resolução da lista (2.6.0): a primeira nem sempre é a maior.
  function maiorVersao(lista, campoUrl = 'url') {
    let melhor = '', area = -1;
    for (const v of (lista || [])) {
      const u = v && v[campoUrl];
      if (typeof u !== 'string' || !u.startsWith('http')) continue;
      const a = (Number(v.width || v.config_width) || 0) * (Number(v.height || v.config_height) || 0);
      if (a > area) { area = a; melhor = u; }
    }
    return melhor;
  }

  function urlDeImagem(media) {
    if (!media) return '';
    if (Array.isArray(media.image_versions2?.candidates) && media.image_versions2.candidates.length) {
      return maiorVersao(media.image_versions2.candidates);
    }
    if (Array.isArray(media.display_resources) && media.display_resources.length) {
      return maiorVersao(media.display_resources, 'src');
    }
    return media.display_url || media.thumbnail_src || media.thumbnail_url || '';
  }

  // ──────────────────────────────────────────────────────────────
  // ADICIONAR MÍDIA (VÍDEO OU FOTO) AO MAPA
  // ──────────────────────────────────────────────────────────────
  function addVideo(node, alvo, map, exigirDono = false) {
    const sc = node.shortcode || node.code || String(node.id);
    if (!sc) return;
    if (!donoBate(node, alvo, exigirDono)) { ignorados++; return; }

    const videoUrl = node.video_url || urlDeVideo(node);
    const isVid = !!videoUrl;
    const isVideoPost = codigosReels.has(sc) ||
                        node.is_video === true ||
                        node.media_type === 2 ||
                        node.__typename === 'GraphVideo' ||
                        !!node.is_video_clip ||
                        node.product_type === 'clips';
    const isPhotoPost = !isVideoPost && (
                        node.media_type === 1 ||
                        node.__typename === 'GraphImage' ||
                        node.is_video === false);

    // Se é sabidamente vídeo/reel mas ainda não tem URL MP4:
    // Nunca salve como foto! Registra para resolução.
    if (isVideoPost && !isVid) {
      codigosVistos.add(sc);
      return;
    }

    if (!isVid && !isPhotoPost) {
      return;
    }

    const coverUrl = urlDeImagem(node) || node.display_url || node.thumbnail_src || '';
    const mediaUrl = isVid ? videoUrl : coverUrl;
    if (!mediaUrl) return;

    if (map.has(sc)) {
      const existente = map.get(sc);
      if (existente && existente.type !== 'photo' && existente.videoUrl) return;
      if (!isVid) return;
    }

    const thumb = coverUrl || mediaUrl;
    const caption = node.edge_media_to_caption?.edges?.[0]?.node?.text || node.caption?.text || '';
    const ts = node.taken_at_timestamp || node.taken_at;
    const timestamp = isoFromTs(ts);
    const isReel = node.__typename === 'GraphVideo' || !!node.is_video_clip || node.product_type === 'clips';
    const type = isVid ? (isReel ? 'reel' : 'video') : 'photo';
    const dur = node.video_duration || 0;
    const ext = isVid ? 'mp4' : 'jpg';

    map.set(sc, {
      id: sc,
      postUrl: `https://www.instagram.com/p/${sc}/`,
      videoUrl: isVid ? mediaUrl : '',
      photoUrl: isVid ? '' : mediaUrl,
      coverUrl: coverUrl,
      mediaUrl: mediaUrl,
      thumbnail: thumb,
      caption: String(caption).slice(0, 120),
      timestamp,
      type,
      sizeEstimate: isVid ? (dur ? Math.round(dur * 500000) : 2000000) : 500000,
      filename: isVid ? `${type}_${sc}.${ext}` : `foto_${sc}.${ext}`
    });
  }

  // O Instagram tem VÁRIOS nomes para a mesma coisa, conforme a origem do payload.
  const CHAVES_VIDEO = [
    'video_url',
    'browser_native_hd_url',
    'browser_native_sd_url',
    'playable_url_quality_hd',
    'playable_url',
  ];

  function urlDeVideo(media) {
    if (!media) return '';
    if (Array.isArray(media.video_versions) && media.video_versions.length) {
      const u = maiorVersao(media.video_versions);
      if (u) return u;
    }
    if (Array.isArray(media.video_resources) && media.video_resources.length) {
      const u = maiorVersao(media.video_resources, 'src');
      if (u) return u;
    }
    for (const k of CHAVES_VIDEO) {
      if (typeof media[k] === 'string' && media[k].startsWith('http')) return media[k];
    }
    return '';
  }

  function temDadosDeVideo(no) {
    if (!no) return false;
    if (Array.isArray(no.video_versions) && no.video_versions.length) return true;
    if (Array.isArray(no.video_resources) && no.video_resources.length) return true;
    return CHAVES_VIDEO.some(k => typeof no[k] === 'string' && no[k].startsWith('http'));
  }

  // Base64 alphabet do Instagram para conversão shortcode <-> ID numérico
  const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  function shortcodeToId(shortcode) {
    if (!shortcode || typeof shortcode !== 'string') return '';
    try {
      let id = BigInt(0);
      for (let i = 0; i < shortcode.length; i++) {
        const idx = B64_ALPHABET.indexOf(shortcode[i]);
        if (idx < 0) return '';
        id = id * 64n + BigInt(idx);
      }
      return id.toString();
    } catch {
      return '';
    }
  }

  // Helper para limpar e desescapar URLs de CDN do Instagram
  function decIgUrl(u) {
    if (!u) return '';
    let clean = u.replace(/\\u0026/g, '&').replace(/&amp;/g, '&');
    try {
      if (clean.includes('\\')) {
        clean = JSON.parse('"' + clean.replace(/"/g, '\\"') + '"');
      }
    } catch {}
    clean = clean.replace(/\\\/|\//g, (m) => m === '\\/' ? '/' : m).replace(/\\/g, '');
    if (clean.startsWith('//')) clean = 'https:' + clean;
    return clean;
  }

  // Extrai informações completas de vídeo a partir do HTML de uma página de reel/post/embed
  function extrairVideoDoHtmlDePost(html, sc, isKnownReel = false) {
    if (!html || typeof html !== 'string') return null;

    let videoUrl = '';

    // 1. Varrer tags <video src="..."> (muito comum em páginas /embed/ e /reel/)
    const mTagVid = html.match(/<video[^>]+src=["']([^"']+)["']/i);
    if (mTagVid && mTagVid[1] && mTagVid[1].startsWith('http')) {
      videoUrl = decIgUrl(mTagVid[1]);
    }

    // 2. Varrer meta tags OpenGraph og:video e og:video:secure_url
    if (!videoUrl) {
      const mOgVid = html.match(/<meta\s+(?:property|name)=["']og:video(?::secure_url)?["']\s+content=["']([^"']+)["']/i) ||
                     html.match(/<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["']og:video(?::secure_url)?["']/i);
      if (mOgVid && mOgVid[1]) {
        videoUrl = decIgUrl(mOgVid[1]);
      }
    }

    // 3. Procura em blocos JSON na página
    if (!videoUrl) {
      try {
        const scriptMatches = html.matchAll(/<script[^>]*type=["']application\/json["'][^>]*>(.*?)<\/script>/gis);
        for (const m of scriptMatches) {
          const txt = m[1] || '';
          if (txt.includes('video_versions') || txt.includes('video_url') || txt.includes('browser_native') || txt.includes('playable_url')) {
            try {
              const obj = JSON.parse(txt);
              function busca(o, dep = 0) {
                if (!o || typeof o !== 'object' || dep > 16 || videoUrl) return;
                if (Array.isArray(o)) { for (const it of o) busca(it, dep + 1); return; }
                const c = o.code || o.shortcode || o.id;
                if (c === sc || !videoUrl) {
                  const u = urlDeVideo(o);
                  if (u) { videoUrl = u; return; }
                }
                for (const k in o) busca(o[k], dep + 1);
              }
              busca(obj);
              if (videoUrl) break;
            } catch {}
          }
        }
      } catch {}
    }

    // 4. Regex flexível para video_url, video_versions, browser_native_hd_url, playable_url (suporta slashes escapados \/)
    if (!videoUrl) {
      const mVid = html.match(/(?:\\"|"|)video_url(?:\\"|"|)\s*:\s*(?:\\"|")((?:https?:)?(?:\\\/\\\/|\/\/)[^"'\s<>]+?)(?:\\"|")/i) ||
                   html.match(/(?:\\"|"|)browser_native_hd_url(?:\\"|"|)\s*:\s*(?:\\"|")((?:https?:)?(?:\\\/\\\/|\/\/)[^"'\s<>]+?)(?:\\"|")/i) ||
                   html.match(/(?:\\"|"|)playable_url_quality_hd(?:\\"|"|)\s*:\s*(?:\\"|")((?:https?:)?(?:\\\/\\\/|\/\/)[^"'\s<>]+?)(?:\\"|")/i) ||
                   html.match(/(?:\\"|"|)playable_url(?:\\"|"|)\s*:\s*(?:\\"|")((?:https?:)?(?:\\\/\\\/|\/\/)[^"'\s<>]+?)(?:\\"|")/i) ||
                   html.match(/(?:\\"|"|)browser_native_sd_url(?:\\"|"|)\s*:\s*(?:\\"|")((?:https?:)?(?:\\\/\\\/|\/\/)[^"'\s<>]+?)(?:\\"|")/i) ||
                   html.match(/(?:\\"|"|)video_versions(?:\\"|"|)\s*:\s*\[\s*\{[^}]*?(?:\\"|"|)url(?:\\"|"|)\s*:\s*(?:\\"|")((?:https?:)?(?:\\\/\\\/|\/\/)[^"'\s<>]+?)(?:\\"|")/i);
      if (mVid && mVid[1]) {
        videoUrl = decIgUrl(mVid[1]);
      }
    }

    // 5. Regex de MP4 direta no HTML (suporta URLs escapadas com \/ e normais)
    if (!videoUrl) {
      const mMp4 = html.match(/((?:https?:)?(?:\\\/\\\/|\/\/)[^"'\s<>]+?(?:cdninstagram\.com|fbcdn\.net)[^"'\s<>]+\.mp4[^"'\s<>]*)/i);
      if (mMp4 && mMp4[1]) {
        videoUrl = decIgUrl(mMp4[1]);
      }
    }

    // Se NÃO achou URL de vídeo:
    if (!videoUrl) {
      const isReel = isKnownReel ||
                     codigosReels.has(sc) ||
                     /\\?"is_video\\?"\s*:\s*true/i.test(html) ||
                     /\\?"media_type\\?"\s*:\s*2/i.test(html) ||
                     /\\?"product_type\\?"\s*:\s*\\?"clips\\?"/i.test(html) ||
                     /data-media-type="GraphVideo"/i.test(html) ||
                     /property="og:type"\s+content="video/i.test(html) ||
                     /property="og:video/i.test(html) ||
                     html.includes('/reel/') ||
                     /video_duration/i.test(html);

      if (isReel) {
        // Sabidamente Reel/Vídeo cujo MP4 não está neste HTML:
        // NUNCA degrade para foto! Devolve null para que outro endpoint resolva.
        return null;
      }

      // É FOTO! Extrai a melhor imagem disponível
      let imgUrl = '';
      const mDisplay = html.match(/"display_url"\s*:\s*"([^"]+)"/) ||
                       html.match(/"image_versions2":\{"candidates":\[\{"url":"([^"]+)"/);
      if (mDisplay && mDisplay[1]) {
        imgUrl = decIgUrl(mDisplay[1]);
      }
      if (!imgUrl) {
        const mOg = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);
        if (mOg && mOg[1]) imgUrl = decIgUrl(mOg[1]);
      }
      if (!imgUrl) return null;

      let caption = '';
      const mCap = html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i) ||
                   html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i);
      if (mCap && mCap[1]) caption = mCap[1].slice(0, 120);

      return {
        id: sc,
        postUrl: `https://www.instagram.com/p/${sc}/`,
        videoUrl: '',
        photoUrl: imgUrl,
        coverUrl: imgUrl,
        mediaUrl: imgUrl,
        thumbnail: imgUrl,
        caption,
        timestamp: '',
        type: 'photo',
        sizeEstimate: 500000,
        filename: `foto_${sc}.jpg`
      };
    }

    // ACHOU VÍDEO!
    let thumb = '';
    const mThumb = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i) ||
                   html.match(/"display_url"\s*:\s*"([^"]+)"/);
    if (mThumb && mThumb[1]) thumb = decIgUrl(mThumb[1]);

    let caption = '';
    const mCap = html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i) ||
                 html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i);
    if (mCap && mCap[1]) caption = mCap[1].slice(0, 120);

    return {
      id: sc,
      postUrl: `https://www.instagram.com/reel/${sc}/`,
      videoUrl,
      photoUrl: '',
      coverUrl: thumb,
      mediaUrl: videoUrl,
      thumbnail: thumb,
      caption,
      timestamp: '',
      type: 'reel',
      sizeEstimate: 2000000,
      filename: `reel_${sc}.mp4`
    };
  }

  // Resolve um post específico aproveitando a sessão logada do navegador
  async function resolverPostIndividual(sc, headers) {
    const isKnownReel = codigosReels.has(sc);
    const mediaId = shortcodeToId(sc);

    // 1. Endpoint /api/v1/media/{mediaId}/info/ (Sessão autenticada do usuário no Instagram)
    // Este endpoint interno oficial devolve o objeto completo com video_versions e URL MP4 direta.
    if (mediaId) {
      try {
        const resp = await fetch(`https://www.instagram.com/api/v1/media/${mediaId}/info/`, {
          credentials: 'include',
          headers
        });
        if (resp.ok) {
          const json = await resp.json();
          const item = json?.items?.[0];
          if (item) {
            const vUrl = urlDeVideo(item);
            const isVid = !!vUrl;
            if (isVid || (!isKnownReel && item.media_type === 1)) {
              const coverUrl = urlDeImagem(item) || item.image_versions2?.candidates?.[0]?.url || item.thumbnail_url || '';
              const mediaUrl = isVid ? vUrl : coverUrl;
              if (mediaUrl) {
                const thumb = coverUrl || mediaUrl;
                const caption = item.caption?.text || '';
                const ts = item.taken_at || '';
                const dur = item.video_duration || 0;
                const isReel = isKnownReel || item.product_type === 'clips' || item.is_video_clip || item.media_type === 2;
                const type = isVid ? (isReel ? 'reel' : 'video') : 'photo';
                const ext = isVid ? 'mp4' : 'jpg';
                return {
                  id: sc,
                  postUrl: `https://www.instagram.com/reel/${sc}/`,
                  videoUrl: isVid ? mediaUrl : '',
                  photoUrl: isVid ? '' : mediaUrl,
                  coverUrl: coverUrl,
                  mediaUrl: mediaUrl,
                  thumbnail: thumb,
                  caption: String(caption).slice(0, 120),
                  timestamp: isoFromTs(ts),
                  type,
                  sizeEstimate: isVid ? (dur ? Math.round(dur * 500000) : 2000000) : 500000,
                  filename: isVid ? `${type}_${sc}.${ext}` : `foto_${sc}.${ext}`
                };
              }
            }
          }
        }
      } catch {}
    }

    // 2. Endpoint __a=1&__d=dis (tenta /reel/ e depois /p/)
    for (const prefix of (isKnownReel ? ['reel', 'p'] : ['p', 'reel'])) {
      try {
        const resp = await fetch(`https://www.instagram.com/${prefix}/${sc}/?__a=1&__d=dis`, {
          credentials: 'include',
          headers
        });
        if (resp.ok) {
          const texto = await resp.text();
          if (texto && !texto.trimStart().startsWith('<')) {
            const json = JSON.parse(texto);
            const item = json?.items?.[0] || json?.graphql?.shortcode_media || json;
            const vUrl = urlDeVideo(item);
            const isVid = !!vUrl;
            if (isVid || (!isKnownReel && item.is_video === false)) {
              const coverUrl = urlDeImagem(item) || item.image_versions2?.candidates?.[0]?.url || item.thumbnail_src || item.display_url || '';
              const mediaUrl = isVid ? vUrl : coverUrl;
              if (mediaUrl) {
                const thumb = coverUrl || mediaUrl;
                const caption = item.caption?.text || item.edge_media_to_caption?.edges?.[0]?.node?.text || '';
                const ts = item.taken_at || item.taken_at_timestamp || '';
                const dur = item.video_duration || 0;
                const isReel = isKnownReel || item.product_type === 'clips' || item.is_video_clip || item.media_type === 2 || item.__typename === 'GraphVideo';
                const type = isVid ? (isReel ? 'reel' : 'video') : 'photo';
                const ext = isVid ? 'mp4' : 'jpg';
                return {
                  id: sc,
                  postUrl: `https://www.instagram.com/reel/${sc}/`,
                  videoUrl: isVid ? mediaUrl : '',
                  photoUrl: isVid ? '' : mediaUrl,
                  coverUrl: coverUrl,
                  mediaUrl: mediaUrl,
                  thumbnail: thumb,
                  caption: String(caption).slice(0, 120),
                  timestamp: isoFromTs(ts),
                  type,
                  sizeEstimate: isVid ? (dur ? Math.round(dur * 500000) : 2000000) : 500000,
                  filename: isVid ? `${type}_${sc}.${ext}` : `foto_${sc}.${ext}`
                };
              }
            }
          }
        }
      } catch {}
    }

    // 3. Tenta página de embed (/reel/ ou /p/)
    try {
      const rotaEmbed = isKnownReel ? `https://www.instagram.com/reel/${sc}/embed/` : `https://www.instagram.com/p/${sc}/embed/`;
      const resp = await fetch(rotaEmbed, { credentials: 'include' });
      if (resp.ok) {
        const html = await resp.text();
        const v = extrairVideoDoHtmlDePost(html, sc, isKnownReel);
        if (v && v.videoUrl) return v;
      }
    } catch {}

    // 4. Tenta carregar a página direta do post / reel (/reel/ ou /p/)
    for (const rota of (isKnownReel ? [`https://www.instagram.com/reel/${sc}/`, `https://www.instagram.com/p/${sc}/`] : [`https://www.instagram.com/p/${sc}/`, `https://www.instagram.com/reel/${sc}/`])) {
      try {
        const resp = await fetch(rota, { credentials: 'include' });
        if (resp.ok) {
          const html = await resp.text();
          const v = extrairVideoDoHtmlDePost(html, sc, isKnownReel);
          if (v && (v.videoUrl || (!isKnownReel && v.type === 'photo'))) return v;
        }
      } catch {}
    }

    return null;
  }

  // Resolve um lote de shortcodes diretamente no navegador com concorrência controlada
  async function resolverLoteNoNavegador(codigosFaltando, headers, collected, limit = Infinity) {
    const total = codigosFaltando.length;
    let resolvidos = 0;
    const CONCORRENCIA = 5;

    for (let i = 0; i < codigosFaltando.length; i += CONCORRENCIA) {
      if (collected.size >= limit || Date.now() > prazoScan) break;
      const lote = codigosFaltando.slice(i, i + CONCORRENCIA);
      progress(null, `Resolvendo vídeos no navegador: ${collected.size} de ${codigosFaltando.length + collected.size}...`);

      const promessas = lote.map(async (sc) => {
        try {
          const item = await resolverPostIndividual(sc, headers);
          if (item && (item.videoUrl || item.photoUrl || item.mediaUrl)) {
            if (collected.has(sc)) {
              const ex = collected.get(sc);
              if (ex && ex.type !== 'photo' && ex.videoUrl) return;
              if (item.type === 'photo') return;
            }
            collected.set(sc, item);
            resolvidos++;
          }
        } catch {}
      });

      await Promise.all(promessas);
      await sleep(150);
    }
    return resolvidos;
  }

  function addVideoV1(media, alvo, map, exigirDono = false) {
    const sc = media.code || media.shortcode || String(media.pk || media.id || '');
    if (!sc) return;
    if (!donoBate(media, alvo, exigirDono)) { ignorados++; return; }

    const videoUrl = urlDeVideo(media);
    const isVid = !!videoUrl;
    const isVideoPost = codigosReels.has(sc) ||
                        media.is_video === true ||
                        media.media_type === 2 ||
                        media.__typename === 'GraphVideo' ||
                        media.product_type === 'clips' ||
                        !!media.is_video_clip;
    const isPhotoPost = !isVideoPost && (
                        media.media_type === 1 ||
                        media.__typename === 'GraphImage' ||
                        media.is_video === false);

    // Se é sabidamente vídeo/reel mas ainda não tem URL MP4:
    // Nunca adicione como foto! Registra para resolução.
    if (isVideoPost && !isVid) {
      codigosVistos.add(sc);
      return;
    }

    if (!isVid && !isPhotoPost) {
      return;
    }

    const coverUrl = urlDeImagem(media) ||
                     media.image_versions2?.candidates?.[0]?.url ||
                     media.thumbnail_url || '';
    const mediaUrl = isVid ? videoUrl : coverUrl;
    if (!mediaUrl) return;

    if (map.has(sc)) {
      const existente = map.get(sc);
      if (existente && existente.type !== 'photo' && existente.videoUrl) return;
      if (!isVid) return;
    }

    const thumb = coverUrl || mediaUrl;
    const caption = media.caption?.text || '';
    const ts = media.taken_at;
    const timestamp = isoFromTs(ts);
    const dur = media.video_duration || 0;
    const isReel = media.product_type === 'clips' || media.is_video_clip || media.media_type === 2;
    const type = isVid ? (isReel ? 'reel' : 'video') : 'photo';
    const ext = isVid ? 'mp4' : 'jpg';

    map.set(sc, {
      id: sc,
      postUrl: `https://www.instagram.com/p/${sc}/`,
      videoUrl: isVid ? mediaUrl : '',
      photoUrl: isVid ? '' : mediaUrl,
      coverUrl: coverUrl,
      mediaUrl: mediaUrl,
      thumbnail: thumb,
      caption: String(caption).slice(0, 120),
      timestamp,
      type,
      sizeEstimate: isVid ? (dur ? Math.round(dur * 500000) : 2000000) : 500000,
      filename: isVid ? `${type}_${sc}.${ext}` : `foto_${sc}.${ext}`
    });

    // Se for carrossel com múltiplos itens (carousel_media)
    if (media.carousel_media && Array.isArray(media.carousel_media)) {
      media.carousel_media.forEach((child, idx) => {
        const cSc = `${sc}_${idx + 1}`;
        const cVUrl = urlDeVideo(child);
        const cIsVid = !!cVUrl;
        const cIsVideoPost = child.is_video === true || child.media_type === 2 || child.__typename === 'GraphVideo';
        if (cIsVideoPost && !cIsVid) return;

        const cCoverUrl = urlDeImagem(child) || child.image_versions2?.candidates?.[0]?.url || child.thumbnail_url || '';
        const cMediaUrl = cIsVid ? cVUrl : cCoverUrl;
        if (cMediaUrl) {
          if (map.has(cSc)) {
            const ex = map.get(cSc);
            if (ex && ex.type !== 'photo' && ex.videoUrl) return;
            if (!cIsVid) return;
          }
          const cThumb = cCoverUrl || cMediaUrl;
          const cType = cIsVid ? 'video' : 'photo';
          const cExt = cIsVid ? 'mp4' : 'jpg';
          map.set(cSc, {
            id: cSc,
            postUrl: `https://www.instagram.com/p/${sc}/`,
            videoUrl: cIsVid ? cMediaUrl : '',
            photoUrl: cIsVid ? '' : cMediaUrl,
            coverUrl: cCoverUrl,
            mediaUrl: cMediaUrl,
            thumbnail: cThumb,
            caption: String(caption).slice(0, 120),
            timestamp,
            type: cType,
            sizeEstimate: cIsVid ? 2000000 : 500000,
            filename: cIsVid ? `${cType}_${cSc}.${cExt}` : `foto_${cSc}.${cExt}`
          });
        }
      });
    }
  }

  function adaptV1Item(item) {
    const isCarousel = item.media_type === 8;
    const isVideo = item.media_type === 2;
    const node = {
      __typename: isCarousel ? 'GraphSidecar' : (isVideo ? 'GraphVideo' : 'GraphImage'),
      owner: item.user || null,
      id: item.pk || item.id,
      shortcode: item.code || item.shortcode,
      is_video: isVideo,
      video_url: urlDeVideo(item),
      thumbnail_src: urlDeImagem(item),
      display_url: urlDeImagem(item),
      taken_at_timestamp: item.taken_at,
      video_duration: item.video_duration,
      edge_media_to_caption: {
        edges: item.caption ? [{ node: { text: item.caption.text } }] : []
      }
    };
    
    if (isCarousel && item.carousel_media) {
      node.edge_sidecar_to_children = {
        edges: item.carousel_media.map(child => ({ node: adaptV1Item(child) }))
      };
    }
    
    return node;
  }

  // ──────────────────────────────────────────────────────────────
  // UTILS
  // ──────────────────────────────────────────────────────────────

  // Headers das chamadas /api/v1/ — exatamente os que a extensão sempre mandou.
  //
  // REVERTIDO em 2026-09-09: eu tinha acrescentado 'X-IG-WWW-Claim' e
  // 'X-Requested-With' por conhecimento genérico de scraping, sem ter medido
  // nada. Foram um palpite, e um palpite ruim:
  //   • o claim é um token de sessão que o app renova; mandar um valor
  //     desatualizado (ou o literal "0") é PIOR do que não mandar header
  //     nenhum, porque afirma algo errado sobre a sessão;
  //   • o app do Instagram não manda X-Requested-With nas chamadas fetch —
  //     mandar serve só de impressão digital de requisição sintética.
  // O 429 começou justamente depois dessa mudança. Sem prova de que eram
  // necessários, o certo é voltar ao conjunto que funcionava.
  function igHeaders(username, csrf) {
    return {
      'X-IG-App-ID': '936619743392459',
      'X-ASBD-ID':   '129477',
      'X-CSRFToken': csrf,
      'Accept':      '*/*',
    };
  }

  // Erro com status e trecho do corpo — é o que permite dizer ao usuário
  // "403 do Instagram" em vez de "0 vídeos".
  //
  // Lê como TEXTO e só então faz JSON.parse: res.json() estoura um
  // "Unexpected token '<'" que não diz status nem o que veio. E o que vem
  // nesses casos é justamente a casca HTML do app do Instagram — resposta
  // 200, conteúdo inútil. Sem ler o texto, esse caso ficava indistinguível
  // de um erro de rede.
  async function requisicao(url, opcoes) {
    const res = await fetch(url, { credentials: 'include', ...opcoes });
    const texto = await res.text().catch(() => '');

    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      err.corpo  = texto.slice(0, 160);
      throw err;
    }

    const inicio = texto.trimStart().slice(0, 1);
    if (inicio === '<') {
      const err = new Error(`HTTP ${res.status} devolveu HTML (o Instagram serviu a página do app, não a API)`);
      err.status = res.status;
      err.html   = true;
      err.corpo  = texto.trimStart().slice(0, 100).replace(/\s+/g, ' ');
      throw err;
    }

    try {
      return JSON.parse(texto);
    } catch (e) {
      const err = new Error(`HTTP ${res.status} com resposta ilegível`);
      err.status = res.status;
      err.corpo  = texto.slice(0, 100).replace(/\s+/g, ' ');
      throw err;
    }
  }

  function apiFetch(url, headers) {
    return requisicao(url, { headers });
  }

  // Retry com backoff. Só insiste no que pode melhorar esperando: 429 e 5xx.
  //
  // Espera curta no 429, de propósito (2026-09-09, decisão do dono do produto).
  // Cheguei a colocar 20s/45s/90s porque é a escala em que esse limite abre de
  // verdade — mas prender o usuário olhando um cronômetro é pior do que
  // devolver logo o que já dá. Uma tentativa rápida cobre a oscilação
  // momentânea; se o limite for de cota mesmo, nenhuma espera razoável
  // resolveria, e o certo é entregar parcial com o aviso.
  const ESPERA_429 = [4000];

  async function withRetry(fn, tries = 3) {
    let lastErr = null;
    for (let attempt = 0; attempt < tries; attempt++) {
      try {
        return await fn();
      } catch (e) {
        lastErr = e;
        const st = e && e.status || 0;
        if (st >= 400 && st < 500 && st !== 429) break; // não adianta repetir
        if (attempt === tries - 1) break;               // última tentativa: não espera à toa

        let espera;
        if (st === 429) {
          if (attempt >= ESPERA_429.length) break;   // não insiste no limite
          espera = ESPERA_429[attempt];
        } else {
          espera = 1500 * (attempt + 1);
        }
        await sleep(espera + Math.floor(Math.random() * 400));
      }
    }
    throw lastErr;
  }

  // Extrai o user_id numérico dos dados que a própria página do perfil já
  // embute — não faz nenhuma requisição de rede, só lê o que está na tela.
  function extractUserIdFromPage(username) {
    const cleanU = String(username || '').replace(/^@/, '').toLowerCase().trim();
    try {
      const scripts = document.querySelectorAll('script[type="application/json"]');
      for (const s of scripts) {
        const txt = s.textContent || '';
        if (txt.length < 50) continue;
        const m = txt.match(/"target_user_id":"(\d{5,20})"/i) ||
                  txt.match(/"profile_id":"(\d{5,20})"/i) ||
                  txt.match(/"user_id":"(\d{5,20})"/i) ||
                  txt.match(new RegExp(`"id":"(\\d{5,20})"[^}]{0,150}"username":"${cleanU}"`, 'i')) ||
                  txt.match(new RegExp(`"username":"${cleanU}"[^}]{0,150}"id":"(\\d{5,20})"`, 'i'));
        if (m) return m[1];
      }
    } catch {}

    // Fallback: varre o HTML bruto para encontrar os novos formatos (incluindo aba de Reels)
    try {
      const html = document.documentElement.innerHTML;

      const m3 = html.match(/"profilePage_(\d+)"/i);
      if (m3) return m3[1];

      const m4 = html.match(/"profile_id":"(\d+)"/i);
      if (m4) return m4[1];

      const m5 = html.match(/"PolarisProfile(?:Posts|Reels|Clips)TabRoot[^"]*","props":\{"id":"(\d+)"/i);
      if (m5) return m5[1];

      const re = new RegExp(`"(?:pk|id)":"?(\\d{5,20})"?[^}]{0,200}"username":"${cleanU}"`, 'i');
      const m2 = html.match(re);
      if (m2) return m2[1];

      const re2 = new RegExp(`"username":"${cleanU}"[^}]{0,200}"(?:pk|id)":"?(\\d{5,20})"`, 'i');
      const m2b = html.match(re2);
      if (m2b) return m2b[1];

      const m6 = html.match(/"owner":\{"[^}]*"id":"(\d{5,20})"/i);
      if (m6) return m6[1];
    } catch {}
    return null;
  }

  function getCsrfToken() {
    const match = document.cookie.match(/csrftoken=([^;]+)/);
    return match ? match[1] : '';
  }

  function extractUsernameFromUrl() {
    const path = window.location.pathname;
    const parts = path.split('/').filter(Boolean);
    if (!parts.length) return null;
    const reserved = ['p', 'reel', 'reels', 'stories', 'explore', 'accounts', 'direct', 'tv'];
    return reserved.includes(parts[0]) ? null : parts[0];
  }

  // Retrato do que a página oferecia quando a busca terminou vazia. É o que
  // separa "o Instagram bloqueou a API" de "a grade nem carregou" de "a grade
  // carregou mas sem as URLs de vídeo".
  function diagnostico() {
    let links = 0;
    try { links = document.querySelectorAll('a[href*="/reel/"], a[href*="/p/"]').length; } catch {}
    // A versão vai junto de propósito: um relatório de erro sem ela não diz se
    // o problema é do build atual ou de uma cópia antiga presa no cache do
    // navegador — foi exatamente essa dúvida que custou uma rodada inteira.
    let versao = '';
    try { versao = 'v' + chrome.runtime.getManifest().version + ' | '; } catch {}
    return `${versao}página: ${links} link(s) de post na tela | ${capturasTotais} resposta(s) do app capturadas | `
         + `${comVideo} objeto(s) com vídeo | ${ignorados} de outro perfil`;
  }

  function progress(percent, label) {
    chrome.runtime.sendMessage({ action: 'SCAN_PROGRESS', percent, label });
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

})();
