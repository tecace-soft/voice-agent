import type { CallMinutes } from "../api/types";
import { StatCard } from "./StatCard";

// How long the assistant spent on the phone for ONE business, this month and last.
//
// Always one business's figures — never a blend. An admin looking across businesses gets one of
// these per business, inside that business's panel, the same way every other view keeps each
// person's numbers apart.
//
// Worded carefully about what it counts: every agent call, inbound AND outbound. The list beside it
// only has the calls that rang in, so without saying so, adding up that list would come to less than
// this and look like a mistake.

/** Talk time the way people read a phone bill: minutes, with seconds only for a short total. */
export function formatTalkTime(seconds: number): string {
  if (seconds <= 0) return "0 min";
  if (seconds < 60) return `${Math.round(seconds)} sec`;
  const minutes = Math.round(seconds / 6) / 10;
  return `${minutes.toLocaleString("en-US", { maximumFractionDigits: minutes >= 100 ? 0 : 1 })} min`;
}

/** "2026-09" -> "September 2026". Formatted in UTC: the key is already the business's month. */
export function formatMonth(key: string): string {
  const [year, month] = key.split("-").map(Number);
  if (!year || !month) return key;
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", year: "numeric" }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  );
}

export function TalkTimeCards({ minutes }: { minutes: CallMinutes }) {
  return (
    <section className="split-grid">
      <StatCard
        label="Talk time this month"
        value={formatTalkTime(minutes.currentSeconds)}
        lead={`${formatMonth(minutes.currentMonth)}, so far`}
        sub="Every agent call, inbound and outbound"
      />
      <StatCard
        label="Talk time last month"
        value={formatTalkTime(minutes.previousSeconds)}
        lead={formatMonth(minutes.previousMonth)}
        sub="The month's final total"
      />
    </section>
  );
}
