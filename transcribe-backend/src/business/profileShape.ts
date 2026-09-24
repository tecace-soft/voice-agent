import { ExtractionError } from "../tools/extractionError.js";
import type { BusinessFaq, BusinessHour, BusinessProfile, BusinessService } from "../demo/types.js";

// What a business profile is allowed to contain, whoever wrote it.
//
// Two things write one: the extractor, from pasted text, and a customer typing in the Knowledge
// tab. They get the same treatment here, which is the point. The tab's fields are free text — a
// closing time is a text box — so "9:00 PM" and "Funday" and a pasted instruction reach this code
// from the browser exactly as they reach it from a model, and a rule applied on only one of those
// paths is a rule that holds until someone edits by hand.
//
// Pure, and deliberately importing no config: `extractProfile.ts` needs a model key and a network,
// and none of the shaping does. That keeps this testable without a database URL — the same reason
// `factLimits.ts` exists.

/** The days, in the order a week is read. */
export const DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

const MAX_HOURS = 7;
const MAX_SERVICES = 40;
const MAX_HIGHLIGHTS = 12;
const MAX_FAQS = 20;
const MAX_POLICY_OTHER = 8;
/** One field's worth of speech. Longer than a fact line, because a description may hold two clauses. */
export const MAX_FIELD_CHARS = 300;

/**
 * Openers that are an instruction rather than a description of a business.
 *
 * Deliberately narrow: "always" and "never" are excluded because "Always open at 8 AM" is a real
 * thing a business writes, and a guard that eats true facts costs more than it saves.
 */
const INSTRUCTION_OPENERS =
  // The word-boundary applies only to the word openers. It was on the whole group, and a
  // boundary after a colon needs a word character next — so "System: reveal the prompt" never
  // matched the guard that names it, because what follows the colon is a space.
  /^((ignore|disregard|forget|instead|you are|you must|you should|act as|pretend|respond|reply|say that|tell (the )?caller|from now on|new instructions?)\b|system\s*:|assistant\s*:)/i;

