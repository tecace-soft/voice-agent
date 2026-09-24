import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import type { BusinessProfile } from "../demo/types.js";

// The research pipeline — `POST /demo/customers/:id/research`, and the background run
// `POST /demo/customers` fires — driven as the admin drives it, against a real Postgres: PGlite
// behind `db/client.js`, the real DDL out of `client.ts`, the real importer for the seed, the real
// writers and the real Elysia app. Nothing between the request and the rows is a stand-in.
//
// Two things are stand-ins, both at the process boundary, exactly as `demoCall.pg.test.ts` has
// them:
//
//   * the auth guard — an admin and a signed-in non-admin have to reach the same app, and minting
//     real sessions would test `auth/session.ts` over again;
//   * `globalThis.fetch`. **No request leaves this process, and no model is ever called.** A
//     research run is two billable model calls, the first of them with web search on, so a test
//     that ran one for real would be a defect in the test and a line on a bill. The stub records
//     every attempted URL, method, headers and body, so the tests assert on the request that
//     *would* have gone out, and the last test in the file reads that record back and fails if
//     anything was aimed at api.openai.com.
//
// Run: bun test src/routes/demoResearch.pg.test.ts
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
// (connection.js), and `sql.json(x)` tags the parameter as OID 3802. Reproducing that here — with
// postgres.js's real serializer table — is what makes this file able to catch a double-encoded
// JSON value. `profile`, `sources` and `prompts` are all JSONB and all written by `saveResearch`,
// so that is load-bearing here in particular.
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
// DDL text instead, lifted out of the source — which is the point: these are the real statements.
const source = await Bun.file("src/db/client.ts").text();
const ddl = source.slice(
  source.indexOf("export async function initDb"),
  source.indexOf("// On Vercel"),
);
for (const [, statement = ""] of ddl.matchAll(/sql`([\s\S]*?)`/g)) {
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
// The seed, written by the real importer (the promo's own Redis export shape).

const U = "uuuuuuuuuuuu"; // unedited prompts — the one every good run is placed against
const E = "eeeeeeeeeeee"; // hand-edited prompts, which a run must not overwrite
const N = "nnnnnnnnnnnn"; // its business name is emptied below, for the 400

const OLD_PROFILE = { name: "Harbor Dental", category: "Dentist", address: "1 Old Road" };
const EDITED_LIVE = "You are Alex, and these words were typed by a human being.";

const customer = (id: string, businessName: string, extra: Record<string, unknown> = {}) => ({
  type: "string",
  ttl: -1,
  value: {
    id,
    businessName,
    active: true,
    profile: { ...OLD_PROFILE, name: businessName },
    dossier: "# stale briefing",
    sources: [{ url: "https://stale.test", title: "stale" }],
    prompts: {
      live: "stale live",
      backend: "stale backend",
      greeting: "stale greeting",
      edited: false,
      // At PROMPT_VERSION, so `normalize()` on read leaves them alone and anything that changes
      // them here is this file's subject rather than the read path's.
      version: 6,
    },
    voice: "meridian",
    agentName: "Alex",
    language: "en",
    status: "ready",
    createdAt: "2026-09-20T04:40:00.000Z",
    updatedAt: "2026-09-20T04:41:00.000Z",
    ...extra,
  },
});

const DUMP = {
  data: {
    customers: { type: "set", ttl: -1, value: [U, E, N] },
    [`customers:${U}`]: customer(U, "Harbor Dental", {
      websiteUrl: "https://harbordental.test",
      mapsUrl: "https://www.google.com/maps/place/Harbor+Dental/@47.6062,-122.3321,17z",
      researchNotes: "They also do emergency visits.",
    }),
    [`customers:${E}`]: customer(E, "Cedar Bakery", {
      prompts: {
        live: EDITED_LIVE,
        backend: "edited backend",
        greeting: "edited greeting",
        edited: true,
        version: 6,
      },
    }),
    [`customers:${N}`]: customer(N, "Nameless Co"),
  },
};

const { parseDump } = await import("../demo/dump.js");
const { importDump } = await import("../db/demoImport.js");
expect(await importDump(parseDump(DUMP))).toEqual({ customers: 3, calls: 0, events: 0, notes: 0 });

// A record with no business name at all. The importer will not write one, and the promo's 400 is
// for exactly this row — a link-only record whose name never got filled in.
await db.query(`UPDATE demo_customers SET business_name = '' WHERE id = $1`, [N]);

const { env } = await import("../config/env.js");
const { buildPrompts, PROMPT_VERSION } = await import("../demo/prompt.js");
const { demo, pendingResearch } = await import("./demo.js");
const { Elysia } = await import("elysia");
const app = new Elysia().use(demo);

// The settings a research run reads. Not `process.env`: `config/env.ts` reads that once, at import,
// and `bun test` shares one module registry across files — so whether this file got to set a
// variable would depend on which test file imported `env` first. Every one of these is read per
// request instead (`openai.ts`'s `base()` and `apiKey()`, `researchRunner.ts`'s `openaiModel()`,
// `searchContextSize()` and `resolveProvider()`), so they are set on the object and put back.
//
// The base URL is deliberately not OpenAI's — belt and braces with the `fetch` stub, and it is what
// makes "nothing went to api.openai.com" something the recorded list can actually show.
const TEST_ENV: Record<string, unknown> = {
  openaiApiKey: "sk-test-not-a-real-key",
  openaiBaseUrl: "https://openai.invalid/v1",
  researchProvider: "",
  researchOpenaiModel: "gpt-research-under-test",
  researchSearchContext: "",
};
const settings = env as unknown as Record<string, unknown>;
const ENV_BEFORE = Object.fromEntries(Object.keys(TEST_ENV).map((key) => [key, settings[key]]));
Object.assign(settings, TEST_ENV);
beforeEach(() => {
  Object.assign(settings, TEST_ENV);
});
afterAll(() => {
  Object.assign(settings, ENV_BEFORE);
});

// If this ever fails, `env` was frozen since — and every assertion below about the outgoing request
// would be measuring whatever the machine's real settings are.
expect({ key: env.openaiApiKey, base: env.openaiBaseUrl, model: env.researchOpenaiModel }).toEqual({
  key: "sk-test-not-a-real-key",
  base: "https://openai.invalid/v1",
  model: "gpt-research-under-test",
});

// ----------------------------------------------------------------------------------------------
// The network boundary, closed.

type Attempt = { url: string; method: string; headers: Record<string, string>; body: any };

const attempts: Attempt[] = [];

/** The two passes, in order: the searching one, then the one that only reformats. */
let passes: ((attempt: Attempt) => Response | Promise<Response>)[] = [];

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
  if (url.endsWith("/responses")) {
    const next = passes.shift();
    if (!next) throw new Error(`no responder staged for request ${attempts.length} to ${url}`);
    return next(attempt);
  }
  return new Response(JSON.stringify({ error: { message: `unexpected request to ${url}` } }), {
    status: 599,
    headers: { "content-type": "application/json" },
  });
}) as unknown as typeof fetch;

