import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

// The two halves of a Demo test call — `POST /demo/session` and `POST /demo/calls/:callId` — driven
// as the call panel drives them, against a real Postgres: PGlite behind `db/client.js`, the real DDL
// out of `client.ts`, the real importer for the seed, the real writers and the real Elysia app.
// Nothing between the request and the rows is a stand-in, which is the point: what these two routes
// are is ordering (the row is opened *before* OpenAI is asked, and taken back if OpenAI says no) and
// a first-report-wins rule decided on a locked row. Neither survives a mocked data layer.
//
// Two things are stand-ins, both at the process boundary:
//
//   * the auth guard, exactly as `demo.pg.test.ts` does it — an admin and a signed-in non-admin have
//     to reach the same app, and minting real sessions would test `auth/session.ts` over again;
//   * `globalThis.fetch`. **No request leaves this process.** The stub records every attempted URL,
//     method, headers and body, so the tests assert on the request that *would* have gone out, and
//     the last test in the file reads that record back and fails if anything was aimed at
//     api.openai.com. A test that dials for real is a defect in the test, not a passing test.
//
// Run: bun test src/routes/demoCall.pg.test.ts
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
// double-encoded JSON value, which a shim that forwarded raw values could not. The transcript and
// the review below are both JSONB, so this is load-bearing for this file in particular.
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
// The seed, written by the real importer (the promo's own Redis export shape) rather than by
// hand-rolled INSERTs that could agree with the loaders about a mistake.

// Real opening hours, so `callClock` produces its "book for the next seven days" block rather than
// the bare list it falls back to — the clock text asserted against the outgoing prompt is then the
// long one, and a route that appended nothing could not accidentally match.
const HOURS = [
  { day: "Monday", open: "09:00", close: "17:00" },
  { day: "Tuesday", open: "09:00", close: "17:00" },
  { day: "Wednesday", open: "09:00", close: "17:00" },
  { day: "Thursday", open: "09:00", close: "17:00" },
  { day: "Friday", open: "09:00", close: "17:00" },
  { day: "Saturday", open: "10:00", close: "14:00" },
  { day: "Sunday", open: "", close: "", closed: true },
];

const LIVE_PROMPT = "You are Alex, the receptionist at Harbor Dental. Speak warmly.";
const BACKEND_PROMPT = "You take the booking for Harbor Dental and answer in JSON.";
const GREETING = "Harbor Dental, this is Alex — how can I help?";

const A = "aaaaaaaaaaaa"; // the prospect every good call is placed against
const F = "ffffffffffff"; // only ever dialled on the failure paths, so its call rows can be counted
const P = "pppppppppppp"; // paused
const R = "rrrrrrrrrrrr"; // still being researched
const U = "uuuuuuuuuuuu"; // the public demo: two minutes, so the allowance is reachable in a test
const V = "vvvvvvvvvvvv"; // the public demo the concurrency cap is filled on

// Operator-only fields, on the customer the public page is served from. They exist so the public
// read can be checked for their absence rather than for the absence of nothing.
const OPERATOR_LABEL = "warm lead";
const OPERATOR_NAME = "Office manager";
const OPERATOR_EMAIL = "private@example.invalid";
const OPERATOR_NOTE = "internal: haggles on price";

/** Who the browser says it is on a public dial; there is no such thing on an admin test call. */
const VISITOR = "vid_public_1";

/** Set by the first public dial and read by the report that follows it. */
let publicCallId = "";

const customer = (id: string, businessName: string, extra: Record<string, unknown> = {}) => ({
  type: "string",
  ttl: -1,
  value: {
    id,
    businessName,
    active: true,
    profile: { name: businessName, hours: HOURS },
    dossier: "# " + businessName,
    sources: [{ url: "https://example.test" }],
    // `edited: true` because these three strings are hand-written, and this file's assertions are
    // that the *stored* prompt is what reaches the model. `demoRead.ts normalize()` rebuilds any
    // unedited prompt whose version is behind `PROMPT_VERSION` — the promo's own behaviour, ported
    // with `src/demo/prompt.ts` — and these carry no version, so with `edited: false` the route
    // would (correctly) have sent a freshly built prompt instead of these.
    prompts: { live: LIVE_PROMPT, backend: BACKEND_PROMPT, greeting: GREETING, edited: true },
    voice: "meridian",
    agentName: "Alex",
    status: "ready",
    createdAt: "2026-09-20T04:40:00.000Z",
    updatedAt: "2026-09-20T04:41:00.000Z",
    ...extra,
  },
});

const DUMP = {
  data: {
    customers: { type: "set", ttl: -1, value: [A, F, P, R, U, V] },
    [`customers:${A}`]: customer(A, "Harbor Dental"),
    [`customers:${F}`]: customer(F, "Fallible Co"),
    [`customers:${P}`]: customer(P, "Paused Clinic", { active: false }),
    [`customers:${R}`]: customer(R, "Cedar Bakery", { status: "researching" }),
    [`customers:${U}`]: customer(U, "Public Spa", {
      demoMinutes: 2,
      label: OPERATOR_LABEL,
      contactName: OPERATOR_NAME,
      contactEmail: OPERATOR_EMAIL,
      notes: OPERATOR_NOTE,
    }),
    [`customers:${V}`]: customer(V, "Busy Spa"),
  },
};

const { parseDump } = await import("../demo/dump.js");
const { importDump } = await import("../db/demoImport.js");
expect(await importDump(parseDump(DUMP))).toEqual({ customers: 6, calls: 0, events: 0, notes: 0 });

