import type {
  CallLog,
  CrmNote,
  CustomerStage,
  CustomerStats,
  Engagement,
  Heat,
  TrackEvent,
} from "./types.js";
import { CUSTOMER_STAGES } from "./types.js";

/** A call left in "started" for longer than this is treated as abandoned. */
export const STALE_CALL_MS = 10 * 60 * 1000;

/**
 * Research runs in the background, so nothing tells the page when the function
 * behind it was killed mid-run (a host's execution limit, a redeploy). A record
 * still marked "researching" long after its last write is not running any more.
 */
export const RESEARCH_STALL_MS = 15 * 60 * 1000;

export function isResearchStalled(
  customer: { status: string; updatedAt: string },
  now = Date.now(),
): boolean {
  return (
    customer.status === "researching" &&
    now - new Date(customer.updatedAt).getTime() > RESEARCH_STALL_MS
  );
}

/** A call that never reported an end and is older than the stale window. */
export function isAbandoned(call: CallLog, now = Date.now()): boolean {
  return (
    call.status === "started" &&
    now - new Date(call.startedAt).getTime() > STALE_CALL_MS
  );
}

/**
 * The slice of history a reporting period covers. The KPI cards used to ignore
 * the period select entirely and report all time, so changing it moved the
 * chart and nothing else.
 */
export function withinDays<T>(
  items: T[],
  days: number,
  at: (item: T) => string,
  now = Date.now(),
): T[] {
  const from = now - days * 86_400_000;
  return items.filter((item) => {
    const time = new Date(at(item)).getTime();
    return Number.isFinite(time) && time >= from;
  });
}

/**
 * Calls happening right now: started, not yet reported, not old enough to be
 * written off. Several people at one business can be on the line at the same
 * time, so anything that asks "how much has this demo used" has to count them.
 */
export function inFlightCalls(calls: CallLog[], now = Date.now()): CallLog[] {
  return calls.filter(
    (call) => !call.isTest && call.status === "started" && !isAbandoned(call, now),
  );
}

/** Seconds burned by calls still in progress. */
export function inFlightSeconds(calls: CallLog[], now = Date.now()): number {
  return inFlightCalls(calls, now).reduce((sum, call) => {
    const elapsed = (now - new Date(call.startedAt).getTime()) / 1000;
    return sum + (Number.isFinite(elapsed) && elapsed > 0 ? elapsed : 0);
  }, 0);
}

/** Calls the operator made from the admin test panel. */
export function testCalls(calls: CallLog[]): CallLog[] {
  return calls.filter((call) => call.isTest);
}

/** Calls that count towards customer-facing numbers: real, not in flight. */
export function countableCalls(calls: CallLog[], now = Date.now()): CallLog[] {
  return calls.filter(
    (call) =>
      !call.isTest &&
      (call.status === "completed" ||
        call.status === "abandoned" ||
        call.status === "failed" ||
        isAbandoned(call, now)),
  );
}

/**
 * Every prospect gets a fixed amount of demo time, and asking for more is the
 * point at which they talk to a person. A call still in flight has reported no
 * seconds yet, so the figure here is what has finished; the per-IP limit on
 * /api/session is what stops anyone racing that gap.
 *
 * Admin test calls are excluded, the same as everywhere else, so trying a
 * customer's demo yourself does not spend their minutes.
 */
export type DemoAllowance = {
  allowedSec: number;
  usedSec: number;
  remainingSec: number;
  exhausted: boolean;
};

export function demoAllowance(
  calls: CallLog[],
  minutes: number,
  now = Date.now(),
): DemoAllowance {
  const allowedSec = Math.max(0, Math.round(minutes * 60));
  const finished = countableCalls(calls, now).reduce(
    (sum, call) => sum + (call.durationSec ?? 0),
    0,
  );
  // Calls still on the line count as they happen. Without this, everyone who
  // dialled at the same moment saw a full allowance and got a full call, and a
  // ten minute demo could hand out an hour.
  const usedSec = Math.round(finished + inFlightSeconds(calls, now));
  const remainingSec = Math.max(0, allowedSec - usedSec);
  return { allowedSec, usedSec, remainingSec, exhausted: remainingSec <= 0 };
}