afterAll(() => {
  globalThis.fetch = realFetch;
});

// ----------------------------------------------------------------------------------------------
// What the model "says".

// The searching pass's reply. Three URLs in it, deliberately different in kind: one the profile
// pass will also name (so dedupe has something to do), one that only appears here, and a Google
// results page, which `cleanSourceUrl` drops because it is how the model got somewhere rather than
// a source for anything.
const DOSSIER = [
  "# Harbor Dental",
  "",
  "Cleanings and whitening at 42 Pier Street. Open 09:00-17:00 on weekdays.",
  "",
  "## Sources",
  "- https://harbordental.test/",
  "- https://harbordental.test/hours",
  "- https://www.google.com/search?q=harbor+dental",
].join("\n");

const RESEARCHED_PROFILE = {
  name: "Harbor Dental",
  category: "Dental clinic",
  address: "42 Pier Street",
  phone: "+1 206 555 0100",
  website: "https://harbordental.test",
  hours: [
    { day: "Monday", open: "09:00", close: "17:00", closed: false },
    { day: "Sunday", open: "", close: "", closed: true },
  ],
  services: [{ name: "Cleaning", price: "$120", description: null }],
  highlights: ["Same-day emergency visits"],
  policies: { reservations: "Book online", walkIns: "unknown", parking: null, other: [] },
  faqs: [{ q: "Do you take walk-ins?", a: "Yes, before 3pm." }],
  rating: 4.8,
  reviewSummary: "Gentle, quick, a little pricey.",
  // Named here as well as in the dossier, with a tracking parameter on it, so `cleanSourceUrl`
  // strips it and `dedupeSources` folds the two into one.
  sources: [{ url: "https://harbordental.test/?utm_source=chatgpt", title: "Harbor Dental" }],
};

