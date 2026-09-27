import { afterAll, describe, expect, it, mock } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

// Calendar connections through the real routes against a real Postgres (PGlite), with the harness
// callSettings.pg.test.ts uses. The provider is Cal.com with `fetch` stubbed, so the whole path runs
// — connect, pick an event type, openings, a test booking, disconnect — without a network.
//
// Run: bun test src/routes/calendar.pg.test.ts
process.env.DATABASE_URL ??= "postgres://unused/unused";
process.env.AUTH_SECRET ??= "test-secret-test-secret-test-secret-0123";

const db = await PGlite.create();
// nested-fragment case is not decoration here — `setLifecycleById` leaves a column alone by
// assigning it to itself, and a shim that could not splice would silently test something else.
const FRAGMENT = Symbol("fragment");

// A fragment is recognised by its SHAPE, not by a private symbol.
//
// Module instances are shared across test files in one `bun test` run, while `mock.module` rebinds
// their imports retroactively. So `businessProfiles.ts`'s module-level COLUMNS list can have been
// built by another test file's tag and then be executed by this one's. A shim that recognised only
// its own symbol treated that list as a VALUE, and the query became `SELECT $1 FROM ...` — which
// fails in a way that looks like a bug in the route. Anything carrying a template's `strings` and
// `values` is a fragment, whoever made it.
const isFragment = (value: any): boolean =>
  Boolean(value) &&
  typeof value === "object" &&
  Array.isArray(value.strings) &&
  Array.isArray(value.values) &&
  "raw" in value.strings;

// postgres.js decides a parameter's wire text with `options.serializers[type](x)` (connection.js),
// and `sql.json(x)` tags the parameter as OID 3802. Reproducing that here — with postgres.js's real
// serializer table — is what makes these tests able to catch a double-encoded JSON value.
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

// initDb closes over client.ts's own `sql`, so mocking the module cannot redirect it. Run the real
// DDL text instead, lifted out of the source — which is the point: these are the real statements,
// including the CHECK constraint and the unique partial index this file leans on.
const source = await Bun.file("src/db/client.ts").text();
const body = source.slice(source.indexOf("export async function initDb"), source.indexOf("// On Vercel"));
for (const [, statement = ""] of body.matchAll(/sql`([\s\S]*?)`/g)) {
  try {
    await db.exec(statement);
  } catch (error) {
    throw new Error(`DDL failed: ${statement.trim().slice(0, 90)}\n${(error as Error).message}`);
  }
}

// ----------------------------------------------------------------------------------------------
// The callers, as real accounts with real session tokens.
//
// NOT a stubbed guard. `mock.module` replaces a module for the whole test run, so a stand-in for
// `auth/guard.js` here is the guard every later test file gets too — which is fine until one of them
// is about authorization, and then it silently tests the stand-in. Minting a token is two lines
// against the users table this file already has, and it costs one query per request.
const { createUser } = await import("../db/users.js");
const { createToken } = await import("../auth/session.js");

async function bearerFor(email: string, role: "admin" | "user"): Promise<string> {
  const user = (await createUser({
    email,
    name: email,
    // Never verified on this path — the token is signed, and a request carries no password.
    passwordHash: "x".repeat(60),
    role,
  }))!;
  return `Bearer ${createToken(user.id, user.tokenVersion).token}`;
}

const JANE = await bearerFor("jane.cal@tecace.com", "user");
const BOB = await bearerFor("bob.cal@tecace.com", "user");

const { app } = await import("../app.js");

