import { afterAll, describe, expect, it, mock } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

// Every Demo endpoint, driven as the dashboard drives it, against a real Postgres: PGlite behind
// `db/client.js`, the real DDL out of `client.ts`, the real importer for the seed, and the real
// Elysia app. Nothing between the request and the rows is a stand-in — which is the point, because
// what these routes are is the promo's shaping over `demoRead`/`demoWrite`, and a mocked data layer
// would only pin that the shaping calls the mock.
//
// The one stand-in is the auth guard, exactly as `src/routes/usage.test.ts` does it: an admin, a
// signed-in non-admin and an anonymous caller all have to reach the same app, and minting three
// real sessions would test `auth/session.ts` over again rather than these routes. The denial shapes
// below are `auth/guard.ts`'s own, 401 body and 403 body, so a route that forwards them is
// forwarding what the rest of this API sends.
//
// Run: bun test src/routes/demo.pg.test.ts
process.env.DATABASE_URL ??= "postgres://unused/unused";
process.env.AUTH_SECRET ??= "test-secret-test-secret-test-secret-0123";

const db = await PGlite.create();

// A postgres.js-shaped tagged template over PGlite: it builds $1..$n and splices a nested fragment
// (sql`TRUE`) as text with its values merged, which is what postgres.js itself does.
const FRAGMENT = Symbol("fragment");

// A fragment is recognised by its SHAPE, not by the private symbol above.
//
// Module instances are shared across the files of one `bun test` run, while `mock.module` rebinds
// their imports. So `db/users.ts`'s module-level COLUMNS list can have been built by ANOTHER test
// file's tag and still be executed here. Recognising only our own symbol bound that list as a value
// — `RETURNING $1`, a row with no columns — which surfaces wherever the row is next read and looks
// nothing like its cause.
const isFragment = (value: any): boolean =>
  Boolean(value) &&
  typeof value === "object" &&
  Array.isArray(value.strings) &&
  Array.isArray(value.values) &&
  "raw" in value.strings;

// postgres.js decides a parameter's wire text with `options.serializers[type](x)`
// (connection.js), and `sql.json(x)` tags the parameter as OID 3802. Reproducing that here —
// with postgres.js's real serializer table — is what makes these tests able to catch a
// double-encoded JSON value, which a shim that forwarded raw values could not.
// Resolved relative to this file: postgres.js does not export its internals through package
// "exports", and the specifier is built at runtime so tsc does not try to resolve it.
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
  // postgres.js's own `sql.json(x)` is `new Parameter(x, 3802)`; `bind()` above then runs the
  // driver's jsonb serializer over it, exactly as connection.js does.
  json: (value: unknown) => ({ value, type: 3802 }),
  end: async () => {},
});

await mock.module("../db/client.js", () => ({
  sql: sqlShim,
  initDb: async () => {},
  ensureDbReady: async () => {},
}));

// initDb closes over client.ts's own `sql`, so mocking the module cannot redirect it. Run the real
// DDL text instead, lifted out of the source — which is the point: these are the real statements.
const source = await Bun.file("src/db/client.ts").text();
const body = source.slice(source.indexOf("export async function initDb"), source.indexOf("// On Vercel"));
// The `= ""` default is for `noUncheckedIndexedAccess`: a destructured capture group is typed
// `string | undefined` even though a match always has one.
for (const [, statement = ""] of body.matchAll(/sql`([\s\S]*?)`/g)) {
  try {
    await db.exec(statement);
  } catch (error) {
    throw new Error(`DDL failed: ${statement.trim().slice(0, 90)}\n${(error as Error).message}`);
  }
}


// ----------------------------------------------------------------------------------------------
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

const ADMIN = await bearerFor("admin@tecace.com", "admin");
const NON_ADMIN = await bearerFor("jane@tecace.com", "user");

// ----------------------------------------------------------------------------------------------
// The seed, in the shape `demoImport.pg.test.ts` uses — the promo's own Redis export — so the rows
// under these routes were written by the real importer rather than by hand-rolled INSERTs that
// could agree with the loaders about a mistake.
//
// Instants are relative to now because the analytics window by them: a fixed date would drift out
// of the 30 day window and quietly turn every KPI assertion into a zero.
const hoursAgo = (n: number) => new Date(Date.now() - n * 3_600_000).toISOString();

const A = "aaaaaaaaaaaa"; // Harbor Dental — stage "interested", one real call and one test call
const B = "bbbbbbbbbbbb"; // Cedar Bakery  — NO stage at all, one real call 45 days back

