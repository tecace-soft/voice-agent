import { useEffect, useState } from "react";
import { getTranscribeStats } from "../api/backend";
import type { TranscribeStats, VoicemailRun } from "../api/types";
import { formatDateTime, formatShort } from "../lib";
import { AsyncState } from "../ui";

// Line chart where each data point is one transcribe-app run, plotted by how many voicemails that
// run transcribed. `recent` comes back newest-first, so reverse it to read left→right in time.
function RunLineChart({ runs }: { runs: VoicemailRun[] }) {
  // viewBox units; the SVG scales to the container width (uniform, so points stay round).
  const W = 720;
  const H = 230;
  const padL = 34; // room for y-axis value labels
  const padR = 16;
  const padT = 18; // room for the endpoint's value label
  const padB = 30; // room for x-axis time labels
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const baseline = padT + plotH;

  const n = runs.length;
  if (n === 0) return null;

  const yMax = Math.max(1, ...runs.map((r) => r.processed));
  const x = (i: number) => (n <= 1 ? padL + plotW / 2 : padL + (i / (n - 1)) * plotW);
  const y = (v: number) => padT + plotH - (v / yMax) * plotH;

  const pts = runs.map((r, i) => ({ run: r, cx: x(i), cy: y(r.processed) }));
  const first = pts[0]!;
  const last = pts[n - 1]!;
  const linePath = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.cx.toFixed(1)},${p.cy.toFixed(1)}`).join(" ");
  const areaPath =
    n >= 2
      ? `M${first.cx.toFixed(1)},${baseline} ` +
        pts.map((p) => `L${p.cx.toFixed(1)},${p.cy.toFixed(1)}`).join(" ") +
        ` L${last.cx.toFixed(1)},${baseline} Z`
      : "";

  // Up to three horizontal gridlines: 0, a midpoint, and the max.
  const rawTicks = yMax >= 2 ? [0, Math.round(yMax / 2), yMax] : [0, yMax];
  const ticks = [...new Set(rawTicks)];

  // The line always connects every run. Once there are many points, drawing a marker on each one
  // gets noisy, so show per-run dots only while the series is sparse — the connecting line and the
  // emphasized newest point still carry the shape, and hover tooltips stay on every run.
  const showDots = n <= 24;
  const spacing = n > 1 ? plotW / (n - 1) : plotW;
  const hitR = Math.max(5, Math.min(12, spacing / 1.5)); // shrink hit targets as points crowd

  return (
    <svg className="linechart" viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Voicemails transcribed per run">
      <defs>
        <linearGradient id="runFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.15} />
          <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
        </linearGradient>
      </defs>

      {/* y grid + value labels */}
      {ticks.map((t) => (
        <g key={t}>
          <line className="grid" x1={padL} y1={y(t)} x2={W - padR} y2={y(t)} />
          <text className="axis" x={padL - 8} y={y(t)} dy="0.32em" textAnchor="end">
            {t}
          </text>
        </g>
      ))}

      {n >= 2 && <path className="area" d={areaPath} fill="url(#runFill)" />}
      {n >= 2 && <path className="line" d={linePath} />}

      {/* markers (thinned when dense) plus a hit target on every run for the hover tooltip */}
      {pts.map((p, i) => {
        const isLast = i === n - 1;
        return (
          <g key={p.run.id}>
            {(showDots || isLast) && (
              <circle className={isLast ? "dot dot-last" : "dot"} cx={p.cx} cy={p.cy} r={isLast ? 5 : 4} />
            )}
            <circle className="hit" cx={p.cx} cy={p.cy} r={hitR}>
              <title>{`${formatDateTime(p.run.createdAt)} — ${p.run.processed} transcribed`}</title>
            </circle>
          </g>
        );
      })}

      {/* direct-label the newest run's value (clamped so a max-value point doesn't clip the top) */}
      <text className="endpoint" x={last.cx} y={Math.max(last.cy - 10, 12)} textAnchor="end">
        {last.run.processed}
      </text>

      {/* x-axis: label the first and last run so the time span is clear (hover gives the rest) */}
      {n >= 2 && (
        <text className="axis" x={padL} y={H - 8} textAnchor="start">
          {formatShort(first.run.createdAt)}
        </text>
      )}
      <text className="axis" x={last.cx} y={H - 8} textAnchor="end">
        {formatShort(last.run.createdAt)}
      </text>
    </svg>
  );
}

export function DashboardPage() {
  const [data, setData] = useState<TranscribeStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getTranscribeStats()
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : "Failed to load transcription stats.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const hasAny = data && data.runs > 0;
  // Each point on the chart is one run. `runSeries` already comes back oldest→newest from the
  // backend, so the line reads left→right and keeps extending as new runs are added.
  const runsChrono = data?.runSeries ?? [];

  return (
    <section className="stack">
      <div className="page-head">
        <h1>Voicemail transcriptions</h1>
      </div>

      <AsyncState loading={loading} error={error} />

      {!loading && !error && data && (
        <>
          <p className="muted ta-body-2">
            How many voicemails the transcribe app has processed
            {data.lastRunAt ? ` · last run ${formatDateTime(data.lastRunAt)}` : ""}.
          </p>

          <div className="stat-grid">
            <div className="stat">
              <div className="stat-num">{data.totalProcessed.toLocaleString()}</div>
              <div className="stat-label">Total transcribed</div>
            </div>
            <div className="stat">
              <div className="stat-num">{data.today.toLocaleString()}</div>
              <div className="stat-label">Today</div>
            </div>
            <div className="stat">
              <div className="stat-num">{data.last7Days.toLocaleString()}</div>
              <div className="stat-label">Last 7 days</div>
            </div>
            <div className="stat">
              <div className="stat-num">{data.runs.toLocaleString()}</div>
              <div className="stat-label">Runs</div>
            </div>
            <div className="stat">
              <div className={`stat-num${data.totalFailed > 0 ? " is-danger" : ""}`}>
                {data.totalFailed.toLocaleString()}
              </div>
              <div className="stat-label">Failed</div>
            </div>
          </div>

          {!hasAny ? (
            <p className="muted ta-body-2">
              No transcription runs reported yet. Runs appear here once the transcribe app finishes a
              pass (with <code>BACKEND_URL</code> configured).
            </p>
          ) : (
            <>
              <div className="card">
                <div className="card-head">
                  <div>
                    <div className="card-title ta-headline-2">Voicemails transcribed per run</div>
                    <div className="card-sub ta-caption-1">
                      One point per run · newest on the right
                    </div>
                  </div>
                </div>
                <div className="chart-body">
                  <RunLineChart runs={runsChrono} />
                </div>
              </div>

              <div className="card">
                <div className="card-head">
                  <div className="card-title ta-headline-2">Recent runs</div>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>When</th>
                        <th className="num">Found</th>
                        <th className="num">Transcribed</th>
                        <th className="num">Skipped</th>
                        <th className="num">Failed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recent.map((r) => (
                        <tr key={r.id}>
                          <td>{formatDateTime(r.createdAt)}</td>
                          <td className="num">{r.voicemails}</td>
                          <td className="num">{r.processed}</td>
                          <td className="num">{r.skipped}</td>
                          <td className={`num${r.failed > 0 ? " is-danger" : ""}`}>{r.failed}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
