import type { BusinessHour } from "./types";

/**
 * The week the Schedule tab draws.
 *
 * It is a mock-up and says so on the page: the demo takes no bookings, and
 * nothing here is read from a calendar. What makes it worth showing is that it
 * is the business's *own* week — their opening hours, their closed days, their
 * kind of appointment — so a prospect reads it as their diary rather than a
 * stock screenshot.
 *
 * Deliberately built without a clock. The page is server-rendered and then
 * hydrated, so anything derived from `Date.now()` here would render one week on
 * the server and a different one in the browser a second later. Weekday names
 * carry the idea and cannot disagree with themselves.
 *
 * Pure data, like lib/use-cases.ts — a client component imports it.
 */

export type ScheduleSlot = {
  time: string;
  /**
   * Set when the slot is taken: the name the receptionist wrote down. A column
   * one seventh of a phone wide has room for a time and a name and nothing
   * else, so what kind of booking it is gets said once, above the grid.
   */
  who?: string;
};

export type ScheduleDay = {
  day: string;
  /** The short label the column header uses. */
  short: string;
  /** "09:00 to 17:00", or null when the research never found the hours. */
  hours: string | null;
  closed: boolean;
  slots: ScheduleSlot[];
};

const WEEK = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

/**
 * Names on the sample bookings. Ordinary, unremarkable, and fixed, so two
 * businesses never look like they share a customer list and nobody reads a
 * real person into them.
 */
const NAMES = [
  "D. Lee",
  "M. Alvarez",
  "R. Chen",
  "J. Okafor",
  "S. Patel",
  "T. Nguyen",
  "A. Brooks",
  "K. Murphy",
];

/** Minutes past midnight, or null when the time is not a time. */
export function minutesOf(time: string | undefined): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec((time ?? "").trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const mins = Number(match[2]);
  if (hours > 23 || mins > 59) return null;
  return hours * 60 + mins;
}

function clockOf(minutes: number): string {
  const hours = Math.floor(minutes / 60) % 24;
  return `${String(hours).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/**
 * Three times spread across the day, far enough from the edges that none of
 * them reads as "right as they open" or "just before they lock up".
 */
export function slotTimes(open: string, close: string): string[] {
  const from = minutesOf(open);
  const to = minutesOf(close);
  if (from === null || to === null) return [];
  // A business that closes after midnight is a span, not a mistake.
  const span = (to > from ? to : to + 1440) - from;
  if (span < 120) return [];
  const step = Math.floor(span / 4 / 30) * 30;
  if (step < 30) return [];
  return [1, 2, 3].map((index) => clockOf(from + step * index));
}

/**
 * A week of the business's own hours with a few bookings already in it.
 *
 * Which slots are taken is fixed by position, never random: the same business
 * shows the same week on every render and on every reload, because a diary
 * that reshuffles itself while you look at it is obviously fake.
 */
export function demoWeek(hours: BusinessHour[] | undefined): ScheduleDay[] {
  const byDay = new Map<string, BusinessHour>();
  for (const hour of hours ?? []) {
    byDay.set(hour.day.trim().toLowerCase(), hour);
  }

  let taken = 0;

  return WEEK.map((day, index) => {
    const found = byDay.get(day.toLowerCase());
    const short = day.slice(0, 3);

    if (found?.closed) {
      return { day, short, hours: null, closed: true, slots: [] };
    }

    const open = found?.open ?? "";
    const close = found?.close ?? "";
    const times = slotTimes(open, close);

    // Two bookings midweek, one at the ends, starting at a different hour on
    // alternating days, so the week looks lived in rather than filled top-down.
    const wanted = index === 1 || index === 3 ? 2 : 1;
    const start = index % 2;

    const slots = times.map((time, position) => {
      if (position < start || position >= start + wanted) return { time };
      const who = NAMES[taken % NAMES.length];
      taken += 1;
      return { time, who };
    });

    return {
      day,
      short,
      hours: open && close ? `${open} to ${close}` : null,
      closed: false,
      slots,
    };
  });
}

/** True when research found no usable hours at all, so the week is a blank grid. */
export function hoursUnknown(days: ScheduleDay[]): boolean {
  return days.every((day) => day.closed || day.slots.length === 0);
}