const customer = (id: string, businessName: string, extra: Record<string, unknown>) => ({
  type: "string",
  ttl: -1,
  value: {
    id, businessName, active: true, profile: { name: businessName }, dossier: "# " + businessName,
    sources: [{ url: "https://example.test" }], prompts: { live: "You are Alex", edited: false },
    voice: "gleam", agentName: "Alex", status: "ready",
    ...extra,
  },
});

const call = (id: string, customerId: string, extra: Record<string, unknown>) => ({
  type: "string",
  ttl: -1,
  value: {
    id, customerId, status: "completed", isTest: false,
    transcript: [{ id: "t1", speaker: "caller", text: "Hi", startMs: 0, endMs: 900 }],
    ...extra,
  },
});

const C1_AT = hoursAgo(24);
const NOTE_AT = hoursAgo(2);

const DUMP = {
  data: {
    customers: { type: "set", ttl: -1, value: [A, B] },
    [`customers:${A}`]: customer(A, "Harbor Dental", {
      stage: "interested",
      contactName: "Dana Reed",
      contactEmail: "dana@harbor.test",
      createdAt: "2026-09-20T04:40:00.000Z",
      updatedAt: "2026-09-20T04:41:00.000Z",
    }),
    // No `stage` key at all: the case the whole `normalize()` default exists for.
    [`customers:${B}`]: customer(B, "Cedar Bakery", {
      createdAt: "2026-09-19T04:40:00.000Z",
      updatedAt: "2026-09-19T04:41:00.000Z",
    }),
    [`calls:${A}:c1`]: call("c1", A, {
      startedAt: C1_AT, endedAt: hoursAgo(23.9), durationSec: 120, turns: 22, visitorId: "v1",
      review: { sentiment: "happy" },
    }),
    [`calls:${A}:c2`]: call("c2", A, {
      startedAt: hoursAgo(48), endedAt: hoursAgo(47.9), durationSec: 60, turns: 8, isTest: true,
    }),
    [`calls:${B}:c3`]: call("c3", B, {
      startedAt: hoursAgo(45 * 24), endedAt: hoursAgo(45 * 24 - 0.1), durationSec: 180, turns: 30,
    }),
    // The legacy global list and a per-customer one, so both event eras are under the routes.
    events: {
      type: "list", ttl: -1,
      value: [JSON.stringify({ type: "page_view", customerId: A, at: hoursAgo(20), ipHash: "ee5c" })],
    },
    [`events:${B}`]: {
      type: "list", ttl: -1,
      value: [{ type: "page_view", customerId: B, at: hoursAgo(45 * 24 + 1), visitorId: "229f" }],
    },
    [`notes:${A}`]: {
      type: "list", ttl: -1,
      value: [{ id: "n1", at: NOTE_AT, text: "Called back" }],
    },
  },
};

const { parseDump } = await import("../demo/dump.js");
const { importDump } = await import("../db/demoImport.js");
expect(await importDump(parseDump(DUMP))).toEqual({ customers: 2, calls: 3, events: 2, notes: 1 });

// What a prospect with no stored figure is treated as having. Imported rather than written out as
// 10, so the top-up tests measure the route against the constant the route itself reads.
const { DEFAULT_DEMO_MINUTES } = await import("../demo/types.js");

const { PROMPT_VERSION } = await import("../demo/prompt.js");
const { demo, pendingResearch } = await import("./demo.js");
const { Elysia } = await import("elysia");
const app = new Elysia().use(demo);

// ----------------------------------------------------------------------------------------------
// The network boundary, closed — because `POST /demo/customers` now fires a research run in the
// background and a research run is two billable model calls. **No request leaves this process.**
// Bun loads the developer's own `.env` at startup, so a real `OPENAI_API_KEY` could otherwise be
// picked up and spent by running the test suite. Two belts: the base URL is pointed somewhere that
// does not exist, and `fetch` is replaced with a stub that records the attempt and refuses.
//
// Research itself is covered properly in `demoResearch.pg.test.ts`. Here it only has to not escape
// and not race — every create below is followed by `await pendingResearch()`, so the run is over
// before the next assertion reads the row.
const { env } = await import("../config/env.js");
const settings = env as unknown as Record<string, unknown>;
Object.assign(settings, {
  openaiApiKey: "sk-test-not-a-real-key",
  openaiBaseUrl: "https://openai.invalid/v1",
});

const realFetch = globalThis.fetch;
const attempts: string[] = [];
globalThis.fetch = (async (input: any) => {
  const url =
    typeof input === "string" ? input : input instanceof URL ? input.href : String(input?.url);
  attempts.push(url);
  return new Response(JSON.stringify({ error: { message: `refused: ${url}` } }), {
    status: 599,
    headers: { "content-type": "application/json" },
  });
}) as unknown as typeof fetch;

afterAll(() => {
  globalThis.fetch = realFetch;
});

