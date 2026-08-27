import type { ReactNode } from "react";
import { IconFlat, IconTrendDown, IconTrendUp } from "../icons";

export type Trend = "up" | "down" | "flat";

const TREND_ICON = { up: IconTrendUp, down: IconTrendDown, flat: IconFlat } as const;

// The small outlined pill in a KPI card's top-right corner: an arrow carrying the direction plus
// the delta itself. Only the arrow takes a semantic color — the pill stays outlined and quiet.
export function TrendBadge({ trend, children }: { trend: Trend; children: ReactNode }) {
  const Arrow = TREND_ICON[trend];
  return (
    <span className={`badge badge-outline trend-${trend}`}>
      <Arrow size={12} />
      {children}
    </span>
  );
}

// One KPI tile: label + delta badge on top, the number in Poppins, and a two-line footer that
// says what the number is doing and what it's measured over.
export function StatCard({
  label,
  value,
  badge,
  lead,
  leadTrend,
  sub,
  tone,
  extra,
}: {
  label: string;
  value: string;
  badge?: ReactNode;
  lead: string;
  leadTrend?: Trend;
  sub: string;
  tone?: "danger";
  // Rendered below the footer. Used for the cap meter, which is absent on most cards and on all
  // cards most of the time — so it is a slot rather than another prop the card has to understand.
  extra?: ReactNode;
}) {
  const LeadIcon = leadTrend ? TREND_ICON[leadTrend] : null;
  return (
    <article className="stat-card">
      <div className="stat-card-body">
        <div className="stat-card-top">
          <span className="stat-label ta-caption-1">{label}</span>
          {badge}
        </div>
        <div className={`stat-value${tone === "danger" ? " is-danger" : ""}`}>{value}</div>
      </div>
      <footer className="stat-card-foot">
        <div className="stat-foot-lead ta-label-1">
          {lead}
          {LeadIcon ? <LeadIcon size={14} className={`icon trend-${leadTrend}`} /> : null}
        </div>
        <div className="stat-foot-sub ta-caption-1">{sub}</div>
        {extra}
      </footer>
    </article>
  );
}