const { env } = await import("../config/env.js");
const { callClock, zonedToday } = await import("../demo/callClock.js");
// The ceiling the session answer hands the browser. Imported rather than written out as 600, so
// this file measures the route against the same constant the route and the hook read.
const { CALL_MAX_SEC } = await import("../demo/callLimits.js");
// `reviewCall` is documented never to throw, and the route does not take that on trust: the call is
// committed before the review runs and must stay committed whatever the review does. Nothing that
// can be staged from outside makes it throw — a failing `fetch` becomes an `OpenAIError` that it
// catches and turns into `null` — so the real function is wrapped and a flag makes it throw.
let reviewThrows = false;
const callReviewModule = await import("../demo/callReview.js");
// Captured into a local BEFORE the mock is installed. Reading it back off the namespace object
// afterwards returns the replacement, and the wrapper then calls itself — which is a stack overflow,
// not a test failure, and took a moment to recognise.
const actualReviewCall = callReviewModule.reviewCall;
// `mock.module` replaces the module whole, so everything else the routes import from it has to be
// handed back or it arrives `undefined` at the call site. `reviewable` is the Analyze branch's
// first guard, and an undefined guard is a TypeError inside a try/catch — a 500 that would look
// like a bug in the route rather than a hole in this mock.
const actualReviewable = callReviewModule.reviewable;
await mock.module("../demo/callReview.js", () => ({
  reviewCall: async (call: Parameters<typeof actualReviewCall>[0]) => {
    if (reviewThrows) throw new Error("review step exploded");
    return actualReviewCall(call);
  },
  reviewable: actualReviewable,
}));

const { demo } = await import("./demo.js");
// The prospect's side is mounted alongside the operator's, exactly as `app.ts` mounts them, because
// half of what these tests check is the difference between the two.
const { demoPublic } = await import("./demoPublic.js");
const { Elysia } = await import("elysia");
const app = new Elysia().use(demo).use(demoPublic);

// The settings the test call runs on.
//
// Not `process.env`: `config/env.ts` reads that once, at import, and `bun test` shares one module
// registry across files — so whether this file got to set a variable would depend on which test
// file imported `env` first, which is not something to hang assertions on. Every one of these is
// read per request instead (`openai.ts`'s `base()` and `apiKey()`, `callReview.ts`'s `model()`, and
// the route's own `env.openaiLiveModel`), so they are set on the object and put back afterwards.
//
// The base URL is deliberately not OpenAI's — belt and braces with the `fetch` stub, and it is what
// makes "nothing went to api.openai.com" something the recorded list can actually show.
const TEST_ENV: Record<string, unknown> = {
  openaiApiKey: "sk-test-not-a-real-key",
  openaiBaseUrl: "https://openai.invalid/v1",
  openaiLiveModel: "gpt-live-1-under-test",
  openaiBackendModel: "gpt-backend-under-test",
  callReviewModel: "gpt-review-under-test",
  defaultTimezone: "America/Los_Angeles",
};
const settings = env as unknown as Record<string, unknown>;
const ENV_BEFORE = Object.fromEntries(Object.keys(TEST_ENV).map((key) => [key, settings[key]]));
Object.assign(settings, TEST_ENV);
afterAll(() => {
  Object.assign(settings, ENV_BEFORE);
});

// If this ever fails, `env` was frozen since — and every assertion below about the outgoing request
// would be measuring whatever the machine's real settings are.
expect({ key: env.openaiApiKey, base: env.openaiBaseUrl, model: env.openaiLiveModel }).toEqual({
  key: "sk-test-not-a-real-key",
  base: "https://openai.invalid/v1",
  model: "gpt-live-1-under-test",
});

// ----------------------------------------------------------------------------------------------
// The network boundary, closed.

type Attempt = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: any;
};

type Responder = (attempt: Attempt) => Response | Promise<Response>;

const attempts: Attempt[] = [];

let nextSessionId = 0;

/** What OpenAI's live API answers when it is willing: an id and the SDP answer, under `transport`. */
const liveAnswer: Responder = () =>
  Response.json({ id: `sess_${++nextSessionId}`, transport: { sdp: ANSWER_SDP } });

/** The error envelope `readError` in `demo/openai.ts` unwraps. */
const refuses = (status: number, message: string): Responder => () =>
  new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { "content-type": "application/json" },
  });

const NO_REVIEW: Responder = () => {
  throw new Error("the review model must not be asked for this call");
};

const responders: { live: Responder; responses: Responder } = {
  live: liveAnswer,
  responses: NO_REVIEW,
};

beforeEach(() => {
  responders.live = liveAnswer;
  responders.responses = NO_REVIEW;
});

const realFetch = globalThis.fetch;

globalThis.fetch = (async (input: any, init: RequestInit = {}) => {
  const url =
    typeof input === "string" ? input : input instanceof URL ? input.href : String(input?.url);
  const attempt: Attempt = {
    url,
    method: String(init.method ?? "GET"),
    headers: (init.headers ?? {}) as Record<string, string>,
    body: typeof init.body === "string" ? JSON.parse(init.body) : init.body,
  };
  attempts.push(attempt);
  if (url.endsWith("/live/sessions")) return responders.live(attempt);
  if (url.endsWith("/responses")) return responders.responses(attempt);
  // Recorded like the rest, and unmistakable in a failure message.
  return new Response(JSON.stringify({ error: { message: `unexpected request to ${url}` } }), {
    status: 599,
    headers: { "content-type": "application/json" },
  });
}) as unknown as typeof fetch;

afterAll(() => {
  globalThis.fetch = realFetch;
});

/** The most recent request aimed at that endpoint, or a failure that names it. */
function sentTo(suffix: string): Attempt {
  const found = [...attempts].reverse().find((attempt) => attempt.url.endsWith(suffix));
  if (!found) throw new Error(`nothing was sent to ${suffix}`);
  return found;
}

// ----------------------------------------------------------------------------------------------
// Driving the app.

const OFFER_SDP = "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n";
const ANSWER_SDP = "v=0\r\no=- 2 2 IN IP4 127.0.0.1\r\na=this-is-the-answer\r\n";
const USER_AGENT = "TestPanel/1.0";
const TIME_ZONE = "America/Chicago"; // not the server default, so `safeTimeZone` has to carry it