export function computeStats(
  calls: CallLog[],
  events: TrackEvent[],
  now = Date.now(),
): CustomerStats {
  const real = countableCalls(calls, now);
  const views = events.length;
  const totalSec = real.reduce((sum, call) => sum + (call.durationSec ?? 0), 0);
  const lastCall = real[0] ?? calls.find((call) => !call.isTest);
  const lastView = events.reduce<string | undefined>(
    (latest, event) => (!latest || event.at > latest ? event.at : latest),
    undefined,
  );
  return {
    views,
    calls: real.length,
    totalSec,
    visitors: distinctVisitors(events, calls),
    lastCallAt: lastCall?.startedAt,
    lastViewAt: lastView,
  };
}

export function statsByCustomer(
  calls: CallLog[],
  events: TrackEvent[],
  now = Date.now(),
): Record<string, CustomerStats> {
  const callsFor = new Map<string, CallLog[]>();
  for (const call of calls) {
    const list = callsFor.get(call.customerId) ?? [];
    list.push(call);
    callsFor.set(call.customerId, list);
  }
  const eventsFor = new Map<string, TrackEvent[]>();
  for (const event of events) {
    const list = eventsFor.get(event.customerId) ?? [];
    list.push(event);
    eventsFor.set(event.customerId, list);
  }
  const ids = new Set([...callsFor.keys(), ...eventsFor.keys()]);
  const out: Record<string, CustomerStats> = {};
  for (const id of ids) {
    out[id] = computeStats(callsFor.get(id) ?? [], eventsFor.get(id) ?? [], now);
  }
  return out;
}

export function emptyStats(): CustomerStats {
  return { views: 0, calls: 0, totalSec: 0, visitors: 0 };
}

/** Heat per customer, for the list, where the calls are already to hand. */
export function heatByCustomer(
  calls: CallLog[],
  stats: Record<string, CustomerStats>,
  now = Date.now(),
): Record<string, Engagement> {
  const callsFor = new Map<string, CallLog[]>();
  for (const call of calls) {
    const list = callsFor.get(call.customerId) ?? [];
    list.push(call);
    callsFor.set(call.customerId, list);
  }
  const out: Record<string, Engagement> = {};
  for (const [id, stat] of Object.entries(stats)) {
    out[id] = engagement(stat, callsFor.get(id) ?? [], now);
  }
  return out;
}

export type DayBucket = { date: string; calls: number; minutes: number };

/** Calls and minutes per day, oldest first, with empty days filled in. */
export function callsPerDay(
  calls: CallLog[],
  days: number,
  now = Date.now(),
): DayBucket[] {
  const buckets = new Map<string, DayBucket>();
  const today = new Date(now);
  for (let offset = days - 1; offset >= 0; offset--) {
    const day = new Date(today.getTime() - offset * 86_400_000);
    const key = day.toISOString().slice(0, 10);
    buckets.set(key, { date: key, calls: 0, minutes: 0 });
  }
  for (const call of countableCalls(calls, now)) {
    const key = call.startedAt.slice(0, 10);
    const bucket = buckets.get(key);
    if (!bucket) continue;
    bucket.calls += 1;
    bucket.minutes += (call.durationSec ?? 0) / 60;
  }
  return [...buckets.values()].map((bucket) => ({
    ...bucket,
    minutes: Math.round(bucket.minutes * 10) / 10,
  }));
}

export type Kpis = {
  customers: number;
  testedCustomers: number;
  totalCalls: number;
  totalMinutes: number;
  avgCallSec: number;
  totalViews: number;
};

export function computeKpis(
  customerIds: string[],
  stats: Record<string, CustomerStats>,
): Kpis {
  let totalCalls = 0;
  let totalSec = 0;
  let totalViews = 0;
  let testedCustomers = 0;
  for (const id of customerIds) {
    const stat = stats[id];
    if (!stat) continue;
    totalCalls += stat.calls;
    totalSec += stat.totalSec;
    totalViews += stat.views;
    if (stat.calls > 0) testedCustomers += 1;
  }
  return {
    customers: customerIds.length,
    testedCustomers,
    totalCalls,
    totalMinutes: Math.round((totalSec / 60) * 10) / 10,
    avgCallSec: totalCalls ? Math.round(totalSec / totalCalls) : 0,
    totalViews,
  };
}

