import type { Interval } from "./availability.js";
import { accessToken, type OAuthTokens } from "./oauth.js";
import { failed, call, type BookingRequest, type CalendarClient, type Target } from "./types.js";

// Google Calendar over its REST API: the calendar list, free/busy, and inserting an event.
// https://developers.google.com/calendar/api/v3/reference

const API = "https://www.googleapis.com/calendar/v3";

export function googleClient(tokens: OAuthTokens, save: (next: OAuthTokens) => Promise<void>): CalendarClient {
  const headers = async () => ({
    authorization: `Bearer ${await accessToken("google-calendar", tokens, save)}`,
    "content-type": "application/json",
  });

  return {
    kind: "calendar",

    async targets(): Promise<Target[]> {
      // Only calendars we could write to: a subscribed holiday calendar is not somewhere to book.
      const res = await call(`${API}/users/me/calendarList?minAccessRole=writer`, { headers: await headers() });
      if (!res.ok) throw failed("Google Calendar", res.status, res.json()?.error?.message);
      return (res.json()?.items ?? []).map((c: any) => ({
        id: String(c.id),
        name: String(c.summaryOverride || c.summary || c.id),
        primary: Boolean(c.primary),
      }));
    },

    async busy(target: string, from: number, to: number): Promise<Interval[]> {
      const res = await call(`${API}/freeBusy`, {
        method: "POST",
        headers: await headers(),
        body: JSON.stringify({
          timeMin: new Date(from).toISOString(),
          timeMax: new Date(to).toISOString(),
          items: [{ id: target }],
        }),
      });
      if (!res.ok) throw failed("Google Calendar", res.status, res.json()?.error?.message);
      const entry = res.json()?.calendars?.[target];
      if (entry?.errors?.length) throw failed("Google Calendar", 403, entry.errors[0]?.reason);
      return (entry?.busy ?? []).map((b: any) => ({ start: Date.parse(b.start), end: Date.parse(b.end) }));
    },

    async book(target: string, request: BookingRequest) {
      const res = await call(`${API}/calendars/${encodeURIComponent(target)}/events`, {
        method: "POST",
        headers: await headers(),
        body: JSON.stringify({
          summary: request.title,
          description: request.notes,
          start: { dateTime: new Date(request.start).toISOString(), timeZone: request.timeZone },
          end: { dateTime: new Date(request.end).toISOString(), timeZone: request.timeZone },
          reminders: { useDefault: true },
        }),
      });
      if (!res.ok) throw failed("Google Calendar", res.status, res.json()?.error?.message);
      const event = res.json();
      return { id: String(event.id), start: request.start, end: request.end, link: event.htmlLink };
    },
  };
}

/** The signed-in account's email, for the connection's label. */
export async function googleAccount(tokens: OAuthTokens, save: (next: OAuthTokens) => Promise<void>): Promise<string> {
  const res = await call("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { authorization: `Bearer ${await accessToken("google-calendar", tokens, save)}` },
  });
  return res.ok ? String(res.json()?.email ?? "") : "";
}