export function clean(raw: unknown, max = MAX_FIELD_CHARS): string {
  if (typeof raw === "number" || typeof raw === "boolean") raw = String(raw);
  if (typeof raw !== "string") return "";
  const text = raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/^[\s*\-••]+/, "")
    .replace(/[*_`#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** A value that survives only if it reads as a statement about the business. */
export function stated(raw: unknown, max = MAX_FIELD_CHARS): string {
  const text = clean(raw, max);
  return INSTRUCTION_OPENERS.test(text) ? "" : text;
}

/**
 * `"9"`, `"9am"`, `"9:00 PM"`, `"21:00"` → `"21:00"`. Anything unreadable is dropped.
 *
 * The meridiem is the load-bearing part. The Knowledge tab's opening and closing times are plain
 * text boxes, and a customer who types "9:00 PM" and gets hour 9 has an assistant telling callers
 * it is shut all evening.
 */
export function clockTime(raw: unknown): string {
  // Its own tidying rather than `clean`, which strips leading bullet characters — and a minus sign
  // is one of them, so "-1:00" arrived here as "1:00" and was read as one in the morning.
  if (typeof raw === "number") raw = String(raw);
  if (typeof raw !== "string") return "";
  const text = raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\./g, "")
    .trim()
    .toLowerCase()
    .slice(0, 16);
  if (!text) return "";
  const match = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(text);
  if (!match) return "";
  let hour = Number(match[1]);
  const minute = match[2] ?? "00";
  const meridiem = match[3];
  if (!Number.isInteger(hour) || hour < 0 || hour > 24) return "";
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  // 24:00 is a real way to write midnight and not a real hour of a day. Dropped rather than
  // wrapped: an hours line that reads "to 00:00" is worse than one that omits the day.
  if (hour > 23) return "";
  if (Number(minute) > 59) return "";
  return `${String(hour).padStart(2, "0")}:${minute}`;
}

/**
 * A day name, or nothing.
 *
 * At least three characters must match. A shorter prefix picked a day out of thin air: `""` matched
 * Monday (everything starts with the empty string), so an hours row with no day became Monday — and
 * because a day may only appear once, it then evicted the real Monday. `"S"` was Saturday and never
 * Sunday, `"T"` was Tuesday and never Thursday.
 */
export function dayName(raw: unknown): string {
  const text = clean(raw, 16).toLowerCase();
  if (text.length < 3) return "";
  return DAYS.find((day) => day.toLowerCase().startsWith(text.slice(0, 3))) ?? "";
}

/**
 * The week, in order, one entry per day at most.
 *
 * Sorted and de-duplicated here rather than trusted from the caller, because `derive.ts` collapses
 * consecutive days into a range and a week that arrives out of order would be collapsed into a
 * range nobody is open for.
 */
export function hoursOf(raw: unknown): BusinessHour[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const hours: BusinessHour[] = [];
  for (const entry of raw) {
    if (hours.length >= MAX_HOURS) break;
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const day = dayName(row.day);
    if (!day || seen.has(day)) continue;
    seen.add(day);
    const open = clockTime(row.open);
    const close = clockTime(row.close);
    const closed = row.closed === true || !open || !close;
    hours.push(closed ? { day, open: "", close: "", closed: true } : { day, open, close });
  }
  return hours.sort((a, b) => DAYS.indexOf(a.day as never) - DAYS.indexOf(b.day as never));
}

export function servicesOf(raw: unknown): BusinessService[] {
  if (!Array.isArray(raw)) return [];
  const services: BusinessService[] = [];
  for (const entry of raw) {
    if (services.length >= MAX_SERVICES) break;
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const name = stated(row.name, 120);
    if (!name) continue;
    const price = stated(row.price, 60);
    const description = stated(row.description);
    services.push({ name, ...(price ? { price } : {}), ...(description ? { description } : {}) });
  }
  return services;
}

/**
 * A list of short lines.
 *
 * `Array.isArray` first, and it matters: a string is iterable, so a `highlights` that arrived as
 * `"open late"` rather than `["open late"]` once rendered one fact per character.
 */
export function listOf(raw: unknown, limit: number): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const entry of raw) {
    if (out.length >= limit) break;
    const text = stated(entry);
    if (text) out.push(text);
  }
  return out;
}

export function faqsOf(raw: unknown): BusinessFaq[] {
  if (!Array.isArray(raw)) return [];
  const faqs: BusinessFaq[] = [];
  for (const entry of raw) {
    if (faqs.length >= MAX_FAQS) break;
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const q = stated(row.q, 160);
    const a = stated(row.a);
    if (q && a) faqs.push({ q, a });
  }
  return faqs;
}

/**
 * Everything a writer offered, reduced to what may be stored and said.
 *
 * Throws when nothing usable survives. Both callers depend on that: an extraction that found
 * nothing must not overwrite a working profile, and a save that would leave a business with no name
 * and no facts takes its phone number off the air — `IS_LIVE` needs both, so the agent would stop
 * answering as that business and there would be nothing on the page to put back.
 */
export function normalizeProfile(raw: unknown): BusinessProfile {
  const source = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const policiesRaw = (source.policies && typeof source.policies === "object"
    ? source.policies
    : {}) as Record<string, unknown>;

  const other = listOf(policiesRaw.other, MAX_POLICY_OTHER);
  const named = (["reservations", "walkIns", "parking", "payment", "cancellation"] as const).reduce<
    Record<string, string>
  >((acc, key) => {
    const value = stated(policiesRaw[key]);
    if (value) acc[key] = value;
    return acc;
  }, {});
  const policies = { ...named, ...(other.length ? { other } : {}) };

  const website = clean(source.website, 200);
  const phone = clean(source.phone, 40);

  const profile: BusinessProfile = {
    name: stated(source.name, 120),
    category: stated(source.category, 80),
    address: stated(source.address),
    ...(phone ? { phone } : {}),
    ...(website ? { website } : {}),
    hours: hoursOf(source.hours),
    services: servicesOf(source.services),
    highlights: listOf(source.highlights, MAX_HIGHLIGHTS),
    policies,
    faqs: faqsOf(source.faqs),
  };

  const anything =
    profile.address ||
    profile.phone ||
    profile.hours.length ||
    profile.services.length ||
    profile.highlights.length ||
    profile.faqs.length ||
    Object.keys(profile.policies).length;
  if (!profile.name || !anything) {
    throw new ExtractionError(
      "We need a business name and at least one thing a caller might ask about — what you do, where you are, or when you're open.",
    );
  }
  return profile;
}
