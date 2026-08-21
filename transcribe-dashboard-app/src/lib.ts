// Small formatting helpers. Times are shown in the business timezone (Pacific).
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