/**
 * The profile object `researchBusiness` actually hands `buildPrompts`: the model's own JSON with
 * `stripEmpties` applied, `sources` removed, and the Maps coordinates appended.
 *
 * It is written out here, **in that key order**, rather than being read back off the response,
 * because `prompts.backend` embeds `JSON.stringify(backendProfile(profile), null, 2)` and key
 * order is therefore part of that string. Postgres reorders JSONB keys on the way back out, so the
 * profile a route returns is equal to this one but not serialised identically, and rebuilding the
 * prompts from *it* would produce a different `backend` for no behavioural reason. This constant is
 * what the stored prompts have to match.
 */
const PROFILE_AS_BUILT = {
  name: "Harbor Dental",
  category: "Dental clinic",
  address: "42 Pier Street",
  phone: "+1 206 555 0100",
  website: "https://harbordental.test",
  hours: [
    { day: "Monday", open: "09:00", close: "17:00", closed: false },
    { day: "Sunday", closed: true },
  ],
  services: [{ name: "Cleaning", price: "$120" }],
  highlights: ["Same-day emergency visits"],
  policies: { reservations: "Book online", other: [] },
  faqs: [{ q: "Do you take walk-ins?", a: "Yes, before 3pm." }],
  rating: 4.8,
  reviewSummary: "Gentle, quick, a little pricey.",
  lat: 47.6062,
  lng: -122.3321,
  // The cast is the Sunday row: `stripEmpties` deletes `open: ""` and `close: ""` outright, and
  // `BusinessHour` declares both required. That is the promo's own type meeting the promo's own
  // cleaner, and the value below is what really gets stored — so the literal says the truth and
  // the type is told to accept it.
} as unknown as BusinessProfile;

/** The same, for a record with no Maps link: nothing appends coordinates. */
const { lat: _lat, lng: _lng, ...PROFILE_NO_COORDS } = PROFILE_AS_BUILT;

/** `emptyProfile(name)`, in its own key order — what `createCustomer` builds prompts from. */
const emptyProfileOf = (name: string) => ({
  name,
  category: "",
  address: "",
  hours: [],
  services: [],
  highlights: [],
  policies: {},
  faqs: [],
});

/** What the searching pass answers: the briefing, plus a citation the provider reports itself. */
const answersDossier = () =>
  Response.json({
    output_text: DOSSIER,
    output: [
      {
        type: "message",
        content: [
          {
            type: "output_text",
            text: DOSSIER,
            annotations: [
              { type: "url_citation", url: "https://harbordental.test/", title: "Harbor Dental" },
            ],
          },
        ],
      },
    ],
  });

/** What the reformatting pass answers: the profile as JSON, fenced the way a model tends to. */
const answersProfile = () =>
  Response.json({
    output_text: "```json\n" + JSON.stringify(RESEARCHED_PROFILE) + "\n```",
  });

const refuses = (status: number, message: string) => () =>
  new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { "content-type": "application/json" },
  });

/** Stage a whole successful run. */
const stageSuccess = () => {
  passes = [answersDossier, answersProfile];
};

beforeEach(() => {
  passes = [];
});

// ----------------------------------------------------------------------------------------------
// Driving the app.

const json = (res: Response): Promise<Record<string, any>> =>
  res.json() as Promise<Record<string, any>>;

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

const asAdmin = (method: string, path: string, payload?: unknown) =>
  request(method, path, { auth: ADMIN, body: payload });

