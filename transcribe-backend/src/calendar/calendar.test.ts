import { afterAll, describe, expect, it } from "bun:test";

// The calendar module without a real calendar: time zones, the opening maths, the CalDAV XML and
// iCalendar reading (against a small fake CalDAV server), sealing, the OAuth state, the booking
// rules' validation, and what a call is told once booking is on.
//
// Run: bun test src/calendar/calendar.test.ts
process.env.DATABASE_URL ??= "postgres://unused/unused";
process.env.AUTH_SECRET ??= "test-secret-test-secret-test-secret-0123";

const { zonedToUtc, zonedDate, spokenTime, zonedIso } = await import("./time.js");
const { calendarSlots, pickSlots, withinRules, bookingWindows } = await import("./availability.js");
const { busyFromIcs, elements, caldavClient, eventIcs } = await import("./caldav.js");
const { seal, open, openStored, signState, readState } = await import("./secrets.js");
const { defaultAppointments, validateCallSettings, readCallSettings, CallSettingsError } = await import(
  "../business/callSettings.js"
);
const { composeSession } = await import("../session/compose.js");
const { callRules } = await import("../session/callRules.js");

const LA = "America/Los_Angeles";
const rules = (over: Partial<ReturnType<typeof defaultAppointments>> = {}) => ({
  ...defaultAppointments(),
  enabled: true,
  minNoticeMinutes: 0,
  ...over,
});
const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].map((day) => ({
  day,
  open: "9:00 AM",
  close: "5:00 PM",
}));

describe("time", () => {
  it("turns wall-clock time in a zone into the right instant, across daylight saving", () => {
    // 2026-07-01 09:00 PDT = 16:00Z; 2026-12-01 09:00 PST = 17:00Z.
    expect(new Date(zonedToUtc({ year: 2026, month: 7, day: 1 }, 9 * 60, LA)).toISOString()).toBe("2026-07-01T16:00:00.000Z");
    expect(new Date(zonedToUtc({ year: 2026, month: 12, day: 1 }, 9 * 60, LA)).toISOString()).toBe("2026-12-01T17:00:00.000Z");
    expect(zonedDate(Date.parse("2026-07-01T06:00:00Z"), LA)).toMatchObject({ day: 30, weekday: "Tuesday" });
  });

  it("says a time the way a caller hears it, and writes it with the zone's offset", () => {
    const at = Date.parse("2026-10-06T21:30:00Z");
    expect(spokenTime(at, LA)).toBe("Tuesday, October 6 at 2:30 PM");
    expect(zonedIso(at, LA)).toBe("2026-10-06T14:30:00-07:00");
  });
});

describe("openings", () => {
  // Monday 2026-10-05, 07:00 in Seattle.
  const now = Date.parse("2026-10-05T14:00:00Z");

  it("offers starts inside the business hours, every half hour, until the day is too short", () => {
    const slots = calendarSlots({ rules: rules({ horizonDays: 1 }), profileHours: weekdays, busy: [], now, timeZone: LA });
    const monday = slots.filter((s) => zonedDate(s, LA).day === 5).map((s) => zonedIso(s, LA).slice(11, 16));
    expect(monday[0]).toBe("09:00");
    expect(monday.at(-1)).toBe("16:30");
    expect(monday).toHaveLength(16);
  });

  it("keeps clear of busy time plus the gap, and of anything too soon", () => {
    const busy = [{ start: Date.parse("2026-10-05T17:00:00Z"), end: Date.parse("2026-10-05T18:00:00Z") }]; // 10–11am
    const slots = calendarSlots({
      rules: rules({ horizonDays: 1, bufferMinutes: 15, minNoticeMinutes: 150 }), // earliest 9:30
      profileHours: weekdays,
      busy,
      now,
      timeZone: LA,
    }).map((s) => zonedIso(s, LA).slice(11, 16));
    expect(slots.slice(0, 3)).toEqual(["11:30", "12:00", "12:30"]);
    // 9:30 would end at 10:00, inside the 15-minute gap before the 10:00 event.
    expect(slots).not.toContain("09:30");
    expect(slots).not.toContain("11:00");
  });

  it("uses the business's own booking hours over its opening hours, and skips closed days", () => {
    const own = rules({ hours: [{ day: "Wednesday", open: "13:00", close: "15:00" }], horizonDays: 7 });
    const slots = calendarSlots({ rules: own, profileHours: weekdays, busy: [], now, timeZone: LA });
    expect(new Set(slots.map((s) => zonedDate(s, LA).weekday))).toEqual(new Set(["Wednesday"]));
    expect(bookingWindows(rules(), [{ day: "Saturday", open: "", close: "", closed: true }]).size).toBe(0);
  });

  it("holds a booking tool's own openings to the notice and horizon", () => {
    const starts = [now + 30 * 60_000, now + 5 * 3_600_000, now + 40 * 86_400_000];
    expect(withinRules(starts, rules({ minNoticeMinutes: 60, horizonDays: 30 }), now)).toEqual([now + 5 * 3_600_000]);
  });

  it("picks a spread across the first days, or a day's worth when a date is asked for", () => {
    const slots = calendarSlots({ rules: rules({ horizonDays: 5 }), profileHours: weekdays, busy: [], now, timeZone: LA });
    const soon = pickSlots(slots, LA, {});
    expect(soon.length).toBe(6);
    expect(new Set(soon.map((s) => s.start.slice(0, 10))).size).toBe(3);
    const thursday = pickSlots(slots, LA, { date: "2026-10-08", partOfDay: "afternoon" });
    expect(thursday.every((s) => s.start.startsWith("2026-10-08T1"))).toBe(true);
    expect(thursday[0]!.spoken).toBe("Thursday, October 8 at 12:00 PM");
  });
});