// `Response.json()` is typed `unknown`; these are our own fixtures, so read them as records (same
// pattern as ../auth/auth.test.ts).
const json = (res: Response): Promise<Record<string, any>> => res.json() as Promise<Record<string, any>>;

const request = (method: string, path: string, opts: { auth?: string; body?: unknown } = {}) => {
  const headers: Record<string, string> = { accept: "application/json" };
  if (opts.auth !== undefined) headers.authorization = opts.auth;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  return app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers,
      ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
    }),
  );
};

/** The admin's own request — what the dashboard sends. */
const asAdmin = (method: string, path: string, payload?: unknown) =>
  request(method, path, { auth: ADMIN, body: payload });

const countOf = async (table: string) =>
  Number(((await db.query(`SELECT count(*)::int AS n FROM ${table}`)).rows as any[])[0].n);

// ==============================================================================================
// The reads. These run before anything writes, so the numbers below are the seed's and only the
// seed's.

describe("GET /demo/analytics", () => {
  it("answers with the promo's eight fields, windowed to 30 days by default", async () => {
    const res = await asAdmin("GET", "/demo/analytics");
    const payload = await json(res);
    expect(res.status).toBe(200);
    // Not sorted: the screens read these by name, and the order is the promo's own.
    expect(Object.keys(payload)).toEqual([
      "kpis", "window", "callsPerDay", "topCustomers", "recentCalls",
      "realCallCount", "testCallCount", "includeTests",
    ]);

    // Inside the 30 day window: c1 (real, 120s) and c2 (a test call, so not counted); c3 is 45
    // days back. The customer count is all-time — the promo's KPI row says how many prospects
    // exist, not how many were busy.
    expect(payload.kpis).toEqual({
      customers: 2,
      testedCustomers: 1,
      totalCalls: 1,
      totalMinutes: 2,
      avgCallSec: 120,
      totalViews: 1,
    });
    expect(payload.window).toBe(30);
    expect(payload.includeTests).toBe(false);
    expect(payload.realCallCount).toBe(2); // all-time: c1 and c3
    expect(payload.testCallCount).toBe(1); // in the window: c2

    expect(payload.callsPerDay).toHaveLength(30);
    expect(Object.keys(payload.callsPerDay[0])).toEqual(["date", "calls", "minutes"]);

    expect(payload.topCustomers).toEqual([{ id: A, name: "Harbor Dental", minutes: 2, calls: 1 }]);

    // Newest first, across every prospect — the Overview's recent-calls list is the first 20 of
    // exactly this order.
    expect(payload.recentCalls.map((c: any) => c.id)).toEqual(["c1", "c2", "c3"]);
    expect(payload.recentCalls[0]).toEqual({
      id: "c1",
      customerId: A,
      customerName: "Harbor Dental",
      contactName: "Dana Reed",
      startedAt: C1_AT,
      durationSec: 120,
      status: "completed",
      isTest: false,
      turns: 22,
    });
  });

  it("widens to 90 days when asked, picking up the older prospect", async () => {
    const payload = await json(await asAdmin("GET", "/demo/analytics?days=90"));
    expect(payload.window).toBe(90);
    expect(payload.kpis).toEqual({
      customers: 2,
      testedCustomers: 2,
      totalCalls: 2,
      totalMinutes: 5, // 120s + 180s
      avgCallSec: 150,
      totalViews: 2,
    });
    // Sorted by minutes, so Cedar's one longer call outranks Harbor's.
    expect(payload.topCustomers.map((t: any) => t.id)).toEqual([B, A]);
  });

  it("falls back to 30 for a window it does not recognise", async () => {
    expect((await json(await asAdmin("GET", "/demo/analytics?days=13"))).window).toBe(30);
    expect((await json(await asAdmin("GET", "/demo/analytics?days=nonsense"))).window).toBe(30);
  });

  it("counts the operator's own test calls when includeTests=1", async () => {
    const payload = await json(await asAdmin("GET", "/demo/analytics?days=90&includeTests=1"));
    expect(payload.includeTests).toBe(true);
    expect(payload.kpis).toMatchObject({ totalCalls: 3, totalMinutes: 6, avgCallSec: 120 });
    // What is being left out is still reported, so a zero can explain itself.
    expect(payload.testCallCount).toBe(1);
  });
});

