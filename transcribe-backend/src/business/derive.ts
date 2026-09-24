import type { BusinessHour, BusinessProfile } from "../demo/types.js";
import { MAX_FACT_CHARS, MAX_FACTS, MAX_TOTAL_CHARS } from "../tools/factLimits.js";
import { DAYS, clockTime } from "./profileShape.js";

// The structured profile, turned back into the four flat values the phone agent reads.
//
// This file exists because of one hard boundary. `openai-agent-app` reads `facts`, `hoursText`,
// `openHour` and `closeHour` off `GET /business/config` as plain strings and ints, and coerces
// everything with `str(... or "")`. Hand it a structured object and it does not fail — it
// stringifies a dict into the system prompt and the agent recites JSON at a caller. So the
// structured profile is what a customer edits, and this is what the agent is told: the flat
// contract is unchanged, and nothing about the new shape can reach a live call.
//
// It also decides what the agent KNOWS. `renderFacts` is the whole knowledge base — anything a
// caller asks that is not in these lines is something the agent says it cannot answer — so the
// order here is the order of what gets kept when a long profile meets the caps: the things a caller
// asks first (where are you, what do you do, when are you open) before the things they ask last.

/** How a day with no opening time reads in the spoken hours line. */
const CLOSED = "closed";

/**
 * `"09:00"` → `9`, and so does `"9am"`; `"9:00 PM"` → `21`.
 *
 * Read through the same parser the writers use rather than with a regex of its own. A stored time
 * should always be `HH:MM` by now, but this is the value that decides whether the agent tells a
 * caller it is open — reading "9:00 PM" as nine in the morning is a whole evening of wrong answers,
 * so it is not a place to assume the data was cleaned.
 */
export function hourOf(time: string | undefined): number | null {
  const normalized = clockTime(time);
  if (!normalized) return null;
  return Number(normalized.slice(0, 2));
}

function isClosed(hour: BusinessHour): boolean {
  return Boolean(hour.closed) || !hour.open?.trim() || !hour.close?.trim();
}

/**
 * The opening hours as one sentence a receptionist would say.
 *
 * Consecutive days that keep the same hours are collapsed into a range ("Monday to Friday"), which
 * is both how a person says it and what stops seven near-identical lines eating the fact budget.
 */
export function hoursText(hours: BusinessHour[]): string | null {
  // Sorted and de-duplicated here as well as at the writer: a range is only true if the days in it
  // really are consecutive, and this is the last place that can tell.
  const seen = new Set<string>();
  const days = hours
    .filter((hour) => {
      const day = hour.day?.trim();
      if (!day || !DAYS.includes(day as never) || seen.has(day)) return false;
      seen.add(day);
      return true;
    })
    .sort((a, b) => DAYS.indexOf(a.day as never) - DAYS.indexOf(b.day as never));
  if (days.length === 0) return null;

  const spans: { from: string; to: string; text: string; end: number }[] = [];
  for (const day of days) {
    const text = isClosed(day) ? CLOSED : `${day.open.trim()} to ${day.close.trim()}`;
    const index = DAYS.indexOf(day.day.trim() as never);
    const last = spans[spans.length - 1];
    // Only CALENDAR-consecutive days collapse. Merging on array adjacency alone turned a business
    // open Monday and Friday into "Monday to Friday", and told callers it was open on Wednesday.
    if (last && last.text === text && last.end === index - 1) {
      last.to = day.day.trim();
      last.end = index;
    } else {
      spans.push({ from: day.day.trim(), to: day.day.trim(), text, end: index });
    }
  }

  const parts = spans.map((span) => {
    const when = span.from === span.to ? span.from : `${span.from} to ${span.to}`;
    return span.text === CLOSED ? `${CLOSED} ${when}` : `${when} ${span.text}`;
  });
  return parts.join(", ");
}

/**
 * The two ints the agent uses to say whether the business is open right now.
 *
 * Taken from the most common pair across the days that are open, not from the first day: a business
 * that opens late once a week should not have the whole week judged by that day. Ties go to the
 * earlier day, which is the one a caller is most likely to be asking about.
 *
 * Both are dropped together when they do not make sense as a pair, which is what
 * `extractBusiness.normalizeExtract` does — an agent that thinks it closes before it opens tells
 * callers it is shut all day.
 */
