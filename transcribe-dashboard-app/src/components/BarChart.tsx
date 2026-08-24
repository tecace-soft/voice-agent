// Single-series bar chart in plain SVG, for the "when does work arrive" breakdowns. Follows the
// design system's bar rules: one hue (brand blue), rounded caps, gridlines on the value axis only.

export interface Bar {
  key: string;
  label: string; // axis tick — pass "" to leave a bar unlabelled when ticks would crowd
  value: number;
  tip: string;
}

export function BarChart({
  bars,
  ariaLabel,
  highlightMax = true,
}: {
  bars: Bar[];
  ariaLabel: string;
  highlightMax?: boolean;
}) {
  const W = 900;
  const H = 220;
  const padL = 36;
  const padR = 8;
  const padT = 14;
  const padB = 26;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const baseline = padT + plotH;

  if (bars.length === 0) return null;

  const max = Math.max(1, ...bars.map((b) => b.value));
  const slot = plotW / bars.length;
  const barW = Math.max(2, Math.min(28, slot * 0.68));
  const radius = Math.min(6, barW / 2);
  const ticks = [...new Set(max >= 2 ? [0, Math.round(max / 2), max] : [0, max])];
  const y = (v: number) => padT + plotH - (v / max) * plotH;

  return (
    <svg
      className="barchart"
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={ariaLabel}
    >
      {ticks.map((t) => (
        <g key={t}>
          <line className="grid" x1={padL} y1={y(t)} x2={W - padR} y2={y(t)} />
          <text className="axis" x={padL - 8} y={y(t)} dy="0.32em" textAnchor="end">
            {t}
          </text>
        </g>
      ))}

      {bars.map((bar, i) => {
        const cx = padL + slot * i + slot / 2;
        const h = Math.max(bar.value > 0 ? 2 : 0, (bar.value / max) * plotH);
        const isMax = highlightMax && bar.value === max && max > 0;
        return (
          <g key={bar.key}>
            {h > 0 && (
              <rect
                className={isMax ? "bar bar-max" : "bar"}
                x={cx - barW / 2}
                y={baseline - h}
                width={barW}
                height={h}
                rx={radius}
              />
            )}
            {/* a full-height hit target so the tooltip works even where the bar is tiny */}
            <rect className="hit" x={cx - slot / 2} y={padT} width={slot} height={plotH}>
              <title>{bar.tip}</title>
            </rect>
            {bar.label && (
              <text className="axis" x={cx} y={H - 8} textAnchor="middle">
                {bar.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