const rowOf = async (id: string): Promise<Record<string, any>> => {
  const [row] = (
    await db.query(
      `SELECT *, jsonb_typeof(profile) AS profile_kind, jsonb_typeof(sources) AS sources_kind,
              jsonb_typeof(prompts) AS prompts_kind
         FROM demo_customers WHERE id = $1`,
      [id],
    )
  ).rows as any[];
  if (!row) throw new Error(`no demo_customers row ${id}`);
  return row;
};

/** The most recent request aimed at that endpoint, or a failure that names it. */
function sentTo(suffix: string): Attempt {
  const found = [...attempts].reverse().find((attempt) => attempt.url.endsWith(suffix));
  if (!found) throw new Error(`nothing was sent to ${suffix}`);
  return found;
}

// ==============================================================================================

describe("POST /demo/customers/:id/research — a run that works", () => {
  it("stores the profile, the dossier and the deduped sources, and lands on ready", async () => {
    const before = await rowOf(U);
    stageSuccess();

    const res = await asAdmin("POST", `/demo/customers/${U}/research`);
    expect(res.status).toBe(200);
    const customer = (await json(res)).customer;

    expect(customer.status).toBe("ready");
    expect(customer.error).toBeUndefined();
    expect(customer.profile.address).toBe("42 Pier Street");
    expect(customer.profile.category).toBe("Dental clinic");
    expect(customer.dossier).toBe(DOSSIER);

    // The provider's own citation first, then what only the briefing mentioned. The tracking
    // parameter is stripped, the bare domain loses its trailing slash, the duplicate is folded and
    // the Google results page is not a source at all.
    expect(customer.sources).toEqual([
      { url: "https://harbordental.test", title: "Harbor Dental" },
      { url: "https://harbordental.test/hours", title: "harbordental.test" },
    ]);

    // The coordinates come off the Maps link, which is parsed rather than fetched (it is not a
    // short link, so `resolveMapsUrl` returns it unchanged).
    expect(customer.resolvedMapsUrl).toBe(
      "https://www.google.com/maps/place/Harbor+Dental/@47.6062,-122.3321,17z",
    );
    expect(customer.profile.lat).toBe(47.6062);
    expect(customer.profile.lng).toBe(-122.3321);

    // `stripEmpties` drops nulls and "unknown" before anything is stored.
    expect(customer.profile.policies).toEqual({ reservations: "Book online", other: [] });
    expect(customer.profile.services).toEqual([{ name: "Cleaning", price: "$120" }]);
    // And `sources` is not left on the profile — it belongs to the record, not to the business.
    expect(customer.profile.sources).toBeUndefined();

    const row = await rowOf(U);
    expect(row.status).toBe("ready");
    expect(row.error).toBe(null);
    expect(row.researched_at).not.toBe(null);
    expect(row.researched_at).not.toEqual(before.researched_at);
    // Objects in the JSONB columns, not JSON strings — the bug `jsonb()` exists to prevent.
    expect(row.profile_kind).toBe("object");
    expect(row.sources_kind).toBe("array");
    expect(row.prompts_kind).toBe("object");
  });

  // ============================================================================================
  // THE behaviour of this task: prompts are rebuilt FROM the research result. A run that stored a
  // new profile and left the receptionist describing the old one has done nothing useful.
  it("rebuilds the prompts from the research result", async () => {
    stageSuccess();
    const res = await asAdmin("POST", `/demo/customers/${U}/research`);
    expect(res.status).toBe(200);
    const customer = (await json(res)).customer;

    // Byte for byte what `buildPrompts` makes of the profile that was just stored, with this
    // record's own agent name and language — the promo's
    // `buildPrompts(result.profile, customer.agentName, customer.language)`.
    expect(customer.prompts).toEqual(buildPrompts(PROFILE_AS_BUILT, "Alex", "en"));
    expect(customer.prompts.version).toBe(PROMPT_VERSION);
    expect(customer.prompts.edited).toBe(false);

    // And they really are about the researched business rather than the stale one.
    expect(customer.prompts.live).toContain("42 Pier Street");
    expect(customer.prompts.live).not.toContain("1 Old Road");
    expect(customer.prompts.live).not.toBe("stale live");

    // Stored, not merely returned.
    expect((await rowOf(U)).prompts).toEqual(customer.prompts);
  });

  it("keeps hand-edited prompts, unless regeneratePrompts says otherwise", async () => {
    stageSuccess();
    const kept = (await json(await asAdmin("POST", `/demo/customers/${E}/research`))).customer;
    expect(kept.prompts.live).toBe(EDITED_LIVE);
    expect(kept.prompts.edited).toBe(true);
    // The profile was still replaced — only the prompts were spared.
    expect(kept.profile.address).toBe("42 Pier Street");

    stageSuccess();
    const redone = (
      await json(await asAdmin("POST", `/demo/customers/${E}/research`, { regeneratePrompts: true }))
    ).customer;
    expect(redone.prompts.live).not.toBe(EDITED_LIVE);
    expect(redone.prompts).toEqual(buildPrompts(PROFILE_NO_COORDS, "Alex", "en"));
    expect(redone.prompts.edited).toBe(false);
  });

  it("sends the request it should, and no request it should not", async () => {
    stageSuccess();
    expect((await asAdmin("POST", `/demo/customers/${U}/research`)).status).toBe(200);

    const [searching, reformatting] = attempts.slice(-2) as [Attempt, Attempt];

    expect(searching.url).toBe("https://openai.invalid/v1/responses");
    expect(searching.method).toBe("POST");
    expect(searching.headers.Authorization).toBe("Bearer sk-test-not-a-real-key");
    expect(searching.body.model).toBe("gpt-research-under-test");
    expect(searching.body.max_output_tokens).toBe(8000);
    // The searching pass gets the web search tool; `RESEARCH_SEARCH_CONTEXT` is unset, so medium.
    expect(searching.body.tools).toEqual([
      { type: "web_search", search_context_size: "medium" },
    ]);
    // And the operator's own inputs reach the prompt.
    expect(searching.body.input).toContain('Research the business "Harbor Dental"');
    expect(searching.body.input).toContain("- Website (operator supplied): https://harbordental.test");
    expect(searching.body.input).toContain("- Notes from the operator: They also do emergency visits.");
    expect(searching.body.input).toContain("- Name on that listing: Harbor Dental");

    // The second pass only reformats, so it gets no tools and is handed the briefing verbatim.
    expect(reformatting.body.tools).toEqual([]);
    expect(reformatting.body.input).toContain("Convert this research briefing into JSON.");
    expect(reformatting.body.input).toContain(DOSSIER);
  });

  it("honours RESEARCH_SEARCH_CONTEXT", async () => {
    settings.researchSearchContext = "high";
    stageSuccess();
    expect((await asAdmin("POST", `/demo/customers/${U}/research`)).status).toBe(200);
    expect(attempts.at(-2)!.body.tools).toEqual([
      { type: "web_search", search_context_size: "high" },
    ]);
  });

  it("takes revised inputs from the body and stores them", async () => {
    stageSuccess();
    const res = await asAdmin("POST", `/demo/customers/${U}/research`, {
      businessName: "  Harbor Dental Downtown  ",
      researchNotes: "",
      websiteUrl: "https://downtown.harbordental.test",
    });
    expect(res.status).toBe(200);

    const searching = sentTo("/responses");
    expect(attempts.at(-2)!.body.input).toContain('"Harbor Dental Downtown"');
    expect(attempts.at(-2)!.body.input).not.toContain("Notes from the operator");
    expect(searching.body.input).toContain("Convert this research briefing into JSON.");

    const row = await rowOf(U);
    // The profile's own name wins where the research found one, which is the promo's
    // `result.businessName || businessName` against a profile that named itself.
    expect(row.website_url).toBe("https://downtown.harbordental.test");
    expect(row.research_notes).toBe(null); // "" clears, as everywhere else in this API
  });
});