async function call(method: string, path: string, auth: string, body?: unknown) {
  const response = await app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: { authorization: auth, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  return { status: response.status, body: (await response.json()) as any };
}

// Cal.com, as far as these routes can tell. Tomorrow at 10:00 and 10:30 in Los Angeles are open.
const realFetch = globalThis.fetch;
const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const openAt = `${tomorrow}T17:00:00.000Z`;
const calls: { url: string; body: any }[] = [];
globalThis.fetch = (async (input: any, init?: RequestInit) => {
  const url = String(input);
  if (!url.startsWith("https://api.cal.com/")) return realFetch(input, init);
  const body = init?.body ? JSON.parse(String(init.body)) : null;
  calls.push({ url, body });
  if ((init?.headers as any)?.authorization !== "Bearer cal_live_good") {
    return Response.json({ error: { message: "bad key" } }, { status: 401 });
  }
  const path = new URL(url).pathname;
  if (path === "/v2/me") return Response.json({ data: { email: "jane@glow.example" } });
  if (path === "/v2/event-types") return Response.json({ data: [{ id: 7, title: "Intro call", lengthInMinutes: 30 }] });
  if (path === "/v2/slots") {
    return Response.json({ data: { [tomorrow]: [{ start: openAt }, { start: `${tomorrow}T17:30:00.000Z` }] } });
  }
  if (path === "/v2/bookings") return Response.json({ status: "success", data: { uid: "bk_1", start: body.start, end: body.start } });
  return new Response("", { status: 404 });
}) as typeof fetch;

afterAll(async () => {
  globalThis.fetch = realFetch;
  await db.close();
});

describe("calendar connections", () => {
  it("lists what can be connected, and nothing connected yet", async () => {
    const res = await call("GET", "/business/calendar", JANE);
    expect(res.status).toBe(200);
    const status = Object.fromEntries(res.body.providers.map((p: any) => [p.id, p.status]));
    expect(status["apple-calendar"]).toBe("ready");
    expect(status["cal-com"]).toBe("ready");
    expect(status["google-calendar"]).toBe("needs_setup"); // no OAuth app in the test env
    expect(status.opentable).toBe("soon");
    expect(res.body.connection).toBeNull();
  });

  it("refuses a CalDAV server inside our own network, and a key the provider rejects", async () => {
    const local = await call("POST", "/business/calendar/connect", JANE, {
      provider: "caldav",
      credentials: { server: "https://localhost/dav", username: "a", password: "b" },
    });
    expect(local.status).toBe(400);
    expect(local.body.message).toMatch(/isn't reachable/);
    const bad = await call("POST", "/business/calendar/connect", JANE, { provider: "cal-com", credentials: { apiKey: "nope" } });
    expect(bad.status).toBe(400);
    expect((await call("GET", "/business/calendar", JANE)).body.connection).toBeNull();
  });

  it("connects Cal.com with a key, picks the event type, and never returns or stores the key in the clear", async () => {
    const res = await call("POST", "/business/calendar/connect", JANE, {
      provider: "cal-com",
      credentials: { apiKey: "cal_live_good" },
    });
    expect(res.status).toBe(200);
    expect(res.body.connection).toMatchObject({
      provider: "cal-com",
      account: "jane@glow.example",
      targetName: "Intro call",
      status: "ok",
    });
    expect(JSON.stringify(res.body)).not.toContain("cal_live_good");
    const [row] = (await db.query("SELECT secret FROM calendar_connections")).rows as any[];
    expect(row.secret).not.toContain("cal_live_good");
    // Someone else's account sees nothing of it.
    expect((await call("GET", "/business/calendar", BOB)).body.connection).toBeNull();
  });

  it("finds openings and makes a real (test) booking through the tool a test call uses", async () => {
    const check = await call("POST", "/business/calendar/tool", JANE, { name: "check_availability", args: {} });
    expect(check.status).toBe(200);
    expect(check.body.available).toBe(true);
    expect(Date.parse(check.body.openings[0].start)).toBe(Date.parse(openAt));
    const book = await call("POST", "/business/calendar/tool", JANE, {
      name: "book_appointment",
      args: { start: check.body.openings[0].start, caller_name: "Jo Kim", reason: "First visit" },
      callerNumber: "+12065550188",
    });
    expect(book.body).toMatchObject({ booked: true });
    const sent = calls.find((c) => c.url.endsWith("/v2/bookings"))!.body;
    expect(sent).toMatchObject({
      eventTypeId: 7,
      start: openAt,
      attendee: { name: "Jo Kim", email: "jane@glow.example", phoneNumber: "+12065550188" },
    });
    const listed = await call("GET", "/business/calendar", JANE);
    expect(listed.body.bookings[0]).toMatchObject({ callerName: "Jo Kim", reason: "First visit", test: true });
  });

  it("refuses a time that isn't open, offering the ones that are", async () => {
    const res = await call("POST", "/business/calendar/tool", JANE, {
      name: "book_appointment",
      args: { start: `${tomorrow}T03:00:00-07:00`, caller_name: "Jo" },
    });
    expect(res.body.booked).toBe(false);
    expect(res.body.other_openings.length).toBeGreaterThan(0);
  });

  it("saves the booking rules as part of the draft", async () => {
    const saved = await call("PUT", "/business/call-settings", JANE, {
      draft: { appointments: { enabled: true, title: "Intro call" } },
    });
    expect(saved.status).toBe(200);
    expect(saved.body.draft.appointments).toMatchObject({ enabled: true, title: "Intro call", durationMinutes: 30 });
    expect(saved.body.dirty).toBe(true);
  });

  it("keeps the OAuth ones shut until the server has an app for them, and the agent route behind its key", async () => {
    const start = await call("POST", "/business/calendar/oauth/start", JANE, {
      provider: "google-calendar",
      returnTo: "http://localhost:5175/",
    });
    expect(start.status).toBe(409);
    const agent = await call("POST", "/business/calendar/agent-tool", "", { to: "+12065550100", name: "check_availability" });
    expect(agent.status).toBe(401);
    const callback = await app.handle(new Request("http://localhost/calendar/oauth/google/callback?code=x&state=forged.sig"));
    expect(callback.status).toBe(400);
  });

  it("disconnects", async () => {
    expect((await call("DELETE", "/business/calendar", JANE)).body.connection).toBeNull();
    expect((await call("GET", "/business/calendar", JANE)).body.connection).toBeNull();
  });
});
