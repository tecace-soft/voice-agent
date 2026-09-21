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

// How a mailbox reads on screen. Runs reported before mailboxes were recorded have none, and
// "Unattributed" says that plainly rather than leaving a blank cell that looks like a bug.
export const formatMailbox = (email: string | null): string => email ?? "Unattributed";

// "+12.5%" / "-20%" / "0%" — the delta as it reads on a trend badge.
export function formatPct(pct: number): string {
  const rounded = Math.round(pct * 10) / 10;
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded}%`;
}

// A phone number as a person reads it: "+14254787534" -> "(425) 478-7534".
//
// This grouping deliberately matches what the voicemail poller writes into the customer's sheet
// (callerid.py). The same customer reads both, often side by side, and one number wearing two
// different formats invites the question "are these the same number?" — which is a question the
// formatting should never make anyone ask.
//
// E.164 is how the number is STORED — it has to be, it's what the phone network and Twilio agree
// on, and it's what we match against. It is not how anyone reads a number out loud, so it is
// formatted at the edge, on the way to the screen, and never on the way to the database.
//
// Only North American numbers take the grouping, because that grouping is only correct for them.
// Anything else — a longer international number, an extension, something the caller garbled — is
// passed through untouched: showing it plainly beats confidently splitting it in the wrong places.
export function formatPhone(raw: string | null | undefined): string {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");

  // An explicit "+" means the country code is stated, so it has to BE 1 followed by ten digits.
  // Without this check "+1425478753" — a number a digit short — reads as ten digits and formats to
  // "(142) 547-8753": a wrong number that looks perfectly valid. Showing a malformed number as-is
  // lets someone see it's malformed; grouping it hides the fault behind correct-looking punctuation.
  const nanp =
    digits.length === 11 && digits.startsWith("1")
      ? digits.slice(1)
      : raw.trim().startsWith("+")
        ? ""
        : digits;

  if (nanp.length !== 10) return raw;
  return `(${nanp.slice(0, 3)}) ${nanp.slice(3, 6)}-${nanp.slice(6)}`;
}