export function openClose(hours: BusinessHour[]): { openHour: number | null; closeHour: number | null } {
  const pairs = hours
    .filter((hour) => !isClosed(hour))
    .map((hour) => ({ open: hourOf(hour.open), close: hourOf(hour.close) }))
    .filter((pair): pair is { open: number; close: number } => pair.open !== null && pair.close !== null);

  if (pairs.length === 0) return { openHour: null, closeHour: null };

  const counts = new Map<string, number>();
  for (const pair of pairs) {
    const key = `${pair.open}-${pair.close}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let best = pairs[0]!;
  let bestCount = 0;
  for (const pair of pairs) {
    const count = counts.get(`${pair.open}-${pair.close}`) ?? 0;
    if (count > bestCount) {
      best = pair;
      bestCount = count;
    }
  }

  if (best.close <= best.open) return { openHour: null, closeHour: null };
  return { openHour: best.open, closeHour: best.close };
}

function clean(text: string | undefined): string {
  return (text ?? "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** A sentence, capped and tidied, or nothing if there was nothing to say. */
function fact(text: string): string | null {
  const line = clean(text);
  if (!line) return null;
  return line.length > MAX_FACT_CHARS ? `${line.slice(0, MAX_FACT_CHARS - 1).trimEnd()}…` : line;
}

const POLICY_LABEL: [keyof BusinessProfile["policies"], string][] = [
  ["reservations", "Reservations"],
  ["walkIns", "Walk-ins"],
  ["parking", "Parking"],
  ["payment", "Payment"],
  ["cancellation", "Cancellation"],
];

/**
 * Everything the agent is allowed to say about this business, as the `- ` block it already reads.
 *
 * Ordered by what a caller asks first. The caps are `extractBusiness`'s own, imported rather than
 * repeated: they are a real cost — every fact is sent on every call — and the reasoning for the
 * numbers lives in that file.
 */
export function renderFacts(profile: BusinessProfile): string {
  const lines: (string | null)[] = [];

  if (profile.address?.trim()) lines.push(fact(`The address is ${profile.address}.`));
  if (profile.phone?.trim()) lines.push(fact(`The phone number is ${profile.phone}.`));
  if (profile.website?.trim()) lines.push(fact(`The website is ${profile.website}.`));
  if (profile.category?.trim()) lines.push(fact(`${profile.name || "The business"} is a ${profile.category}.`));

  const hours = hoursText(profile.hours ?? []);
  if (hours) lines.push(fact(`Opening hours: ${hours}.`));

  for (const service of profile.services ?? []) {
    const name = clean(service.name);
    if (!name) continue;
    const price = clean(service.price);
    const description = clean(service.description);
    const tail = [price ? `costs ${price}` : "", description].filter(Boolean).join(" — ");
    lines.push(fact(tail ? `${name}: ${tail}.` : `${name} is one of the services.`));
  }

  for (const [key, label] of POLICY_LABEL) {
    const value = clean(profile.policies?.[key] as string | undefined);
    if (value) lines.push(fact(`${label}: ${value}.`));
  }
  for (const other of profile.policies?.other ?? []) {
    lines.push(fact(other));
  }

  for (const highlight of profile.highlights ?? []) {
    lines.push(fact(highlight));
  }

  for (const faq of profile.faqs ?? []) {
    const q = clean(faq.q);
    const a = clean(faq.a);
    if (q && a) lines.push(fact(`${q} ${a}`));
  }

  // The caps, applied from the front so the first-asked things survive a long profile.
  const kept: string[] = [];
  let total = 0;
  for (const line of lines) {
    if (!line) continue;
    if (kept.length >= MAX_FACTS) break;
    if (total + line.length + 3 > MAX_TOTAL_CHARS) break;
    kept.push(line);
    total += line.length + 3;
  }
  return kept.map((line) => `- ${line}`).join("\n");
}

/**
 * Everything `GET /business/config` sends the agent, derived from the one thing a customer edits.
 *
 * `businessName` and `website` come off the profile rather than being extracted separately, so the
 * name a customer corrects in the Knowledge tab is the name the agent says.
 */
export function deriveFromProfile(profile: BusinessProfile): {
  businessName: string | null;
  website: string | null;
  hoursText: string | null;
  openHour: number | null;
  closeHour: number | null;
  facts: string;
} {
  const { openHour, closeHour } = openClose(profile.hours ?? []);
  return {
    businessName: clean(profile.name) || null,
    website: clean(profile.website) || null,
    hoursText: hoursText(profile.hours ?? []),
    openHour,
    closeHour,
    facts: renderFacts(profile),
  };
}
