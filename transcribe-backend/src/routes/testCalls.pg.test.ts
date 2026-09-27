import { afterAll, describe, expect, it, mock } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

// A business's in-app test calls, through the real routes against a real Postgres (PGlite), with
// OpenAI stubbed at `fetch` — no request leaves the process.
//
// What matters: the session is the composed one, built from the DRAFT call settings with their tools;
// a customer is held to a monthly allowance and an admin is not; a report is written once and only
// by the account the call belongs to.
//
// Run: bun test src/routes/testCalls.pg.test.ts
process.env.DATABASE_URL ??= "postgres://unused/unused";
process.env.AUTH_SECRET ??= "test-secret-test-secret-test-secret-0123";

const db = await PGlite.create();

// A postgres.js-shaped tagged template over PGlite: it builds $1..$n and splices a nested fragment
// (sql`business_id`) as text with its values merged, which is what postgres.js itself does. The
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

const ADMIN = await bearerFor("admin@tecace.com", "admin");
const JANE = await bearerFor("jane@tecace.com", "user");
const BOB = await bearerFor("bob@tecace.com", "user");

const { env } = await import("../config/env.js");
const settingsEnv = env as unknown as Record<string, unknown>;
const TEST_ENV: Record<string, unknown> = {
  openaiApiKey: "sk-test-not-a-real-key",
  openaiBaseUrl: "https://openai.invalid/v1",
  openaiLiveModel: "gpt-live-1-under-test",
  openaiBackendModel: "gpt-backend-under-test",
  testSecondsPerMonth: 600,
};
const ENV_BEFORE = Object.fromEntries(Object.keys(TEST_ENV).map((k) => [k, settingsEnv[k]]));
Object.assign(settingsEnv, TEST_ENV);

type Attempt = { url: string; body: any };
const attempts: Attempt[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init: RequestInit = {}) => {
  const url = typeof input === "string" ? input : input.url;
  attempts.push({ url, body: init.body ? JSON.parse(String(init.body)) : null });
  if (url.endsWith("/live/sessions")) return Response.json({ id: "sess_test", transport: { sdp: "v=0 answer" } });
  // The reviewer: no review, so reports stay quick and deterministic.
  if (url.endsWith("/responses")) return Response.json({ output_text: "not json" });
  return new Response("unexpected", { status: 500 });
}) as typeof fetch;

afterAll(async () => {
  globalThis.fetch = realFetch;
  Object.assign(settingsEnv, ENV_BEFORE);
  await db.close();
});

const { app } = await import("../app.js");
const { findUserByEmail } = await import("../db/users.js");
const { saveProfile } = await import("../db/businessProfiles.js");
const { saveCallSettingsDraft } = await import("../db/callSettings.js");
const { validateCallSettings } = await import("../business/callSettings.js");

const jane = (await findUserByEmail("jane@tecace.com"))!;
const bob = (await findUserByEmail("bob@tecace.com"))!;

async function call(method: string, path: string, auth: string, payload?: unknown) {
  const response = await app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: { authorization: auth, "content-type": "application/json", "x-forwarded-for": `10.0.0.${Math.floor(Math.random() * 250)}` },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    }),
  );
  return { status: response.status, body: (await response.json()) as any };
}

const SDP = "v=0 offer";