describe("GET /demo/customers", () => {
  it("returns every prospect newest first, each with its all-time stats and heat", async () => {
    const res = await asAdmin("GET", "/demo/customers");
    const payload = await json(res);
    expect(res.status).toBe(200);
    expect(Object.keys(payload)).toEqual(["customers"]);
    expect(payload.customers.map((c: any) => c.id)).toEqual([A, B]); // created_at DESC

    const harbor = payload.customers[0];
    expect(harbor.businessName).toBe("Harbor Dental");
    expect(harbor.profile).toEqual({ name: "Harbor Dental" });
    expect(harbor.stats).toMatchObject({ views: 1, calls: 1, totalSec: 120 });
    expect(Object.keys(harbor.heat).sort()).toEqual(["level", "reason", "score"]);
    expect(payload.customers[1].stats).toMatchObject({ views: 1, calls: 1, totalSec: 180 });
  });
});

describe("GET /demo/customers/:id", () => {
  it("returns the record, its stats, and its calls, views and notes", async () => {
    const res = await asAdmin("GET", `/demo/customers/${A}`);
    const payload = await json(res);
    expect(res.status).toBe(200);
    expect(Object.keys(payload)).toEqual(["customer", "stats", "calls", "events", "notes"]);
    expect(payload.customer.id).toBe(A);
    expect(payload.stats).toMatchObject({ views: 1, calls: 1, totalSec: 120 });
    expect(payload.calls.map((c: any) => c.id)).toEqual(["c1", "c2"]); // newest first
    expect(payload.calls[0].review).toEqual({ sentiment: "happy" });
    expect(payload.events).toHaveLength(1);
    expect(payload.events[0]).toMatchObject({ customerId: A, type: "page_view", ipHash: "ee5c" });
    expect(payload.notes).toEqual([{ id: "n1", at: NOTE_AT, text: "Called back" }]);
  });

  it("404s on an id that is not there, in the promo's error shape", async () => {
    const res = await asAdmin("GET", "/demo/customers/nosuchcustomer");
    expect(res.status).toBe(404);
    expect(await json(res)).toEqual({ error: "Customer not found." });
  });
});

describe("GET /demo/crm", () => {
  it("returns the board's customers and one activity feed across all of them", async () => {
    const res = await asAdmin("GET", "/demo/crm");
    const payload = await json(res);
    expect(res.status).toBe(200);
    expect(Object.keys(payload)).toEqual(["customers", "feed"]);
    expect(payload.customers.map((c: any) => c.id)).toEqual([A, B]);
    expect(payload.customers[0].stats).toMatchObject({ calls: 1, totalSec: 120 });

    // Harbor's note, view and two calls, plus Cedar's view and call — newest first.
    expect(payload.feed).toHaveLength(6);
    expect(payload.feed.map((entry: any) => entry.kind)).toEqual([
      "note", "view", "call", "call", "call", "view",
    ]);
    expect(payload.feed[0]).toMatchObject({
      kind: "note", text: "Called back", customerId: A, customerName: "Harbor Dental",
    });
    expect(payload.feed[2]).toMatchObject({ kind: "call", callId: "c1", text: "Called · 2:00 · 22 turns" });
    expect(payload.feed[3]).toMatchObject({
      kind: "call", callId: "c2", text: "Your test call · 1:00 · 8 turns",
    });
  });
});

// The one piece of the promo's read-time normalize() that this data needs. Two of the ten real
// customers carry no stage, and the CRM board's columns and the drawer's stage select both read
// the field directly — a missing one puts a prospect in no column at all.
describe("a customer saved before stages existed", () => {
  it("really has a NULL stage in the row, not an empty string", async () => {
    const rows = (await db.query(`SELECT id, stage FROM demo_customers ORDER BY id`)).rows as any[];
    expect(rows).toEqual([{ id: A, stage: "interested" }, { id: B, stage: null }]);
  });

  it('reads back as stage "new" from GET /demo/customers', async () => {
    const payload = await json(await asAdmin("GET", "/demo/customers"));
    // Harbor's real stage is asserted alongside, so a handler that simply hard-coded "new" fails.
    expect(payload.customers.map((c: any) => [c.id, c.stage])).toEqual([
      [A, "interested"],
      [B, "new"],
    ]);
  });

  it('reads back as stage "new" from GET /demo/customers/:id', async () => {
    expect((await json(await asAdmin("GET", `/demo/customers/${B}`))).customer.stage).toBe("new");
    expect((await json(await asAdmin("GET", `/demo/customers/${A}`))).customer.stage).toBe("interested");
  });
});

