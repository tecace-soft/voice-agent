// Single-series area chart, hand-rolled in SVG (this app deliberately stays on plain React + CSS,
// so there's no charting library). Follows the design system's chart rules: one series in the
// brand blue, 2px line, ~15% area fill, gridlines on the y-axis only in the neutral fill family.

export interface ChartPoint {
  key: string; // React key — a run id or day key
  label: string; // x-axis tick text
  value: number;
  tip: string; // hover tooltip text
}

// Cardinal-spline control points (tension 0.3, matching the design system's `tension: 0.3` line
// rule). Slopes come from each point's neighbours, then get clamped to the plot box so a curve
// between two far-apart values can't bulge past the axis.
function smoothPath(pts: { cx: number; cy: number }[], top: number, bottom: number): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M${pts[0]!.cx},${pts[0]!.cy}`;
  const t = 0.3;
  const clamp = (y: number) => Math.min(bottom, Math.max(top, y));
  const slope = (i: number) => {
    const prev = pts[Math.max(0, i - 1)]!;
    const next = pts[Math.min(pts.length - 1, i + 1)]!;
    return { x: (next.cx - prev.cx) / 2, y: (next.cy - prev.cy) / 2 };
  };
  let d = `M${pts[0]!.cx.toFixed(1)},${pts[0]!.cy.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p = pts[i]!;
    const n = pts[i + 1]!;
    const mp = slope(i);
    const mn = slope(i + 1);
    const c1x = p.cx + mp.x * t;
    const c1y = clamp(p.cy + mp.y * t);
    const c2x = n.cx - mn.x * t;
    const c2y = clamp(n.cy - mn.y * t);
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${n.cx.toFixed(1)},${n.cy.toFixed(1)}`;
  }
  return d;
}

// Evenly spaced x ticks (first and last always included) so a 60-point series doesn't stack labels.
function tickIndexes(n: number, max: number): number[] {
  if (n <= max) return Array.from({ length: n }, (_, i) => i);
  const step = (n - 1) / (max - 1);
  return [...new Set(Array.from({ length: max }, (_, i) => Math.round(i * step)))];
}

export function AreaChart({
  points,
  ariaLabel,
  gradientId = "areaFill",
}: {
  points: ChartPoint[];
  ariaLabel: string;
  gradientId?: string;
}) {
  // viewBox units; the SVG scales uniformly to the container width (so dots stay round and the
  // labels keep their proportions), which fixes the card's chart area at a ~3.4:1 band.
  const W = 900;
  const H = 264;
  const padL = 40; // room for y-axis value labels
  const padR = 12;
  const padT = 22; // room for the endpoint's value label
  const padB = 30; // room for x-axis labels
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const baseline = padT + plotH;

  const n = points.length;
  if (n === 0) return null;

  const yMax = Math.max(1, ...points.map((p) => p.value));
  const x = (i: number) => (n <= 1 ? padL + plotW / 2 : padL + (i / (n - 1)) * plotW);
  const y = (v: number) => padT + plotH - (v / yMax) * plotH;

  const pts = points.map((p, i) => ({ point: p, cx: x(i), cy: y(p.value) }));
  const first = pts[0]!;
  const last = pts[n - 1]!;
  const linePath = smoothPath(pts, padT, baseline);
  const areaPath =
    n >= 2 ? `${linePath} L${last.cx.toFixed(1)},${baseline} L${first.cx.toFixed(1)},${baseline} Z` : "";

  // Up to three gridlines: 0, a midpoint, and the max.
  const ticks = [...new Set(yMax >= 2 ? [0, Math.round(yMax / 2), yMax] : [0, yMax])];

  // A marker on every point gets noisy once the series is long — the curve and the emphasized
  // newest point carry the shape, while hover tooltips stay on every point either way.
  const showDots = n <= 24;
  const spacing = n > 1 ? plotW / (n - 1) : plotW;
  const hitR = Math.max(6, Math.min(14, spacing / 1.5));
  const xTicks = tickIndexes(n, 7);

  return (
    <svg
      className="areachart"
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={ariaLabel}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.15} />
          <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
        </linearGradient>
      </defs>

      {ticks.map((tick) => (
        <g key={tick}>
          <line className="grid" x1={padL} y1={y(tick)} x2={W - padR} y2={y(tick)} />
          <text className="axis" x={padL - 10} y={y(tick)} dy="0.32em" textAnchor="end">
            {tick}
          </text>
        </g>
      ))}

      {n >= 2 && <path className="area" d={areaPath} fill={`url(#${gradientId})`} />}
      {n >= 2 && <path className="line" d={linePath} />}

      {pts.map((p, i) => {
        const isLast = i === n - 1;
        return (
          <g key={p.point.key}>
            {(showDots || isLast) && (
              <circle className={isLast ? "dot dot-last" : "dot"} cx={p.cx} cy={p.cy} r={isLast ? 5 : 4} />
            )}
            <circle className="hit" cx={p.cx} cy={p.cy} r={hitR}>
              <title>{p.point.tip}</title>
            </circle>
          </g>
        );
      })}

      {/* direct-label the newest value (clamped so a max-value point doesn't clip the top) */}
      <text className="endpoint" x={last.cx} y={Math.max(last.cy - 12, 14)} textAnchor="end">
        {last.point.value}
      </text>

      {xTicks.map((i) => {
        const p = pts[i]!;
        const anchor = i === 0 ? "start" : i === n - 1 ? "end" : "middle";
        return (
          <text className="axis" key={p.point.key} x={p.cx} y={H - 8} textAnchor={anchor}>
            {p.point.label}
          </text>
        );
      })}
    </svg>
  );
}