// `Response.json()` is typed `unknown`; these are our own fixtures, so read them as records (same
// pattern as ../auth/auth.test.ts).
const json = (res: Response): Promise<Record<string, any>> =>
  res.json() as Promise<Record<string, any>>;

// The session route keeps the promo's 5-dials-a-minute ceiling, keyed by `x-forwarded-for`. Every
// request below comes from its own address, so the limit never fires and a 429 in these tests is
// always OpenAI's.
let dials = 0;

const request = (
  method: string,
  path: string,
  opts: { auth?: string; body?: unknown } = {},
) => {
  const headers: Record<string, string> = {
    accept: "application/json",
    "user-agent": USER_AGENT,
    "x-forwarded-for": `198.51.100.${(dials += 1)}`,
  };
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

/** The admin's own request — what the call panel sends. */
const asAdmin = (method: string, path: string, payload?: unknown) =>
  request(method, path, { auth: ADMIN, body: payload });

const rowsOf = async (text: string, values: unknown[] = []) =>
  (await db.query(text, values)).rows as any[];

async function callRow(id: string): Promise<Record<string, any>> {
  const [row] = await rowsOf(
    `SELECT *, jsonb_typeof(transcript) AS transcript_kind, jsonb_typeof(review) AS review_kind
       FROM demo_calls WHERE id = $1`,
    [id],
  );
  if (!row) throw new Error(`no demo_calls row ${id}`);
  return row;
}

const callsOf = async (customerId: string) =>
  Number(
    (
      await rowsOf(`SELECT count(*)::int AS n FROM demo_calls WHERE customer_id = $1`, [customerId])
    )[0].n,
  );

/** A call in `started`, placed through the real route — the state a report needs. */
async function placeCall(customerId = A): Promise<string> {
  const res = await asAdmin("POST", "/demo/session", {
    customerId,
    sdp: OFFER_SDP,
    timeZone: TIME_ZONE,
  });
  expect(res.status).toBe(200);
  return (await json(res)).callId as string;
}

const said = (id: string, speaker: "caller" | "receptionist", text: string) => ({
  id,
  speaker,
  text,
  startMs: 0,
  endMs: 900,
});

// ==============================================================================================
// POST /demo/session

describe("POST /demo/session", () => {
  it("opens a started, is_test row and answers with the callId, session, SDP, greeting and maxSec", async () => {
    responders.live = () => Response.json({ id: "sess_harbor", transport: { sdp: ANSWER_SDP } });

    const res = await asAdmin("POST", "/demo/session", {
      customerId: A,
      sdp: OFFER_SDP,
      timeZone: TIME_ZONE,
    });
    const payload = await json(res);

    expect(res.status).toBe(200);
    // Not sorted: the call panel reads these by name, and the order is the promo's own.
    expect(Object.keys(payload)).toEqual(["callId", "sessionId", "sdp", "greeting", "maxSec"]);
    expect(payload.callId).toMatch(/^[A-Za-z0-9_-]{12}$/); // the promo's nanoid shape
    expect(payload.sessionId).toBe("sess_harbor");
    expect(payload.sdp).toBe(ANSWER_SDP);
    expect(payload.greeting).toBe(GREETING);
    // How long the browser may let this call run. There is no allowance on this route to narrow
    // it, so it is the ten minute ceiling every time — and it is a number, not a string, because
    // the hook does arithmetic with it.
    expect(payload.maxSec).toBe(CALL_MAX_SEC);
    expect(payload.maxSec).toBe(600);

    const row = await callRow(payload.callId);
    expect(row.customer_id).toBe(A);
    expect(row.status).toBe("started");
    // Not a parameter anywhere: every call this backend places is the operator's own.
    expect(row.is_test).toBe(true);
    expect(row.live_session_id).toBe("sess_harbor");
    expect(row.user_agent).toBe(USER_AGENT);
    expect(row.ended_at).toBe(null);
    expect(row.duration_sec).toBe(null);
    expect(row.turns).toBe(null);
    expect(row.review).toBe(null);
    // An empty transcript is an empty JSON *array*, not the string "[]".
    expect(row.transcript_kind).toBe("array");
    expect(row.transcript).toEqual([]);
  });

  it("sends the configured model, the customer's voice, and the prompt with the clock on it", async () => {
    const res = await asAdmin("POST", "/demo/session", {
      customerId: A,
      sdp: OFFER_SDP,
      timeZone: TIME_ZONE,
    });
    expect(res.status).toBe(200);

    // Built right after the answer came back, so the route's `new Date()` and this one are the same
    // minute; every line but the wall clock is compared literally, and that one by shape.
    const clock = callClock(new Date(), TIME_ZONE, HOURS as any);
    const today = zonedToday(new Date(), TIME_ZONE);

    const sent = sentTo("/live/sessions");
    expect(sent.url).toBe("https://openai.invalid/v1/live/sessions");
    expect(sent.method).toBe("POST");
    expect(sent.headers.Authorization).toBe(`Bearer ${env.openaiApiKey}`);
    expect(sent.body.transport).toEqual({ type: "webrtc", sdp: OFFER_SDP });

    const session = sent.body.session;
    expect(session.model).toBe(env.openaiLiveModel);
    expect(session.model).toBe("gpt-live-1-under-test");
    expect(session.audio).toEqual({ output: { voice: "meridian" } });
    expect(session.store).toBe(false);

    // The stored prompt, then the clock, exactly as the promo appends them.
    expect(session.instructions.startsWith(`${LIVE_PROMPT}\n\n`)).toBe(true);
    for (const clockLine of clock.split("\n").filter(Boolean)) {
      if (clockLine.startsWith("- It is ")) continue;
      expect(session.instructions).toContain(clockLine);
    }
    // The one line that carries the time of day, and the timezone the browser asked for.
    expect(session.instructions).toContain(
      `- It is ${today.long}, ${today.year}, `,
    );
    expect(session.instructions).toMatch(
      /- It is .+, \d{4}, \d{1,2}:\d{2}\s?[AP]M \(America\/Chicago\)\./,
    );
    // The book only appears when the hours are known, which is what makes the seed's hours worth
    // having: a route that appended an empty clock would pass the two checks above.
    expect(session.instructions).toContain("The book for the next seven days:");

    // The model that takes the booking gets the other prompt, and the same clock.
    expect(session.delegation.type).toBe("responses");
    expect(session.delegation.responses.model).toBe(env.openaiBackendModel);
    expect(session.delegation.responses.instructions.startsWith(`${BACKEND_PROMPT}\n\n`)).toBe(true);
    expect(session.delegation.responses.instructions).toContain("Right now:");
  });

  it("takes the call row back when OpenAI refuses, leaving no started row behind", async () => {
    responders.live = refuses(500, "The model is overloaded right now.");
    expect(await callsOf(F)).toBe(0);

    const res = await asAdmin("POST", "/demo/session", { customerId: F, sdp: OFFER_SDP });
    expect(res.status).toBe(500);
    expect(await json(res)).toEqual({ error: "The model is overloaded right now." });

    // The row was written before OpenAI was asked — the request above proves the route got that
    // far — so this is the delete on the failure path, not an insert that never happened.
    expect(sentTo("/live/sessions").body.session.model).toBe(env.openaiLiveModel);
    expect(await callsOf(F)).toBe(0);
    expect(
      await rowsOf(`SELECT id FROM demo_calls WHERE customer_id = $1 AND status = 'started'`, [F]),
    ).toEqual([]);
  });

  it("forwards OpenAI's own status — a 429 stays a 429", async () => {
    responders.live = refuses(429, "Rate limit reached for gpt-live-1.");

    const res = await asAdmin("POST", "/demo/session", { customerId: F, sdp: OFFER_SDP });
    expect(res.status).toBe(429);
    // Distinguishable from the route's own 429, which says "Too many calls in a row."
    expect(await json(res)).toEqual({ error: "Rate limit reached for gpt-live-1." });
    expect(await callsOf(F)).toBe(0);
  });

  it("refuses a body with no customerId or no sdp, before it dials or writes", async () => {
    const before = attempts.length;

    const noCustomer = await asAdmin("POST", "/demo/session", { sdp: OFFER_SDP });
    expect(noCustomer.status).toBe(400);
    expect(await json(noCustomer)).toEqual({ error: "Missing customerId or sdp." });

    const noSdp = await asAdmin("POST", "/demo/session", { customerId: A });
    expect(noSdp.status).toBe(400);
    expect(await json(noSdp)).toEqual({ error: "Missing customerId or sdp." });

    expect(attempts.length).toBe(before);
  });

  it("refuses a paused, an unprepared and an unknown prospect with the promo's codes", async () => {
    const before = attempts.length;

    const paused = await asAdmin("POST", "/demo/session", { customerId: P, sdp: OFFER_SDP });
    expect(paused.status).toBe(403);
    expect(await json(paused)).toEqual({ error: "This demo is paused." });

    const researching = await asAdmin("POST", "/demo/session", { customerId: R, sdp: OFFER_SDP });
    expect(researching.status).toBe(409);
    expect(await json(researching)).toEqual({ error: "This demo is still being prepared." });

    const unknown = await asAdmin("POST", "/demo/session", {
      customerId: "nosuchcustomer",
      sdp: OFFER_SDP,
    });
    expect(unknown.status).toBe(404);
    expect(await json(unknown)).toEqual({ error: "This demo isn't available." });

    // None of the three is a call: nothing was dialled and nothing was written down.
    expect(attempts.length).toBe(before);
    expect(await callsOf(P)).toBe(0);
    expect(await callsOf(R)).toBe(0);
  });
});

// ==============================================================================================
// POST /demo/calls/:callId

describe("POST /demo/calls/:callId", () => {
  it("404s a call that is not there", async () => {
    const res = await asAdmin("POST", "/demo/calls/nosuchcall", {
      status: "completed",
      durationSec: 10,
      transcript: [],
    });
    expect(res.status).toBe(404);
    expect(await json(res)).toEqual({ error: "Call not found." });
  });

  it("completes the call: status, duration, end reason, transcript and turns", async () => {
    const callId = await placeCall();
    // One caller line is below MIN_CALLER_LINES, so the review is not asked for at all — which the
    // `NO_REVIEW` responder turns into a failure if it is.
    const transcript = [
      said("t1", "receptionist", "Harbor Dental, this is Alex."),
      said("t2", "caller", "Sorry, wrong number."),
    ];

    const res = await asAdmin("POST", `/demo/calls/${callId}`, {
      customerId: A,
      status: "completed",
      durationSec: 42.6,
      endReason: "caller hung up",
      transcript,
    });

    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ ok: true, reviewed: false });

    const row = await callRow(callId);
    expect(row.status).toBe("completed");
    expect(row.duration_sec).toBe(43); // rounded
    expect(row.end_reason).toBe("caller hung up");
    expect(row.turns).toBe(2);
    expect(row.ended_at).not.toBe(null);
    expect(row.transcript_kind).toBe("array"); // an array, not a JSON string of one
    expect(row.transcript).toEqual(transcript);
    expect(row.review).toBe(null);
  });

  it("normalises what the browser sent: an unknown status, a negative duration, a long reason", async () => {
    const callId = await placeCall();
    const transcript = Array.from({ length: 600 }, (_, i) =>
      said(`t${i}`, i % 2 ? "caller" : "receptionist", `line ${i}`),
    );

    const res = await asAdmin("POST", `/demo/calls/${callId}`, {
      customerId: A,
      status: "started", // sent back at us: the call ended, so it is recorded as abandoned
      durationSec: -5,
      endReason: "x".repeat(200),
      transcript,
    });
    expect(res.status).toBe(200);

    const row = await callRow(callId);
    expect(row.status).toBe("abandoned");
    expect(row.duration_sec).toBe(null);
    expect(row.end_reason).toBe("x".repeat(120));
    expect(row.turns).toBe(500); // capped with the transcript it counts
    expect(row.transcript).toHaveLength(500);
  });

  it("lets the first report win: a second one is alreadyReported and overwrites nothing", async () => {
    const callId = await placeCall();
    const first = [
      said("t1", "receptionist", "Harbor Dental, this is Alex."),
      said("t2", "caller", "I'd like an appointment."),
    ];

    expect(
      await json(
        await asAdmin("POST", `/demo/calls/${callId}`, {
          customerId: A,
          status: "completed",
          durationSec: 61,
          endReason: "caller ended the call",
          transcript: first,
        }),
      ),
    ).toEqual({ ok: true, reviewed: false });

    // The unload beacon, landing after the ordinary report and saying something else entirely.
    const late = await asAdmin("POST", `/demo/calls/${callId}`, {
      customerId: A,
      status: "abandoned",
      durationSec: 9,
      endReason: "page unloaded",
      transcript: [said("z1", "caller", "...")],
    });
    expect(late.status).toBe(200);
    expect(await json(late)).toEqual({ ok: true, alreadyReported: true });

    const row = await callRow(callId);
    expect(row.status).toBe("completed");
    expect(row.duration_sec).toBe(61);
    expect(row.end_reason).toBe("caller ended the call");
    expect(row.turns).toBe(2);
    expect(row.transcript).toEqual(first);
  });

  it("does not report a call belonging to another prospect", async () => {
    const callId = await placeCall();
    const res = await asAdmin("POST", `/demo/calls/${callId}`, {
      customerId: F, // the call is Harbor's
      status: "completed",
      durationSec: 5,
      transcript: [],
    });
    expect(res.status).toBe(404);
    expect(await json(res)).toEqual({ error: "Call not found." });
    expect((await callRow(callId)).status).toBe("started");
  });
});

