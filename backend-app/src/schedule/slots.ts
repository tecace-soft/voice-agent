import type { ScheduleConfig } from "../config/env";

// Pure slot-grid logic: turn business-hours config + a set of already-booked instants
// into a grid of bookable slots, each marked available or taken. Timezone-aware, no DB.

export interface Slot {
  start: string; // ISO 8601 instant (UTC) of the slot start
  end: string; // ISO 8601 instant (UTC) of the slot end
  available: boolean;
}

export interface DaySlots {
  date: string; // YYYY-MM-DD (in the schedule timezone)
  slots: Slot[]; // empty when the date is not a workday
}

// Offset (ms) of `timeZone` at the given instant: (wall-clock in tz) − (UTC).
function tzOffsetMs(timeZone: string, date: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts: Record<string, number> = {};
  for (const p of dtf.formatToParts(date)) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  // Intl renders hour "24" for midnight in some engines; normalize to 0.
  const hour = (parts.hour ?? 0) === 24 ? 0 : (parts.hour ?? 0);
  const asUTC = Date.UTC(
    parts.year ?? 0,
    (parts.month ?? 1) - 1,
    parts.day ?? 1,
    hour,
    parts.minute ?? 0,
    parts.second ?? 0,
  );
  return asUTC - date.getTime();
}

// Convert a wall-clock time in `timeZone` to the corresponding UTC instant.
function zonedWallClockToUtc(
  year: number,
  month: number, // 1–12
  day: number,
  minutesOfDay: number,
  timeZone: string,
): Date {
  const hour = Math.floor(minutesOfDay / 60);
  const minute = minutesOfDay % 60;
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  // Correct by the zone offset; refine once to handle DST boundaries.
  const offset1 = tzOffsetMs(timeZone, new Date(guess));
  let instant = guess - offset1;
  const offset2 = tzOffsetMs(timeZone, new Date(instant));
  if (offset2 !== offset1) instant = guess - offset2;
  return new Date(instant);
}

// ISO weekday (1=Mon … 7=Sun) of a calendar date. A date's weekday is timezone-independent.
function isoWeekday(year: number, month: number, day: number): number {
  const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0=Sun … 6=Sat
  return dow === 0 ? 7 : dow;
}

// Parse "YYYY-MM-DD" into numeric parts (no timezone interpretation).
function parseDate(date: string): { year: number; month: number; day: number } {
  const parts = date.split("-");
  return {
    year: Number(parts[0]),
    month: Number(parts[1]),
    day: Number(parts[2]),
  };
}

// Shift a "YYYY-MM-DD" date by N calendar days.
function shiftDate(date: string, days: number): string {
  const { year, month, day } = parseDate(date);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

// The later of two "YYYY-MM-DD" dates (they sort lexically == chronologically).
function maxDate(a: string, b: string): string {
  return a >= b ? a : b;
}

// The calendar date ("YYYY-MM-DD") an instant falls on, in the given timezone.
export function localDateOf(timeZone: string, instantMs: number): string {
  // en-CA formats as "YYYY-MM-DD".
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(instantMs));
}

