// InstaGestor Downloader — ig_hook.js (observa as respostas internas do Instagram).
// ig_hook.js — roda no mundo MAIN da página do Instagram (document_start).
//
// Por que isto existe (2026-09-09): a extensão montava as chamadas de API na
// mão (/api/v1/clips/user/, /api/v1/feed/user/) com headers simulados. A Meta
// aperta esses endpoints periodicamente e as chamadas passam a voltar 400/403
// — foi o que deixou a busca em "0 vídeos". Em vez de adivinhar o próximo
// conjunto de headers, aqui a extensão simplesmente ESCUTA as respostas que o
// próprio Instagram já busca enquanto a página rola. São as requisições
// legítimas do app, com todos os headers e tokens que só ele sabe montar —
// não tem o que bloquear.
//
// O content script (mundo isolado) não enxerga window.fetch da página, por
// isso este arquivo precisa rodar no mundo MAIN e repassar por postMessage.
(() => {
  'use strict';
  if (window.__autofyIgHook) return;
  window.__autofyIgHook = true;

  // Captura qualquer endpoint de dados do Instagram Web:
  // /api/graphql, /graphql/query, /graphql, /api/v1/clips/, /api/v1/feed/, etc.
  function interessa(url) {
    try {
      const u = String(url || '').toLowerCase();
      if (!u) return false;
      // Ignora assets estáticos e telemetria
      if (u.includes('.js') || u.includes('.css') || u.includes('/logging/') || u.includes('/ajax/bz')) return false;
      return u.includes('graphql') ||
             u.includes('/api/v1/') ||
             u.includes('/api/v2/') ||
             u.includes('/clips/') ||
             u.includes('/feed/');
    } catch { return false; }
  }

  function entregar(url, payload) {
    if (!payload) return;
    try {
      if (typeof payload === 'object' && payload !== null) {
        window.postMessage({ __autofy_ig: true, url: String(url), dados: payload }, '*');
        return;
      }
      const texto = String(payload).trim();
      if (texto.length < 2) return;
      // Trata tanto JSON único quanto NDJSON (múltiplos JSONs por linha)
      if (texto.startsWith('{') || texto.startsWith('[')) {
        try {
          const dados = JSON.parse(texto);
          window.postMessage({ __autofy_ig: true, url: String(url), dados }, '*');
          return;
        } catch {}
      }
      // Se tiver linhas separadas (stream GraphQL do Relay)
      const linhas = texto.split('\n');
      for (const linha of linhas) {
        const l = linha.trim();
        if (l.startsWith('{') && l.endsWith('}')) {
          try {
            const dados = JSON.parse(l);
            window.postMessage({ __autofy_ig: true, url: String(url), dados }, '*');
          } catch {}
        }
      }
    } catch {
      // payload gigante ou não clonável — ignora
    }
  }

  // ── fetch ──────────────────────────────────────────────────────────────────
  const fetchOriginal = window.fetch;
  window.fetch = function (entrada, init) {
    const url = (entrada && entrada.url) ? entrada.url : (typeof entrada === 'string' ? entrada : '');
    const p = fetchOriginal.apply(this, arguments);
    if (!interessa(url)) return p;
    return p.then((res) => {
      try {
        res.clone().text().then((t) => entregar(url, t)).catch(() => {});
      } catch {}
      return res;
    });
  };

  // ── XMLHttpRequest ─────────────────────────────────────────────────────────
  const abrirOriginal = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (metodo, url) {
    this.__autofyUrl = url;
    return abrirOriginal.apply(this, arguments);
  };

  const enviarOriginal = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function () {
    if (interessa(this.__autofyUrl)) {
      this.addEventListener('load', () => {
        try {
          if (this.responseType === 'json' && this.response) {
            entregar(this.__autofyUrl, this.response);
          } else {
            entregar(this.__autofyUrl, this.responseText);
          }
        } catch {}
      });
    }
    return enviarOriginal.apply(this, arguments);
  };
})();