// The other half of read-time normalize(), and the one with the wider blast radius: the source
// rebuilds any prompt nobody has edited whose version is behind PROMPT_VERSION. Eight of the ten
// real imported customers are in exactly that state (versions 3, 4 and none), so without this they
// would show — and dial with — text the source would have refreshed. The fixtures above carry
// `{ live: "You are Alex", edited: false }` and no version, which is that case.
describe("a prompt nobody has edited", () => {
  it("is stale in the row, and rebuilt on the way out", async () => {
    const [row] = (await db.query(
      `SELECT prompts->>'live' AS live, prompts->>'edited' AS edited, prompts->>'version' AS version
       FROM demo_customers WHERE id = $1`,
      [A],
    )).rows as any[];
    // What is stored: the stale text, unedited, no version.
    expect(row).toEqual({ live: "You are Alex", edited: "false", version: null });

    const { customer } = await json(await asAdmin("GET", `/demo/customers/${A}`));
    expect(customer.prompts.version).toBe(PROMPT_VERSION);
    expect(customer.prompts.live).not.toBe("You are Alex");
    // Rebuilt from this business's own profile, not from a template with the name left out.
    expect(customer.prompts.live).toContain("Harbor Dental");
    expect(customer.prompts.edited).toBe(false);
  });

  it("is rebuilt in the list too, not only on the detail read", async () => {
    const { customers } = await json(await asAdmin("GET", "/demo/customers"));
    for (const c of customers) {
      expect(c.prompts.version).toBe(PROMPT_VERSION);
      expect(c.prompts.live).not.toBe("You are Alex");
    }
  });

  it("leaves a hand-edited prompt exactly as stored", async () => {
    // A PATCH carrying prompt text is what marks a prompt edited, and from then on it is the
    // operator's wording — the rebuild must never overwrite it.
    const written = "You are Dana, and this sentence was typed by a person.";
    await asAdmin("PATCH", `/demo/customers/${B}`, { prompts: { live: written } });

    const { customer } = await json(await asAdmin("GET", `/demo/customers/${B}`));
    expect(customer.prompts.edited).toBe(true);
    expect(customer.prompts.live).toBe(written);
  });
});

// ==============================================================================================
// Who gets in. Demo data is every prospect's contact details and call transcripts, so this is the
// whole access story for four tabs: a read and a write are each checked, because the guard is
// per-handler and a route added without one is how this leaks.

describe("the admin guard", () => {
  // Two shapes of refusal, because two of these handlers are shared with the customer whose record
  // it is (`GET` and `PATCH /demo/customers/:id`, see `auth/guard.ts`'s `authenticateDemo`). A plain
  // non-admin — no demo stage, no demo record — is refused by either, and the message says which
  // door was shut. Everything else on this file is the operator's pipeline and has no customer
  // version at all.
  const OPERATOR_ONLY = "Only an admin can read the demo data.";
  const NOT_YOURS = "Only an admin can read other customers' demos.";
  const reads: [string, string, string][] = [
    ["GET", "/demo/analytics", OPERATOR_ONLY],
    ["GET", "/demo/customers", OPERATOR_ONLY],
    ["GET", `/demo/customers/${A}`, NOT_YOURS],
    ["GET", "/demo/crm", OPERATOR_ONLY],
    ["GET", `/demo/customers/${A}/notes`, OPERATOR_ONLY],
  ];
  const writes: [string, string, unknown][] = [
    ["POST", "/demo/customers", { businessName: "Sneaky Co" }],
    ["PATCH", `/demo/customers/${A}`, { label: "sneaky" }],
    ["DELETE", `/demo/customers/${A}`, undefined],
    ["POST", `/demo/customers/${A}/notes`, { text: "sneaky" }],
    ["PATCH", `/demo/customers/${A}/calls`, { callId: "c1", isTest: true }],
  ];

  for (const [method, path, message] of reads) {
    it(`refuses a signed-in non-admin on ${method} ${path} with 403`, async () => {
      const res = await request(method, path, { auth: NON_ADMIN });
      expect(res.status).toBe(403);
      expect(await json(res)).toEqual({ error: "forbidden", message });
    });
  }

  for (const [method, path, payload] of writes) {
    it(`refuses a signed-in non-admin on ${method} ${path} with 403`, async () => {
      const res = await request(method, path, { auth: NON_ADMIN, body: payload });
      expect(res.status).toBe(403);
      expect((await json(res)).error).toBe("forbidden");
    });
  }

  it("refuses a caller with no token at all with 401, on a read and on a write", async () => {
    const read = await request("GET", "/demo/customers");
    expect(read.status).toBe(401);
    expect(await json(read)).toEqual({ error: "unauthorized", message: "Sign in to continue." });

    const write = await request("PATCH", `/demo/customers/${A}`, { body: { label: "sneaky" } });
    expect(write.status).toBe(401);
    expect((await json(write)).error).toBe("unauthorized");
  });

  it("wrote nothing while refusing all of that", async () => {
    expect(await countOf("demo_customers")).toBe(2);
    expect(await countOf("demo_notes")).toBe(1);
    expect((await db.query(`SELECT is_test FROM demo_calls WHERE id = 'c1'`)).rows[0])
      .toEqual({ is_test: false });
  });
});

