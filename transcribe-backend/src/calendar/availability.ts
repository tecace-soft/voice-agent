import type { AppointmentSettings, Window } from "../business/callSettings.js";
import { clockTime, dayName } from "../business/profileShape.js";
import type { BusinessHour } from "../demo/types.js";
import { clockMinutes, isoDay, nextDay, spokenTime, zonedDate, zonedMinutes, zonedToUtc, zonedIso } from "./time.js";

// When a caller can be booked.
//
// A calendar only says when the business is busy. Whether 7:15 on a Sunday is bookable is ours to
// decide: inside the booking hours (the business hours unless the business set its own), far
// enough ahead, not too far ahead, and clear of every existing event plus the gap the business
// wants around them. A booking tool (Cal.com, Calendly, Acuity) decides all of that itself and hands
// back its own openings; those only go through the notice/horizon filter and `pickSlots`.
//
// Pure: instants in, instants out. Tested without a calendar.

export type Interval = { start: number; end: number };

/** No bookable start closer together than this, so the caller hears 9:00, 9:30 — not 9:05, 9:10. */
const STEP_MINUTES = 30;

/**
 * The windows bookings may START and END in, per weekday, as minutes of the day. From the
 * business's own booking hours when set, otherwise from its opening hours. Overnight hours stop at
 * midnight: nobody books a 1am appointment by accident.
 */
export function bookingWindows(rules: AppointmentSettings, profileHours: BusinessHour[] | undefined): Map<string, [number, number][]> {
  const out = new Map<string, [number, number][]>();
  const add = (day: string, open: number, close: number) => {
    if (!day || !Number.isFinite(open) || !Number.isFinite(close) || close <= open) return;
    out.set(day, [...(out.get(day) ?? []), [open, close]]);
  };
  if (rules.hours.length) {
    rules.hours.forEach((w: Window) => add(w.day, clockMinutes(w.open), clockMinutes(w.close)));
    return out;
  }
  for (const h of profileHours ?? []) {
    if (h.closed) continue;
    const day = dayName(h.day);
    const open = clockMinutes(clockTime(h.open));
    let close = clockMinutes(clockTime(h.close));
    if (Number.isFinite(open) && Number.isFinite(close) && close <= open) close = 24 * 60;
    add(day, open, close);
  }
  return out;
}

/** Every bookable start between now and the horizon, for a calendar we check ourselves. */
export function calendarSlots(input: {
  rules: AppointmentSettings;
  profileHours: BusinessHour[] | undefined;
  busy: Interval[];
  now: number;
  timeZone: string;
  /** Only look this far; defaults to the rules' horizon. */
  until?: number;
}): number[] {
  const { rules, now, timeZone } = input;
  const windows = bookingWindows(rules, input.profileHours);
  const earliest = now + rules.minNoticeMinutes * 60_000;
  const latest = Math.min(input.until ?? Infinity, now + rules.horizonDays * 86_400_000);
  const length = rules.durationMinutes * 60_000;
  const gap = rules.bufferMinutes * 60_000;
  const busy = input.busy
    .map((b) => ({ start: b.start - gap, end: b.end + gap }))
    .sort((a, b) => a.start - b.start);

  const out: number[] = [];
  let date: { year: number; month: number; day: number } = zonedDate(now, timeZone);
  for (let i = 0; i <= rules.horizonDays + 1; i++, date = nextDay(date)) {
    const weekday = zonedDate(zonedToUtc(date, 12 * 60, timeZone), timeZone).weekday;
    for (const [open, close] of windows.get(weekday) ?? []) {
      for (let m = open; m + rules.durationMinutes <= close; m += STEP_MINUTES) {
        const start = zonedToUtc(date, m, timeZone);
        const end = start + length;
        if (start < earliest || start > latest) continue;
        // A daylight-saving jump can move a wall-clock time out of the window it was built from.
        if (zonedMinutes(start, timeZone) !== m % (24 * 60)) continue;
        if (busy.some((b) => b.start < end && start < b.end)) continue;
        out.push(start);
      }
    }
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

/** A booking tool's own openings, held to our notice and horizon. */
export function withinRules(starts: number[], rules: AppointmentSettings, now: number): number[] {
  const earliest = now + rules.minNoticeMinutes * 60_000;
  const latest = now + rules.horizonDays * 86_400_000;
  return [...new Set(starts)].filter((s) => s >= earliest && s <= latest).sort((a, b) => a - b);
}

export type PartOfDay = "morning" | "afternoon" | "evening" | "any";

export type SlotChoice = { start: string; spoken: string };

/**
 * The handful of openings a caller hears. With a date, up to `max` on that day spread across it;
 * without, the first few days that have any, two or three each, so "what do you have?" gets a
 * choice of days rather than six times on one morning.
 */
export function pickSlots(
  starts: number[],
  timeZone: string,
  ask: { date?: string; partOfDay?: PartOfDay; after?: number },
  max = 6,
): SlotChoice[] {
  const inPart = (s: number) => {
    const m = zonedMinutes(s, timeZone);
    switch (ask.partOfDay) {
      case "morning":
        return m < 12 * 60;
      case "afternoon":
        return m >= 12 * 60 && m < 17 * 60;
      case "evening":
        return m >= 17 * 60;
      default:
        return true;
    }
  };
  let pool = starts.filter((s) => inPart(s) && (ask.after === undefined || s >= ask.after));
  if (ask.date) pool = pool.filter((s) => isoDay(zonedDate(s, timeZone)) === ask.date);

  const byDay = new Map<string, number[]>();
  for (const s of pool) {
    const key = isoDay(zonedDate(s, timeZone));
    byDay.set(key, [...(byDay.get(key) ?? []), s]);
  }
  const days = [...byDay.values()];
  const perDay = ask.date ? max : Math.max(2, Math.ceil(max / Math.min(3, days.length || 1)));
  const chosen: number[] = [];
  for (const day of days) {
    chosen.push(...spread(day, perDay));
    if (chosen.length >= max) break;
  }
  return chosen.slice(0, max).map((s) => ({ start: zonedIso(s, timeZone), spoken: spokenTime(s, timeZone) }));
}

/** `n` entries evenly from a sorted list, first and last included. */
function spread(list: number[], n: number): number[] {
  if (list.length <= n) return list;
  if (n === 1) return [list[0]!];
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(list[Math.round((i * (list.length - 1)) / (n - 1))]!);
  return [...new Set(out)];
}
