import type { Interval } from "./availability.js";
import { zonedToUtc } from "./time.js";
import { CalendarError, call, failed, type BookingRequest, type CalendarClient, type Target } from "./types.js";

// CalDAV (RFC 4791): Apple's iCloud calendar, and any other server that speaks it — Fastmail,
// Nextcloud, Zoho Calendar, Synology, Radicale. Sign-in is an account name and a password; for
// iCloud that password is an app-specific one (appleid.apple.com → Sign-In and Security), because
// Apple offers no other way in for a calendar.
//
// Deliberately small: find the calendars, read the events in a range, write one event. The XML is
// read by local name with a few regular expressions rather than a parser — servers disagree about
// prefixes (d:, D:, none) but not about element names, and this is all the DAV we need.

export const ICLOUD_CALDAV = "https://caldav.icloud.com/";

export type CalDavCredentials = { server: string; username: string; password: string };

const XML = "application/xml; charset=utf-8";

// ---- XML, by local name --------------------------------------------------------------------------

function decode(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

/** The inner XML of every element with this local name (any prefix). */
export function elements(xml: string, local: string): string[] {
  const re = new RegExp(`<(?:[A-Za-z][\\w.-]*:)?${local}(?:\\s[^>]*)?(?:/>|>([\\s\\S]*?)</(?:[A-Za-z][\\w.-]*:)?${local}\\s*>)`, "g");
  const out: string[] = [];
  for (const m of xml.matchAll(re)) out.push(m[1] ?? "");
  return out;
}

function firstText(xml: string, local: string): string {
  const inner = elements(xml, local)[0];
  return inner === undefined ? "" : decode(inner.replace(/<[^>]+>/g, "")).trim();
}

function hrefIn(xml: string, local: string): string {
  const inner = elements(xml, local)[0] ?? "";
  return decode(elements(inner, "href")[0] ?? "").trim();
}

// ---- iCalendar ------------------------------------------------------------------------------------

/** Unfolded content lines of an iCalendar text. */
function icsLines(ics: string): string[] {
  return ics.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/);
}

function icsTime(value: string, params: string, fallbackZone: string): { at: number; allDay: boolean } | null {
  const date = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  const zone = /TZID=("?)([^;:"]+)\1/i.exec(params)?.[2];
  const tz = zone && validZone(zone) ? zone : fallbackZone;
  if (date) {
    const d = { year: Number(date[1]), month: Number(date[2]), day: Number(date[3]) };
    return { at: zonedToUtc(d, 0, tz), allDay: true };
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (z) return { at: Date.UTC(+y!, +mo! - 1, +d!, +h!, +mi!, +s!), allDay: false };
  return { at: zonedToUtc({ year: +y!, month: +mo!, day: +d! }, +h! * 60 + +mi!, tz) + +s! * 1000, allDay: false };
}

function validZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** "PT1H30M", "P1D" → ms. */
function icsDuration(value: string): number {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value);
  if (!m) return 0;
  const [, , w, d, h, mi, s] = m;
  return ((((+(w ?? 0) * 7 + +(d ?? 0)) * 24 + +(h ?? 0)) * 60 + +(mi ?? 0)) * 60 + +(s ?? 0)) * 1000;
}

/**
 * The busy stretches in one iCalendar object. Transparent events ("show as free", most birthdays
 * and holidays) and cancelled ones do not block anything; an all-day event does, for its day.
 */
export function busyFromIcs(ics: string, fallbackZone: string): Interval[] {
  const out: Interval[] = [];
  let inEvent = false;
  let props: Record<string, { params: string; value: string }> = {};
  for (const line of icsLines(ics)) {
    if (/^BEGIN:VEVENT$/i.test(line)) {
      inEvent = true;
      props = {};
      continue;
    }
    if (/^END:VEVENT$/i.test(line)) {
      inEvent = false;
      const status = props.STATUS?.value.toUpperCase();
      const transp = props.TRANSP?.value.toUpperCase();
      const start = props.DTSTART ? icsTime(props.DTSTART.value, props.DTSTART.params, fallbackZone) : null;
      if (!start || status === "CANCELLED" || transp === "TRANSPARENT") continue;
      let end = props.DTEND ? icsTime(props.DTEND.value, props.DTEND.params, fallbackZone)?.at : undefined;
      if (end === undefined && props.DURATION) end = start.at + icsDuration(props.DURATION.value);
      if (end === undefined) end = start.at + (start.allDay ? 86_400_000 : 0);
      if (end > start.at) out.push({ start: start.at, end });
      continue;
    }
    if (!inEvent) continue;
    const m = /^([A-Za-z-]+)((?:;[^:]*)?):(.*)$/.exec(line);
    if (m && !(m[1]!.toUpperCase() in props)) props[m[1]!.toUpperCase()] = { params: m[2] ?? "", value: m[3]!.trim() };
  }
  return out;
}

function icsEscape(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

function icsStamp(at: number): string {
  return new Date(at).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** Lines longer than 75 octets are folded, as the spec asks. */
function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 74) {
    out.push(rest.slice(0, 74));
    rest = ` ${rest.slice(74)}`;
  }
  out.push(rest);
  return out.join("\r\n");
}

