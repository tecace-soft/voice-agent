import { useMemo } from "react";
import type { TranscribeStats } from "../api/types";
import { AreaChart, type ChartPoint } from "../components/AreaChart";
import { formatDayKey } from "../lib";
import { derive } from "../stats";

// Day-by-day view of the same numbers the overview summarises: the backend's 14-day daily series,
// gap-filled so quiet days show as zero rather than disappearing from the line.
export function ActivityPage({ data }: { data: TranscribeStats }) {
  const d = useMemo(() => derive(data), [data]);
  const points: ChartPoint[] = d.last14.map((day) => ({
    key: day.day,
    label: formatDayKey(day.day).replace(/^\w+, /, ""),
    value: day.processed,
    tip: `${formatDayKey(day.day)} — ${day.processed} transcribed`,
  }));
  const busiest = d.last14.reduce((best, day) => (day.processed > best.processed ? day : best), d.last14[0]!);
  const total = d.last14.reduce((sum, day) => sum + day.processed, 0);

  return (
    <div className="view">
      <section className="kpi-grid kpi-grid-3">
        <div className="stat-card">
          <div className="stat-card-body">
            <span className="stat-label ta-caption-1">Last 14 days</span>
            <div className="stat-value">{total.toLocaleString()}</div>
          </div>
          <footer className="stat-card-foot">
            <div className="stat-foot-lead ta-label-1">
              {(total / 14).toFixed(1)} per day on average
            </div>
            <div className="stat-foot-sub ta-caption-1">Voicemails transcribed</div>
          </footer>
        </div>
        <div className="stat-card">
          <div className="stat-card-body">
            <span className="stat-label ta-caption-1">Busiest day</span>
            <div className="stat-value">{busiest.processed.toLocaleString()}</div>
          </div>
          <footer className="stat-card-foot">
            <div className="stat-foot-lead ta-label-1">{formatDayKey(busiest.day)}</div>
            <div className="stat-foot-sub ta-caption-1">Most transcribed in one day</div>
          </footer>
        </div>
        <div className="stat-card">
          <div className="stat-card-body">
            <span className="stat-label ta-caption-1">Quiet days</span>
            <div className="stat-value">{d.last14.filter((day) => day.processed === 0).length}</div>
          </div>
          <footer className="stat-card-foot">
            <div className="stat-foot-lead ta-label-1">Of the last 14</div>
            <div className="stat-foot-sub ta-caption-1">Days with nothing to transcribe</div>
          </footer>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <div className="card-title ta-headline-2">Transcribed per day</div>
            <div className="card-sub ta-caption-1">Last 14 days · Pacific time</div>
          </div>
        </div>
        <div className="chart-body">
          <AreaChart points={points} ariaLabel="Voicemails transcribed per day" gradientId="dailyFill" />
        </div>
      </section>

      <section className="card">
        <div className="card-toolbar">
          <div className="card-title ta-headline-2">Daily totals</div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Day</th>
                <th className="num" scope="col">
                  Transcribed
                </th>
                <th className="num" scope="col">
                  Share of the 14 days
                </th>
              </tr>
            </thead>
            <tbody>
              {[...d.last14].reverse().map((day) => (
                <tr key={day.day}>
                  <td>{formatDayKey(day.day)}</td>
                  <td className="num">{day.processed.toLocaleString()}</td>
                  <td className="num">{total === 0 ? "—" : `${((day.processed / total) * 100).toFixed(1)}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