// Do two half-open intervals [aStart, aEnd) and [bStart, bEnd) overlap?
function overlaps(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

// Enumerate the bookable slots for a single calendar date, marking each available unless
// a booked window overlaps it. Non-workdays yield an empty slot list.
export function slotsForDate(
  config: ScheduleConfig,
  date: string,
  bookedStarts: number[], // ms epoch of each booked slot start
): DaySlots {
  const { year, month, day } = parseDate(date);
  const durationMs = config.slotMinutes * 60_000;

  if (!config.workdays.includes(isoWeekday(year, month, day))) {
    return { date, slots: [] };
  }

  const slots: Slot[] = [];
  for (
    let m = config.startMinutes;
    m + config.slotMinutes <= config.endMinutes;
    m += config.slotMinutes
  ) {
    const startMs = zonedWallClockToUtc(year, month, day, m, config.timezone).getTime();
    const endMs = startMs + durationMs;
    const taken = bookedStarts.some((b) =>
      overlaps(startMs, endMs, b, b + durationMs),
    );
    slots.push({
      start: new Date(startMs).toISOString(),
      end: new Date(endMs).toISOString(),
      available: !taken,
    });
  }
  return { date, slots };
}

// Inclusive list of "YYYY-MM-DD" dates from `from` to `to`.
export function dateRange(from: string, to: string): string[] {
  const start = parseDate(from);
  const end = parseDate(to);
  const dates: string[] = [];
  const cursor = new Date(Date.UTC(start.year, start.month - 1, start.day));
  const last = Date.UTC(end.year, end.month - 1, end.day);
  while (cursor.getTime() <= last) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

export type AvailabilityReason =
  | "available"
  | "in_past"
  | "outside_business_hours"
  | "not_a_slot_boundary"
  | "taken";

// Assess one specific instant: is it a valid, free slot start? `now` is the current
// instant (ms) — anything before it is rejected as `in_past`.
export function checkAvailability(
  config: ScheduleConfig,
  dateTimeIso: string,
  bookedStarts: number[],
  now: number,
): { available: boolean; reason: AvailabilityReason } {
  const target = new Date(dateTimeIso).getTime();
  const durationMs = config.slotMinutes * 60_000;

  // A time that has already passed is never bookable, regardless of the grid.
  if (target < now) return { available: false, reason: "in_past" };

  // Which calendar date (in the schedule tz) does this instant fall on?
  const localDate = localDateOf(config.timezone, target);
  const day = slotsForDate(config, localDate, bookedStarts);
  const slot = day.slots.find((s) => new Date(s.start).getTime() === target);
  if (!slot) {
    // Distinguish "off the grid entirely" from "valid boundary but no slot" — if it's a
    // workday and within hours but unaligned, it's a boundary problem; otherwise hours.
    const { year, month, day: d } = parseDate(localDate);
    const isWorkday = config.workdays.includes(isoWeekday(year, month, d));
    if (!isWorkday) return { available: false, reason: "outside_business_hours" };
    const first = day.slots[0];
    const last = day.slots[day.slots.length - 1];
    const firstStart = first ? new Date(first.start).getTime() : Infinity;
    const lastEnd = last ? new Date(last.end).getTime() : -Infinity;
    if (target < firstStart || target + durationMs > lastEnd) {
      return { available: false, reason: "outside_business_hours" };
    }
    return { available: false, reason: "not_a_slot_boundary" };
  }
  return slot.available
    ? { available: true, reason: "available" }
    : { available: false, reason: "taken" };
}

// A suggested alternative slot, with how far it sits from the wanted time.
export interface Suggestion {
  start: string; // ISO instant (UTC)
  end: string;
  date: string; // YYYY-MM-DD in the schedule timezone
  minutesFromWanted: number; // signed: negative = earlier than wanted, positive = later
}

// Find the available slots closest to a wanted time — the alternatives the agent offers
// when the requested slot is taken. Searches ±`withinDays` around the wanted date, keeps
// only free future slots, and orders them by absolute distance from the wanted time
// (ties broken by the earlier slot). Excludes the exact wanted instant itself.
export function suggestSlots(
  config: ScheduleConfig,
  wantedIso: string,
  bookedStarts: number[],
  opts: { limit: number; withinDays: number; now: number },
): Suggestion[] {
  const wanted = new Date(wantedIso).getTime();
  const wantedDate = localDateOf(config.timezone, wanted);
  const today = localDateOf(config.timezone, opts.now);
  // Anchor the window at today so a past wanted time still surfaces real slots: never
  // search before today, and always reach `withinDays` past the later of wanted/today.
  const dates = dateRange(
    maxDate(shiftDate(wantedDate, -opts.withinDays), today),
    shiftDate(maxDate(wantedDate, today), opts.withinDays),
  );

  const candidates: Suggestion[] = [];
  for (const date of dates) {
    for (const slot of slotsForDate(config, date, bookedStarts).slots) {
      const startMs = new Date(slot.start).getTime();
      if (!slot.available || startMs < opts.now || startMs === wanted) continue;
      candidates.push({
        start: slot.start,
        end: slot.end,
        date,
        minutesFromWanted: Math.round((startMs - wanted) / 60_000),
      });
    }
  }

  candidates.sort((a, b) => {
    const da = Math.abs(new Date(a.start).getTime() - wanted);
    const db = Math.abs(new Date(b.start).getTime() - wanted);
    return da - db || new Date(a.start).getTime() - new Date(b.start).getTime();
  });
  return candidates.slice(0, opts.limit);
}