// ==============================================================================================
// The review, which runs after the call is already recorded and must never be able to un-record it.

describe("the post-call review", () => {
  const conversation = [
    said("t1", "receptionist", "Harbor Dental, this is Alex."),
    said("t2", "caller", "Do you open on Sunday?"),
    said("t3", "receptionist", "Let me check that for you."),
    said("t4", "caller", "And do you take my insurance?"),
  ];

  it("saves the review the model answered with", async () => {
    const callId = await placeCall();
    responders.responses = () =>
      Response.json({
        output_text: JSON.stringify({
          tested: "Whether the practice opens on Sunday and takes their insurance.",
          worked: "Answered the hours question without hesitating.",
          struggled: "Could not say which insurers are accepted.",
          gaps: ["did not know accepted insurers", "  ", "no Sunday hours given"],
          sentiment: "mixed",
        }),
      });

    const res = await asAdmin("POST", `/demo/calls/${callId}`, {
      customerId: A,
      status: "completed",
      durationSec: 75,
      transcript: conversation,
    });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ ok: true, reviewed: true });

    // The request that would have gone out for it.
    const asked = sentTo("/responses");
    expect(asked.url).toBe("https://openai.invalid/v1/responses");
    expect(asked.body.model).toBe(env.callReviewModel);
    expect(asked.body.max_output_tokens).toBe(700);
    // The transcript, rendered — and nothing about the business, which is the point of the module.
    expect(asked.body.input).toBe(
      [
        "Receptionist: Harbor Dental, this is Alex.",
        "Caller: Do you open on Sunday?",
        "Receptionist: Let me check that for you.",
        "Caller: And do you take my insurance?",
      ].join("\n"),
    );

    const row = await callRow(callId);
    expect(row.status).toBe("completed");
    expect(row.review_kind).toBe("object"); // an object, not a JSON string of one
    expect(row.review).toMatchObject({
      tested: "Whether the practice opens on Sunday and takes their insurance.",
      worked: "Answered the hours question without hesitating.",
      struggled: "Could not say which insurers are accepted.",
      gaps: ["did not know accepted insurers", "no Sunday hours given"], // blanks dropped
      sentiment: "mixed",
      model: "gpt-review-under-test",
    });
    expect(typeof row.review.at).toBe("string");
  });

  it("still completes the call when the review model refuses", async () => {
    const callId = await placeCall();
    responders.responses = refuses(500, "The review model is having a day.");

    const res = await asAdmin("POST", `/demo/calls/${callId}`, {
      customerId: A,
      status: "completed",
      durationSec: 75,
      transcript: conversation,
    });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ ok: true, reviewed: false });

    const row = await callRow(callId);
    expect(row.status).toBe("completed");
    expect(row.turns).toBe(4);
    expect(row.review).toBe(null);
  });

  it("still completes the call when the review step throws outright", async () => {
    const callId = await placeCall();
    // A throw from the review step, rather than the `null` it returns for an ordinary failure.
    // `reviewCall` is documented never to throw, but the route does not take that on trust: the call
    // is committed before the review runs and must stay committed whatever the review does.
    //
    // This used to be provoked with a malformed transcript entry, which reached `entry.text.trim()`
    // inside `reviewable()`. The route now drops entries that are not well formed, so the throw is
    // staged here instead — the behaviour under test is the containment, not the way in.
    reviewThrows = true;
    const spoken = [
      said("t1", "receptionist", "Harbor Dental, this is Alex."),
      said("t2", "caller", "Do you open on Sunday?"),
      said("t3", "receptionist", "We are closed Sundays."),
      said("t4", "caller", "Thanks."),
    ];

    const res = await asAdmin("POST", `/demo/calls/${callId}`, {
      customerId: A,
      status: "completed",
      durationSec: 30,
      endReason: "caller ended the call",
      transcript: spoken,
    });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ ok: true, reviewed: false });

    const row = await callRow(callId);
    expect(row.status).toBe("completed");
    expect(row.duration_sec).toBe(30);
    expect(row.turns).toBe(4);
    expect(row.transcript).toEqual(spoken);
    expect(row.review).toBe(null);
    reviewThrows = false;
  });

  it("drops a transcript entry the browser sent malformed, and keeps the rest", async () => {
    const callId = await placeCall();
    // The entries are stored permanently and read back later by analytics and the reviewer, both of
    // which reach into `entry.text`. A row that makes a later read throw is worse than a lost line.
    const sent = [
      said("t1", "receptionist", "Harbor Dental, this is Alex."),
      { id: "t2", speaker: "caller", startMs: 0, endMs: 900 }, // no text
      { speaker: "caller", text: "no id", startMs: 0, endMs: 1 }, // no id
      { id: "t4", speaker: "narrator", text: "not a speaker", startMs: 0, endMs: 1 },
      "not even an object",
      said("t5", "caller", "Do you open on Sunday?"),
    ];

    const res = await asAdmin("POST", `/demo/calls/${callId}`, {
      customerId: A,
      status: "completed",
      durationSec: 30,
      transcript: sent,
    });
    expect(res.status).toBe(200);

    const row = await callRow(callId);
    // Only the two well-formed lines survive, and `turns` counts what was kept, not what arrived.
    expect(row.transcript).toEqual([sent[0], sent[5]]);
    expect(row.turns).toBe(2);
    expect(row.status).toBe("completed");
  });
});