describe("iCalendar", () => {
  it("reads busy time from UTC, zoned and all-day events, and skips free or cancelled ones", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "DTSTART:20261006T170000Z",
      "DTEND:20261006T180000Z",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "DTSTART;TZID=America/New_York:20261007T090000",
      "DURATION:PT1H30M",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "DTSTART;VALUE=DATE:20261008",
      "DTEND;VALUE=DATE:20261009",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "DTSTART:20261009T170000Z",
      "DTEND:20261009T180000Z",
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "DTSTART:20261010T170000Z",
      "DTEND:20261010T180000Z",
      "STATUS:CANCELLED",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const busy = busyFromIcs(ics, LA).map((b) => [new Date(b.start).toISOString(), new Date(b.end).toISOString()]);
    expect(busy).toEqual([
      ["2026-10-06T17:00:00.000Z", "2026-10-06T18:00:00.000Z"],
      ["2026-10-07T13:00:00.000Z", "2026-10-07T14:30:00.000Z"],
      ["2026-10-08T07:00:00.000Z", "2026-10-09T07:00:00.000Z"],
    ]);
  });

  it("writes an event a CalDAV server accepts, escaped and folded", () => {
    const ics = eventIcs("uid-1", {
      start: Date.parse("2026-10-06T21:30:00Z"),
      end: Date.parse("2026-10-06T22:00:00Z"),
      timeZone: LA,
      title: "Consultation: Kim, Jo",
      notes: "Line one\nLine two; with a semicolon",
      callerName: "Jo Kim",
      callerPhone: "+12065550134",
      email: "",
    });
    expect(ics).toContain("DTSTART:20261006T213000Z");
    expect(ics).toContain("SUMMARY:Consultation: Kim\\, Jo");
    expect(ics).toContain("DESCRIPTION:Line one\\nLine two\\; with a semicolon");
    expect(ics.split("\r\n").every((line) => line.length <= 75)).toBe(true);
  });

  it("reads DAV XML whatever the prefix", () => {
    const xml = `<D:multistatus xmlns:D="DAV:"><D:response><D:href>/a/</D:href></D:response><response><href>/b/</href></response></D:multistatus>`;
    expect(elements(xml, "response")).toHaveLength(2);
    expect(elements(xml, "href")).toEqual(["/a/", "/b/"]);
  });
});

