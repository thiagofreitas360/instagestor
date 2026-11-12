// Conferidor de destaques do InstaGestor. Roda no PC do cliente (Windows ou Ubuntu), aberto pelo arquivo
// baixado em Configurações, que define CONFERIDOR_URL e CONFERIDOR_CHAVE e baixa esta versão a cada abertura.
// Usa o Chrome (ou o Edge) já instalado, num perfil separado e invisível, logado numa conta de Instagram só
// para isso, e conversa com ele pelo protocolo de depuração do Chrome: sem dependências além do Node.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { setTimeout as dormir } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const URL_BASE = process.env.CONFERIDOR_URL;
const CHAVE = process.env.CONFERIDOR_CHAVE;
const PERFIL = join(dirname(fileURLToPath(import.meta.url)), "perfil-chrome");
const ARQUIVO_PORTA = join(PERFIL, "DevToolsActivePort");
const INSTAGRAM = "https://www.instagram.com/";
const PAUSA_ENTRE_PERFIS_MS = 10_000;
const ESPERA_SEM_PEDIDO_MS = 30_000;
// Identificador público do site instagram.com, enviado pelo próprio site ao abrir um perfil.
const INSTAGRAM_WEB_APP_ID = "936619743392459";

/** Interrompe a rodada inteira: continuar só pioraria (Instagram pedindo pausa, sem login). */
class Parada extends Error {}
class SemLogin extends Parada {}

