// Cal.com integration — the ONLY thing Cal.com does for us: create the meeting (calendar
// invite + join link, emailed to the attendee) when a booking is confirmed, and cancel it
// when the booking is canceled/deleted. The backend owns availability + the authoritative
// booking; Cal.com never decides whether a time is free. We store the booking uid on the
// intake so cancel targets the exact meeting — freeing the slot on Cal.com so that time
// can be cleanly re-booked with a fresh link.
//
// Both operations are BEST-EFFORT: a Cal.com problem must never undo our own booking or
// block our own cancel. Uses the Cal.com v2 REST API via global fetch (no extra deps).
//
// Gotchas from the live API: (1) a normal User-Agent is required or Cloudflare blocks the
// request with "error code: 1010"; (2) the bookings endpoints pin this cal-api-version.

import { env } from "../config/env.js";
import type { IntakeRecord } from "../db/intakes.js";

const API_ROOT = "https://api.cal.com/v2";
const USER_AGENT = "Mozilla/5.0 (compatible; backend-app/0.1)";
const BOOKINGS_VERSION = "2024-08-13";

export class CalError extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.name = "CalError";
    this.status = status;
  }
}

async function call(
  path: string,
  { method = "GET", body }: { method?: string; body?: unknown } = {},
): Promise<unknown> {
  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
    Accept: "application/json",
    Authorization: `Bearer ${env.cal.apiKey}`,
    "cal-api-version": BOOKINGS_VERSION,
  };
  let payload: string | undefined;
  if (body !== undefined) {
    payload = JSON.stringify(body);
    headers["Content-Type"] = "application/json";
  }
  let res: Response;
  try {
    res = await fetch(`${API_ROOT}${path}`, { method, headers, body: payload });
  } catch (e) {
    throw new CalError(`could not reach Cal.com: ${(e as Error).message}`);
  }
  const text = await res.text();
  if (!res.ok) {
    throw new CalError(
      `Cal.com API error [${res.status}] on ${path}: ${text.slice(0, 300)}`,
      res.status,
    );
  }
  return text ? JSON.parse(text) : {};
}

// Create the Cal.com meeting for a confirmed booking. Returns the booking uid on success,
// or null if Cal.com isn't configured, the intake has no email, or the call fails.
export async function createMeeting(record: IntakeRecord): Promise<string | null> {
  if (!env.cal.enabled) return null;
  if (!record.email) {
    console.warn(`[cal] intake ${record.id} has no email; skipping meeting invite`);
    return null;
  }
  try {
    const data = (await call("/bookings", {
      method: "POST",
      body: {
        start: record.scheduledAt, // the ISO instant we booked
        eventTypeId: env.cal.eventId,
        attendee: {
          name: record.name || "Guest",
          email: record.email,
          timeZone: env.schedule.timezone,
        },
      },
    })) as { data?: { uid?: string } };
    const uid = data?.data?.uid ?? null;
    console.log(
      `[cal] created meeting for ${record.email} at ${record.scheduledAt} (uid ${uid ?? "?"})`,
    );
    return uid;
  } catch (e) {
    console.warn(`[cal] could not create meeting for intake ${record.id}: ${(e as Error).message}`);
    return null;
  }
}

// Cancel the Cal.com meeting with this uid, freeing the slot on Cal.com. Returns whether
// the meeting is now gone. An already-gone booking (404) counts as canceled; any other
// failure is logged and swallowed so our own cancel/delete still completes.
export async function cancelMeeting(uid: string): Promise<boolean> {
  if (!env.cal.enabled || !uid) return false;
  try {
    await call(`/bookings/${encodeURIComponent(uid)}/cancel`, {
      method: "POST",
      body: { cancellationReason: "Booking canceled by the admin." },
    });
    console.log(`[cal] canceled meeting ${uid}`);
    return true;
  } catch (e) {
    if (e instanceof CalError && e.status === 404) {
      console.log(`[cal] meeting ${uid} already gone; treating as canceled`);
      return true;
    }
    console.warn(`[cal] could not cancel meeting ${uid}: ${(e as Error).message}`);
    return false;
  }
}
