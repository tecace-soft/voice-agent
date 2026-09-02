import { useMemo, useState } from "react";
import type { MailboxScope, TranscribeStats } from "../api/types";
import { AreaChart, type ChartPoint } from "../components/AreaChart";
import { RunsTable } from "../components/RunsTable";
import { CapMeter, capState } from "../components/CapMeter";
import { PollerStatus } from "../components/PollerStatus";
import { StatCard, TrendBadge, type Trend } from "../components/StatCard";
import { TabBar, type TabDef } from "../components/TabBar";
import { deltaPct, formatDayShort, formatPct, formatShort } from "../lib";
import { derive } from "../stats";

// How much of the run series the chart shows. The backend caps the series at the last 60 runs, so
// "All runs" means "everything the chart has" — the sub-caption spells out the real span.
const RANGES = [
  { id: "all", label: "All runs", take: Number.POSITIVE_INFINITY },
  { id: "30", label: "Last 30 runs", take: 30 },
  { id: "10", label: "Last 10 runs", take: 10 },
] as const;
type RangeId = (typeof RANGES)[number]["id"];

type TabId = "recent" | "all" | "failed" | "empty";

// The delta pill on a KPI card: a percentage when there's a baseline to compare with, and a plain
// count when there isn't (a jump from zero has no meaningful percentage).
function delta(curr: number, prev: number): { trend: Trend; text: string } {
  const pct = deltaPct(curr, prev);
  if (pct === null) return { trend: curr > 0 ? "up" : "flat", text: curr > 0 ? `+${curr}` : "0" };
  const trend: Trend = pct > 0 ? "up" : pct < 0 ? "down" : "flat";
  return { trend, text: formatPct(pct) };
}