// ==============================================================================================
// Who gets in. A test call spends real live-API minutes, so the guard is the whole story.

describe("the admin guard on the call routes", () => {
  it("refuses a signed-in non-admin on both routes with 403", async () => {
    const before = attempts.length;

    const session = await request("POST", "/demo/session", {
      auth: NON_ADMIN,
      body: { customerId: A, sdp: OFFER_SDP },
    });
    expect(session.status).toBe(403);
    expect(await json(session)).toEqual({
      error: "forbidden",
      message: "Only an admin can read the demo data.",
    });

    const report = await request("POST", "/demo/calls/anything", {
      auth: NON_ADMIN,
      body: { status: "completed", durationSec: 10, transcript: [] },
    });
    expect(report.status).toBe(403);
    expect(await json(report)).toEqual({
      error: "forbidden",
      message: "Only an admin can read the demo data.",
    });

    expect(attempts.length).toBe(before);
  });

  it("refuses a caller with no token at all with 401, on both routes", async () => {
    const before = attempts.length;

    const session = await request("POST", "/demo/session", {
      body: { customerId: A, sdp: OFFER_SDP },
    });
    expect(session.status).toBe(401);
    expect(await json(session)).toEqual({ error: "unauthorized", message: "Sign in to continue." });

    const report = await request("POST", "/demo/calls/anything", {
      body: { status: "completed", durationSec: 10, transcript: [] },
    });
    expect(report.status).toBe(401);
    expect((await json(report)).error).toBe("unauthorized");

    expect(attempts.length).toBe(before);
  });

  it("wrote nothing while refusing all of that", async () => {
    expect(await callsOf(A)).toBe(10); // the ten the tests above placed, and no eleventh
    expect(await callsOf(F)).toBe(0);
  });
});

