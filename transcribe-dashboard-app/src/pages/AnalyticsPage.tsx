import { useEffect, useMemo, useState } from "react";
import { getTranscribeAnalytics } from "../api/backend";
import type { TranscribeAnalytics } from "../api/types";
import { BarChart, type Bar } from "../components/BarChart";
import { SessionCard } from "../components/SessionCard";
import { StatCard, TrendBadge } from "../components/StatCard";
import { TabBar, type TabDef } from "../components/TabBar";
import { IconChevronLeft, IconChevronRight } from "../icons";
import { formatDateTime, formatDuration, formatHour, formatWeekday } from "../lib";
import { DashboardSkeleton } from "../ui";

// The operational view of the transcribe-app, over its whole history rather than the 60-run window
// the other pages read — and broken out by SESSION rather than by day. A calendar day is an
// arbitrary bucket for a job that runs on its own schedule; what actually happened is a series of
// runs, so each transcribed session gets its own numbers here.

// Two days without a run is well past any normal poll interval — worth calling out rather than
// leaving as a number nobody reads.
const STALL_SECONDS = 48 * 3600;

const pct = (part: number, whole: number) => (whole <= 0 ? 0 : (part / whole) * 100);

type SessionSort = "recent" | "busiest";
const PER_PAGE = 8;

export function AnalyticsPage() {
  const [data, setData] = useState<TranscribeAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessionSort, setSessionSort] = useState<SessionSort>("recent");
  const [page, setPage] = useState(0);

  useEffect(() => {
    let active = true;
    getTranscribeAnalytics()
      .then((d) => active && setData(d))
      .catch((e) => active && setError(e instanceof Error ? e.message : "Couldn't load analytics."));
    return () => {
      active = false;
    };
  }, []);

  // Re-ordering the list should start you at the top of the new order, not page 4 of it.
  useEffect(() => {
    setPage(0);
  }, [sessionSort]);

  const sessions = useMemo(() => data?.sessions ?? [], [data]);
  const shownSessions = useMemo(() => {
    const ordered =
      sessionSort === "busiest"
        ? [...sessions].sort(
            (a, b) => b.processed - a.processed || +new Date(b.createdAt) - +new Date(a.createdAt),
          )
        : sessions;
    return ordered.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);
  }, [sessions, sessionSort, page]);

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

  const pageCount = Math.max(1, Math.ceil(sessions.length / PER_PAGE));
  const listedProcessed = sessions.reduce((sum, s) => sum + s.processed, 0);
  // Newest first is the operational read ("what just happened"); biggest first answers "which were
  // the heavy sessions". Same list, two orderings.
  const sessionTabs: TabDef<SessionSort>[] = [
    { id: "recent", label: "Newest" },
    { id: "busiest", label: "Biggest" },
  ];

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

  // Every output from 1 to the busiest session, so a gap in the middle reads as a gap rather than
  // two neighbouring bars.
  const distCounts = new Map(perRun.distribution.map((d) => [d.processed, d.runs]));
  const distributionBars: Bar[] = Array.from({ length: perRun.maxProcessed }, (_, i) => {
    const processed = i + 1;
    const runs = distCounts.get(processed) ?? 0;
    return {
      key: `d${processed}`,
      label: perRun.maxProcessed <= 20 || processed % 5 === 0 ? String(processed) : "",
      value: runs,
      tip: `${runs} ${runs === 1 ? "session" : "sessions"} transcribed ${processed} ${processed === 1 ? "voicemail" : "voicemails"}`,
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
        <div className="card-toolbar">
          <div>
            <div className="card-title ta-headline-2">Transcribed sessions</div>
            <div className="card-sub ta-caption-1">
              Every run that transcribed something, on its own · {sessions.length} of{" "}
              {perRun.productiveRuns.toLocaleString()} listed
            </div>
          </div>
          <TabBar
            tabs={sessionTabs}
            active={sessionSort}
            onChange={setSessionSort}
            label="How to order the sessions"
          />
        </div>

        {sessions.length === 0 ? (
          <p className="feedback-empty muted ta-body-2">
            No run has transcribed anything yet. Sessions appear here as soon as one does.
          </p>
        ) : (
          <>
            <ul className="session-list">
              {shownSessions.map((session) => (
                <SessionCard
                  key={session.id}
                  session={session}
                  share={pct(session.processed, listedProcessed)}
                />
              ))}
            </ul>
            <div className="table-foot">
              <div className="ta-caption-1 muted">
                {sessions.length} {sessions.length === 1 ? "session" : "sessions"}
              </div>
              <div className="table-foot-controls">
                <div className="ta-caption-1 page-count">
                  Page {page + 1} of {pageCount}
                </div>
                <div className="pager">
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Previous page"
                    disabled={page === 0}
                    onClick={() => setPage((n) => n - 1)}
                  >
                    <IconChevronLeft size={14} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Next page"
                    disabled={page >= pageCount - 1}
                    onClick={() => setPage((n) => n + 1)}
                  >
                    <IconChevronRight size={14} />
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <div className="card-title ta-headline-2">What a session actually transcribes</div>
            <div className="card-sub ta-caption-1">
              Sessions that transcribed something · {perRun.productiveRuns.toLocaleString()} of{" "}
              {totals.runs.toLocaleString()} runs · median {perRun.medianProcessed} (highlighted) ·
              busiest {perRun.maxProcessed}
            </div>
          </div>
        </div>
        <div className="chart-body">
          {perRun.distribution.length > 0 ? (
            <BarChart
              bars={distributionBars}
              ariaLabel="How many voicemails each session transcribed"
              highlightKey={`d${perRun.medianProcessed}`}
            />
          ) : (
            <p className="muted ta-body-2 chart-empty">No session has transcribed anything yet.</p>
          )}
        </div>
        <p className="card-foot muted ta-caption-1">
          Each bar is a number of voicemails; its height is how many sessions transcribed exactly
          that many. The {totals.emptyRuns.toLocaleString()} passes that found nothing are left out —
          an average across every run describes no run that has actually happened.
        </p>
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
        <div className="card-toolbar">
          <div>
            <div className="card-title ta-headline-2">What the app has done overall</div>
            <div className="card-sub ta-caption-1">
              {totals.firstRunAt ? `Since ${formatDateTime(totals.firstRunAt)}` : "No runs reported yet"}
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
