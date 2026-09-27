import { afterAll, describe, expect, it, mock } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

// Appointments end to end: a business connects a CalDAV calendar, picks where bookings land, saves
// its booking rules into the call-settings draft, sees what a call is told, checks openings, makes a
// test booking from the in-app test call, publishes, and the phone agent books under the PUBLISHED
// rules. Then tenancy and disconnect.
//
// Nothing real is called. The calendar is a small, stateful fake CalDAV server behind a stubbed
// `fetch` at https://dav.fake-calendar.test/ (the backend refuses http:// and private hosts, so it
// cannot be a Bun.serve on localhost). It answers the three things caldav.ts asks — PROPFIND
// discovery, REPORT for busy time, PUT for a new event — and keeps what was PUT, so a second
// booking at the same time really does find it taken.
//
// The database is PGlite behind the same `../db/client.js` shim calendar.pg.test.ts uses (copied,
// not imported: a test file importing another would run its tests too).
//
// Run: bun test src/routes/appointments.e2e.pg.test.ts
process.env.DATABASE_URL ??= "postgres://unused/unused";
process.env.AUTH_SECRET ??= "test-secret-test-secret-test-secret-0123";

const db = await PGlite.create();
const FRAGMENT = Symbol("fragment");

// A fragment is recognised by its SHAPE (see calendar.pg.test.ts for why a private symbol is not enough).
const isFragment = (value: any): boolean =>
  Boolean(value) &&
  typeof value === "object" &&
  Array.isArray(value.strings) &&
  Array.isArray(value.values) &&
  "raw" in value.strings;

const TYPES_URL = new URL("../../node_modules/postgres/src/types.js", import.meta.url).href;
const { serializers } = (await import(TYPES_URL)) as {
  serializers: Record<number, (x: unknown) => string>;
};

function bind(value: unknown): unknown {
  const parameter = value as { value?: unknown; type?: number } | null;
  if (parameter && typeof parameter === "object" && "type" in parameter && "value" in parameter) {
    const serialize = serializers[parameter.type as number];
    return serialize ? serialize(parameter.value) : parameter.value;
  }
  return value instanceof Date ? value.toISOString() : value;
}

function build(strings: TemplateStringsArray, values: unknown[], counter: { n: number }) {
  let text = "";
  const out: unknown[] = [];
  strings.forEach((part, i) => {
    text += part;
    if (i >= values.length) return;
    const value = values[i] as any;
    if (isFragment(value)) {
      const inner = build(value.strings, value.values, counter);
      text += inner.text;
      out.push(...inner.values);
    } else {
      counter.n += 1;
      text += "$" + counter.n;
      out.push(bind(value));
    }
  });
  return { text, values: out };
}

const run = async (text: string, values: unknown[]) => (await db.query(text, values)).rows;

const makeTag = () => (strings: TemplateStringsArray, ...values: unknown[]) => ({
  [FRAGMENT]: true,
  strings,
  values,
  then(resolve: any, reject: any) {
    const built = build(strings, values, { n: 0 });
    return run(built.text, built.values).then(resolve, reject);
  },
});

const sqlShim: any = Object.assign(makeTag(), {
  begin: async (fn: (tx: any) => Promise<unknown>) => {
    await db.exec("BEGIN");
    try {
      const out = await fn(makeTag());
      await db.exec("COMMIT");
      return out;
    } catch (error) {
      await db.exec("ROLLBACK");
      throw error;
    }
  },
  json: (value: unknown) => ({ value, type: 3802 }),
  end: async () => {},
});

await mock.module("../db/client.js", () => ({
  sql: sqlShim,
  initDb: async () => {},
  ensureDbReady: async () => {},
}));

// The real DDL, lifted out of client.ts.
const source = await Bun.file("src/db/client.ts").text();
const body = source.slice(source.indexOf("export async function initDb"), source.indexOf("// On Vercel"));
for (const [, statement = ""] of body.matchAll(/sql`([\s\S]*?)`/g)) {
  try {
    await db.exec(statement);
  } catch (error) {
    throw new Error(`DDL failed: ${statement.trim().slice(0, 90)}\n${(error as Error).message}`);
  }
}

// The phone agent's shared key. Spread over the real env: mock.module is process-wide, and a partial
// env would break later test files (same pattern and key as customerLifecycle.pg.test.ts).
const AGENT_KEY = "test-agent-key";
const { env: realEnv } = await import("../config/env.js");
await mock.module("../config/env.js", () => ({ env: { ...realEnv, agentConfigKey: AGENT_KEY } }));

const { createUser } = await import("../db/users.js");
const { createToken } = await import("../auth/session.js");
const { saveProfile } = await import("../db/businessProfiles.js");
const { createAgentNumber, assignAgentNumber } = await import("../db/agentNumbers.js");
const { zonedDate, nextDay, isoDay, zonedMinutes } = await import("../calendar/time.js");

async function account(email: string, role: "admin" | "user") {
  const user = (await createUser({ email, name: email, passwordHash: "x".repeat(60), role }))!;
  return { id: user.id, auth: `Bearer ${createToken(user.id, user.tokenVersion).token}` };
}

