"use client";

import { useMemo, useRef, useState } from "react";

type Point = { label: string; value: number };

const W = 1000;
const H = 260;
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const compact = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });

/** Topo "redondo" do eixo Y, divisível em quartos (100 → 75/50/25). */
function niceMax(value: number) {
  if (!(value > 0)) return 100;
  const power = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 4, 5, 8, 10]) if (step * power >= value * 1.08) return step * power;
  return 10 * power;
}

/** Catmull-Rom → Bézier, com controle preso ao plot para a curva não passar de 0 nem do topo. */
function smoothPath(points: Array<[number, number]>) {
  if (!points.length) return "";
  const clamp = (y: number) => Math.min(H, Math.max(0, y));
  let d = `M${points[0][0]},${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    d += ` C${p1[0] + (p2[0] - p0[0]) / 6},${clamp(p1[1] + (p2[1] - p0[1]) / 6)} ${p2[0] - (p3[0] - p1[0]) / 6},${clamp(p2[1] - (p3[1] - p1[1]) / 6)} ${p2[0]},${p2[1]}`;
  }
  return d;
}

export function SalesChart({ points }: { points: Point[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const plotRef = useRef<HTMLDivElement>(null);
  const n = points.length;

  const { coords, line, area, ticks } = useMemo(() => {
    const max = niceMax(Math.max(0, ...points.map((point) => point.value)));
    const coords = points.map(
      (point, index) => [n > 1 ? (index / (n - 1)) * W : W / 2, H - (point.value / max) * H] as [number, number],
    );
    const line = smoothPath(coords);
    const area = coords.length ? `${line} L${coords[coords.length - 1][0]},${H} L${coords[0][0]},${H} Z` : "";
    return { coords, line, area, ticks: [1, 0.75, 0.5, 0.25, 0].map((fraction) => max * fraction) };
  }, [points, n]);

  const total = points.reduce((sum, point) => sum + point.value, 0);
  const labelStep = Math.max(1, Math.ceil(n / 7));
  const active = hover ?? n - 1;
  const at = (index: number) => ({ left: `${(coords[index][0] / W) * 100}%`, top: `${(coords[index][1] / H) * 100}%` });
  const tipShift = hover === 0 ? "0%" : hover === n - 1 ? "-100%" : "-50%";

  function onMove(event: React.PointerEvent<HTMLDivElement>) {
    const rect = plotRef.current?.getBoundingClientRect();
    if (!rect || !n) return;
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    setHover(Math.round(ratio * (n - 1)));
  }

  return (
    <figure className="sales-chart" aria-label={`Receita aprovada: ${money.format(total)} em ${n} dias`}>
      <span className="sales-chart-unit" aria-hidden="true">R$</span>
      <div className="sales-chart-y" aria-hidden="true">
        {ticks.map((tick, index) => (
          <span key={index} style={{ top: `${(index / 4) * 100}%` }}>{compact.format(tick)}</span>
        ))}
      </div>
      <div className="sales-chart-plot" ref={plotRef} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="sales-area-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
            </linearGradient>
          </defs>
          {ticks.map((_, index) => (
            <line key={index} className="sc-grid" x1="0" x2={W} y1={(index / 4) * H} y2={(index / 4) * H} vectorEffect="non-scaling-stroke" />
          ))}
          {area ? <path d={area} fill="url(#sales-area-fill)" /> : null}
          {line ? <path className="sc-line" d={line} vectorEffect="non-scaling-stroke" /> : null}
          {hover !== null ? (
            <line className="sc-guide" x1={coords[hover][0]} x2={coords[hover][0]} y1="0" y2={H} vectorEffect="non-scaling-stroke" />
          ) : null}
        </svg>
        {n ? <span className="sc-dot" style={at(active)} /> : null}
        {hover !== null ? (
          <span className="sc-tip" style={{ ...at(hover), transform: `translate(${tipShift}, calc(-100% - 14px))` }}>
            <strong>{money.format(points[hover].value)}</strong>
            <span>{points[hover].label}</span>
          </span>
        ) : null}
      </div>
      <div className="sales-chart-x" aria-hidden="true">
        {points.map((point, index) =>
          index === n - 1 || (index % labelStep === 0 && n - 1 - index >= labelStep / 2) ? (
            <span key={point.label} style={{ left: `${n > 1 ? (index / (n - 1)) * 100 : 50}%` }}>{point.label}</span>
          ) : null,
        )}
      </div>
    </figure>
  );
}