export function formatDuration(seconds: number | undefined): string {
  if (!seconds || seconds < 1) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

/**
 * How many different browsers opened this demo, as opposed to how many times it
 * was opened. A link goes to a business, and several people there may try it —
 * "three people once each" and "one person three times" are different news.
 *
 * Records written before visitor ids existed carry none, so they count as one
 * unknown visitor between them rather than as none at all.
 */
export function distinctVisitors(
  events: TrackEvent[],
  calls: CallLog[],
): number {
  const seen = new Set<string>();
  let anonymous = false;
  for (const item of [...events, ...calls]) {
    if (item.visitorId) seen.add(item.visitorId);
    else anonymous = true;
  }
  return seen.size + (anonymous ? 1 : 0);
}

const WARM_SCORE = 25;
const HOT_SCORE = 60;

/**
 * How interested a prospect looks. Deliberately a few plain terms rather than
 * anything clever, because the number is only useful if the operator can see
 * why it is what it is: talking for longer and coming back recently count,
 * opening the link and never calling barely does.
 */
export function engagement(
  stats: CustomerStats,
  calls: CallLog[],
  now = Date.now(),
): Engagement {
  const real = countableCalls(calls, now);
  const minutes = stats.totalSec / 60;
  const turns = real.reduce(
    (sum, call) => sum + (call.turns ?? call.transcript.length),
    0,
  );

  let score = stats.calls * 12 + minutes * 6 + turns * 0.6 + Math.min(stats.views, 10);

  // A prospect who tried it last week is not the prospect who tried it today.
  const lastAt = stats.lastCallAt ?? stats.lastViewAt;
  const days = lastAt
    ? (now - new Date(lastAt).getTime()) / 86_400_000
    : Number.POSITIVE_INFINITY;
  if (Number.isFinite(days)) {
    if (days > 30) score *= 0.4;
    else if (days > 14) score *= 0.6;
    else if (days > 7) score *= 0.8;
  }

  score = Math.round(score);
  const level: Heat = score >= HOT_SCORE ? "hot" : score >= WARM_SCORE ? "warm" : "cold";

  const parts: string[] = [];
  if (stats.calls) parts.push(`${stats.calls} call${stats.calls === 1 ? "" : "s"}`);
  if (minutes >= 0.1) parts.push(`${Math.round(minutes * 10) / 10} min`);
  if (!stats.calls && stats.views) {
    parts.push(`${stats.views} open${stats.views === 1 ? "" : "s"}, never called`);
  }
  if (Number.isFinite(days)) {
    parts.push(days < 1 ? "today" : `${Math.round(days)}d ago`);
  }

  return { score, level, reason: parts.join(" · ") || "No activity yet" };
}

/**
 * One caller's side of one call, as prose.
 *
 * The transcript is stored as bubbles, and a bubble ends whenever the other
 * speaker starts — which on a phone call happens every time the receptionist
 * says "mm-hm" over the top of someone. That is right on screen and wrong in a
 * list: it cut single sentences into five rows that each began mid-word. The
 * caller's fragments in order, joined, are the sentence they actually said.
 */
export function callerSaid(call: CallLog): string {
  return call.transcript
    .filter((entry) => entry.speaker === "caller")
    .map((entry) => entry.text.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.!?])/g, "$1")
    .trim();
}

export type GapCount = { text: string; count: number; callIds: string[] };

/**
 * The same shortcoming across several calls, commonest first. One call where
 * the receptionist did not know the hours is an anecdote; four calls is the
 * next thing to build.
 *
 * Grouping is on the exact wording, normalised for case and trailing
 * punctuation. Anything cleverer would be guessing at which two sentences mean
 * the same thing, and a wrong merge here quietly hides a real problem.
 */
export function gapRollup(calls: CallLog[]): GapCount[] {
  const groups = new Map<string, GapCount>();
  for (const call of calls) {
    for (const gap of call.review?.gaps ?? []) {
      const text = gap.trim();
      if (!text) continue;
      const key = text.toLowerCase().replace(/[.!?,;:\s]+$/, "");
      const group = groups.get(key);
      if (group) {
        group.count += 1;
        if (!group.callIds.includes(call.id)) group.callIds.push(call.id);
      } else {
        groups.set(key, { text, count: 1, callIds: [call.id] });
      }
    }
  }
  return [...groups.values()].sort(
    (a, b) => b.count - a.count || a.text.localeCompare(b.text),
  );
}