const jane = await account("jane.appt@glow.example", "user");
const bob = await account("bob.appt@rival.example", "user");
const admin = await account("ops.appt@tecace.com", "admin");

// Jane's business, so the session preview has something to compose from. No opening hours: the
// booking hours below are the business's own, and the clock block then says nothing about open/closed.
await saveProfile(
  jane.id,
  "Glow Clinic, skin care in Seattle.",
  { businessName: "Glow Clinic", hoursText: null, openHour: null, closeHour: null, website: null, facts: "- Skin care." },
  { transferNumber: null, agentName: "Ava", greeting: null, transferTopics: null, houseRules: null },
  {
    profile: { name: "Glow Clinic", category: "Clinic", address: "1 Main St, Seattle, WA", hours: [], services: [], highlights: [], policies: {}, faqs: [] },
    prompts: { live: "You are at Glow Clinic.", backend: "", greeting: "Hello.", edited: false } as never,
    voice: null,
    language: null,
  },
);

// The numbers the agent answers on: Jane's, Bob's, and one nobody owns yet.
const JANE_LINE = "+12065550100";
const BOB_LINE = "+12065550111";
const SPARE_LINE = "+12065550122";
await assignAgentNumber((await createAgentNumber({ phone: JANE_LINE, label: "Glow" })).id, jane.id);
await assignAgentNumber((await createAgentNumber({ phone: BOB_LINE, label: "Rival" })).id, bob.id);
await createAgentNumber({ phone: SPARE_LINE, label: "Spare" });

const { app } = await import("../app.js");

async function call(method: string, path: string, auth: string | null, payload?: unknown, extra: Record<string, string> = {}) {
  const headers: Record<string, string> = { ...extra };
  if (auth) headers.authorization = auth;
  if (payload !== undefined) headers["content-type"] = "application/json";
  const response = await app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers,
      body: payload === undefined ? undefined : JSON.stringify(payload),
    }),
  );
  const text = await response.text();
  let parsed: any = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // plain text answers stay text
  }
  return { status: response.status, body: parsed };
}

const agent = (payload: unknown, key: string | null = AGENT_KEY) =>
  call("POST", "/business/calendar/agent-tool", null, payload, key === null ? {} : { "x-agent-key": key });

// ---- Time --------------------------------------------------------------------------------------

const LA = "America/Los_Angeles";
const tomorrow = isoDay(nextDay(zonedDate(Date.now(), LA)));
const inThreeDays = isoDay(nextDay(nextDay(nextDay(zonedDate(Date.now(), LA)))));
const icsDay = tomorrow.replace(/-/g, "");
/** "20260928T160000Z" for an instant, the way caldav.ts writes DTSTART. */
const stamp = (at: number) => new Date(at).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
/** "09:00" for an ISO time the tool returned (it carries the zone's offset). */
const clock = (iso: string) => iso.slice(11, 16);

// ---- The fake CalDAV server --------------------------------------------------------------------

const DAV = "https://dav.fake-calendar.test";
const DAV_USER = "jane@glow.example";
const DAV_PASS = "app-pass-9f3k-22xq";
const HOME = "/cal/jane/";
const WORK = `${HOME}work/`;
const CLINIC = `${HOME}clinic/`;

const vevent = (lines: string[]) => ["BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT", ...lines, "END:VEVENT", "END:VCALENDAR"].join("\r\n");

// What each calendar holds, by resource path. The clinic calendar (the one Jane will pick) has a
// staff meeting tomorrow 10:00–11:00 Seattle time; the work calendar (the default pick) has one at
// 9:00–9:30 — so if the chosen calendar were ignored, the openings would come out differently.
const store: Record<string, Map<string, string>> = {
  [WORK]: new Map([[`${WORK}seed-work.ics`, vevent(["UID:seed-work", `DTSTART:${icsDay}T160000Z`, `DTEND:${icsDay}T163000Z`, "SUMMARY:Other"])]]),
  [CLINIC]: new Map([
    [
      `${CLINIC}seed-meeting.ics`,
      vevent(["UID:seed-meeting", `DTSTART;TZID=${LA}:${icsDay}T100000`, `DTEND;TZID=${LA}:${icsDay}T110000`, "SUMMARY:Staff meeting"]),
    ],
  ]),
};
const puts: { path: string; body: string }[] = [];
const davRequests: { method: string; path: string }[] = [];

const xmlEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const multistatus = (inner: string) =>
  new Response(`<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">${inner}</d:multistatus>`, {
    status: 207,
    headers: { "content-type": "application/xml; charset=utf-8" },
  });

