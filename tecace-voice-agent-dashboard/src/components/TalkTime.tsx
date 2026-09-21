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

/**
 * Talk time in the SAME form as a call's own length in the call list ("4m 12s"), switching to hours
 * and minutes past an hour. Decimal minutes ("1.1 min") next to a call reading "1m 5s" looked like
 * two different numbers for the same call, when they were the same 65 seconds.
 */
export function formatTalkTime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  if (total === 0) return "0s";
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours) return `${hours}h ${minutes}m`;
  return minutes ? `${minutes}m ${secs}s` : `${secs}s`;
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