// ==============================================================================================
// The writes.

/** Filled by the POST test and used by the PATCH ones, so the seed's numbers above stay untouched. */
let madeId = "";

describe("POST /demo/customers", () => {
  it("creates one and answers 201 { customer }", async () => {
    const res = await asAdmin("POST", "/demo/customers", {
      businessName: "  Pine Clinic  ",
      contactEmail: " dana@pine.test ",
      websiteUrl: "https://pine.test",
      label: "   ",
      language: "klingon",
    });
    const created = (await json(res)).customer;
    expect(res.status).toBe(201);
    expect(created.businessName).toBe("Pine Clinic"); // trimmed on the way in
    expect(created.contactEmail).toBe("dana@pine.test");
    expect(created.label).toBeUndefined(); // whitespace is no value at all
    expect(created.language).toBe("en"); // an unknown code opens in English
    expect(created.agentName).toBe("Alex");
    expect(created.voice).toBe("gleam");
    // The promo's own status for a record whose research has just been fired and has not landed.
    expect(created.status).toBe("researching");
    expect(created.profile.name).toBe("Pine Clinic");
    expect(created.id).toMatch(/^[A-Za-z0-9_-]{12}$/); // the promo's nanoid shape
    madeId = created.id;
    // The background run the 201 did not wait for. Let it finish — with `fetch` stubbed it fails
    // and lands the record on "error" — so the PATCH tests below are not racing it. What the run
    // does when it succeeds is `demoResearch.pg.test.ts`'s subject, not this file's.
    await pendingResearch();
  });

  it("refuses a blank business name with the promo's 400", async () => {
    const res = await asAdmin("POST", "/demo/customers", { businessName: "   " });
    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({ error: "Enter the business name." });
  });

  it("refuses a website with no scheme and a link that is not Google Maps", async () => {
    const site = await asAdmin("POST", "/demo/customers", {
      businessName: "X", websiteUrl: "pine.test",
    });
    expect(site.status).toBe(400);
    expect(await json(site)).toEqual({ error: "The website must start with http:// or https://." });

    const maps = await asAdmin("POST", "/demo/customers", {
      businessName: "X", mapsUrl: "https://example.test/x",
    });
    expect(maps.status).toBe(400);
    expect(await json(maps)).toEqual({ error: "That does not look like a Google Maps link." });
  });
});

// The merge contract, which is the reason `patchCustomer` reads and writes in one transaction. The
// drawer PATCHes one field at a time, so the difference between "absent" and "empty" is the
// difference between saving a phone number and wiping a record.
describe("PATCH /demo/customers/:id merge rules", () => {
  it("trims a string before storing it", async () => {
    const res = await asAdmin("PATCH", `/demo/customers/${madeId}`, { contactName: "  Dana Reed  " });
    expect(res.status).toBe(200);
    expect((await json(res)).customer.contactName).toBe("Dana Reed");
  });

  it('clears an optional field when sent ""', async () => {
    const payload = await json(await asAdmin("PATCH", `/demo/customers/${madeId}`, { contactName: "" }));
    expect(payload.customer.contactName).toBeUndefined();
    // And it is gone from the row too, not merely absent from this one response.
    const reread = await json(await asAdmin("GET", `/demo/customers/${madeId}`));
    expect(reread.customer.contactName).toBeUndefined();
  });

  it("leaves a stored value alone when its key is absent", async () => {
    // contactEmail is untouched by this request and by the two above it.
    const payload = await json(await asAdmin("PATCH", `/demo/customers/${madeId}`, { stage: "contacted" }));
    expect(payload.customer.stage).toBe("contacted");
    expect(payload.customer.contactEmail).toBe("dana@pine.test");
    expect(payload.customer.businessName).toBe("Pine Clinic");
  });

  it('treats "" on a REQUIRED string as a no-op rather than a clear', async () => {
    // The promo's own exception: businessName and agentName use `?.trim() || current`, so there is
    // no way to empty a record down to a nameless row through the drawer.
    const payload = await json(
      await asAdmin("PATCH", `/demo/customers/${madeId}`, { businessName: "", agentName: "   " }),
    );
    expect(payload.customer.businessName).toBe("Pine Clinic");
    expect(payload.customer.agentName).toBe("Alex");
  });

  it("takes the rest of the drawer's fields, and bumps updated_at", async () => {
    const before = (await json(await asAdmin("GET", `/demo/customers/${madeId}`))).customer;
    const payload = await json(
      await asAdmin("PATCH", `/demo/customers/${madeId}`, {
        active: false,
        demoMinutes: 12.6,
        voice: "meridian",
        followUpAt: "2026-10-01T00:00:00.000Z",
        lastContactedAt: null,
        callSound: { phoneLine: false, ambience: "busy" },
        prompts: { live: "You are Dana" },
      }),
    );
    expect(payload.customer).toMatchObject({
      active: false,
      demoMinutes: 13, // rounded
      voice: "meridian",
      followUpAt: "2026-10-01T00:00:00.000Z",
      callSound: { phoneLine: false, ambience: "busy" },
    });
    expect(payload.customer.lastContactedAt).toBeUndefined();
    expect(payload.customer.prompts).toMatchObject({ live: "You are Dana", edited: true });
    expect(payload.customer.updatedAt > before.updatedAt).toBe(true);
  });

  it("refuses an unknown voice and an unknown stage before it touches the row", async () => {
    const voice = await asAdmin("PATCH", `/demo/customers/${madeId}`, { voice: "kazoo" });
    expect(voice.status).toBe(400);
    expect(await json(voice)).toEqual({ error: "Unknown voice." });

    const stage = await asAdmin("PATCH", `/demo/customers/${madeId}`, { stage: "maybe" });
    expect(stage.status).toBe(400);
    expect(await json(stage)).toEqual({ error: "Unknown stage." });
  });

  it("404s on an id that is not there", async () => {
    const res = await asAdmin("PATCH", "/demo/customers/nosuchcustomer", { label: "x" });
    expect(res.status).toBe(404);
    expect(await json(res)).toEqual({ error: "Customer not found." });
  });
});

