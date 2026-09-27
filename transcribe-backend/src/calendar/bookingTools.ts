import { isoDay, nextDay, zonedDate } from "./time.js";
import { CalendarError, call, failed, type BookingRequest, type CalendarClient, type Target } from "./types.js";

// The booking tools a business may already run: Cal.com, Calendly, and Squarespace Scheduling
// (Acuity). Each has its own availability, lengths, confirmations and reminders, so we never
// second-guess them: ask for the openings in one event type, book through the tool, and let it send
// the emails it always sends.
//
// All three sign in with a key the business copies from its own settings page. Calendly's booking
// API and Acuity's API are both paid-plan features on their side; a key from a free plan connects
// but is refused when booking, and the error says so.

function splitName(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return { first: parts[0] || "Caller", last: "(phone booking)" };
  return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1]! };
}

// ---- Cal.com (API v2) ---------------------------------------------------------------------------
// https://cal.com/docs/api-reference/v2

const CAL = "https://api.cal.com/v2";

export function calcomClient(apiKey: string): CalendarClient {
  const headers = (version?: string) => ({
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json",
    ...(version ? { "cal-api-version": version } : {}),
  });
  return {
    kind: "booking",

    async targets(): Promise<Target[]> {
      const res = await call(`${CAL}/event-types`, { headers: headers("2024-06-14") });
      if (!res.ok) throw failed("Cal.com", res.status, res.json()?.error?.message);
      const data = res.json()?.data;
      // The v2 shape is a flat list; an older one grouped them. Take either.
      const list: any[] = Array.isArray(data) ? data : (data?.eventTypeGroups ?? []).flatMap((g: any) => g.eventTypes ?? []);
      return list
        .filter((e) => !e.hidden)
        .map((e) => ({ id: String(e.id), name: String(e.title ?? e.slug ?? e.id), durationMinutes: Number(e.lengthInMinutes ?? e.length) || undefined }));
    },

    async openings(target: string, from: number, to: number, timeZone: string): Promise<number[]> {
      const params = new URLSearchParams({
        eventTypeId: target,
        start: new Date(from).toISOString(),
        end: new Date(to).toISOString(),
        timeZone,
      });
      const res = await call(`${CAL}/slots?${params}`, { headers: headers("2024-09-04") });
      if (!res.ok) throw failed("Cal.com", res.status, res.json()?.error?.message);
      const days = res.json()?.data ?? {};
      return Object.values(days).flatMap((slots: any) => (slots ?? []).map((s: any) => Date.parse(s.start ?? s.time ?? s)));
    },

    async book(target: string, request: BookingRequest) {
      const res = await call(`${CAL}/bookings`, {
        method: "POST",
        headers: headers("2024-08-13"),
        body: JSON.stringify({
          start: new Date(request.start).toISOString(),
          eventTypeId: Number(target),
          attendee: {
            name: request.callerName || "Phone caller",
            email: request.email,
            timeZone: request.timeZone,
            ...(request.callerPhone ? { phoneNumber: request.callerPhone } : {}),
          },
          metadata: { source: "ai-receptionist" },
          bookingFieldsResponses: { notes: request.notes.slice(0, 1000) },
        }),
      });
      const data = res.json();
      if (!res.ok) throw failed("Cal.com", res.status, data?.error?.message);
      const b = Array.isArray(data?.data) ? data.data[0] : data?.data;
      return { id: String(b?.uid ?? b?.id ?? ""), start: Date.parse(b?.start) || request.start, end: Date.parse(b?.end) || request.end };
    },
  };
}

export async function calcomAccount(apiKey: string): Promise<string> {
  const res = await call(`${CAL}/me`, { headers: { authorization: `Bearer ${apiKey}` } });
  if (!res.ok) throw failed("Cal.com", res.status, res.json()?.error?.message);
  const me = res.json()?.data;
  return String(me?.email || me?.username || "Cal.com");
}

// ---- Calendly -----------------------------------------------------------------------------------
// https://developer.calendly.com — personal access token; POST /invitees is the Scheduling API.

const CALENDLY = "https://api.calendly.com";

export type CalendlyCredentials = { token: string; userUri: string };

export function calendlyClient(creds: CalendlyCredentials): CalendarClient {
  const headers = { authorization: `Bearer ${creds.token}`, "content-type": "application/json" };
  return {
    kind: "booking",

    async targets(): Promise<Target[]> {
      const params = new URLSearchParams({ user: creds.userUri, active: "true", count: "100" });
      const res = await call(`${CALENDLY}/event_types?${params}`, { headers });
      if (!res.ok) throw failed("Calendly", res.status, res.json()?.message);
      return (res.json()?.collection ?? [])
        .filter((e: any) => e.active !== false && e.kind !== "group")
        .map((e: any) => ({ id: String(e.uri), name: String(e.name), durationMinutes: Number(e.duration) || undefined }));
    },

    async openings(target: string, from: number, to: number): Promise<number[]> {
      // At most 7 days per request; the start has to be in the future.
      const out: number[] = [];
      let start = Math.max(from, Date.now() + 60_000);
      while (start < to && out.length < 400) {
        const end = Math.min(to, start + 7 * 86_400_000);
        const params = new URLSearchParams({
          event_type: target,
          start_time: new Date(start).toISOString(),
          end_time: new Date(end).toISOString(),
        });
        const res = await call(`${CALENDLY}/event_type_available_times?${params}`, { headers });
        if (!res.ok) throw failed("Calendly", res.status, res.json()?.message);
        for (const slot of res.json()?.collection ?? []) {
          if (slot.status === "available") out.push(Date.parse(slot.start_time));
        }
        start = end;
      }
      return out;
    },

    async book(target: string, request: BookingRequest) {
      const res = await call(`${CALENDLY}/invitees`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          event_type: target,
          start_time: new Date(request.start).toISOString().replace(/\.\d{3}Z$/, "Z"),
          invitee: {
            name: request.callerName || "Phone caller",
            email: request.email,
            timezone: request.timeZone,
            ...(request.callerPhone ? { text_reminder_number: request.callerPhone } : {}),
          },
          questions_and_answers: [{ question: "Notes", answer: request.notes.slice(0, 1000), position: 0 }],
        }),
      });
      const data = res.json();
      if (!res.ok) {
        if (res.status === 403) {
          throw new CalendarError("provider", "Calendly only books through its API on a paid plan. Check the plan on this Calendly account.");
        }
        throw failed("Calendly", res.status, data?.message);
      }
      const r = data?.resource ?? {};
      return { id: String(r.uri ?? r.event ?? ""), start: request.start, end: request.end, link: r.reschedule_url };
    },
  };
}