export function OverviewPage({
  data,
  mailboxLabel,
  showMailbox,
  mailbox,
  isAdmin,
}: {
  data: TranscribeStats;
  mailboxLabel: string;
  showMailbox?: boolean;
  /** Scope for the poller-liveness check. Omitted inside a per-person panel, which already shows
   *  one person and would otherwise repeat the same warning under every name. */
  mailbox?: MailboxScope;
  /** Poller health is admin-only: it is our infrastructure, not the customer's data. */
  isAdmin?: boolean;
}) {
  const [range, setRange] = useState<RangeId>("all");
  const [tab, setTab] = useState<TabId>("recent");
  const d = useMemo(() => derive(data), [data]);

  const take = RANGES.find((r) => r.id === range)!.take;
  const windowed = useMemo(
    () => (take === Number.POSITIVE_INFINITY ? data.runSeries : data.runSeries.slice(-take)),
    [data.runSeries, take],
  );
  const points: ChartPoint[] = windowed.map((run) => ({
    key: run.id,
    label: formatDayShort(run.createdAt),
    value: run.processed,
    tip: `${formatShort(run.createdAt)} — ${run.processed} transcribed`,
  }));

  const todayDelta = delta(d.today, d.yesterday);
  const monthDelta = delta(data.thisMonth, data.prevMonth);
  // Only the month matters for billing, so the cap is measured against that figure.
  const cap = capState(data.thisMonth, data.cap);

  const tabs: TabDef<TabId>[] = [
    { id: "recent", label: "Recent runs" },
    { id: "all", label: "All runs" },
    { id: "failed", label: "Failed", count: d.failedRuns.length },
    { id: "empty", label: "Empty passes", count: d.emptyRuns.length },
  ];
  const rows = {
    recent: data.recent,
    all: d.runsNewestFirst,
    failed: d.failedRuns,
    empty: d.emptyRuns,
  }[tab];
  const emptyMessage = {
    recent: "No runs reported yet.",
    all: "No runs reported yet.",
    failed: "No run has failed a voicemail — nothing to look at here.",
    empty: "Every pass found voicemails to transcribe.",
  }[tab];

  const spanText =
    windowed.length >= 2
      ? `${formatShort(windowed[0]!.createdAt)} → ${formatShort(windowed[windowed.length - 1]!.createdAt)}`
      : windowed.length === 1
        ? formatShort(windowed[0]!.createdAt)
        : "no runs yet";

  // With no runs at all, say WHOSE data is missing. "Nothing here" reads very differently when the
  // reason is that this mailbox has never been polled.
  if (data.runs === 0) {
    return (
      <div className="view">
        <section className="card">
          <div className="card-head">
            <div>
              <div className="card-title ta-headline-2">No voicemail data yet</div>
              <div className="card-sub ta-caption-1">Showing {mailboxLabel}</div>
            </div>
          </div>
          <p className="feedback-empty muted ta-body-2">
            Nothing has been transcribed for <strong>{mailboxLabel}</strong>. Voicemail data is
            attributed to the mailbox it was fetched from, so it appears here once the transcribe
            app has run against that address. ("Unattributed" is the runs reported before the app
            started recording which mailbox they came from.)
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className="view">
      {/* Admin only, and only where one poller is in view — see the props' notes. */}
      {isAdmin && (mailbox !== undefined || !showMailbox) ? <PollerStatus mailbox={mailbox} /> : null}
      <section className="kpi-grid">
        <StatCard
          label="Total transcribed"
          value={data.totalProcessed.toLocaleString()}
          badge={
            <TrendBadge trend={d.curr7 > 0 ? "up" : "flat"}>
              {d.curr7 > 0 ? `+${d.curr7.toLocaleString()}` : "0"}
            </TrendBadge>
          }
          lead={`${data.runs.toLocaleString()} ${data.runs === 1 ? "run" : "runs"} reported`}
          sub="All voicemails transcribed to date"
        />
        <StatCard
          label="Transcribed today"
          value={d.today.toLocaleString()}
          badge={<TrendBadge trend={todayDelta.trend}>{todayDelta.text}</TrendBadge>}
          lead={
            d.today > d.yesterday
              ? `Up from ${d.yesterday} yesterday`
              : d.today < d.yesterday
                ? `Down from ${d.yesterday} yesterday`
                : `Level with yesterday`
          }
          leadTrend={todayDelta.trend}
          sub="Since midnight, Pacific time"
        />
        <StatCard
          label="This month"
          value={data.thisMonth.toLocaleString()}
          badge={<TrendBadge trend={monthDelta.trend}>{monthDelta.text}</TrendBadge>}
          lead={
            monthDelta.trend === "up"
              ? "Ahead of last month"
              : monthDelta.trend === "down"
                ? "Behind last month"
                : "Level with last month"
          }
          leadTrend={monthDelta.trend}
          sub={`${data.prevMonth.toLocaleString()} last month · ${d.curr7.toLocaleString()} in the last 7 days`}
          tone={cap === "over" ? "danger" : undefined}
          extra={<CapMeter used={data.thisMonth} cap={data.cap} />}
        />
        <StatCard
          label="Success rate"
          value={`${d.successRate.toFixed(1)}%`}
          badge={
            <span className="badge badge-outline">
              <span className={`dot-mark${data.totalFailed > 0 ? " is-danger" : " is-success"}`} />
              {data.totalFailed.toLocaleString()} failed
            </span>
          }
          lead={
            data.totalFailed > 0
              ? `${data.totalFailed.toLocaleString()} of ${d.attempted.toLocaleString()} attempts failed`
              : "No failures recorded"
          }
          sub="Voicemails transcribed without error"
        />
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <div className="card-title ta-headline-2">Voicemails transcribed</div>
            <div className="card-sub ta-caption-1">One point per run · {spanText}</div>
          </div>
          <div className="segmented" role="group" aria-label="Chart range">
            {RANGES.map((r) => (
              <button
                key={r.id}
                type="button"
                className={`segment${r.id === range ? " is-active" : ""}`}
                aria-pressed={r.id === range}
                onClick={() => setRange(r.id)}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
        <div className="chart-body">
          {points.length > 0 ? (
            <AreaChart points={points} ariaLabel="Voicemails transcribed per run" />
          ) : (
            <p className="muted ta-body-2 chart-empty">
              No runs reported yet. The chart fills in once the transcribe app finishes a pass.
            </p>
          )}
        </div>
      </section>

      <RunsTable
        key={tab}
        runs={rows}
        showMailbox={showMailbox}
        emptyMessage={emptyMessage}
        tabs={<TabBar tabs={tabs} active={tab} onChange={setTab} label="Which runs to show" />}
      />
    </div>
  );
}
