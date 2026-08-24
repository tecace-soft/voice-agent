// Small formatting + stat helpers. Times are shown in the business timezone (Pacific), which is
// also the timezone the backend buckets "today" and the daily series by.
const TZ = "America/Los_Angeles";

// "Thu, Aug 1, 2:30 PM" (Pacific).
export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

// "Aug 1, 2:30 PM" (Pacific) — compact label for the run chart's axis.
export function formatShort(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

// "Aug 1" (Pacific) — x-axis tick when several points share a day.
export function formatDayShort(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric" }).format(
    new Date(iso),
  );
}

// "Fri, Aug 1" from a YYYY-MM-DD day key (the daily series' `day`). Parsed as noon UTC so the
// date can't slip a day when it's re-rendered in Pacific.
export function formatDayKey(day: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(`${day}T12:00:00Z`));
}

// The Pacific calendar day ("YYYY-MM-DD") a moment falls on — the same key the backend's daily
// series uses, so client-side windows line up with the server's buckets.
export function dayKey(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

// The last `count` Pacific day keys ending today, oldest→newest.
export function recentDayKeys(count: number, endingOffset = 0): string[] {
  const keys: string[] = [];
  const now = Date.now();
  for (let i = count - 1 + endingOffset; i >= endingOffset; i--) {
    keys.push(dayKey(new Date(now - i * 86_400_000)));
  }
  return keys;
}

// Percentage change from `prev` to `curr`. Null when there's no baseline to compare against —
// "+∞%" would be a lie, so the caller shows an absolute count instead.
export function deltaPct(curr: number, prev: number): number | null {
  if (prev <= 0) return null;
  return ((curr - prev) / prev) * 100;
}

// "35 min" / "4.2 hours" / "3.6 days" — a gap between runs, at whatever scale reads best.
export function formatDuration(seconds: number): string {
  if (seconds <= 0) return "—";
  if (seconds < 90) return `${Math.round(seconds)} sec`;
  const minutes = seconds / 60;
  if (minutes < 90) return `${Math.round(minutes)} min`;
  const hours = minutes / 60;
  if (hours < 36) return `${hours.toFixed(1)} hours`;
  return `${(hours / 24).toFixed(1)} days`;
}

// "9 AM" / "12 PM" — an hour-of-day bucket.
export function formatHour(hour: number): string {
  const suffix = hour < 12 ? "AM" : "PM";
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h} ${suffix}`;
}

// 1=Mon … 7=Sun, as Postgres's isodow returns them.
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const formatWeekday = (isoDow: number): string => WEEKDAYS[isoDow - 1] ?? "?";

// "+12.5%" / "-20%" / "0%" — the delta as it reads on a trend badge.
export function formatPct(pct: number): string {
  const rounded = Math.round(pct * 10) / 10;
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded}%`;
}