describe("CalDAV client against a fake server", () => {
  const puts: { url: string; body: string; auth: string | null }[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const auth = req.headers.get("authorization");
      if (auth !== `Basic ${Buffer.from("jo@example.com:abcd-efgh").toString("base64")}`) return new Response("", { status: 401 });
      const ms = (body: string) => new Response(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">${body}</d:multistatus>`, { status: 207 });
      if (req.method === "PROPFIND" && url.pathname === "/") {
        return ms(`<d:response><d:href>/</d:href><d:propstat><d:prop><d:current-user-principal><d:href>/123/principal/</d:href></d:current-user-principal></d:prop></d:propstat></d:response>`);
      }
      if (req.method === "PROPFIND" && url.pathname === "/123/principal/") {
        return ms(`<d:response><d:href>/123/principal/</d:href><d:propstat><d:prop><cal:calendar-home-set><d:href>/123/calendars/</d:href></cal:calendar-home-set></d:prop></d:propstat></d:response>`);
      }
      if (req.method === "PROPFIND" && url.pathname === "/123/calendars/") {
        return ms(
          `<d:response><d:href>/123/calendars/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>` +
            `<d:response><d:href>/123/calendars/work/</d:href><d:propstat><d:prop><d:displayname>Work</d:displayname><d:resourcetype><d:collection/><cal:calendar/></d:resourcetype><cal:supported-calendar-component-set><cal:comp name="VEVENT"/></cal:supported-calendar-component-set></d:prop></d:propstat></d:response>` +
            `<d:response><d:href>/123/calendars/tasks/</d:href><d:propstat><d:prop><d:displayname>Reminders</d:displayname><d:resourcetype><d:collection/><cal:calendar/></d:resourcetype><cal:supported-calendar-component-set><cal:comp name="VTODO"/></cal:supported-calendar-component-set></d:prop></d:propstat></d:response>`,
        );
      }
      if (req.method === "REPORT" && url.pathname === "/123/calendars/work/") {
        const data = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART:20261006T170000Z\r\nDTEND:20261006T180000Z\r\nEND:VEVENT\r\nEND:VCALENDAR";
        return ms(`<d:response><d:href>/123/calendars/work/e1.ics</d:href><d:propstat><d:prop><cal:calendar-data>${data}</cal:calendar-data></d:prop></d:propstat></d:response>`);
      }
      if (req.method === "PUT") {
        puts.push({ url: url.pathname, body: await req.text(), auth });
        return new Response("", { status: 201 });
      }
      return new Response("", { status: 404 });
    },
  });
  afterAll(() => server.stop(true));
  const creds = { server: `http://localhost:${server.port}/`, username: "jo@example.com", password: "abcd-efgh" };

  it("finds the event calendars, reads busy time, and books", async () => {
    const client = caldavClient(creds, LA);
    const targets = await client.targets();
    expect(targets).toEqual([{ id: `http://localhost:${server.port}/123/calendars/work/`, name: "Work", primary: true }]);
    const busy = await client.busy!(targets[0]!.id, Date.parse("2026-10-06T00:00:00Z"), Date.parse("2026-10-07T00:00:00Z"));
    expect(busy).toEqual([{ start: Date.parse("2026-10-06T17:00:00Z"), end: Date.parse("2026-10-06T18:00:00Z") }]);
    const booked = await client.book(targets[0]!.id, {
      start: Date.parse("2026-10-06T21:30:00Z"),
      end: Date.parse("2026-10-06T22:00:00Z"),
      timeZone: LA,
      title: "Appointment: Jo",
      notes: "Booked by the AI receptionist.",
      callerName: "Jo",
      callerPhone: "",
      email: "",
    });
    expect(puts).toHaveLength(1);
    expect(puts[0]!.url).toStartWith("/123/calendars/work/");
    expect(puts[0]!.body).toContain(`UID:${booked.id}`);
  });

  it("says the sign-in was refused, in words a business can act on", async () => {
    const client = caldavClient({ ...creds, password: "wrong" }, LA, "iCloud");
    await expect(client.targets()).rejects.toThrow(/iCloud didn't accept that sign-in/);
  });
});

describe("secrets", () => {
  it("seals and opens credentials, and refuses another key or a tampered value", () => {
    const sealed = seal({ apiKey: "cal_live_123" });
    expect(sealed).not.toContain("cal_live_123");
    expect(open<{ apiKey: string }>(sealed)).toEqual({ apiKey: "cal_live_123" });
    expect(open(sealed, "another-secret")).toBeNull();
    expect(open(`${sealed.slice(0, -2)}AA`)).toBeNull();
  });

  // Setting CALENDAR_SECRET where AUTH_SECRET used to stand in for it must not strand what was saved
  // before: the earlier key still opens it, and says so, so the caller can re-seal under the new one.
  it("opens credentials sealed under an earlier key, and says they need re-sealing", () => {
    const old = seal({ apiKey: "cal_live_old" }, "old-key");
    expect(openStored<{ apiKey: string }>(old, ["new-key", "old-key"])).toEqual({
      value: { apiKey: "cal_live_old" },
      stale: true,
    });
    const current = seal({ apiKey: "cal_live_new" }, "new-key");
    expect(openStored(current, ["new-key", "old-key"])).toEqual({ value: { apiKey: "cal_live_new" }, stale: false });
    expect(openStored(old, ["new-key", "other-key"])).toBeNull();
  });

  it("signs the OAuth state, and refuses it tampered or expired", () => {
    const state = signState({ uid: "u1", provider: "google-calendar", back: "http://localhost:5175/" }, 1_000);
    expect(readState(state, 2_000)).toMatchObject({ uid: "u1", provider: "google-calendar" });
    expect(readState(state, 1_000 + 11 * 60_000)).toBeNull();
    const [payload, mac] = state.split(".");
    const forged = Buffer.from(JSON.stringify({ uid: "u2", provider: "google-calendar", back: "x", exp: 9e15 })).toString("base64url");
    expect(readState(`${forged}.${mac}`, 2_000)).toBeNull();
    expect(payload).toBeTruthy();
  });
});

