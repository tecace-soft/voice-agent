import { useEffect, useMemo, useState } from "react";
import { getTranscribeAnalytics } from "../api/backend";
import type { TranscribeAnalytics } from "../api/types";
import { AreaChart, type ChartPoint } from "../components/AreaChart";
import { BarChart, type Bar } from "../components/BarChart";
import { StatCard, TrendBadge } from "../components/StatCard";
import { formatDateTime, formatDayKey, formatDuration, formatHour, formatWeekday } from "../lib";
import { DashboardSkeleton } from "../ui";

// The operational view of the transcribe-app, over its whole history rather than the 60-run window
// the other pages read. Three things worth knowing about a pipeline that runs unattended:
// is it keeping up, is it running on schedule, and when does the work actually turn up.

// Two days without a run is well past any normal poll interval — worth calling out rather than
// leaving as a number nobody reads.
const STALL_SECONDS = 48 * 3600;

const pct = (part: number, whole: number) => (whole <= 0 ? 0 : (part / whole) * 100);

export function AnalyticsPage() {
  const [data, setData] = useState<TranscribeAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getTranscribeAnalytics()
      .then((d) => active && setData(d))
      .catch((e) => active && setError(e instanceof Error ? e.message : "Couldn't load analytics."));
    return () => {
      active = false;
    };
  }, []);

  const derived = useMemo(() => {
    if (!data) return null;
    const { totals } = data;
    const attempted = totals.processed + totals.failed;
    return {
      successRate: pct(totals.processed, attempted || 1),
      skipRate: pct(totals.skipped, totals.voicemails),
      emptyRate: pct(totals.emptyRuns, totals.runs),
      attempted,
    };
  }, [data]);

  if (error) return <p className="error ta-body-2">{error}</p>;
  if (!data || !derived) return <DashboardSkeleton />;

  const { totals, cadence, perRun } = data;

  // 90-day trend. The backend only returns days that had runs, so gaps are simply absent rather
  // than zero — with a 90-day window, filling every quiet day in would bury the shape.
  const dailyPoints: ChartPoint[] = data.daily.map((d) => ({
    key: d.day,
    label: formatDayKey(d.day).replace(/^\w+, /, ""),
    value: d.processed,
    tip: `${formatDayKey(d.day)} — ${d.processed} transcribed across ${d.runs} ${d.runs === 1 ? "run" : "runs"}`,
  }));

  // Every hour of the day, including the quiet ones — the gaps are the point here.
  const hourMap = new Map(data.byHour.map((h) => [h.hour, h]));
  const hourBars: Bar[] = Array.from({ length: 24 }, (_, hour) => {
    const row = hourMap.get(hour);
    return {
      key: `h${hour}`,
      label: hour % 3 === 0 ? formatHour(hour).replace(" ", "") : "",
      value: row?.processed ?? 0,
      tip: `${formatHour(hour)} — ${row?.processed ?? 0} transcribed across ${row?.runs ?? 0} runs`,
    };
  });

  const weekdayMap = new Map(data.byWeekday.map((w) => [w.weekday, w]));
  const weekdayBars: Bar[] = Array.from({ length: 7 }, (_, i) => {
    const row = weekdayMap.get(i + 1);
    return {
      key: `w${i + 1}`,
      label: formatWeekday(i + 1),
      value: row?.processed ?? 0,
      tip: `${formatWeekday(i + 1)} — ${row?.processed ?? 0} transcribed across ${row?.runs ?? 0} runs`,
    };
  });

  // Every output from 1 to the busiest run, so a gap in the middle reads as a gap rather than
  // two neighbouring bars.
  const distCounts = new Map(perRun.distribution.map((d) => [d.processed, d.runs]));
  const distributionBars: Bar[] = Array.from({ length: perRun.maxProcessed }, (_, i) => {
    const processed = i + 1;
    const runs = distCounts.get(processed) ?? 0;
    return {
      key: `d${processed}`,
      label: perRun.maxProcessed <= 20 || processed % 5 === 0 ? String(processed) : "",
      value: runs,
      tip: `${runs} ${runs === 1 ? "run" : "runs"} transcribed ${processed} ${processed === 1 ? "voicemail" : "voicemails"}`,
    };
  });

  const stalled = cadence.longestGapSeconds >= STALL_SECONDS;
  const busiestHour = data.byHour.reduce(
    (best, h) => (h.processed > (best?.processed ?? -1) ? h : best),
    data.byHour[0],
  );

  return (
    <div className="view">
      <section className="kpi-grid">
        <StatCard
          label="Success rate"
          value={`${derived.successRate.toFixed(1)}%`}
          badge={
            <span className="badge badge-outline">
              <span className={`dot-mark${totals.failed > 0 ? " is-danger" : " is-success"}`} />
              {totals.failed.toLocaleString()} failed
            </span>
          }
          lead={`${totals.processed.toLocaleString()} of ${derived.attempted.toLocaleString()} attempts`}
          sub="Transcribed without error, all time"
        />
        <StatCard
          label="Already handled"
          value={`${derived.skipRate.toFixed(1)}%`}
          lead={`${totals.skipped.toLocaleString()} of ${totals.voicemails.toLocaleString()} found`}
          sub="Seen on an earlier pass and skipped"
        />
        <StatCard
          label="Typical gap between runs"
          value={formatDuration(cadence.medianGapSeconds)}
          badge={
            <TrendBadge trend={stalled ? "down" : "flat"}>
              {stalled ? "stalled once" : "steady"}
            </TrendBadge>
          }
          lead={`Longest ${formatDuration(cadence.longestGapSeconds)}`}
          sub={
            cadence.longestGapEndedAt
              ? `Ended ${formatDateTime(cadence.longestGapEndedAt)}`
              : "No gap recorded yet"
          }
        />
        <StatCard
          label="Passes with nothing to do"
          value={`${derived.emptyRate.toFixed(0)}%`}
          lead={`${totals.emptyRuns.toLocaleString()} of ${totals.runs.toLocaleString()} runs`}
          sub="Ran on schedule, found no voicemails"
        />
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <div className="card-title ta-headline-2">Transcribed per day</div>
            <div className="card-sub ta-caption-1">
              Last 90 days · {data.daily.length} {data.daily.length === 1 ? "day" : "days"} with runs
            </div>
          </div>
        </div>
        <div className="chart-body">
          {dailyPoints.length > 0 ? (
            <AreaChart points={dailyPoints} ariaLabel="Voicemails transcribed per day" gradientId="analyticsFill" />
          ) : (
            <p className="muted ta-body-2 chart-empty">No runs in the last 90 days.</p>
          )}
        </div>
      </section>

      <div className="split-grid">
        <section className="card">
          <div className="card-head">
            <div>
              <div className="card-title ta-headline-2">When voicemails get transcribed</div>
              <div className="card-sub ta-caption-1">
                By hour, Pacific
                {busiestHour ? ` · busiest around ${formatHour(busiestHour.hour)}` : ""}
              </div>
            </div>
          </div>
          <div className="chart-body">
            <BarChart bars={hourBars} ariaLabel="Voicemails transcribed by hour of day" />
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <div>
              <div className="card-title ta-headline-2">By day of the week</div>
              <div className="card-sub ta-caption-1">All time, Pacific</div>
            </div>
          </div>
          <div className="chart-body">
            <BarChart bars={weekdayBars} ariaLabel="Voicemails transcribed by day of the week" />
          </div>
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <div>
            <div className="card-title ta-headline-2">What a run actually transcribes</div>
            <div className="card-sub ta-caption-1">
              Runs that transcribed something ·{" "}
              {perRun.productiveRuns.toLocaleString()} of {totals.runs.toLocaleString()} runs ·
              median {perRun.medianProcessed} (highlighted) · busiest {perRun.maxProcessed}
            </div>
          </div>
        </div>
        <div className="chart-body">
          {perRun.distribution.length > 0 ? (
            <BarChart
              bars={distributionBars}
              ariaLabel="How many voicemails each run transcribed"
              highlightKey={`d${perRun.medianProcessed}`}
            />
          ) : (
            <p className="muted ta-body-2 chart-empty">No run has transcribed anything yet.</p>
          )}
        </div>
        <p className="card-foot muted ta-caption-1">
          Each bar is a number of voicemails; its height is how many runs transcribed exactly that
          many. The {totals.emptyRuns.toLocaleString()} passes that found nothing are left out — an
          average across every run describes no run that has actually happened.
        </p>
      </section>

      <section className="card">
        <div className="card-toolbar">
          <div>
            <div className="card-title ta-headline-2">Busiest runs</div>
            <div className="card-sub ta-caption-1">The ten single runs that transcribed the most</div>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">When</th>
                <th className="num" scope="col">
                  Found
                </th>
                <th className="num" scope="col">
                  Transcribed
                </th>
                <th className="num" scope="col">
                  Skipped
                </th>
                <th className="num" scope="col">
                  Failed
                </th>
              </tr>
            </thead>
            <tbody>
              {perRun.busiest.length === 0 ? (
                <tr>
                  <td className="table-empty" colSpan={5}>
                    No run has transcribed anything yet.
                  </td>
                </tr>
              ) : (
                perRun.busiest.map((run) => (
                  <tr key={run.id}>
                    <td>{formatDateTime(run.createdAt)}</td>
                    <td className="num">{run.voicemails}</td>
                    <td className="num">{run.processed}</td>
                    <td className="num">{run.skipped}</td>
                    <td className={`num${run.failed > 0 ? " is-danger" : ""}`}>{run.failed}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="card-toolbar">
          <div>
            <div className="card-title ta-headline-2">What the app has done overall</div>
            <div className="card-sub ta-caption-1">
              {totals.firstRunAt
                ? `Since ${formatDateTime(totals.firstRunAt)}`
                : "No runs reported yet"}
            </div>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Measure</th>
                <th className="num" scope="col">
                  Count
                </th>
                <th className="num" scope="col">
                  Share of voicemails found
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Voicemails found</td>
                <td className="num">{totals.voicemails.toLocaleString()}</td>
                <td className="num">100%</td>
              </tr>
              <tr>
                <td>Transcribed</td>
                <td className="num">{totals.processed.toLocaleString()}</td>
                <td className="num">{pct(totals.processed, totals.voicemails).toFixed(1)}%</td>
              </tr>
              <tr>
                <td>Skipped as already handled</td>
                <td className="num">{totals.skipped.toLocaleString()}</td>
                <td className="num">{derived.skipRate.toFixed(1)}%</td>
              </tr>
              <tr>
                <td>Failed, left for a retry</td>
                <td className="num">{totals.failed.toLocaleString()}</td>
                <td className={`num${totals.failed > 0 ? " is-danger" : ""}`}>
                  {pct(totals.failed, totals.voicemails).toFixed(1)}%
                </td>
              </tr>
              <tr>
                <td>Runs reported</td>
                <td className="num">{totals.runs.toLocaleString()}</td>
                <td className="num">
                  {perRun.productiveRuns.toLocaleString()} transcribed something
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