/** Calls whose transcript is long enough to review but has not been. */
export function unreviewedCalls(calls: CallLog[]): CallLog[] {
  return calls.filter(
    (call) =>
      !call.review &&
      call.status !== "started" &&
      call.transcript.filter((entry) => entry.speaker === "caller" && entry.text.trim())
        .length >= 2,
  );
}

export type TimelineEntry = {
  at: string;
  kind: "note" | "view" | "call";
  text: string;
  /** Set on a call entry, so the row can open that call's transcript. */
  callId?: string;
};

/**
 * Everything that has happened with one prospect, newest first: what they did
 * and what the operator wrote about it, in one column rather than two places.
 */
export function timeline(
  notes: CrmNote[],
  events: TrackEvent[],
  calls: CallLog[],
): TimelineEntry[] {
  const entries: TimelineEntry[] = [];

  for (const note of notes) {
    entries.push({ at: note.at, kind: "note", text: note.text });
  }

  for (const event of events) {
    entries.push({ at: event.at, kind: "view", text: "Opened the demo link" });
  }

  for (const call of calls) {
    const turns = call.turns ?? call.transcript.length;
    const length = formatDuration(call.durationSec);
    entries.push({
      at: call.startedAt,
      kind: "call",
      callId: call.id,
      text: call.isTest
        ? `Your test call · ${length} · ${turns} turns`
        : `Called · ${length} · ${turns} turns`,
    });
  }

  return entries.sort((a, b) => b.at.localeCompare(a.at));
}

export type FeedEntry = TimelineEntry & {
  customerId: string;
  customerName: string;
};

/**
 * One column of everything that happened, across every prospect, newest first.
 *
 * The pipeline board says where each deal stands; this says what moved. Put
 * side by side they answer the question a stage column cannot — which of these
 * is worth a call today, as opposed to which was worth one last week.
 *
 * A record whose customer has been deleted is dropped rather than shown
 * nameless: the row would be unclickable and tell the operator nothing.
 */
export function activityFeed(
  input: {
    customers: { id: string; name: string }[];
    notes: (CrmNote & { customerId: string })[];
    events: TrackEvent[];
    calls: CallLog[];
  },
  limit = 40,
): FeedEntry[] {
  const nameFor = new Map(input.customers.map((customer) => [customer.id, customer.name]));

  const notesFor = new Map<string, CrmNote[]>();
  for (const note of input.notes) {
    const list = notesFor.get(note.customerId) ?? [];
    list.push(note);
    notesFor.set(note.customerId, list);
  }
  const eventsFor = new Map<string, TrackEvent[]>();
  for (const event of input.events) {
    const list = eventsFor.get(event.customerId) ?? [];
    list.push(event);
    eventsFor.set(event.customerId, list);
  }
  const callsFor = new Map<string, CallLog[]>();
  for (const call of input.calls) {
    const list = callsFor.get(call.customerId) ?? [];
    list.push(call);
    callsFor.set(call.customerId, list);
  }

  const entries: FeedEntry[] = [];
  for (const [customerId, customerName] of nameFor) {
    for (const entry of timeline(
      notesFor.get(customerId) ?? [],
      eventsFor.get(customerId) ?? [],
      callsFor.get(customerId) ?? [],
    )) {
      entries.push({ ...entry, customerId, customerName });
    }
  }

  return entries.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

/** How many prospects sit in each stage, for the board's column headers. */
export function stageCounts<T extends { stage?: CustomerStage }>(
  customers: T[],
): Record<CustomerStage, number> {
  const counts = Object.fromEntries(
    CUSTOMER_STAGES.map((stage) => [stage, 0]),
  ) as Record<CustomerStage, number>;
  for (const customer of customers) counts[customer.stage ?? "new"] += 1;
  return counts;
}

/** Prospects the operator said they would come back to, soonest first. */
export function dueFollowUps<T extends { followUpAt?: string }>(
  customers: T[],
  now = Date.now(),
): T[] {
  return customers
    .filter((customer) => {
      if (!customer.followUpAt) return false;
      const due = new Date(customer.followUpAt).getTime();
      return Number.isFinite(due) && due <= now;
    })
    .sort((a, b) => (a.followUpAt ?? "").localeCompare(b.followUpAt ?? ""));
}