describe("booking rules in the call settings", () => {
  const ctx = { agentNumber: null, waterfallAllowed: false };

  it("defaults for settings saved before appointments existed", () => {
    expect(readCallSettings({ transfer: { scenarios: [] } }).appointments).toEqual(defaultAppointments());
    expect(validateCallSettings({}, ctx).appointments.enabled).toBe(false);
  });

  it("keeps good values and refuses out-of-range ones with the field named", () => {
    const saved = validateCallSettings(
      { appointments: { enabled: true, title: "Consultation", durationMinutes: 45, horizonDays: 14, hours: [{ day: "Mon", open: "9am", close: "12pm" }] } },
      ctx,
    ).appointments;
    expect(saved).toMatchObject({ enabled: true, title: "Consultation", durationMinutes: 45, horizonDays: 14 });
    expect(saved.hours).toEqual([{ day: "Monday", open: "09:00", close: "12:00" }]);
    try {
      validateCallSettings({ appointments: { durationMinutes: 1000 } }, ctx);
      throw new Error("should have refused");
    } catch (e) {
      expect(e).toBeInstanceOf(CallSettingsError);
      expect((e as InstanceType<typeof CallSettingsError>).field).toBe("appointments.durationMinutes");
    }
  });
});

describe("what a call is told", () => {
  const record = {
    profile: { name: "Glow Clinic", address: "1 Main St", hours: weekdays, services: [], highlights: [], policies: {}, faqs: [] } as any,
    prompts: null,
    agentName: "Ava",
    voice: null,
    language: null,
  };
  const base = {
    record,
    channel: "app-test" as const,
    now: new Date("2026-10-05T17:00:00Z"),
    timeZone: LA,
    waterfallAllowed: false,
    neverPublished: false,
  };
  const on = { ...defaultAppointments(), enabled: true, title: "Consultation", instructions: "Ask if it's their first visit." };

  it("offers booking only with it switched on AND a calendar connected", () => {
    const booking = { providerName: "Google Calendar", kind: "calendar" as const };
    const names = (s: { tools: { name: string }[] }) => s.tools.map((t) => t.name);
    expect(names(composeSession({ ...base, callSettings: { appointments: on } }))).not.toContain("book_appointment");
    expect(names(composeSession({ ...base, callSettings: { appointments: { ...on, enabled: false } }, booking }))).not.toContain(
      "check_availability",
    );
    const session = composeSession({ ...base, callSettings: { appointments: on }, booking });
    expect(session.canBook).toBe(true);
    expect(names(session)).toEqual(expect.arrayContaining(["check_availability", "book_appointment", "take_message", "end_call"]));
    expect(session.live).toContain("# Appointments");
    expect(session.live).toContain("Consultation");
    expect(session.live).toContain("Ask if it's their first visit.");
    expect(session.live).toContain("BOOKING A NEW APPOINTMENT IS YOURS TO DO");
    expect(session.live).not.toContain("You are NOT the booking system");
    // The public demo books into its demo calendar when booking is on (the page plays it out; nothing
    // is saved), and not without a booking target or with booking off.
    const demoCal = { providerName: "demo calendar", kind: "calendar" as const };
    expect(composeSession({ ...base, channel: "public-demo", callSettings: { appointments: on }, booking: demoCal }).canBook).toBe(true);
    expect(composeSession({ ...base, channel: "public-demo", callSettings: { appointments: on } }).canBook).toBe(false);
    expect(composeSession({ ...base, channel: "public-demo", callSettings: { appointments: { ...on, enabled: false } }, booking: demoCal }).canBook).toBe(false);
  });

  it("leaves the rule book exactly as it was when booking is off", () => {
    for (const reachable of [true, false]) {
      const off = callRules({ businessName: "X", agentName: "Ava", reachable });
      expect(callRules({ businessName: "X", agentName: "Ava", reachable, canBook: false })).toBe(off);
      expect(off).toContain("You are NOT the booking system");
      const bookable = callRules({ businessName: "X", agentName: "Ava", reachable, canBook: true });
      expect(bookable).not.toContain("I can't book");
    }
  });
});