async function api(metodo, corpo) {
  const resposta = await fetch(`${URL_BASE}/api/conferidor`, {
    method: metodo,
    headers: { authorization: `Bearer ${CHAVE}`, ...(corpo ? { "content-type": "application/json" } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  if (resposta.status === 401) {
    console.error("O InstaGestor recusou a chave deste conferidor: o programa foi baixado de novo depois deste.");
    console.error("Use o arquivo mais novo, ou baixe o conferidor de novo em Configurações.");
    process.exit(1);
  }
  if (!resposta.ok) throw new Error(`O InstaGestor respondeu ${resposta.status}; tentando de novo em instantes.`);
  return resposta.json();
}

function acharNavegador() {
  const [pastas, executaveis] = process.platform === "win32"
    ? [[process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA], ["Google/Chrome/Application/chrome.exe", "Microsoft/Edge/Application/msedge.exe"]]
    : [(process.env.PATH ?? "").split(delimiter), ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]];
  for (const executavel of executaveis) {
    for (const pasta of pastas.filter(Boolean)) {
      if (existsSync(join(pasta, executavel))) return join(pasta, executavel);
    }
  }
  console.error("Não achei o Google Chrome neste computador. Instale o Chrome e abra o conferidor de novo.");
  process.exit(1);
}

/** Porta de um Chrome deste perfil que ainda esteja aberto (ex.: programa fechado no meio de uma rodada). */
async function portaAberta() {
  try {
    const porta = Number(readFileSync(ARQUIVO_PORTA, "utf8").split("\n")[0]);
    await fetch(`http://127.0.0.1:${porta}/json/version`, { signal: AbortSignal.timeout(2_000) });
    return porta;
  } catch {
    return null;
  }
}

async function fecharNavegador(porta) {
  try {
    const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${porta}/json/version`)).json();
    const ws = new WebSocket(webSocketDebuggerUrl);
    await new Promise((pronto) => { ws.onopen = pronto; ws.onerror = pronto; });
    ws.send(JSON.stringify({ id: 1, method: "Browser.close" }));
    await dormir(2_000);
  } catch { /* já estava fechado */ }
}

/** Abre o Chrome do perfil do conferidor; invisível, a menos que seja para fazer login. */
async function abrirNavegador(visivel) {
  const jaAberto = await portaAberta();
  if (jaAberto && !visivel) return jaAberto;
  if (jaAberto) await fecharNavegador(jaAberto);
  mkdirSync(PERFIL, { recursive: true });
  rmSync(ARQUIVO_PORTA, { force: true });
  spawn(acharNavegador(), [
    `--user-data-dir=${PERFIL}`, "--remote-debugging-port=0", "--no-first-run", "--no-default-browser-check",
    ...(visivel ? [`${INSTAGRAM}accounts/login/`] : ["--headless=new", "about:blank"]),
  ], { stdio: "ignore" });
  for (let tentativa = 0; tentativa < 60; tentativa++) {
    await dormir(500);
    const porta = await portaAberta();
    if (porta) return porta;
  }
  throw new Error("O Chrome não abriu a tempo; tentando de novo em instantes.");
}

async function conectarAba(porta) {
  const alvos = await (await fetch(`http://127.0.0.1:${porta}/json/list`)).json();
  const aba = alvos.find((alvo) => alvo.type === "page");
  if (!aba) throw new Error("O Chrome abriu sem nenhuma aba; tentando de novo em instantes.");
  const ws = new WebSocket(aba.webSocketDebuggerUrl);
  await new Promise((pronto, falha) => {
    ws.onopen = pronto;
    ws.onerror = () => falha(new Error("Não consegui controlar o Chrome; tentando de novo em instantes."));
  });
  let ultimoId = 0;
  const pendentes = new Map();
  ws.onmessage = ({ data }) => {
    const mensagem = JSON.parse(data);
    const pendente = pendentes.get(mensagem.id);
    if (!pendente) return;
    pendentes.delete(mensagem.id);
    if (mensagem.error) pendente.falha(new Error(mensagem.error.message));
    else pendente.ok(mensagem.result);
  };
  ws.onclose = () => pendentes.forEach((pendente) => pendente.falha(new Error("A janela do Chrome foi fechada.")));
  const enviar = (method, params = {}) => new Promise((ok, falha) => {
    const id = ++ultimoId;
    const limite = setTimeout(() => { pendentes.delete(id); falha(new Error("O Chrome demorou demais para responder.")); }, 45_000);
    pendentes.set(id, { ok: (valor) => { clearTimeout(limite); ok(valor); }, falha: (erro) => { clearTimeout(limite); falha(erro); } });
    ws.send(JSON.stringify({ id, method, params }));
  });
  return { enviar, fechar: () => ws.close() };
}

async function logado(aba) {
  const { cookies } = await aba.enviar("Network.getCookies", { urls: [INSTAGRAM] });
  return cookies.some((cookie) => cookie.name === "sessionid");
}

/** Primeira vez (ou login perdido): janela visível que fecha sozinha quando o login termina. */
async function fazerLogin() {
  console.log("");
  console.log("Abri o Chrome: entre na conta de Instagram que vai fazer a conferência.");
  console.log("Use uma conta só para isso, não uma das contas do painel. A janela fecha sozinha depois do login.");
  for (;;) {
    const porta = await abrirNavegador(true);
    try {
      const aba = await conectarAba(porta);
      while (!(await logado(aba))) await dormir(3_000);
      await dormir(5_000); // o Instagram termina de gravar a sessão
      aba.fechar();
      await fecharNavegador(porta);
      console.log("Login feito. Esperando pedidos de conferência do InstaGestor...");
      return;
    } catch {
      console.log("A janela foi fechada antes do login; abrindo de novo...");
      await dormir(2_000);
    }
  }
}

/** Mesma consulta que o instagram.com faz ao abrir um perfil; devolve quantos destaques ele tem. */
async function contarDestaques(aba, username) {
  const { result, exceptionDetails } = await aba.enviar("Runtime.evaluate", {
    expression: `fetch("/api/v1/users/web_profile_info/?username=" + encodeURIComponent(${JSON.stringify(username)}),
      { headers: { "x-ig-app-id": "${INSTAGRAM_WEB_APP_ID}" } })
      .then(async (resposta) => ({ status: resposta.status, texto: await resposta.text() }))`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (exceptionDetails) return { erro: "Falha de rede ao abrir o perfil" };
  const { status, texto } = result.value;
  if (status === 404) return { erro: "Perfil não encontrado no Instagram" };
  if ([401, 403, 429].includes(status)) {
    throw new Parada(`O Instagram pediu uma pausa nas consultas (código ${status}). Tente de novo mais tarde.`);
  }
  let dados;
  try {
    dados = JSON.parse(texto);
  } catch {
    console.error(`Resposta inesperada do Instagram (${status}): ${texto.slice(0, 200)}`);
    throw new SemLogin("O Instagram pediu login ou verificação. Entre de novo na janela que o conferidor abriu no PC.");
  }
  if (dados?.data?.user === null) return { erro: "Perfil não encontrado no Instagram" };
  const destaques = dados?.data?.user?.highlight_reel_count;
  if (!Number.isInteger(destaques)) {
    console.error(`Resposta sem destaques para @${username} (${status}): ${texto.slice(0, 200)}`);
    return { erro: "O Instagram não informou os destaques deste perfil" };
  }
  return { destaques };
}

async function conferir(contas) {
  const porta = await abrirNavegador(false);
  const aba = await conectarAba(porta);
  try {
    await aba.enviar("Page.navigate", { url: INSTAGRAM });
    await dormir(3_000);
    if (!(await logado(aba))) {
      throw new SemLogin("O conferidor não está logado no Instagram. Entre na conta de conferência na janela que abriu no PC.");
    }
    for (const [indice, conta] of contas.entries()) {
      const resultado = await contarDestaques(aba, conta.username).catch((erro) => {
        if (erro instanceof Parada) throw erro;
        return { erro: "Não deu para abrir o perfil" };
      });
      await api("POST", { accountId: conta.id, destaques: resultado.destaques ?? null, erro: resultado.erro ?? null });
      console.log(`${indice + 1}/${contas.length} @${conta.username}: ${resultado.erro ?? `${resultado.destaques} destaque(s)`}`);
      if (indice < contas.length - 1) await dormir(PAUSA_ENTRE_PERFIS_MS);
    }
  } finally {
    aba.fechar();
    await fecharNavegador(porta);
  }
}

if (!URL_BASE || !CHAVE) {
  console.error("Abra o conferidor pelo arquivo baixado em Configurações do InstaGestor.");
  process.exit(1);
}
console.log("Conferidor de destaques ligado. Deixe esta janela aberta (pode minimizar).");
if (!existsSync(PERFIL)) await fazerLogin();
for (;;) {
  try {
    const { contas } = await api("GET");
    if (!contas.length) {
      await dormir(ESPERA_SEM_PEDIDO_MS);
      continue;
    }
    console.log(`Conferindo ${contas.length} conta(s)...`);
    await conferir(contas);
  } catch (erro) {
    console.error(erro.message);
    if (erro instanceof Parada) await api("POST", { fatal: erro.message }).catch(() => {});
    if (erro instanceof SemLogin) await fazerLogin();
    else await dormir(ESPERA_SEM_PEDIDO_MS);
  }
}