// ==============================================================================================
// The Analyze button: the same review, asked for after the fact.
//
// It sits below the guard section on purpose — the call count asserted up there counts what the
// sections above it placed, and these tests place more.

describe("PATCH /demo/customers/:id/calls with analyze", () => {
  const conversation = [
    said("t1", "receptionist", "Harbor Dental, this is Alex."),
    said("t2", "caller", "Do you open on Sunday?"),
    said("t3", "receptionist", "Let me check that for you."),
    said("t4", "caller", "And do you take my insurance?"),
  ];

  const REVIEW = {
    tested: "Whether the practice opens on Sunday and takes their insurance.",
    worked: "Picked the call up warmly and by name.",
    struggled: "Could not say which insurers are accepted.",
    gaps: ["did not know accepted insurers"],
    sentiment: "frustrated",
  };

  /** What the model would answer, if it were asked. */
  const answers = (review: Record<string, unknown>): Responder => () =>
    Response.json({ output_text: JSON.stringify(review) });

  const responsesAsked = () =>
    attempts.filter((attempt) => attempt.url.endsWith("/responses")).length;

  /**
   * A finished call with a transcript and no review — one reported while the review model was
   * unreachable, which is exactly the call the button exists for. Placed and reported through the
   * real routes, so the row is the one the dashboard would be looking at.
   */
  async function unreviewed(transcript: unknown[]): Promise<string> {
    const callId = await placeCall();
    responders.responses = refuses(503, "The review model was unreachable at the time.");
    const res = await asAdmin("POST", `/demo/calls/${callId}`, {
      customerId: A,
      status: "completed",
      durationSec: 75,
      endReason: "caller ended the call",
      transcript,
    });
    expect(await json(res)).toEqual({ ok: true, reviewed: false });
    expect((await callRow(callId)).review).toBe(null);
    responders.responses = NO_REVIEW;
    return callId;
  }

  it("writes the review the call never got, and answers with the call carrying it", async () => {
    const callId = await unreviewed(conversation);
    responders.responses = answers(REVIEW);
    const before = responsesAsked();

    const res = await asAdmin("PATCH", `/demo/customers/${A}/calls`, { callId, analyze: true });
    expect(res.status).toBe(200);
    const payload = await json(res);
    expect(Object.keys(payload)).toEqual(["call"]);
    expect(payload.call.id).toBe(callId);
    expect(payload.call.review).toMatchObject({ ...REVIEW, model: "gpt-review-under-test" });

    // Asked once, of the review model, with the transcript and nothing else.
    expect(responsesAsked()).toBe(before + 1);
    const asked = sentTo("/responses");
    expect(asked.url).toBe("https://openai.invalid/v1/responses");
    expect(asked.body.model).toBe(env.callReviewModel);
    expect(asked.body.input).toBe(
      [
        "Receptionist: Harbor Dental, this is Alex.",
        "Caller: Do you open on Sunday?",
        "Receptionist: Let me check that for you.",
        "Caller: And do you take my insurance?",
      ].join("\n"),
    );

    // And it is on the row, not only in the answer.
    const row = await callRow(callId);
    expect(row.status).toBe("completed");
    expect(row.review_kind).toBe("object"); // an object, not a JSON string of one
    expect(row.review).toMatchObject(REVIEW);
    expect(typeof row.review.at).toBe("string");
  });

  it("never redoes a review that is already there", async () => {
    const callId = await placeCall();
    responders.responses = answers(REVIEW);
    expect(
      await json(
        await asAdmin("POST", `/demo/calls/${callId}`, {
          customerId: A,
          status: "completed",
          durationSec: 75,
          transcript: conversation,
        }),
      ),
    ).toEqual({ ok: true, reviewed: true });
    const stored = (await callRow(callId)).review;
    expect(stored).toMatchObject(REVIEW);

    // A second opinion costs money and the operator has already read the first one. Nothing may be
    // asked here: `NO_REVIEW` throws if it is, and the count below says so without relying on that.
    responders.responses = NO_REVIEW;
    const before = responsesAsked();

    const res = await asAdmin("PATCH", `/demo/customers/${A}/calls`, { callId, analyze: true });
    expect(res.status).toBe(200);
    expect((await json(res)).call.review).toEqual(stored);
    expect(responsesAsked()).toBe(before);
    expect((await callRow(callId)).review).toEqual(stored);
  });

  it("refuses a call with too little of a caller in it, and asks nothing", async () => {
    // One caller line: `MIN_CALLER_LINES` is two, and asking anyway invents a finding.
    const callId = await unreviewed([
      said("t1", "receptionist", "Harbor Dental, this is Alex."),
      said("t2", "caller", "Sorry, wrong number."),
    ]);
    const before = responsesAsked();

    const res = await asAdmin("PATCH", `/demo/customers/${A}/calls`, { callId, analyze: true });
    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({ error: "This call is too short to say anything about." });
    expect(responsesAsked()).toBe(before);
    expect((await callRow(callId)).review).toBe(null);
  });

  it("answers 502 when the model cannot be read back, and changes nothing", async () => {
    const callId = await unreviewed(conversation);
    responders.responses = refuses(500, "The review model is having a day.");

    const res = await asAdmin("PATCH", `/demo/customers/${A}/calls`, { callId, analyze: true });
    expect(res.status).toBe(502);
    expect(await json(res)).toEqual({
      error: "The review could not be read back. Try again in a moment.",
    });

    const row = await callRow(callId);
    expect(row.review).toBe(null);
    expect(row.status).toBe("completed");
    expect(row.duration_sec).toBe(75);
    expect(row.turns).toBe(4);
    expect(row.is_test).toBe(true);
  });

  it("applies isTest and analyze when they arrive together", async () => {
    const callId = await unreviewed(conversation);
    expect((await callRow(callId)).is_test).toBe(true);
    responders.responses = answers(REVIEW);

    const res = await asAdmin("PATCH", `/demo/customers/${A}/calls`, {
      callId,
      isTest: false,
      analyze: true,
    });
    expect(res.status).toBe(200);
    const call = (await json(res)).call;
    expect(call.isTest).toBe(false);
    expect(call.review).toMatchObject(REVIEW);

    const row = await callRow(callId);
    expect(row.is_test).toBe(false);
    expect(row.review_kind).toBe("object");
    expect(row.review).toMatchObject(REVIEW);
  });
});