async function fakeCalDav(url: URL, init: RequestInit | undefined): Promise<Response> {
  const method = (init?.method ?? "GET").toUpperCase();
  const headers = new Headers(init?.headers as ConstructorParameters<typeof Headers>[0]);
  const path = url.pathname;
  davRequests.push({ method, path });
  if (headers.get("authorization") !== `Basic ${Buffer.from(`${DAV_USER}:${DAV_PASS}`).toString("base64")}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (method === "PROPFIND" && (path === "/" || path === "/.well-known/caldav")) {
    return multistatus(
      `<d:response><d:href>/</d:href><d:propstat><d:prop><d:current-user-principal><d:href>/principals/jane/</d:href></d:current-user-principal></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`,
    );
  }
  if (method === "PROPFIND" && path === "/principals/jane/") {
    return multistatus(
      `<d:response><d:href>/principals/jane/</d:href><d:propstat><d:prop><cal:calendar-home-set><d:href>${HOME}</d:href></cal:calendar-home-set></d:prop></d:propstat></d:response>`,
    );
  }
  if (method === "PROPFIND" && path === HOME) {
    const cal = (href: string, name: string, comp: string) =>
      `<d:response><d:href>${href}</d:href><d:propstat><d:prop><d:displayname>${name}</d:displayname><d:resourcetype><d:collection/><cal:calendar/></d:resourcetype><cal:supported-calendar-component-set><cal:comp name="${comp}"/></cal:supported-calendar-component-set></d:prop></d:propstat></d:response>`;
    return multistatus(
      `<d:response><d:href>${HOME}</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>` +
        cal(WORK, "Work", "VEVENT") +
        cal(CLINIC, "Clinic", "VEVENT") +
        cal(`${HOME}tasks/`, "Reminders", "VTODO"),
    );
  }
  if (method === "REPORT" && store[path]) {
    const inner = [...store[path]!.entries()]
      .map(
        ([href, ics]) =>
          `<d:response><d:href>${href}</d:href><d:propstat><d:prop><cal:calendar-data>${xmlEscape(ics)}</cal:calendar-data></d:prop></d:propstat></d:response>`,
      )
      .join("");
    return multistatus(inner);
  }
  if (method === "PUT") {
    const calendar = Object.keys(store).find((c) => path.startsWith(c) && path.endsWith(".ics"));
    if (!calendar) return new Response("", { status: 404 });
    if (headers.get("if-none-match") === "*" && store[calendar]!.has(path)) return new Response("", { status: 412 });
    const text = typeof init?.body === "string" ? init.body : await new Response(init?.body as ConstructorParameters<typeof Response>[0]).text();
    store[calendar]!.set(path, text);
    puts.push({ path, body: text });
    return new Response("", { status: 201 });
  }
  return new Response("", { status: 404 });
}

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (url.origin !== DAV) return realFetch(input, init);
  return fakeCalDav(url, init);
}) as typeof fetch;

afterAll(async () => {
  globalThis.fetch = realFetch;
  await db.close();
});

// ---- Settings helpers --------------------------------------------------------------------------

const WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((day) => ({
  day,
  open: "09:00",
  close: "17:00",
}));
const RULES = {
  enabled: true,
  title: "Consultation",
  durationMinutes: 30,
  bufferMinutes: 15,
  minNoticeMinutes: 60,
  horizonDays: 30,
  hours: WEEK,
  instructions: "Ask if it's their first visit.",
};

const saveDraft = (appointments: Record<string, unknown>, who = jane.auth, query = "") =>
  call("PUT", `/business/call-settings${query}`, who, { draft: { timezone: LA, appointments } });

const preview = (which: "draft" | "published" = "draft") =>
  call("GET", `/business/session-preview${which === "published" ? "?settings=published" : ""}`, jane.auth);

/** The composed text with the one line that moves with the clock taken out. */
const steady = (live: string) => live.replace(/^- It is .*$/m, "- It is <now>.");

const bookingRows = async (userId: string) =>
  (await db.query(
    "SELECT provider, external_id, start_at, end_at, caller_name, caller_phone, reason, test FROM appointment_bookings WHERE user_id = $1 ORDER BY created_at, start_at",
    [userId],
  )).rows as any[];

// What the business's call looks like with booking off. Every "off" case below must match it exactly.
let baseline = "";

// ------------------------------------------------------------------------------------------------

describe("1. before anything is connected", () => {
  it("lists CalDAV as connectable, and nothing connected", async () => {
    const res = await call("GET", "/business/calendar", jane.auth);
    expect(res.status).toBe(200);
    const caldav = res.body.providers.find((p: any) => p.id === "caldav");
    expect(caldav).toMatchObject({ kind: "calendar", method: "caldav", status: "ready" });
    expect(res.body.connection).toBeNull();
    expect(res.body.bookings).toEqual([]);
  });

  it("offers no booking with appointments switched on but no calendar, and the rule book is untouched", async () => {
    const off = await preview();
    expect(off.status).toBe(200);
    expect(off.body.tools).not.toContain("check_availability");
    baseline = steady(off.body.live);
    expect(baseline).toContain("You are NOT the booking system");

    expect((await saveDraft(RULES)).status).toBe(200);
    const onButNothing = await preview();
    expect(onButNothing.body.tools).not.toContain("check_availability");
    expect(onButNothing.body.tools).not.toContain("book_appointment");
    expect(steady(onButNothing.body.live)).toBe(baseline);
    expect(onButNothing.body.live).not.toContain("# Appointments");
  });

  it("answers the test tool with 'no calendar' rather than failing", async () => {
    const res = await call("POST", "/business/calendar/tool", jane.auth, { name: "check_availability", args: {} });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: false, error: "No calendar is connected." });
    expect(res.body.instruction).toMatch(/take a message/);
  });
});

describe("2. connecting CalDAV", () => {
  it("refuses a wrong password in words a business can act on, and saves nothing", async () => {
    const res = await call("POST", "/business/calendar/connect", jane.auth, {
      provider: "caldav",
      credentials: { server: `${DAV}/`, username: DAV_USER, password: "wrong-password" },
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("calendar_auth");
    expect(res.body.message).toMatch(/didn't accept that sign-in/);
    expect(JSON.stringify(res.body)).not.toContain("wrong-password");
    expect((await call("GET", "/business/calendar", jane.auth)).body.connection).toBeNull();
  });

  it("refuses a plain-http server, a private host, and missing fields", async () => {
    const http = await call("POST", "/business/calendar/connect", jane.auth, {
      provider: "caldav",
      credentials: { server: "http://dav.fake-calendar.test/", username: DAV_USER, password: DAV_PASS },
    });
    expect(http.status).toBe(400);
    expect(http.body.message).toMatch(/https:\/\//);
    const lan = await call("POST", "/business/calendar/connect", jane.auth, {
      provider: "caldav",
      credentials: { server: "https://192.168.1.20/dav", username: DAV_USER, password: DAV_PASS },
    });
    expect(lan.status).toBe(400);
    expect(lan.body.message).toMatch(/isn't reachable/);
    const noPassword = await call("POST", "/business/calendar/connect", jane.auth, {
      provider: "caldav",
      credentials: { server: `${DAV}/`, username: DAV_USER },
    });
    expect(noPassword.status).toBe(400);
    expect(noPassword.body.message).toBe("Add the password.");
    const unknown = await call("POST", "/business/calendar/connect", jane.auth, { provider: "opentable", credentials: {} });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error).toBe("unknown_provider");
  });

  it("connects with the right password, picks the first event calendar, and never returns or stores the password", async () => {
    const res = await call("POST", "/business/calendar/connect", jane.auth, {
      provider: "caldav",
      credentials: { server: `${DAV}/`, username: DAV_USER, password: DAV_PASS },
    });
    expect(res.status).toBe(200);
    expect(res.body.connection).toMatchObject({
      provider: "caldav",
      providerName: "CalDAV calendar",
      account: DAV_USER,
      targetId: `${DAV}${WORK}`,
      targetName: "Work",
      status: "ok",
      lastError: null,
    });
    // The reminders list (VTODO) is not somewhere to book.
    expect(res.body.targets.map((t: any) => t.name)).toEqual(["Work", "Clinic"]);
    expect(JSON.stringify(res.body)).not.toContain(DAV_PASS);

    const listed = await call("GET", "/business/calendar", jane.auth);
    expect(listed.body.connection.account).toBe(DAV_USER);
    expect(JSON.stringify(listed.body)).not.toContain(DAV_PASS);

    const rows = (await db.query("SELECT secret FROM calendar_connections WHERE user_id = $1", [jane.id])).rows as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].secret).not.toContain(DAV_PASS);
    expect(rows[0].secret).not.toContain(DAV_USER);
  });
});

describe("3. choosing the calendar (an admin, onboarding Jane)", () => {
  it("lists the calendars on Jane's account", async () => {
    const res = await call("GET", `/business/calendar/targets?userId=${jane.id}`, admin.auth);
    expect(res.status).toBe(200);
    expect(res.body.targets).toEqual([
      { id: `${DAV}${WORK}`, name: "Work", primary: true },
      { id: `${DAV}${CLINIC}`, name: "Clinic" },
    ]);
    // The admin's own account has nothing connected.
    expect((await call("GET", "/business/calendar/targets", admin.auth)).status).toBe(404);
  });

  it("refuses a calendar that isn't on the account, and picks the clinic one", async () => {
    const bad = await call("PUT", `/business/calendar/target?userId=${jane.id}`, admin.auth, { targetId: `${DAV}/cal/someone-else/` });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("unknown_target");

    const res = await call("PUT", `/business/calendar/target?userId=${jane.id}`, admin.auth, { targetId: `${DAV}${CLINIC}` });
    expect(res.status).toBe(200);
    expect(res.body.connection).toMatchObject({ targetId: `${DAV}${CLINIC}`, targetName: "Clinic" });
    expect((await call("GET", "/business/calendar", jane.auth)).body.connection.targetName).toBe("Clinic");
  });
});

describe("4. booking rules in the call-settings draft", () => {
  it("refuses out-of-range values with the field named, and keeps the saved draft", async () => {
    const cases: [Record<string, unknown>, string, RegExp][] = [
      [{ durationMinutes: 1000 }, "appointments.durationMinutes", /between 5 and 480/],
      [{ durationMinutes: 2 }, "appointments.durationMinutes", /between 5 and 480/],
      [{ bufferMinutes: -5 }, "appointments.bufferMinutes", /between 0 and 240/],
      [{ minNoticeMinutes: "soon" }, "appointments.minNoticeMinutes", /whole number/],
      [{ minNoticeMinutes: 12.5 }, "appointments.minNoticeMinutes", /whole number/],
      [{ horizonDays: 0 }, "appointments.horizonDays", /between 1 and 180/],
      [{ horizonDays: 181 }, "appointments.horizonDays", /between 1 and 180/],
      [{ hours: [{ day: "Monday", open: "17:00", close: "09:00" }] }, "appointments.hours[0]", /end time has to be after/],
      [{ hours: [{ day: "", open: "09:00", close: "17:00" }] }, "appointments.hours[0]", /Pick a day/],
      [{ hours: [{ day: "Monday", open: "whenever", close: "17:00" }] }, "appointments.hours[0]", /Use times like/],
      [{ title: "x".repeat(81) }, "appointments.title", /at most 80/],
    ];
    for (const [bad, field, message] of cases) {
      const res = await saveDraft({ ...RULES, ...bad });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: "invalid_call_settings", field });
      expect(res.body.message).toMatch(message);
    }
    const kept = await call("GET", "/business/call-settings", jane.auth);
    expect(kept.body.draft.appointments.durationMinutes).toBe(30);
  });

  it("saves good rules, tidied, as a draft that callers don't get yet", async () => {
    const res = await saveDraft({ ...RULES, hours: [...WEEK].reverse().map((w) => ({ ...w, open: "9am", close: "5pm" })) });
    expect(res.status).toBe(200);
    expect(res.body.draft.appointments).toMatchObject({
      enabled: true,
      title: "Consultation",
      durationMinutes: 30,
      bufferMinutes: 15,
      minNoticeMinutes: 60,
      horizonDays: 30,
      instructions: "Ask if it's their first visit.",
    });
    expect(res.body.draft.appointments.hours[0]).toEqual({ day: "Monday", open: "09:00", close: "17:00" });
    expect(res.body.draft.appointments.hours).toHaveLength(7);
    expect(res.body.published).toBeNull();
    expect(res.body.dirty).toBe(true);
    expect(res.body.agentNumber).toBe(JANE_LINE);
  });
});

describe("5. what a call is told", () => {
  it("offers both tools and the booking rules once booking is on AND a calendar is connected", async () => {
    const res = await preview();
    expect(res.status).toBe(200);
    expect(res.body.tools).toEqual(expect.arrayContaining(["check_availability", "book_appointment", "take_message", "end_call"]));
    expect(res.body.live).toContain("# Appointments");
    expect(res.body.live).toContain("- You can book: Consultation.");
    expect(res.body.live).toContain("- Each one is 30 minutes.");
    expect(res.body.live).toContain("CalDAV calendar");
    expect(res.body.live).toContain("30 days ahead");
    expect(res.body.live).toContain("Ask if it's their first visit.");
    expect(res.body.live).toContain("BOOKING A NEW APPOINTMENT IS YOURS TO DO");
    expect(res.body.live).not.toContain("You are NOT the booking system");
    expect(res.body.backend).toContain("# Appointments");
    // Nothing is published, so the phone line is told nothing about booking.
    const phone = await preview("published");
    expect(phone.body.tools).not.toContain("book_appointment");
  });

  it("drops both tools and restores the exact rule book when appointments are switched off", async () => {
    expect((await saveDraft({ ...RULES, enabled: false })).status).toBe(200);
    const off = await preview();
    expect(off.body.tools).not.toContain("check_availability");
    expect(off.body.tools).not.toContain("book_appointment");
    expect(steady(off.body.live)).toBe(baseline);
    expect((await saveDraft(RULES)).status).toBe(200);
  });
});

describe("6. openings", () => {
  it("offers tomorrow morning only around the staff meeting plus its buffer (admin and customer alike)", async () => {
    const res = await call("POST", "/business/calendar/availability", jane.auth, { date: tomorrow, partOfDay: "morning" });
    expect(res.status).toBe(200);
    expect(res.body.timeZone).toBe(LA);
    // Hours 9–5, 30 minutes, 15 minutes kept clear of the 10–11 meeting: 9:30 would end inside the
    // gap, 10:00–11:00 are the meeting, 11:00 starts inside the gap after it.
    expect(res.body.openings.map((o: any) => `${o.start.slice(0, 10)} ${clock(o.start)}`)).toEqual([`${tomorrow} 09:00`, `${tomorrow} 11:30`]);
    expect(res.body.openings[0].spoken).toMatch(/ at 9:00 AM$/);
    const forJane = await call("POST", `/business/calendar/availability?userId=${jane.id}`, admin.auth, { date: tomorrow, partOfDay: "morning" });
    expect(forJane.body.openings).toEqual(res.body.openings);
  });

  it("keeps every opening inside the hours, clear of busy time, and past the minimum notice", async () => {
    const started = Date.now();
    const res = await call("POST", "/business/calendar/availability", jane.auth, {});
    expect(res.status).toBe(200);
    expect(res.body.openings.length).toBeGreaterThan(0);
    const meeting = { start: Date.parse(`${tomorrow}T10:00:00${res.body.openings[0].start.slice(19)}`) };
    for (const o of res.body.openings) {
      const at = Date.parse(o.start);
      expect(at).toBeGreaterThanOrEqual(started + 60 * 60_000 - 5_000);
      expect(at).toBeLessThanOrEqual(started + 30 * 86_400_000);
      const minute = zonedMinutes(at, LA);
      expect(minute).toBeGreaterThanOrEqual(9 * 60);
      expect(minute + 30).toBeLessThanOrEqual(17 * 60);
      if (o.start.startsWith(tomorrow)) {
        // Not within [9:45, 11:15) once the 15-minute gap is added round the 10–11 meeting.
        expect(at + 30 * 60_000 <= meeting.start - 15 * 60_000 || at >= meeting.start + 75 * 60_000).toBe(true);
      }
    }
  });

  it("honours a long minimum notice and a short horizon", async () => {
    expect((await saveDraft({ ...RULES, minNoticeMinutes: 20_160 })).status).toBe(200);
    const started = Date.now();
    const notice = await call("POST", "/business/calendar/availability", jane.auth, { date: tomorrow });
    expect(notice.body.openings).toEqual([]);
    expect(notice.body.nearest.length).toBeGreaterThan(0);
    for (const o of notice.body.nearest) expect(Date.parse(o.start)).toBeGreaterThanOrEqual(started + 14 * 86_400_000 - 5_000);

    expect((await saveDraft({ ...RULES, horizonDays: 1 })).status).toBe(200);
    const horizon = await call("POST", "/business/calendar/availability", jane.auth, { date: inThreeDays });
    expect(horizon.body.openings).toEqual([]);
    expect(horizon.body.nearest ?? []).toEqual([]);

    expect((await saveDraft(RULES)).status).toBe(200);
  });
});

describe("7. the in-app test call books for real, marked [Test]", () => {
  let nine = "";

  it("checks availability, then books an offered time", async () => {
    const check = await call("POST", "/business/calendar/tool", jane.auth, {
      name: "check_availability",
      args: { date: tomorrow, part_of_day: "morning" },
    });
    expect(check.status).toBe(200);
    expect(check.body.available).toBe(true);
    expect(check.body.openings.map((o: any) => clock(o.start))).toEqual(["09:00", "11:30"]);
    expect(check.body.note).toMatch(/Book only a start from this list/);
    nine = check.body.openings[0].start;

    const book = await call("POST", "/business/calendar/tool", jane.auth, {
      name: "book_appointment",
      args: { start: nine, caller_name: "Jo Kim", reason: "First visit" },
      callerNumber: "(206) 555-0188",
    });
    expect(book.status).toBe(200);
    expect(book.body).toMatchObject({ booked: true, what: "Consultation" });
    expect(book.body.when).toMatch(/ at 9:00 AM$/);
  });

  it("wrote a [Test] event into the chosen calendar", async () => {
    expect(puts).toHaveLength(1);
    const put = puts[0]!;
    expect(put.path.startsWith(CLINIC)).toBe(true);
    expect(put.path.endsWith(".ics")).toBe(true);
    expect(put.body).toContain("SUMMARY:[Test] Consultation: Jo Kim");
    expect(put.body).toContain(`DTSTART:${stamp(Date.parse(nine))}`);
    expect(put.body).toContain(`DTEND:${stamp(Date.parse(nine) + 30 * 60_000)}`);
    expect(put.body).toContain("during an in-app test call");
    expect(put.body).toContain("Phone: +12065550188");
  });

  it("recorded the booking as a test", async () => {
    const rows = await bookingRows(jane.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ provider: "caldav", caller_name: "Jo Kim", caller_phone: "+12065550188", reason: "First visit", test: true });
    expect(new Date(rows[0].start_at).getTime()).toBe(Date.parse(nine));
    expect(new Date(rows[0].end_at).getTime()).toBe(Date.parse(nine) + 30 * 60_000);
    expect(puts[0]!.body).toContain(`UID:${rows[0].external_id}`);
    const listed = await call("GET", "/business/calendar", jane.auth);
    expect(listed.body.bookings[0]).toMatchObject({ callerName: "Jo Kim", test: true, provider: "caldav" });
  });

  it("refuses the same time again, offering other openings", async () => {
    const again = await call("POST", "/business/calendar/tool", jane.auth, {
      name: "book_appointment",
      args: { start: nine, caller_name: "Someone Else" },
    });
    expect(again.body.booked).toBe(false);
    expect(again.body.message).toBe("That time is no longer open.");
    expect(again.body.other_openings.length).toBeGreaterThan(0);
    expect(again.body.other_openings.map((o: any) => o.start)).not.toContain(nine);
    expect(puts).toHaveLength(1);
    expect(await bookingRows(jane.id)).toHaveLength(1);
  });

  it("refuses a time outside the booking hours, and one that isn't a time at all", async () => {
    const early = nine.replace("T09:00", "T03:00");
    const res = await call("POST", "/business/calendar/tool", jane.auth, {
      name: "book_appointment",
      args: { start: early, caller_name: "Night Owl" },
    });
    expect(res.body.booked).toBe(false);
    expect(res.body.other_openings.length).toBeGreaterThan(0);

    const garbage = await call("POST", "/business/calendar/tool", jane.auth, {
      name: "book_appointment",
      args: { start: "next tuesday-ish", caller_name: "Vague" },
    });
    expect(garbage.body).toMatchObject({ ok: false, error: "That isn't a time from check_availability." });

    const unknown = await call("POST", "/business/calendar/tool", jane.auth, { name: "cancel_appointment", args: {} });
    expect(unknown.status).toBe(400);
    expect(puts).toHaveLength(1);
  });
});

describe("8. the phone agent books under the PUBLISHED rules", () => {
  // Found by this suite (2026-09-27): `bookingContext` fell back to the DRAFT when nothing had ever
  // been published, so the phone could book under rules nobody had published. Fixed in calendar.ts.
  it("refuses booking while the settings have never been published, even with the draft on", async () => {
    expect((await call("GET", "/business/call-settings", jane.auth)).body.published).toBeNull();
    for (const name of ["check_availability", "book_appointment"]) {
      const res = await agent({ to: JANE_LINE, name, args: { date: tomorrow } });
      expect(res.body).toMatchObject({ ok: false, error: "Booking is switched off for this business." });
    }
  });

  it("is shut without the key, or with the wrong one", async () => {
    const payload = { to: JANE_LINE, name: "check_availability", args: {} };
    expect((await agent(payload, null)).status).toBe(401);
    expect((await agent(payload, "wrong-key")).status).toBe(401);
    // A session token is not the agent's key.
    expect((await call("POST", "/business/calendar/agent-tool", jane.auth, payload)).status).toBe(401);
  });

  it("refuses booking when the draft has it on but the published copy has it off", async () => {
    expect((await saveDraft({ ...RULES, enabled: false })).status).toBe(200);
    const published = await call("POST", "/business/call-settings/publish", jane.auth);
    expect(published.status).toBe(200);
    expect(published.body.published.appointments.enabled).toBe(false);

    expect((await saveDraft(RULES)).status).toBe(200);
    for (const name of ["check_availability", "book_appointment"]) {
      const res = await agent({ to: JANE_LINE, name, args: { start: `${tomorrow}T11:30:00-07:00`, caller_name: "Sam" } });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: false, error: "Booking is switched off for this business." });
    }
    expect(puts).toHaveLength(1);
    // And the phone's composed session agrees.
    expect((await preview("published")).body.tools).not.toContain("check_availability");
    // While the in-app test call, on the draft, can still book.
    expect((await preview()).body.tools).toContain("check_availability");
  });

  it("books under the published rules once they are published, not marked [Test]", async () => {
    const published = await call("POST", "/business/call-settings/publish", jane.auth);
    expect(published.status).toBe(200);
    expect(published.body.published.appointments).toMatchObject({ enabled: true, title: "Consultation", durationMinutes: 30, bufferMinutes: 15 });
    expect((await preview("published")).body.tools).toEqual(expect.arrayContaining(["check_availability", "book_appointment"]));

    // A draft-only change the phone must NOT follow: an hour long, no gap, another name.
    expect((await saveDraft({ ...RULES, title: "Draft only", durationMinutes: 60, bufferMinutes: 0 })).status).toBe(200);
    const draftView = await call("POST", "/business/calendar/tool", jane.auth, {
      name: "check_availability",
      args: { date: tomorrow, part_of_day: "morning" },
    });
    expect(draftView.body.openings.map((o: any) => clock(o.start))).toEqual(["11:00", "11:30"]);

    // The dialled number arrives however the carrier formats it.
    const check = await agent({ to: "(206) 555-0100", name: "check_availability", args: { date: tomorrow, part_of_day: "morning" } });
    expect(check.status).toBe(200);
    expect(check.body.openings.map((o: any) => clock(o.start))).toEqual(["11:30"]);

    const book = await agent({
      to: JANE_LINE,
      name: "book_appointment",
      args: { start: check.body.openings[0].start, caller_name: "Sam Lee", reason: "Follow-up" },
      callerNumber: "+12065550199",
    });
    expect(book.body).toMatchObject({ booked: true, what: "Consultation" });

    expect(puts).toHaveLength(2);
    const put = puts[1]!;
    expect(put.path.startsWith(CLINIC)).toBe(true);
    expect(put.body).toContain("SUMMARY:Consultation: Sam Lee");
    expect(put.body).not.toContain("[Test]");
    expect(put.body).not.toContain("Draft only");
    expect(put.body).toContain("on a phone call");
    const start = Date.parse(check.body.openings[0].start);
    expect(put.body).toContain(`DTSTART:${stamp(start)}`);
    expect(put.body).toContain(`DTEND:${stamp(start + 30 * 60_000)}`);

    const rows = await bookingRows(jane.id);
    expect(rows).toHaveLength(2);
    const phoneRow = rows.find((r) => r.caller_name === "Sam Lee");
    expect(phoneRow).toMatchObject({ test: false, caller_phone: "+12065550199", reason: "Follow-up" });
  });

  it("answers 404 for a number nobody owns, and 400 for a tool it doesn't have", async () => {
    expect((await agent({ to: SPARE_LINE, name: "check_availability" })).status).toBe(404);
    expect((await agent({ to: "+12065550999", name: "check_availability" })).status).toBe(404);
    expect((await agent({ to: JANE_LINE, name: "transfer_call" })).status).toBe(400);
  });
});

describe("9. tenancy", () => {
  it("another customer sees nothing of Jane's calendar, even naming her account", async () => {
    for (const q of ["", `?userId=${jane.id}`]) {
      const res = await call("GET", `/business/calendar${q}`, bob.auth);
      expect(res.body.connection).toBeNull();
      expect(res.body.bookings).toEqual([]);
      expect(JSON.stringify(res.body)).not.toContain(DAV_USER);
      expect((await call("GET", `/business/calendar/targets${q}`, bob.auth)).status).toBe(404);
    }
  });

  it("another customer can't pick, check, book in or disconnect Jane's calendar", async () => {
    const q = `?userId=${jane.id}`;
    expect((await call("PUT", `/business/calendar/target${q}`, bob.auth, { targetId: `${DAV}${WORK}` })).status).toBe(404);
    const avail = await call("POST", `/business/calendar/availability${q}`, bob.auth, {});
    expect(avail.status).toBe(400);
    expect(avail.body.message).toBe("No calendar is connected.");
    const tool = await call("POST", `/business/calendar/tool${q}`, bob.auth, {
      name: "book_appointment",
      args: { start: `${tomorrow}T14:00:00-07:00`, caller_name: "Mallory" },
    });
    expect(tool.body).toMatchObject({ ok: false, error: "No calendar is connected." });
    // Their own line rings their own (empty) settings.
    expect((await agent({ to: BOB_LINE, name: "check_availability" })).body).toMatchObject({ ok: false });
    // A customer's DELETE is their own; Jane stays connected.
    await call("DELETE", `/business/calendar${q}`, bob.auth);
    expect((await call("GET", "/business/calendar", jane.auth)).body.connection.targetName).toBe("Clinic");
    // And Bob can't save rules into Jane's draft by naming her.
    await saveDraft({ ...RULES, title: "Hijacked" }, bob.auth, q);
    expect((await call("GET", "/business/call-settings", jane.auth)).body.draft.appointments.title).toBe("Draft only");

    expect(puts).toHaveLength(2);
    expect(await bookingRows(bob.id)).toEqual([]);
    expect(await bookingRows(jane.id)).toHaveLength(2);
  });

  it("an unauthenticated caller gets 401 everywhere", async () => {
    expect((await call("GET", "/business/calendar", null)).status).toBe(401);
    expect((await call("POST", "/business/calendar/tool", null, { name: "check_availability" })).status).toBe(401);
    expect((await call("POST", "/business/calendar/availability", null, {})).status).toBe(401);
  });
});

describe("10. disconnecting", () => {
  it("removes the connection (admin for Jane), and with it the tools and the booking rule text", async () => {
    const res = await call("DELETE", `/business/calendar?userId=${jane.id}`, admin.auth);
    expect(res.status).toBe(200);
    expect(res.body.connection).toBeNull();
    expect((await call("GET", "/business/calendar", jane.auth)).body.connection).toBeNull();
    expect((await db.query("SELECT 1 FROM calendar_connections WHERE user_id = $1", [jane.id])).rows).toHaveLength(0);

    // Back to the baseline draft so the rule book can be compared word for word.
    expect((await saveDraft(RULES)).status).toBe(200);
    const draft = await preview();
    expect(draft.body.tools).not.toContain("check_availability");
    expect(draft.body.tools).not.toContain("book_appointment");
    expect(steady(draft.body.live)).toBe(baseline);
    expect((await preview("published")).body.tools).not.toContain("book_appointment");
  });

  it("leaves the tools answering 'no calendar' instead of failing, and keeps the booking history", async () => {
    const tool = await call("POST", "/business/calendar/tool", jane.auth, { name: "check_availability", args: {} });
    expect(tool.body).toMatchObject({ ok: false, error: "No calendar is connected." });
    const phone = await agent({ to: JANE_LINE, name: "check_availability", args: {} });
    expect(phone.body).toMatchObject({ ok: false, error: "No calendar is connected." });
    expect((await call("GET", "/business/calendar", jane.auth)).body.bookings).toHaveLength(2);
  });
});