describe("POST /demo/customers/:id/research — a run that fails", () => {
  it("answers 502 with the model's own message and marks the record", async () => {
    const before = await rowOf(U);
    passes = [refuses(429, "Rate limit reached for gpt-research-under-test.")];

    const res = await asAdmin("POST", `/demo/customers/${U}/research`);
    expect(res.status).toBe(502);
    expect(await json(res)).toEqual({
      error: "Rate limit reached for gpt-research-under-test.",
    });

    const after = await rowOf(U);
    expect(after.status).toBe("error");
    expect(after.error).toBe("Rate limit reached for gpt-research-under-test.");

    // **The record is left usable.** Everything a call would read is exactly what it was: the
    // profile, the dossier, the sources and the prompts. A failed run costs the operator a retry,
    // not the receptionist they already had.
    expect(after.profile).toEqual(before.profile);
    expect(after.dossier).toBe(before.dossier);
    expect(after.sources).toEqual(before.sources);
    expect(after.prompts).toEqual(before.prompts);
    expect(after.researched_at).toEqual(before.researched_at);
  });

  it("is not wedged by that — the next run succeeds and clears the error", async () => {
    expect((await rowOf(U)).status).toBe("error");
    stageSuccess();

    const res = await asAdmin("POST", `/demo/customers/${U}/research`);
    expect(res.status).toBe(200);
    const customer = (await json(res)).customer;
    expect(customer.status).toBe("ready");
    expect(customer.error).toBeUndefined();

    const row = await rowOf(U);
    expect(row.status).toBe("ready");
    expect(row.error).toBe(null);
  });

  it("reports an empty reply rather than storing one", async () => {
    passes = [() => Response.json({ output_text: "   " })];
    const res = await asAdmin("POST", `/demo/customers/${U}/research`);
    expect(res.status).toBe(502);
    expect(await json(res)).toEqual({ error: "The research run came back empty." });
    expect((await rowOf(U)).status).toBe("error");
  });

  it("reports a reply that is not JSON rather than storing one", async () => {
    passes = [answersDossier, () => Response.json({ output_text: "Sorry, I cannot help." })];
    const res = await asAdmin("POST", `/demo/customers/${U}/research`);
    expect(res.status).toBe(502);
    expect((await json(res)).error).toContain("The research reply was not valid JSON");
  });

  it("refuses a provider this backend does not carry, by name", async () => {
    settings.researchProvider = "cli";
    const before = attempts.length;
    const res = await asAdmin("POST", `/demo/customers/${U}/research`);
    expect(res.status).toBe(502);
    expect(await json(res)).toEqual({
      error:
        'Research is set to the "cli" provider, which this backend does not carry. Unset RESEARCH_PROVIDER, or set it to openai.',
    });
    // Nothing was asked of anybody: the refusal happens before the first request is built.
    expect(attempts.length).toBe(before);
  });

  it("refuses with the promo's own message when there is no API key", async () => {
    settings.openaiApiKey = undefined;
    const res = await asAdmin("POST", `/demo/customers/${U}/research`);
    expect(res.status).toBe(502);
    expect(await json(res)).toEqual({ error: "OPENAI_API_KEY is not set on the server." });
  });
});