// ==============================================================================================
// The prospect's own side: `/demo/public/*`, reached with no sign-in at all.
//
// These are the routes behind a `/c/<id>` link. Everything above this point is the operator's, and
// the two differ in more than a guard: a public dial spends the prospect's demo minutes, holds one
// of the concurrency seats, and is recorded as a real call rather than a test — so each of those is
// asserted here rather than taken on trust from the admin route's tests.
//
// Every request below is deliberately sent WITHOUT an `authorization` header.

describe("GET /demo/public/customers/:id", () => {
  it("serves the business's own data to a caller with no sign-in", async () => {
    const res = await request("GET", `/demo/public/customers/${U}`);
    expect(res.status).toBe(200);

    const { customer } = await json(res);
    expect(customer.customerId).toBe(U);
    expect(customer.name).toBe("Public Spa");
    expect(customer.agentName).toBe("Alex");
    expect(customer.voice).toBe("meridian");
    expect(customer.prompts.greeting).toBe(GREETING);
    // Two minutes on this fixture, so the page can tell the caller what is left.
    expect(customer.demo.allowedSec).toBe(120);
    expect(customer.demo.exhausted).toBe(false);
  });

  it("carries nothing the operator keeps about the prospect", async () => {
    const res = await request("GET", `/demo/public/customers/${U}`);
    const body = JSON.stringify(await json(res));
    for (const secret of [OPERATOR_EMAIL, OPERATOR_NAME, OPERATOR_NOTE, OPERATOR_LABEL]) {
      expect(body).not.toContain(secret);
    }
    // The field list itself is pinned in `demoPublicView.test.ts`; this is the same promise made
    // over HTTP, in case a route ever spreads the customer in beside the view.
    expect(body).not.toContain("operatorNotes");
    expect(body).not.toContain("contactEmail");
  });

  it("says why a link does not open a demo, so the page can word it", async () => {
    const paused = await request("GET", `/demo/public/customers/${P}`);
    expect(paused.status).toBe(404);
    expect(await json(paused)).toEqual({ error: "This demo isn't available.", reason: "paused" });

    const preparing = await request("GET", `/demo/public/customers/${R}`);
    expect(preparing.status).toBe(404);
    expect((await json(preparing)).reason).toBe("preparing");

    const missing = await request("GET", "/demo/public/customers/zzzzzzzzzzzz");
    expect(missing.status).toBe(404);
    expect((await json(missing)).reason).toBe("missing");
  });
});