export function eventIcs(uid: string, request: BookingRequest, now = Date.now()): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//TecAce//AI Receptionist//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${icsStamp(now)}`,
    `DTSTART:${icsStamp(request.start)}`,
    `DTEND:${icsStamp(request.end)}`,
    `SUMMARY:${icsEscape(request.title)}`,
    `DESCRIPTION:${icsEscape(request.notes)}`,
    "TRANSP:OPAQUE",
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ]
    .map(fold)
    .join("\r\n");
}

// ---- The client -----------------------------------------------------------------------------------

export function caldavClient(creds: CalDavCredentials, fallbackZone: string, label = "The calendar"): CalendarClient {
  const auth = `Basic ${Buffer.from(`${creds.username}:${creds.password}`).toString("base64")}`;

  async function dav(method: string, url: string, body: string | null, depth: "0" | "1" | null, extra: Record<string, string> = {}) {
    const headers: Record<string, string> = { authorization: auth, ...extra };
    if (body !== null && !headers["content-type"]) headers["content-type"] = XML;
    if (depth) headers.depth = depth;
    const res = await call(url, { method, headers, body: body ?? undefined, redirect: "follow" });
    if (res.status === 401 || res.status === 403) {
      throw new CalendarError(
        "auth",
        `${label} didn't accept that sign-in. Check the account name and the password (for iCloud, an app-specific password).`,
      );
    }
    return res;
  }

  async function calendarHome(): Promise<string> {
    const root = new URL(creds.server);
    const principalBody = `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>`;
    let res = await dav("PROPFIND", root.toString(), principalBody, "0");
    // Servers that only answer on the well-known path (RFC 6764).
    if (!res.ok && res.status !== 207) {
      res = await dav("PROPFIND", new URL("/.well-known/caldav", root).toString(), principalBody, "0");
    }
    if (!res.ok && res.status !== 207) throw failed(label, res.status);
    const principal = hrefIn(res.text, "current-user-principal");
    if (!principal) throw new CalendarError("provider", `${label} didn't say where this account's calendars are.`);
    const principalUrl = new URL(principal, root).toString();

    const homeBody = `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>`;
    const home = await dav("PROPFIND", principalUrl, homeBody, "0");
    if (!home.ok && home.status !== 207) throw failed(label, home.status);
    const href = hrefIn(home.text, "calendar-home-set");
    if (!href) throw new CalendarError("provider", `${label} has no calendars for this account.`);
    return new URL(href, principalUrl).toString();
  }

  return {
    kind: "calendar",

    async targets(): Promise<Target[]> {
      const home = await calendarHome();
      const body = `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:displayname/><d:resourcetype/><c:supported-calendar-component-set/></d:prop></d:propfind>`;
      const res = await dav("PROPFIND", home, body, "1");
      if (!res.ok && res.status !== 207) throw failed(label, res.status);
      const out: Target[] = [];
      for (const response of elements(res.text, "response")) {
        const type = elements(response, "resourcetype")[0] ?? "";
        if (!/calendar[\s/>]/.test(type)) continue;
        const comps = elements(response, "supported-calendar-component-set")[0];
        if (comps && !/name="VEVENT"/i.test(comps)) continue; // a reminders list, not a calendar
        const href = decode(elements(response, "href")[0] ?? "").trim();
        if (!href) continue;
        out.push({ id: new URL(href, home).toString(), name: firstText(response, "displayname") || "Calendar" });
      }
      if (out[0]) out[0].primary = true;
      return out;
    },

    async busy(target: string, from: number, to: number): Promise<Interval[]> {
      const range = `start="${icsStamp(from)}" end="${icsStamp(to)}"`;
      // `expand` asks the server to unroll repeating events into the range, in UTC. Servers that
      // ignore it still return the events; only a repeating one's later occurrences are then missed.
      const body = `<?xml version="1.0" encoding="utf-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><c:calendar-data><c:expand ${range}/></c:calendar-data></d:prop>
  <c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range ${range}/></c:comp-filter></c:comp-filter></c:filter>
</c:calendar-query>`;
      const res = await dav("REPORT", target, body, "1");
      if (!res.ok && res.status !== 207) throw failed(label, res.status);
      return elements(res.text, "calendar-data")
        .flatMap((data) => busyFromIcs(decode(data), fallbackZone))
        .filter((b) => b.end > from && b.start < to);
    },

    async book(target: string, request: BookingRequest) {
      const uid = `${crypto.randomUUID()}@tecace-receptionist`;
      const url = new URL(`${encodeURIComponent(uid)}.ics`, target.endsWith("/") ? target : `${target}/`).toString();
      const res = await dav("PUT", url, eventIcs(uid, request), null, {
        "content-type": "text/calendar; charset=utf-8",
        "if-none-match": "*",
      });
      if (!res.ok) throw failed(label, res.status);
      return { id: uid, start: request.start, end: request.end };
    },
  };
}