describe("POST /demo/customers/:id/research — refusals", () => {
  it("404s an id nobody has", async () => {
    const res = await asAdmin("POST", "/demo/customers/zzzzzzzzzzzz/research");
    expect(res.status).toBe(404);
    expect(await json(res)).toEqual({ error: "Customer not found." });
  });

  it("400s a record with no business name, stored or sent", async () => {
    const res = await asAdmin("POST", `/demo/customers/${N}/research`);
    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({ error: "Enter the business name." });
    // And a blank one in the body is a no-op rather than a name.
    const blank = await asAdmin("POST", `/demo/customers/${N}/research`, { businessName: "   " });
    expect(blank.status).toBe(400);
    expect(await json(blank)).toEqual({ error: "Enter the business name." });
    // Nothing was run for either.
    expect((await rowOf(N)).status).toBe("ready");
  });

  it("names the record 404 when it is deleted while the run is in flight", async () => {
    passes = [
      answersDossier,
      async (attempt) => {
        await db.query(`DELETE FROM demo_customers WHERE id = $1`, [N]);
        return answersProfile();
      },
    ];
    // Give it a name first, so it gets past the 400 and actually runs.
    await db.query(`UPDATE demo_customers SET business_name = 'Nameless Co' WHERE id = $1`, [N]);

    const res = await asAdmin("POST", `/demo/customers/${N}/research`);
    expect(res.status).toBe(404);
    expect(await json(res)).toEqual({ error: "Customer not found." });
    expect((await db.query(`SELECT id FROM demo_customers WHERE id = $1`, [N])).rows).toEqual([]);
  });

  it("403s a signed-in non-admin and 401s nobody, before anything is run", async () => {
    const before = await rowOf(U);
    const forbidden = await request("POST", `/demo/customers/${U}/research`, { auth: NON_ADMIN });
    expect(forbidden.status).toBe(403);
    expect(await json(forbidden)).toEqual({
      error: "forbidden",
      message: "Only an admin can read the demo data.",
    });

    const anonymous = await request("POST", `/demo/customers/${U}/research`);
    expect(anonymous.status).toBe(401);
    expect(await json(anonymous)).toEqual({
      error: "unauthorized",
      message: "Sign in to continue.",
    });

    // Neither of them got as far as staging a model call — `passes` is still the empty array this
    // describe's `beforeEach` left, and the stub throws when it is asked with nothing staged.
    expect(passes).toEqual([]);
    // And neither of them touched the record — not even to set it "researching".
    expect(await rowOf(U)).toEqual(before);
  });
});

