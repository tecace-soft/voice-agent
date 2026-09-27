// Wall-clock time in a business's zone, and back. The calendar code works in UTC instants and only
// crosses into a zone at the edges: when it reads opening hours ("9:00 on Tuesday, in Seattle") and
// when it says a time out loud.
//
// Pure, and no dependencies: Intl already knows every zone's offsets, including daylight saving.

/** The zone's offset from UTC at an instant, in milliseconds (Seattle in summer: -7h). */
export function zoneOffset(at: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(at));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return asUtc - Math.floor(at / 1000) * 1000;
}

/**
 * The instant a wall-clock time in a zone names. On the spring-forward gap it lands just after the
 * gap; on the fall-back overlap it takes the first of the two.
 */
export function zonedToUtc(
  date: { year: number; month: number; day: number },
  minutesOfDay: number,
  timeZone: string,
): number {
  const guess = Date.UTC(date.year, date.month - 1, date.day, 0, minutesOfDay);
  const first = guess - zoneOffset(guess, timeZone);
  const second = guess - zoneOffset(first, timeZone);
  return Math.min(first, second);
}

/** The calendar date and weekday an instant falls on in a zone. */
export function zonedDate(at: number, timeZone: string): { year: number; month: number; day: number; weekday: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "long",
  }).formatToParts(new Date(at));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { year: Number(get("year")), month: Number(get("month")), day: Number(get("day")), weekday: get("weekday") };
}

/** "2026-10-06" for a date. */
export function isoDay(d: { year: number; month: number; day: number }): string {
  return `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
}

/** The next calendar date (no zone involved: dates are just dates). */
export function nextDay(d: { year: number; month: number; day: number }): { year: number; month: number; day: number } {
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day + 1));
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

/** "09:30" → 570. Also takes "24:00" → 1440. NaN for anything else. */
export function clockMinutes(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return Number.NaN;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min > 0)) return Number.NaN;
  return h * 60 + min;
}

/** The minute of the day an instant is at, in a zone. */
export function zonedMinutes(at: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(at));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return (get("hour") % 24) * 60 + get("minute");
}

/** How a time is said to a caller: "Tuesday, October 6 at 2:30 PM". */
export function spokenTime(at: number, timeZone: string): string {
  const day = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long", month: "long", day: "numeric" }).format(
    new Date(at),
  );
  const time = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(at));
  return `${day} at ${time}`;
}

/** An ISO string with the zone's offset, the way a caller-facing tool result should carry a time. */
export function zonedIso(at: number, timeZone: string): string {
  const offset = zoneOffset(at, timeZone);
  const local = new Date(Math.floor(at / 1000) * 1000 + offset);
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset) / 60000;
  const oh = String(Math.floor(abs / 60)).padStart(2, "0");
  const om = String(abs % 60).padStart(2, "0");
  return `${local.toISOString().slice(0, 19)}${sign}${oh}:${om}`;
}
