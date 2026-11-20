// Cena "Vice City" em SVG inline (pôr-do-sol, sol retrô, palmeiras, grade).
// Vetor dentro do HTML: nenhuma imagem é baixada, pesa alguns KB.
// Renderizada só no tema GTA VI, atrás do conteúdo (z-index 0), decorativa.

function Palm({ x, flip }: { x: number; flip?: boolean }) {
  return (
    <g transform={`translate(${x} 900) scale(${flip ? -1 : 1} 1)`} className="gta-palm">
      {/* tronco */}
      <path d="M0 0 C -10 -120 -24 -230 -40 -330 C -46 -366 -40 -372 -28 -372 C -40 -270 -28 -140 16 0 Z" fill="#07040d" />
      {/* folhas */}
      <g transform="translate(-30 -372)" fill="#07040d">
        <path d="M0 0 C -60 -40 -130 -46 -196 -26 C -140 -58 -58 -66 2 -40 Z" />
        <path d="M0 0 C -46 -70 -58 -150 -40 -214 C -14 -150 -2 -74 10 -8 Z" />
        <path d="M0 0 C 40 -66 110 -96 182 -92 C 116 -108 44 -84 6 -34 Z" />
        <path d="M0 0 C 56 -44 140 -48 206 -16 C 140 -64 54 -72 2 -38 Z" />
        <path d="M0 0 C 20 -72 72 -134 140 -168 C 86 -112 44 -56 12 6 Z" />
        <path d="M0 0 C -30 -60 -36 -140 -18 -206 C 2 -150 10 -78 12 -6 Z" />
      </g>
    </g>
  );
}

export function GtaBackdrop() {
  return (
    <div className="gta-backdrop" aria-hidden="true">
      <svg viewBox="0 0 1440 900" preserveAspectRatio="xMidYMax slice" role="presentation" focusable="false">
        <defs>
          <linearGradient id="gta-sun" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffe08a" />
            <stop offset="42%" stopColor="#ff9d3d" />
            <stop offset="74%" stopColor="#ff2e88" />
            <stop offset="100%" stopColor="#b026d3" />
          </linearGradient>
          <linearGradient id="gta-grid" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ff2e88" stopOpacity="0" />
            <stop offset="100%" stopColor="#ff2e88" stopOpacity="0.5" />
          </linearGradient>
        </defs>

        {/* sol retrô */}
        <g className="gta-sun">
          <circle cx="1120" cy="250" r="196" fill="url(#gta-sun)" />
          {/* listras: barras da cor do fundo "cortam" a metade de baixo */}
          <g fill="#0b0714">
            <rect x="915" y="268" width="410" height="7" />
            <rect x="915" y="292" width="410" height="9" />
            <rect x="915" y="320" width="410" height="12" />
            <rect x="915" y="354" width="410" height="16" />
            <rect x="915" y="398" width="410" height="22" />
          </g>
        </g>

        {/* grade synthwave no horizonte */}
        <g className="gta-gridlines" stroke="url(#gta-grid)" strokeWidth="1.5">
          {[760, 790, 826, 870, 922, 982].map((y) => (
            <line key={`h${y}`} x1="0" x2="1440" y1={y} y2={y} />
          ))}
          {[-640, -360, -160, -40, 40, 160, 360, 640].map((d) => (
            <line key={`v${d}`} x1={720 + d / 7} y1="760" x2={720 + d} y2="982" />
          ))}
        </g>

        {/* palmeiras */}
        <g className="gta-palms">
          <Palm x={150} />
          <Palm x={1312} flip />
        </g>
      </svg>
    </div>
  );
}