describe("POST /demo/public/session", () => {
  it("opens a REAL call — not a test — and answers the browser the same way", async () => {
    responders.live = () => Response.json({ id: "sess_public", transport: { sdp: ANSWER_SDP } });

    const res = await request("POST", "/demo/public/session", {
      body: { customerId: U, sdp: OFFER_SDP, timeZone: TIME_ZONE, visitorId: VISITOR },
    });
    const payload = await json(res);

    expect(res.status).toBe(200);
    expect(Object.keys(payload)).toEqual(["callId", "sessionId", "sdp", "greeting", "maxSec"]);
    expect(payload.sessionId).toBe("sess_public");
    expect(payload.sdp).toBe(ANSWER_SDP);
    expect(payload.greeting).toBe(GREETING);
    // Narrowed to what is left of the two minutes, NOT the ten minute ceiling: this is the half the
    // admin route has no use for, and the reason a prospect cannot overrun a demo with one call.
    expect(payload.maxSec).toBe(120);

    const row = await callRow(payload.callId);
    expect(row.customer_id).toBe(U);
    expect(row.status).toBe("started");
    // The whole point. A public dial counts against the demo and shows in the prospect's numbers.
    expect(row.is_test).toBe(false);
    expect(row.live_session_id).toBe("sess_public");
    // Who was on the page, for `analytics.distinctVisitors`. There is none on an admin test call.
    expect(row.visitor_id).toBe(VISITOR);

    publicCallId = payload.callId;
  });

  it("is reported done through the public route, with no sign-in either", async () => {
    const res = await request("POST", `/demo/public/calls/${publicCallId}`, {
      body: {
        customerId: U,
        status: "completed",
        durationSec: 200,
        transcript: [said("p1", "caller", "Do you do massages?")],
      },
    });
    expect(res.status).toBe(200);
    expect((await json(res)).ok).toBe(true);

    const row = await callRow(publicCallId);
    expect(row.status).toBe("completed");
    expect(row.duration_sec).toBe(200);
    expect(row.is_test).toBe(false);
  });

  it("refuses once the demo has spent its minutes, and says so in a way the page can act on", async () => {
    const res = await request("POST", "/demo/public/session", {
      body: { customerId: U, sdp: OFFER_SDP },
    });
    expect(res.status).toBe(403);
    const body = await json(res);
    // The page swaps the call button for the contact form on this flag.
    expect(body.exhausted).toBe(true);
    expect(body.error).toContain("2 minutes");
    // Refused before OpenAI was asked, and without leaving a row behind.
    expect(await callsOf(U)).toBe(1);
  });

  it("refuses a paused demo, one still being prepared, and an id that is not one", async () => {
    const before = attempts.length;

    const paused = await request("POST", "/demo/public/session", {
      body: { customerId: P, sdp: OFFER_SDP },
    });
    expect(paused.status).toBe(403);
    expect(await json(paused)).toEqual({ error: "This demo is paused." });

    const preparing = await request("POST", "/demo/public/session", {
      body: { customerId: R, sdp: OFFER_SDP },
    });
    expect(preparing.status).toBe(409);

    const missing = await request("POST", "/demo/public/session", {
      body: { customerId: "zzzzzzzzzzzz", sdp: OFFER_SDP },
    });
    expect(missing.status).toBe(404);

    const empty = await request("POST", "/demo/public/session", { body: { customerId: U } });
    expect(empty.status).toBe(400);
    expect(await json(empty)).toEqual({ error: "Missing customerId or sdp." });

    // Nothing reached OpenAI, and no rows were opened for any of it.
    expect(attempts.length).toBe(before);
    expect(await callsOf(P)).toBe(0);
    expect(await callsOf(R)).toBe(0);
  });

  it("cannot be talked into placing a test call", async () => {
    responders.live = () => Response.json({ id: "sess_v1", transport: { sdp: ANSWER_SDP } });
    const res = await request("POST", "/demo/public/session", {
      // `isTest` was a body field on the promo's one shared route. This route has no such field, so
      // a caller sending it changes nothing — the call is still real and still spends the demo.
      body: { customerId: V, sdp: OFFER_SDP, isTest: true },
    });
    expect(res.status).toBe(200);
    expect((await callRow((await json(res)).callId)).is_test).toBe(false);
  });
});

describe("how many people may be on one demo at once", () => {
  it("lets a few colleagues on together and turns the next one away politely", async () => {
    // One is already on the line from the test above; three more fill the demo.
    for (let i = 2; i <= 4; i += 1) {
      responders.live = () => Response.json({ id: `sess_v${i}`, transport: { sdp: ANSWER_SDP } });
      const res = await request("POST", "/demo/public/session", {
        body: { customerId: V, sdp: OFFER_SDP },
      });
      expect(res.status).toBe(200);
    }
    expect(await callsOf(V)).toBe(4);

    const before = attempts.length;
    const fifth = await request("POST", "/demo/public/session", {
      body: { customerId: V, sdp: OFFER_SDP },
    });
    expect(fifth.status).toBe(429);
    expect((await json(fifth)).error).toContain("as many people on it as it can take");

    // Turned away before OpenAI was asked, and the reservation it wrote was taken back — otherwise
    // the demo would be one seat down for the ten minutes it takes a started row to age out.
    expect(attempts.length).toBe(before);
    expect(await callsOf(V)).toBe(4);
  });
});

// ==============================================================================================
// The promise this whole file makes.

describe("the network", () => {
  it("was exercised, and never once aimed at OpenAI", () => {
    // Exercised: if the stub had recorded nothing, every assertion about an outgoing request above
    // would have thrown instead — this says so out loud.
    expect(attempts.length).toBeGreaterThan(0);
    expect(attempts.map((attempt) => attempt.url).filter((url) => url.includes("api.openai.com")))
      .toEqual([]);
    // And nothing else escaped either: every attempt was to the stub base URL.
    for (const attempt of attempts) {
      expect(attempt.url.startsWith("https://openai.invalid/v1/")).toBe(true);
    }
    // No request was ever handed to the real `fetch`.
    expect(globalThis.fetch).not.toBe(realFetch);
  });
});