// The "Add time" menu. `addDemoMinutes` is a top-up, and the whole reason it is not just another
// `demoMinutes` is *what it is added to*: the figure in the row, read inside the same transaction
// that writes it — never the figure the browser was showing. A tab left open since yesterday
// would otherwise undo a colleague's top-up simply by clicking "+10" on a stale total.
describe("PATCH /demo/customers/:id — addDemoMinutes", () => {
  const minutesOf = async (id: string) =>
    (
      (await db.query(`SELECT demo_minutes FROM demo_customers WHERE id = $1`, [id])).rows as any[]
    )[0].demo_minutes;

  const rowOf = async (id: string) =>
    ((await db.query(`SELECT * FROM demo_customers WHERE id = $1`, [id])).rows as any[])[0];

  it("adds to the stored minutes", async () => {
    // A baseline set outright, the Share tab's way, so the starting figure is this test's own
    // rather than whatever the merge-rule tests above left behind.
    await asAdmin("PATCH", `/demo/customers/${madeId}`, { demoMinutes: 20 });
    expect(await minutesOf(madeId)).toBe(20);

    const res = await asAdmin("PATCH", `/demo/customers/${madeId}`, { addDemoMinutes: 30 });
    expect(res.status).toBe(200);
    expect((await json(res)).customer.demoMinutes).toBe(50);
    expect(await minutesOf(madeId)).toBe(50);
  });

  it("ignores a stale demoMinutes sent in the same body", async () => {
    // 50 is stored. A page loaded before the top-up above still shows 20 and sends it back with
    // the next save; the add has to land on the 50, and the 20 has to go nowhere at all.
    const res = await asAdmin("PATCH", `/demo/customers/${madeId}`, {
      demoMinutes: 20,
      addDemoMinutes: 10,
    });
    expect(res.status).toBe(200);
    // 60, not 30 (added to what was sent) and not 20 (the stale figure written outright).
    expect((await json(res)).customer.demoMinutes).toBe(60);
    expect(await minutesOf(madeId)).toBe(60);
  });

  it("starts from DEFAULT_DEMO_MINUTES when the prospect has none stored", async () => {
    // Its own prospect, so the seeded ones the tests below read are left as they were.
    const fresh = (await json(await asAdmin("POST", "/demo/customers", { businessName: "Fir Spa" })))
      .customer;
    expect(await minutesOf(fresh.id)).toBe(null); // absent means the default, not zero

    const res = await asAdmin("PATCH", `/demo/customers/${fresh.id}`, { addDemoMinutes: 5 });
    expect(res.status).toBe(200);
    expect((await json(res)).customer.demoMinutes).toBe(DEFAULT_DEMO_MINUTES + 5);
  });

  it("refuses zero, a negative and a non-number with the promo's 400, and writes nothing", async () => {
    const before = await rowOf(madeId);

    for (const addDemoMinutes of [0, -5, "ten"]) {
      const res = await asAdmin("PATCH", `/demo/customers/${madeId}`, {
        addDemoMinutes,
        // Real fields alongside it, so a refusal that came *after* the write would be caught:
        // these would have landed on the row.
        label: "should not be saved",
        demoMinutes: 999,
      });
      expect(res.status).toBe(400);
      expect(await json(res)).toEqual({ error: "Minutes to add must be positive." });
    }

    // Not just the minutes — the whole row, updated_at included. The refusal is a refusal.
    expect(await rowOf(madeId)).toEqual(before);
  });
});