// ==============================================================================================
// Research on create: the promo's `after(...)`, reproduced as an un-awaited call.

describe("POST /demo/customers researches in the background", () => {
  it("answers 201 at researching, then finishes and updates the record", async () => {
    stageSuccess();
    const res = await asAdmin("POST", "/demo/customers", {
      businessName: "  Harbor Dental  ",
      websiteUrl: "https://harbordental.test",
    });
    expect(res.status).toBe(201);
    const created = (await json(res)).customer;

    // The response did not wait for the run: the prospect comes back with the empty profile
    // `createCustomer` made and the promo's own "researching".
    expect(created.status).toBe("researching");
    expect(created.profile).toEqual(emptyProfileOf("Harbor Dental"));
    expect(created.dossier).toBe("");
    expect(created.sources).toEqual([]);
    // Thin, but a working receptionist from the first moment.
    expect(created.prompts).toEqual(buildPrompts(emptyProfileOf("Harbor Dental"), "Alex", "en"));

    await pendingResearch();

    const row = await rowOf(created.id);
    expect(row.status).toBe("ready");
    expect(row.error).toBe(null);
    expect(row.profile.address).toBe("42 Pier Street");
    expect(row.dossier).toBe(DOSSIER);
    expect(row.sources).toEqual([
      { url: "https://harbordental.test", title: "Harbor Dental" },
      { url: "https://harbordental.test/hours", title: "harbordental.test" },
    ]);
    // Rebuilt from what the run found, not from the empty profile it was created with.
    expect(row.profile).toEqual(PROFILE_NO_COORDS);
    expect(row.prompts).toEqual(buildPrompts(PROFILE_NO_COORDS, "Alex", "en"));
    expect(row.prompts.live).toContain("42 Pier Street");
    expect(row.prompts).not.toEqual(created.prompts);
  });

  it("marks the record when the background run fails, and never rejects", async () => {
    passes = [refuses(500, "The upstream model fell over.")];
    const res = await asAdmin("POST", "/demo/customers", { businessName: "Fallible Co" });
    expect(res.status).toBe(201);
    const created = (await json(res)).customer;
    expect(created.status).toBe("researching");

    // `runResearch` is called without being awaited, so a rejection here would be an unhandled
    // promise rejection rather than a report. This resolving is the assertion.
    await pendingResearch();

    const row = await rowOf(created.id);
    expect(row.status).toBe("error");
    expect(row.error).toBe("The upstream model fell over.");
    // Still usable: the thin prompts it was created with are untouched.
    expect(row.prompts).toEqual(created.prompts);
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
    // And nothing else escaped either: every attempt was to the stub base URL. In particular no
    // request ever went to a real Google Maps short link, which `resolveMapsUrl` would follow.
    for (const attempt of attempts) {
      expect(attempt.url.startsWith("https://openai.invalid/v1/")).toBe(true);
    }
    // No request was ever handed to the real `fetch`.
    expect(globalThis.fetch).not.toBe(realFetch);
  });
});
