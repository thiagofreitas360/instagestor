import { getEnv } from "@/lib/env";
import { requireAdminApi } from "@/server/auth";
import { rotateCheckerKey } from "@/server/highlight-checker";
import { readSmallUrlEncodedForm } from "@/server/request";

export const runtime = "nodejs";

// Node portátil baixado pelo próprio arquivo na primeira execução; o conferidor em si (public/conferidor.mjs)
// é baixado a cada abertura, então correções chegam sem o cliente baixar nada de novo.
const NODE_VERSION = "v22.12.0";

function windowsLauncher(appUrl: string, key: string) {
  const node = `node-${NODE_VERSION}-win-x64`;
  return [
    "@echo off",
    "setlocal",
    "title Conferidor de destaques - deixe esta janela aberta (pode minimizar)",
    `set "CONFERIDOR_URL=${appUrl}"`,
    `set "CONFERIDOR_CHAVE=${key}"`,
    `set "PASTA=%LOCALAPPDATA%\\ConferidorDestaques"`,
    `if not exist "%PASTA%" mkdir "%PASTA%"`,
    // goto em vez de bloco ( ): um ")" no caminho do usuário fecharia o bloco antes da hora.
    `if exist "%PASTA%\\node\\node.exe" goto atualizar`,
    "echo Baixando o Node.js - so na primeira vez, pode levar alguns minutos...",
    `curl.exe -fL --progress-bar -o "%PASTA%\\node.zip" "https://nodejs.org/dist/${NODE_VERSION}/${node}.zip" || goto erro`,
    `tar.exe -xf "%PASTA%\\node.zip" -C "%PASTA%" || goto erro`,
    `move "%PASTA%\\${node}" "%PASTA%\\node" >nul || goto erro`,
    `del "%PASTA%\\node.zip"`,
    ":atualizar",
    `curl.exe -fsS -o "%PASTA%\\conferidor-novo.mjs" "%CONFERIDOR_URL%/conferidor.mjs" && move /y "%PASTA%\\conferidor-novo.mjs" "%PASTA%\\conferidor.mjs" >nul`,
    `if not exist "%PASTA%\\conferidor.mjs" goto erro`,
    `"%PASTA%\\node\\node.exe" "%PASTA%\\conferidor.mjs"`,
    "pause",
    "exit /b",
    ":erro",
    "echo Nao foi possivel preparar o conferidor. Confira a internet e abra o arquivo de novo.",
    "pause",
    "",
  ].join("\r\n");
}

function ubuntuLauncher(appUrl: string, key: string) {
  return `#!/usr/bin/env bash
# Conferidor de destaques do InstaGestor. Abra um terminal na pasta do arquivo e rode: bash conferidor-destaques.sh
set -euo pipefail
export CONFERIDOR_URL="${appUrl}"
export CONFERIDOR_CHAVE="${key}"
# Pasta sem ponto no nome: o Chromium instalado pela loja (snap) não grava em pastas ocultas.
PASTA="$HOME/conferidor-destaques"
case "$(uname -m)" in
  x86_64) ARQ=x64 ;;
  aarch64|arm64) ARQ=arm64 ;;
  *) echo "Processador não suportado: $(uname -m)"; exit 1 ;;
esac
baixar() { if command -v curl >/dev/null; then curl -fsSL "$1"; else wget -qO- "$1"; fi; }
mkdir -p "$PASTA"
if [ ! -x "$PASTA/node/bin/node" ]; then
  echo "Baixando o Node.js (só na primeira vez)..."
  baixar "https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-linux-$ARQ.tar.xz" | tar -xJ -C "$PASTA"
  rm -rf "$PASTA/node"
  mv "$PASTA/node-${NODE_VERSION}-linux-$ARQ" "$PASTA/node"
fi
if baixar "$CONFERIDOR_URL/conferidor.mjs" > "$PASTA/conferidor-novo.mjs"; then
  mv "$PASTA/conferidor-novo.mjs" "$PASTA/conferidor.mjs"
fi
exec "$PASTA/node/bin/node" "$PASTA/conferidor.mjs"
`;
}

/** Baixar o conferidor gera uma chave nova para a organização: a cópia baixada antes para de funcionar. */
export async function POST(request: Request) {
  let organizationId: string;
  try {
    organizationId = (await requireAdminApi()).organizationId;
  } catch (error) {
    if (error instanceof Response) return error;
    throw error;
  }
  const appUrl = new URL(getEnv().APP_URL).origin;
  if (request.headers.get("origin") !== appUrl) return new Response("Origem não autorizada", { status: 403 });
  const system = (await readSmallUrlEncodedForm(request)).get("sistema");
  if (system !== "windows" && system !== "ubuntu") return new Response("Sistema inválido", { status: 400 });

  const key = await rotateCheckerKey(organizationId);
  const [body, filename] = system === "windows"
    ? [windowsLauncher(appUrl, key), "conferidor-destaques.cmd"]
    : [ubuntuLauncher(appUrl, key), "conferidor-destaques.sh"];
  return new Response(body, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
