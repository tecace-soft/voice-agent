import { datedWeek, hoursUnknown } from "./schedule.js";
import type { BusinessHour } from "./types.js";

/**
 * What day it is, for a call.
 *
 * The prompts are written once and stored, so they cannot hold a date, and a
 * receptionist who does not know today is Monday cannot tell whether "tomorrow"
 * is a day the business opens. `/api/session` appends `callClock()` to both
 * instructions when the session is created, which is also why hand-edited
 * prompts get it.
 *
 * Everything takes `now` and a timezone rather than reading either: a serverless
 * host runs in UTC, where it is already tomorrow for half of every evening in
 * North America. Pure, with no `node:` imports — the Schedule tab imports it.
 */

export type CalendarDay = {
  year: number;
  /** 1 to 12. */
  month: number;
  day: number;
  /** "Monday". */
  weekday: string;
  /** "2026-09-21". */
  key: string;
  /** "Sep 21", for a column header. */
  label: string;
  /** "Monday, September 21", for a sentence. */
  long: string;
};

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * Noon UTC on the date, so that reading it back in UTC can never land on the
 * day before or after. The instant means nothing; only its calendar fields do.
 */
function calendarDay(year: number, month: number, day: number): CalendarDay {
  const at = new Date(Date.UTC(year, month - 1, day, 12));
  const y = at.getUTCFullYear();
  const m = at.getUTCMonth() + 1;
  const d = at.getUTCDate();
  const weekday = WEEKDAYS[at.getUTCDay()]!;
  const monthName = MONTHS[m - 1]!;
  return {
    year: y,
    month: m,
    day: d,
    weekday,
    key: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
    label: `${monthName.slice(0, 3)} ${d}`,
    long: `${weekday}, ${monthName} ${d}`,
  };
}

/** The calendar date it is right now in that timezone. */
export function zonedToday(now: Date, timeZone: string): CalendarDay {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(now);
  const read = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value);
  return calendarDay(read("year"), read("month"), read("day"));
}

/** Back from a `key`, or null when it is not one. */
export function dayFromKey(key: string | null | undefined): CalendarDay | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key ?? "");
  if (!match) return null;
  return calendarDay(Number(match[1]), Number(match[2]), Number(match[3]));
}

/** "3:42 PM", in that timezone. */
export function zonedTime(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(now);
}

/**
 * `count` days starting with `today`. Stepped as dates, not as 24 hour jumps
 * from an instant, which repeat a day when the clocks go back.
 */
export function nextDays(today: CalendarDay, count: number): CalendarDay[] {
  return Array.from({ length: count }, (_, offset) =>
    calendarDay(today.year, today.month, today.day + offset),
  );
}

/** "1st", "22nd", "24th". English only, like the rest of the prompt. */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  const suffix = ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix}`;
}

/**
 * The timezone a browser reported, if it is one. It arrives on a public
 * endpoint and ends up inside a prompt, so it is checked rather than trusted:
 * a name `Intl` accepts has no room in it for an instruction.
 */
export function safeTimeZone(value: unknown, fallback: string): string {
  if (typeof value !== "string" || !value || value.length > 64) return fallback;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: value }).resolvedOptions()
      .timeZone;
  } catch {
    return fallback;
  }
}

/**
 * The block both models are handed. The week is written out day by day because
 * working a weekday out from a date is exactly the arithmetic a model gets
 * wrong, and the taken times are the ones the Schedule tab is showing.
 */
export function callClock(
  now: Date,
  timeZone: string,
  hours: BusinessHour[] | undefined,
): string {
  const today = zonedToday(now, timeZone);
  const days = nextDays(today, 7);
  const week = datedWeek(hours, days);

  const lines = [
    "Right now:",
    `- It is ${today.long}, ${today.year}, ${zonedTime(now, timeZone)} (${timeZone}).`,
    `- Tomorrow is ${days[1]!.long}.`,
  ];

  if (hoursUnknown(week)) {
    lines.push(
      `- The days after that: ${days
        .slice(2)
        .map((day) => `${day.weekday.slice(0, 3)} ${day.label}`)
        .join(", ")}.`,
    );
  } else {
    lines.push("", "The book for the next seven days:");
    for (const day of week) {
      const name = `${day.isToday ? "Today, " : ""}${day.short} ${day.date}`;
      if (day.closed) {
        lines.push(`- ${name}: closed.`);
        continue;
      }
      if (!day.slots.length) {
        lines.push(
          day.hours ? `- ${name}: open ${day.hours}.` : `- ${name}: hours unknown.`,
        );
        continue;
      }
      const taken = day.slots.filter((slot) => slot.who).map((slot) => slot.time);
      const free = day.slots.filter((slot) => !slot.who).map((slot) => slot.time);
      lines.push(
        `- ${name}: open ${day.hours}. Taken: ${taken.join(", ") || "none"}. Free: ${
          free.join(", ") || "none"
        }.`,
      );
    }
  }

  lines.push(
    "",
    "Dates and bookings:",
    '- When a caller says "today", "tomorrow", "this Friday" or gives a date, find that day in the list above. Never work out a weekday yourself.',
    // The example is tomorrow's real date: a model copies sample phrases, and a
    // fixed "Tuesday the 22nd" is the wrong day six days in seven.
    `- Say the weekday and the date back before you confirm anything: "tomorrow, ${
      days[1]!.weekday
    } the ${ordinal(days[1]!.day)}".`,
  );
  if (!hoursUnknown(week)) {
    lines.push(
      "- A closed day, or a time outside the hours: say so, and offer the nearest free time.",
      "- A taken time: say it is taken and offer the nearest free one. Never offer a time today that has already passed.",
      "- Past these seven days you have no book. Take the request as a message for the team to confirm.",
    );
  }

  return lines.join("\n");
}