describe("business test calls", () => {
  it("needs business information first", async () => {
    const res = await call("POST", "/business/test/session", JANE, { sdp: SDP });
    expect(res.status).toBe(409);
  });

  it("builds the composed session from the DRAFT settings, with their tools", async () => {
    await saveProfile(
      jane.id,
      "Jane's Salon.",
      { businessName: "Jane's Salon", hoursText: null, openHour: null, closeHour: null, website: null, facts: "Cuts." },
      { transferNumber: null, agentName: "Mia", greeting: null, transferTopics: null, houseRules: null },
      {
        profile: { name: "Jane's Salon", category: "Hair salon", address: "1 A St, Tacoma, WA", hours: [], services: [], highlights: [], policies: {}, faqs: [] },
        prompts: null as never,
        voice: "gleam",
        language: null,
      },
    );
    await saveCallSettingsDraft(
      jane.id,
      validateCallSettings(
        {
          transfer: { scenarios: [{ id: "front", mode: "warm", name: "Front desk", numbers: ["2065550134"] }] },
          links: { scenarios: [{ id: "map", triggers: ["directions"], url: "https://maps.example.com/jane" }] },
        },
        { waterfallAllowed: false },
      ),
    );
    const res = await call("POST", "/business/test/session", JANE, { sdp: SDP });
    expect(res.status).toBe(200);
    expect(res.body.callId).toBeTruthy();
    expect(res.body.greeting).toContain("Jane's Salon");
    expect(res.body.maxSec).toBeLessThanOrEqual(600);

    const sent = attempts.filter((a) => a.url.endsWith("/live/sessions")).at(-1)!.body.session;
    expect(sent.model).toBe("gpt-live-1-under-test");
    expect(sent.instructions).toContain('scenario_id "front"');
    expect(sent.instructions).toContain("(an in-app test call)");
    const tools = sent.delegation.responses.tools;
    expect(tools.map((t: { name: string }) => t.name)).toEqual(["transfer_call", "send_link", "take_message", "end_call"]);
    expect(tools.every((t: { strict: boolean }) => t.strict === false)).toBe(true);
  });

  it("records a report once, only for the account it belongs to", async () => {
    const started = await call("POST", "/business/test/session", JANE, { sdp: SDP });
    const id = started.body.callId;
    const transcript = [{ id: "t1", speaker: "caller", text: "Hi", startMs: 0, endMs: 500 }];
    const events = [{ at: new Date().toISOString(), type: "transfer_result", data: { result: "accepted" } }, { bad: true }];

    const stranger = await call("POST", `/business/test/calls/${id}`, BOB, { status: "completed", durationSec: 40, transcript });
    expect(stranger.status).toBe(404);

    const first = await call("POST", `/business/test/calls/${id}`, JANE, { status: "completed", durationSec: 40, transcript, events });
    expect(first.status).toBe(200);
    const second = await call("POST", `/business/test/calls/${id}`, JANE, { status: "failed", durationSec: 1, transcript: [] });
    expect(second.status).toBe(200);

    const list = await call("GET", "/business/test/calls", JANE);
    const row = list.body.calls.find((c: { id: string }) => c.id === id);
    expect(row.status).toBe("completed");
    expect(row.durationSec).toBe(40);
    expect(row.transcript).toHaveLength(1);
    expect(row.events).toEqual([events[0]]);
  });

  it("holds a customer to the monthly allowance, and lets an admin set it", async () => {
    // Close out the call the earlier test left open, so only reported time counts.
    const open = await call("GET", "/business/test/calls", JANE);
    for (const c of open.body.calls.filter((c: { status: string }) => c.status === "started")) {
      await call("POST", `/business/test/calls/${c.id}`, JANE, { status: "completed", durationSec: 0 });
    }
    const cap = await call("PUT", `/business/test/cap?userId=${jane.id}`, ADMIN, { seconds: 50 });
    expect(cap.status).toBe(200);
    expect(cap.body.usage.usedSec).toBe(40);

    const selfService = await call("PUT", `/business/test/cap?userId=${jane.id}`, JANE, { seconds: 9999 });
    expect(selfService.status).toBe(403);

    const refused = await call("POST", "/business/test/session", JANE, { sdp: SDP });
    expect(refused.status).toBe(403);
    expect(refused.body.exhausted).toBe(true);

    const usage = await call("GET", "/business/test/calls", JANE);
    expect(usage.body.usage).toMatchObject({ usedSec: 40, capSec: 50, remainingSec: 10, unlimited: false });

    // An admin acting for the business is not held to it.
    const admin = await call("POST", "/business/test/session", ADMIN, { sdp: SDP, customerId: jane.id });
    expect(admin.status).toBe(200);
  });

  it("never reaches the real OpenAI", () => {
    expect(attempts.every((a) => a.url.startsWith("https://openai.invalid/"))).toBe(true);
  });
});
