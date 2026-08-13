import type { IntakeStatus } from "./api/types";

// The business timezone — all times are shown to the admin in Pacific.
const TZ = "America/Los_Angeles";

// Whether an ISO instant is in the past (its time has already passed). Instant
// comparison is timezone-agnostic, so no tz handling is needed here.
export function isPast(iso: string): boolean {
  return new Date(iso).getTime() < Date.now();
}

// "YYYY-MM-DD" calendar date (in Pacific) of an ISO instant.
export function pacificDate(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

// "2:30 PM" (Pacific).
export function formatTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

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

// "Thursday, August 1, 2026" from a "YYYY-MM-DD" date string.
export function formatDateLong(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

// The client's preferred language, shown consistently. Stored values aren't normalized, so we
// fix casing/whitespace variants ("english", "English " -> "English") to a canonical label; a
// blank value shows a dash.
export function formatLanguage(lang: string | null | undefined): string {
  const v = (lang ?? "").trim();
  if (!v) return "—";
  const lower = v.toLowerCase();
  if (lower === "english") return "English";
  if (lower === "korean") return "Korean";
  return v.charAt(0).toUpperCase() + v.slice(1);
}

export const STATUS_LABEL: Record<IntakeStatus, string> = {
  new: "New",
  contacted: "Contacted",
  booked: "Booked",
  unreachable: "Unreachable",
  canceled: "Canceled",
};