export async function calendlyAccount(token: string): Promise<{ userUri: string; email: string }> {
  const res = await call(`${CALENDLY}/users/me`, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw failed("Calendly", res.status, res.json()?.message);
  const me = res.json()?.resource;
  return { userUri: String(me?.uri ?? ""), email: String(me?.email ?? me?.name ?? "Calendly") };
}

// ---- Squarespace Scheduling / Acuity -------------------------------------------------------------
// https://developers.acuityscheduling.com — Basic auth with the User ID and API key from
// Integrations → API. Squarespace Scheduling is Acuity under another name, and the same keys work.

const ACUITY = "https://acuityscheduling.com/api/v1";

export type AcuityCredentials = { userId: string; apiKey: string };

export function acuityClient(creds: AcuityCredentials): CalendarClient {
  const headers = {
    authorization: `Basic ${Buffer.from(`${creds.userId}:${creds.apiKey}`).toString("base64")}`,
    "content-type": "application/json",
  };
  return {
    kind: "booking",

    async targets(): Promise<Target[]> {
      const res = await call(`${ACUITY}/appointment-types`, { headers });
      if (!res.ok) throw failed("Squarespace Scheduling", res.status, res.json()?.message);
      return (res.json() ?? [])
        .filter((t: any) => t.active !== false && !t.private)
        .map((t: any) => ({ id: String(t.id), name: String(t.name), durationMinutes: Number(t.duration) || undefined }));
    },

    async openings(target: string, from: number, to: number, timeZone: string): Promise<number[]> {
      // One request per day with openings. /availability/dates first, so empty days cost nothing.
      const months = new Set<string>();
      for (let d: { year: number; month: number; day: number } = zonedDate(from, timeZone), i = 0; i < 200; i++, d = nextDay(d)) {
        const key = isoDay(d).slice(0, 7);
        months.add(key);
        if (isoDay(d) >= isoDay(zonedDate(to, timeZone))) break;
      }
      const dates: string[] = [];
      for (const month of months) {
        const params = new URLSearchParams({ month, appointmentTypeID: target, timezone: timeZone });
        const res = await call(`${ACUITY}/availability/dates?${params}`, { headers });
        if (!res.ok) throw failed("Squarespace Scheduling", res.status, res.json()?.message);
        for (const d of res.json() ?? []) if (d?.date) dates.push(String(d.date));
      }
      const out: number[] = [];
      for (const date of dates.slice(0, 21)) {
        const params = new URLSearchParams({ date, appointmentTypeID: target, timezone: timeZone });
        const res = await call(`${ACUITY}/availability/times?${params}`, { headers });
        if (!res.ok) throw failed("Squarespace Scheduling", res.status, res.json()?.message);
        for (const t of res.json() ?? []) {
          const at = Date.parse(String(t.time).replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
          if (Number.isFinite(at)) out.push(at);
        }
      }
      return out.filter((s) => s >= from && s <= to);
    },

    async book(target: string, request: BookingRequest) {
      const { first, last } = splitName(request.callerName || "Phone caller");
      const res = await call(`${ACUITY}/appointments`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          datetime: new Date(request.start).toISOString(),
          appointmentTypeID: Number(target),
          firstName: first,
          lastName: last,
          email: request.email,
          phone: request.callerPhone,
          notes: request.notes.slice(0, 1000),
          timezone: request.timeZone,
        }),
      });
      const data = res.json();
      if (!res.ok) throw failed("Squarespace Scheduling", res.status, data?.message);
      return {
        id: String(data?.id ?? ""),
        start: request.start,
        end: Date.parse(String(data?.endTime ?? "")) || request.end,
        link: data?.confirmationPage,
      };
    },
  };
}

export async function acuityAccount(creds: AcuityCredentials): Promise<string> {
  const res = await call(`${ACUITY}/me`, {
    headers: { authorization: `Basic ${Buffer.from(`${creds.userId}:${creds.apiKey}`).toString("base64")}` },
  });
  if (!res.ok) throw failed("Squarespace Scheduling", res.status, res.json()?.message);
  const me = res.json();
  return String(me?.email || me?.name || "Squarespace Scheduling");
}
