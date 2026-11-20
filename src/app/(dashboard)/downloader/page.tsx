import { DownloaderPanel } from "@/components/downloader-panel";
import { requireAdmin } from "@/server/auth";

export const metadata = { title: "Downloader · InstaGestor" };

const EXT_VERSION = "1.0.0";
const EXT_ZIP = "/downloads/instagestor-downloader.zip";

const steps = [
  { n: 1, title: "Cole o perfil", text: "Link do perfil, @usuário, ou o link de um story, destaque, post ou reel." },
  { n: 2, title: "Escolha o alcance", text: "Top 50, 100 ou todos os vídeos e fotos do perfil." },
  { n: 3, title: "Busque", text: "Com a extensão instalada, o InstaGestor varre o perfil, stories e destaques usando a conta logada no seu navegador." },
  { n: 4, title: "Baixe o ZIP", text: "Baixe cada arquivo pelo botão ou os selecionados juntos em um ZIP." },
];

export default async function DownloaderPage() {
  await requireAdmin();

  return (
    <div className="page-stack">
      <header className="page-hero">
        <div className="page-hero-copy">
          <p className="eyebrow">Ferramentas</p>
          <h1>Instagram <em className="text-gradient">Downloader</em></h1>
          <p className="page-description">
            Baixe reels, fotos, stories e destaques de qualquer perfil usando a conta já logada no seu navegador.
          </p>
        </div>
      </header>

      <DownloaderPanel />

      <section className="panel dl-how">
        <h2>Como funciona</h2>
        <ol className="dl-steps">
          {steps.map((s) => (
            <li key={s.n} className="dl-step">
              <span className="dl-step-n">{s.n}</span>
              <div>
                <strong>{s.title}</strong>
                <p>{s.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="panel dl-ext">
        <div className="dl-ext-head">
          <h2>Extensão InstaGestor Downloader</h2>
          <span className="dl-ext-ver">v{EXT_VERSION}</span>
        </div>
        <p className="muted">
          A extensão busca com a conta do Instagram logada neste navegador — é ela que traz o perfil inteiro, os stories e os
          destaques. Sem ela, a página não consegue coletar nada.
        </p>
        <a className="button button-primary button-hero dl-ext-dl" href={EXT_ZIP} download>
          Baixar extensão (.zip) {EXT_VERSION}
        </a>
        <ol className="dl-ext-steps">
          <li>Baixe o arquivo acima e <b>extraia</b> numa pasta do seu computador.</li>
          <li>Abra <code>chrome://extensions</code> no Chrome ou Edge.</li>
          <li>Ative o <b>Modo do desenvolvedor</b> (canto superior direito).</li>
          <li>Clique em <b>Carregar sem compactação</b> e selecione a pasta extraída.</li>
          <li>Pronto — o ícone aparece na barra de extensões. Não precisa repetir.</li>
        </ol>
      </section>
    </div>
  );
}