describe("the notes endpoints", () => {
  it("lists a prospect's timeline newest first", async () => {
    const res = await asAdmin("GET", `/demo/customers/${A}/notes`);
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ notes: [{ id: "n1", at: NOTE_AT, text: "Called back" }] });
  });

  it("appends one and answers 201 { note }, trimmed", async () => {
    const res = await asAdmin("POST", `/demo/customers/${A}/notes`, { text: "  Left a voicemail  " });
    const note = (await json(res)).note;
    expect(res.status).toBe(201);
    expect(note.text).toBe("Left a voicemail");
    expect(note.id).toMatch(/^[A-Za-z0-9_-]{10}$/);

    // The note just written is at the top, which is what the drawer renders.
    const listed = (await json(await asAdmin("GET", `/demo/customers/${A}/notes`))).notes;
    expect(listed.map((n: any) => n.id)).toEqual([note.id, "n1"]);
  });

  it("refuses an empty note", async () => {
    const res = await asAdmin("POST", `/demo/customers/${A}/notes`, { text: "   " });
    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({ error: "Write something first." });
  });

  it("404s for a prospect that is not there, rather than a foreign-key 500", async () => {
    expect((await asAdmin("GET", "/demo/customers/nosuchcustomer/notes")).status).toBe(404);
    const post = await asAdmin("POST", "/demo/customers/nosuchcustomer/notes", { text: "hi" });
    expect(post.status).toBe(404);
    expect(await json(post)).toEqual({ error: "Customer not found." });
  });
});

describe("PATCH /demo/customers/:id/calls", () => {
  it("reclassifies a call and answers { call }", async () => {
    const res = await asAdmin("PATCH", `/demo/customers/${A}/calls`, { callId: "c2", isTest: false });
    const payload = await json(res);
    expect(res.status).toBe(200);
    expect(Object.keys(payload)).toEqual(["call"]);
    expect(payload.call).toMatchObject({
      id: "c2", customerId: A, isTest: false, durationSec: 60, turns: 8,
    });
    // Put it back, so the counts the DELETE test reads are the seed's.
    const back = await json(
      await asAdmin("PATCH", `/demo/customers/${A}/calls`, { callId: "c2", isTest: true }),
    );
    expect(back.call.isTest).toBe(true);
  });

  it("leaves a call that already has a review alone when analyze is sent", async () => {
    const res = await asAdmin("PATCH", `/demo/customers/${A}/calls`, { callId: "c1", analyze: true });
    const payload = await json(res);
    expect(res.status).toBe(200);
    expect(payload.call).toMatchObject({ id: "c1", isTest: false, durationSec: 120, turns: 22 });
    expect(payload.call.review).toEqual({ sentiment: "happy" }); // not rewritten, not dropped
  });

  it("refuses a body with neither isTest nor analyze", async () => {
    const res = await asAdmin("PATCH", `/demo/customers/${A}/calls`, { callId: "c1" });
    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({ error: "Send a callId with isTest or analyze." });
  });

  it("404s separately for an unknown prospect and an unknown call", async () => {
    const noCustomer = await asAdmin("PATCH", "/demo/customers/nosuchcustomer/calls", {
      callId: "c1", isTest: true,
    });
    expect(noCustomer.status).toBe(404);
    expect(await json(noCustomer)).toEqual({ error: "Customer not found." });

    const noCall = await asAdmin("PATCH", `/demo/customers/${A}/calls`, { callId: "nope", isTest: true });
    expect(noCall.status).toBe(404);
    expect(await json(noCall)).toEqual({ error: "Call not found." });
  });
});

// Last, because it takes the fixture with it.
describe("DELETE /demo/customers/:id", () => {
  it("removes the prospect and cascades to its calls, views and notes", async () => {
    expect(await countOf("demo_calls")).toBe(3);
    expect(await countOf("demo_notes")).toBe(2);
    expect(await countOf("demo_call_events")).toBe(2);

    const res = await asAdmin("DELETE", `/demo/customers/${A}`);
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ ok: true });

    expect((await asAdmin("GET", `/demo/customers/${A}`)).status).toBe(404);
    expect(await countOf("demo_calls")).toBe(1); // Cedar's c3 survives
    expect(await countOf("demo_notes")).toBe(0);
    expect(await countOf("demo_call_events")).toBe(1); // Cedar's view survives
  });

  it("404s the second time", async () => {
    const res = await asAdmin("DELETE", `/demo/customers/${A}`);
    expect(res.status).toBe(404);
    expect(await json(res)).toEqual({ error: "Customer not found." });
  });
});
