import type { CallMinutes, InboundCall } from "../../api/types";
import type { DayBucket } from "./analytics";
import type { STATUS_STYLES } from "../components/admin/shared";

// Dashboard-only (see PORTING.md): the numbers on the Dashboard › Overview page, worked out from a
// business's answered calls (`GET /calls`) and talk time (`GET /usage/minutes`). Pure, so the page
// only fetches and draws.

export type ReceptionistKpis = {
  calls: number;
  minutes: number;
  avgCallSec: number;
  callbacks: number;
};

const DAY_MS = 86_400_000;

// A calendar day in the browser's time zone, "YYYY-MM-DD" — the day the person reading it had.
function localDay(time: number): string {
  const d = new Date(time);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The calls that started in the last `days` days (today included), newest first as given. */
export function callsInWindow(calls: InboundCall[], days: number, now = Date.now()): InboundCall[] {
  const today = new Date(now);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() - (days - 1) * DAY_MS;
  return calls.filter((call) => {
    const at = Date.parse(call.startedAt);
    return Number.isFinite(at) && at >= start && at <= now;
  });
}

/** Calls and minutes per local day over the last `days` days, oldest first, empty days filled in. */
export function inboundCallsPerDay(calls: InboundCall[], days: number, now = Date.now()): DayBucket[] {
  const buckets = new Map<string, DayBucket>();
  const today = new Date(now);
  for (let offset = days - 1; offset >= 0; offset--) {
    // Built from the calendar date, not `now - offset * 24h`, so a DST change can't skip a day.
    const key = localDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset).getTime());
    buckets.set(key, { date: key, calls: 0, minutes: 0 });
  }
  for (const call of calls) {
    const at = Date.parse(call.startedAt);
    if (!Number.isFinite(at)) continue;
    const bucket = buckets.get(localDay(at));
    if (!bucket) continue;
    bucket.calls += 1;
    bucket.minutes += (call.durationSeconds ?? 0) / 60;
  }
  return [...buckets.values()].map((bucket) => ({ ...bucket, minutes: Math.round(bucket.minutes * 10) / 10 }));
}

/** The KPI row, over calls already narrowed to the window. */
export function receptionistKpis(calls: InboundCall[]): ReceptionistKpis {
  const seconds = calls.reduce((sum, call) => sum + (call.durationSeconds ?? 0), 0);
  return {
    calls: calls.length,
    minutes: Math.round((seconds / 60) * 10) / 10,
    avgCallSec: calls.length ? seconds / calls.length : 0,
    callbacks: calls.filter((call) => call.callbackRequested).length,
  };
}

/**
 * What callers got, counted by outcome, for the customer's Home: every call answered, the bookings,
 * the ones that left something for the business (a message, or a call back asked for), and the
 * ones put through to a person. `outcome` is what the phone agent marks at the end of a call
 * (openai-agent-app: booked, message, callback, transferred, transfer_failed, voicemail,
 * caller_hung_up); `callbackRequested` is set alongside, so a call counts as a message once.
 */
export interface OutcomeKpis {
  answered: number;
  booked: number;
  messages: number;
  transferred: number;
}

const MESSAGE_OUTCOMES = new Set(["message", "callback"]);

export const leftSomething = (call: InboundCall): boolean =>
  call.callbackRequested || (call.outcome !== null && MESSAGE_OUTCOMES.has(call.outcome));

export function outcomeKpis(calls: InboundCall[]): OutcomeKpis {
  return {
    answered: calls.length,
    booked: calls.filter((call) => call.outcome === "booked").length,
    messages: calls.filter(leftSomething).length,
    transferred: calls.filter((call) => call.outcome === "transferred").length,
  };
}

/** The calls that left something for the business, newest first. */
export function needsReply(calls: InboundCall[]): InboundCall[] {
  return calls.filter(leftSomething).sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
}

/** This month's and last month's talk time, summed over the rows given (one business, or all). */
export function talkTime(rows: CallMinutes[]): { current: number; previous: number } {
  return {
    current: Math.round(rows.reduce((sum, row) => sum + row.currentMinutes, 0) * 10) / 10,
    previous: Math.round(rows.reduce((sum, row) => sum + row.previousMinutes, 0) * 10) / 10,
  };
}

// How the phone agent says a call ended (openai-agent-app `realtime/bridge.py` `_OUTCOME_SUMMARY`),
// as a pill. An outcome we don't know is shown as it came, so a new one is never hidden.
const OUTCOMES: Record<string, { label: string; kind: keyof typeof STATUS_STYLES }> = {
  booked: { label: "Booked", kind: "positive" },
  transferred: { label: "Transferred", kind: "positive" },
  message: { label: "Message taken", kind: "active" },
  callback: { label: "Callback", kind: "caution" },
  transfer_failed: { label: "Transfer failed", kind: "negative" },
  caller_hung_up: { label: "Caller hung up", kind: "caution" },
  declined: { label: "Declined", kind: "neutral" },
  wrong_number: { label: "Wrong number", kind: "neutral" },
  unreachable: { label: "Unreachable", kind: "neutral" },
  voicemail: { label: "Voicemail", kind: "neutral" },
};

export function outcomeBadge(call: InboundCall): { label: string; kind: keyof typeof STATUS_STYLES } {
  const known = call.outcome ? OUTCOMES[call.outcome] : undefined;
  if (known) return known;
  if (call.outcome) return { label: call.outcome.replace(/_/g, " "), kind: "neutral" };
  if (call.callbackRequested) return OUTCOMES.callback!;
  return { label: "Answered", kind: "neutral" };
}

/** Who rang, as plainly as we know it. */
export function callerLabel(call: InboundCall): string {
  return call.callerName?.trim() || call.caller || "Unknown caller";
}
