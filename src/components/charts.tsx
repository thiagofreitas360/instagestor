const WIDTH = 640;
const HEIGHT = 200;
const PADDING = 12;

export function scaleY(value: number, max: number, height: number, padding: number) {
  const usable = height - padding * 2;
  return Math.round((height - padding - (max ? (value / max) * usable : 0)) * 100) / 100;
}

export function linePath(values: Array<number | null>, width: number, height: number, padding: number) {
  const max = Math.max(1, ...values.map((value) => value ?? 0));
  const step = values.length > 1 ? (width - padding * 2) / (values.length - 1) : 0;
  let path = "";
  let open = false;
  values.forEach((value, index) => {
    if (value === null) {
      open = false;
      return;
    }
    const x = Math.round((padding + index * step) * 100) / 100;
    const y = scaleY(value, max, height, padding);
    path += `${path ? " " : ""}${open ? "L" : "M"}${x},${y}`;
    open = true;
  });
  return path;
}

const defaultFormat = (value: number) => new Intl.NumberFormat("pt-BR").format(value);

export function LineChart({ title, points, formatValue = defaultFormat }: {
  title: string; points: Array<{ label: string; value: number | null }>; formatValue?: (value: number) => string;
}) {
  const values = points.map((point) => point.value);
  const max = Math.max(1, ...values.map((value) => value ?? 0));
  const step = points.length > 1 ? (WIDTH - PADDING * 2) / (points.length - 1) : 0;
  const last = [...points].reverse().find((point) => point.value !== null);
  return (
    <figure className="chart">
      <figcaption>
        <span>{title}</span>
        {last ? <strong>{formatValue(last.value!)}</strong> : <strong>—</strong>}
      </figcaption>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={title} preserveAspectRatio="none">
        <line className="chart-axis" x1={PADDING} x2={WIDTH - PADDING} y1={HEIGHT - PADDING} y2={HEIGHT - PADDING} />
        <path className="chart-line" d={linePath(values, WIDTH, HEIGHT, PADDING)} fill="none" />
        {points.map((point, index) => point.value === null ? null : (
          <circle className="chart-point" key={point.label} cx={PADDING + index * step} cy={scaleY(point.value, max, HEIGHT, PADDING)} r="3">
            <title>{`${point.label}: ${formatValue(point.value)}`}</title>
          </circle>
        ))}
      </svg>
      <div className="chart-labels" aria-hidden="true">
        <span>{points[0]?.label}</span>
        <span>{points[points.length - 1]?.label}</span>
      </div>
    </figure>
  );
}

export function BarChart({ title, groups, seriesLabels, formatValue = defaultFormat }: {
  title: string; groups: Array<{ label: string; values: number[] }>; seriesLabels: string[]; formatValue?: (value: number) => string;
}) {
  const max = Math.max(1, ...groups.flatMap((group) => group.values));
  const groupWidth = groups.length ? (WIDTH - PADDING * 2) / groups.length : 0;
  const barWidth = seriesLabels.length ? (groupWidth * 0.7) / seriesLabels.length : 0;
  return (
    <figure className="chart">
      <figcaption>
        <span>{title}</span>
        <span className="chart-legend">
          {seriesLabels.map((label, index) => <em className={`chart-swatch chart-bar-${index}`} key={label}>{label}</em>)}
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={title} preserveAspectRatio="none">
        <line className="chart-axis" x1={PADDING} x2={WIDTH - PADDING} y1={HEIGHT - PADDING} y2={HEIGHT - PADDING} />
        {groups.map((group, groupIndex) => group.values.map((value, seriesIndex) => {
          const x = PADDING + groupIndex * groupWidth + groupWidth * 0.15 + seriesIndex * barWidth;
          const y = scaleY(value, max, HEIGHT, PADDING);
          return (
            <rect className={`chart-bar chart-bar-${seriesIndex}`} key={`${group.label}-${seriesIndex}`} x={x} y={y} width={barWidth} height={HEIGHT - PADDING - y}>
              <title>{`${group.label} · ${seriesLabels[seriesIndex]}: ${formatValue(value)}`}</title>
            </rect>
          );
        }))}
      </svg>
      <div className="chart-labels" aria-hidden="true">
        <span>{groups[0]?.label}</span>
        <span>{groups[groups.length - 1]?.label}</span>
      </div>
    </figure>
  );
}
