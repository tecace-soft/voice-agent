import type { Interval } from "./availability.js";

// What every calendar or booking tool looks like to the rest of the backend.
//
// Two families. A CALENDAR (Google, Outlook, iCloud, any CalDAV server) only knows when the business
// is busy; we work out the openings from the booking rules and write the event ourselves. A BOOKING
// TOOL (Cal.com, Calendly, Acuity) already has its own availability, lengths and confirmations; we
// ask it for openings in one of its event types and book through it, so its emails, reminders and
// intake keep working exactly as the business set them up.

export type ProviderId =
  | "google-calendar"
  | "outlook"
  | "apple-calendar"
  | "caldav"
  | "cal-com"
  | "calendly"
  | "squarespace";

export type ProviderKind = "calendar" | "booking";

/** A calendar to book into, or a booking tool's event type. */
export type Target = {
  id: string;
  name: string;
  primary?: boolean;
  /** Booking tools: the event type's own length. */
  durationMinutes?: number;
};

export type BookingRequest = {
  start: number;
  end: number;
  timeZone: string;
  /** The event's title on the business's calendar. */
  title: string;
  /** Everything the team needs, one fact per line. */
  notes: string;
  callerName: string;
  /** E.164, or "" when withheld. */
  callerPhone: string;
  /**
   * Booking tools insist on an email. The caller's when they gave one, otherwise the business's own
   * account email — the confirmation then lands with the business instead of bouncing.
   */
  email: string;
};

export type Booked = { id: string; start: number; end: number; link?: string };

export class CalendarError extends Error {
  /** "auth" means the credentials no longer work and the business has to reconnect. */
  kind: "auth" | "input" | "provider";
  constructor(kind: CalendarError["kind"], message: string) {
    super(message);
    this.name = "CalendarError";
    this.kind = kind;
  }
}

export interface CalendarClient {
  kind: ProviderKind;
  /** The calendars (or event types) this account can book into. */
  targets(): Promise<Target[]>;
  /** Calendars: when the chosen calendar is busy. */
  busy?(target: string, from: number, to: number): Promise<Interval[]>;
  /** Booking tools: the openings the tool itself offers. */
  openings?(target: string, from: number, to: number, timeZone: string): Promise<number[]>;
  book(target: string, request: BookingRequest): Promise<Booked>;
}

/** Plain fetch with a timeout, and the body read either way. A calendar that hangs must not hang a call. */
export async function call(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<{ status: number; ok: boolean; text: string; json: () => any; headers: Headers }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 12_000);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    return {
      status: res.status,
      ok: res.ok,
      text,
      headers: res.headers,
      json: () => {
        try {
          return JSON.parse(text);
        } catch {
          return null;
        }
      },
    };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    throw new CalendarError("provider", aborted ? "The calendar took too long to answer." : "Couldn't reach the calendar.");
  } finally {
    clearTimeout(timer);
  }
}

/** A refusal from a provider, as a message a business can act on. */
export function failed(provider: string, status: number, detail?: string): CalendarError {
  if (status === 401 || status === 403) {
    return new CalendarError("auth", `${provider} refused the sign-in. Reconnect it, or check the details you entered.`);
  }
  const tail = detail ? ` ${detail.slice(0, 200)}` : "";
  return new CalendarError("provider", `${provider} answered with an error (${status}).${tail}`);
}
