import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

// The Twilio numbers routes: an admin sees the numbers on our Twilio account, each with where its
// calls go and whether it is in our own list, and can point one at the voice agent.
//
// Nothing real is called. Twilio is a small stateful fake behind a stubbed `fetch` at
// https://twilio.fake.test (TWILIO_API_BASE), holding three numbers: one already on the agent, one
// with no voice URL, one ringing a Twilio demo. The database is PGlite behind the same
// `../db/client.js` shim appointments.e2e.pg.test.ts uses (copied, not imported: a test file
// importing another would run its tests too).
//
// Run: bun test src/routes/twilioNumbers.pg.test.ts
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

// Twilio configured, over the real env (mock.module is process-wide, so a partial env would break
// later test files). Kept as one mutable object so a test can switch a setting off and back on.
const AGENT = "https://agent.fake.test";
const TWILIO = "https://twilio.fake.test";
const { env: realEnv } = await import("../config/env.js");
const testEnv: Record<string, unknown> = {
  ...realEnv,
  twilioAccountSid: "AC123",
  twilioApiKeySid: "SK456",
  twilioApiKeySecret: "key-secret",
  twilioAuthToken: "",
  twilioApiBase: TWILIO,
  agentPublicUrl: AGENT,
};
await mock.module("../config/env.js", () => ({ env: testEnv }));

const { createUser } = await import("../db/users.js");
const { createToken } = await import("../auth/session.js");
const { createAgentNumber, assignAgentNumber } = await import("../db/agentNumbers.js");

async function account(email: string, role: "admin" | "user") {
  const user = (await createUser({ email, name: email, passwordHash: "x".repeat(60), role }))!;
  return { id: user.id, auth: `Bearer ${createToken(user.id, user.tokenVersion).token}` };
}

const admin = await account("ops.twilio@tecace.com", "admin");
const jane = await account("jane.twilio@glow.example", "user");

// Our own list: the connected number is registered and Jane's; the other two aren't registered.
const ON_AGENT = "+14255988987";
const EMPTY = "+14255987522";
const DEMO = "+14256969728";
await assignAgentNumber((await createAgentNumber({ phone: ON_AGENT, label: "Main" })).id, jane.id);

// ---- the fake Twilio ----------------------------------------------------------------------------

type FakeNumber = { sid: string; phone_number: string; friendly_name: string; voice_url: string; voice_fallback_url: string };
let twilio: FakeNumber[] = [];
let twilioAnswers401 = false;
const posts: { path: string; form: Record<string, string>; auth: string | null }[] = [];

function resetTwilio() {
  twilio = [
    { sid: "PN0001", phone_number: ON_AGENT, friendly_name: "(425) 598-8987", voice_url: `${AGENT}/incoming`, voice_fallback_url: `${AGENT}/incoming-fallback` },
    { sid: "PN0002", phone_number: EMPTY, friendly_name: "(425) 598-7522", voice_url: "", voice_fallback_url: "" },
    { sid: "PN0003", phone_number: DEMO, friendly_name: "(425) 696-9728", voice_url: "https://demo.twilio.com/welcome/voice/", voice_fallback_url: "" },
  ];
  twilioAnswers401 = false;
  posts.length = 0;
}
resetTwilio();

const LIST = "/2010-04-01/Accounts/AC123/IncomingPhoneNumbers.json";
const ONE = /^\/2010-04-01\/Accounts\/AC123\/IncomingPhoneNumbers\/(PN\w+)\.json$/;

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: RequestInit) => {
  const url = new URL(String(input));
  if (url.origin !== TWILIO) return realFetch(input, init);
  const headers = new Headers(init?.headers);
  const reply = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  if (twilioAnswers401) return reply({ code: 20003, message: "Authenticate" }, 401);
  if (url.pathname === LIST && (init?.method ?? "GET") === "GET") {
    return reply({ incoming_phone_numbers: twilio, next_page_uri: null });
  }
  const match = url.pathname.match(ONE);
  if (match && init?.method === "POST") {
    const form = Object.fromEntries(new URLSearchParams(String(init.body)));
    posts.push({ path: url.pathname, form, auth: headers.get("authorization") });
    const number = twilio.find((n) => n.sid === match[1]);
    if (!number) return reply({ message: "The requested resource was not found" }, 404);
    number.voice_url = form.VoiceUrl ?? number.voice_url;
    number.voice_fallback_url = form.VoiceFallbackUrl ?? number.voice_fallback_url;
    return reply(number);
  }
  return reply({ message: "unexpected request" }, 400);
}) as typeof fetch;

afterAll(async () => {
  globalThis.fetch = realFetch;
  await db.close();
});

const { app } = await import("../app.js");

async function call(method: string, path: string, auth: string | null, payload?: unknown) {
  const headers: Record<string, string> = {};
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
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

beforeEach(() => {
  resetTwilio();
  testEnv.twilioAccountSid = "AC123";
  testEnv.agentPublicUrl = AGENT;
});

// ---- listing ------------------------------------------------------------------------------------

describe("GET /business/numbers/twilio", () => {
  it("is admin only", async () => {
    expect((await call("GET", "/business/numbers/twilio", null)).status).toBe(401);
    expect((await call("GET", "/business/numbers/twilio", jane.auth)).status).toBe(403);
  });

  it("lists every Twilio number with where it rings and whether it is in our list", async () => {
    const { status, body } = await call("GET", "/business/numbers/twilio", admin.auth);
    expect(status).toBe(200);
    expect(body.configured).toBe(true);
    expect(body.agentUrl).toBe(`${AGENT}/incoming`);
    expect(body.numbers.map((n: any) => [n.phoneE164, n.status])).toEqual([
      [EMPTY, "not_connected"],
      [ON_AGENT, "connected"],
      [DEMO, "elsewhere"],
    ]);
    const main = body.numbers.find((n: any) => n.phoneE164 === ON_AGENT);
    expect(main.sid).toBe("PN0001");
    expect(main.registered).toMatchObject({ label: "Main", userId: jane.id, userEmail: "jane.twilio@glow.example" });
    const demo = body.numbers.find((n: any) => n.phoneE164 === DEMO);
    expect(demo.registered).toBeNull();
    expect(demo.voiceUrl).toBe("https://demo.twilio.com/welcome/voice/");
  });

  it("still lists without an agent URL, with nothing reported as connected", async () => {
    testEnv.agentPublicUrl = "";
    const { status, body } = await call("GET", "/business/numbers/twilio", admin.auth);
    expect(status).toBe(200);
    expect(body.agentUrl).toBeNull();
    expect(body.numbers.some((n: any) => n.status === "connected")).toBe(false);
  });

  // A normal state for a deployment, not a failure: a 200 the page reads as a note (a 503 here would
  // log a console error on every visit to the page).
  it("answers configured: false when Twilio is not configured", async () => {
    testEnv.twilioAccountSid = "";
    const { status, body } = await call("GET", "/business/numbers/twilio", admin.auth);
    expect(status).toBe(200);
    expect(body).toEqual({ configured: false, agentUrl: null, numbers: [] });
  });

  it("answers 502 twilio_auth when Twilio rejects the credentials", async () => {
    twilioAnswers401 = true;
    const { status, body } = await call("GET", "/business/numbers/twilio", admin.auth);
    expect(status).toBe(502);
    expect(body.error).toBe("twilio_auth");
    expect(JSON.stringify(body)).not.toContain("key-secret");
  });
});

// ---- connecting ---------------------------------------------------------------------------------

describe("POST /business/numbers/twilio/:sid/connect", () => {
  it("is admin only", async () => {
    expect((await call("POST", "/business/numbers/twilio/PN0002/connect", null, {})).status).toBe(401);
    expect((await call("POST", "/business/numbers/twilio/PN0002/connect", jane.auth, {})).status).toBe(403);
    expect(posts).toHaveLength(0);
  });

  it("points a number with no voice URL at the agent", async () => {
    const { status, body } = await call("POST", "/business/numbers/twilio/PN0002/connect", admin.auth, {});
    expect(status).toBe(200);
    expect(body.number).toMatchObject({ sid: "PN0002", phoneE164: EMPTY, status: "connected", registered: null });
    expect(posts).toHaveLength(1);
    expect(posts[0]!.form).toEqual({
      VoiceUrl: `${AGENT}/incoming`,
      VoiceMethod: "POST",
      VoiceFallbackUrl: `${AGENT}/incoming-fallback`,
      VoiceFallbackMethod: "POST",
    });
    expect(posts[0]!.auth).toBe(`Basic ${btoa("SK456:key-secret")}`);
  });

  it("asks before overwriting a number that rings somewhere else", async () => {
    const refused = await call("POST", "/business/numbers/twilio/PN0003/connect", admin.auth, {});
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe("points_elsewhere");
    expect(refused.body.voiceUrl).toBe("https://demo.twilio.com/welcome/voice/");
    expect(refused.body.message).toContain("https://demo.twilio.com/welcome/voice/");
    expect(posts).toHaveLength(0);

    const done = await call("POST", "/business/numbers/twilio/PN0003/connect", admin.auth, { overwrite: true });
    expect(done.status).toBe(200);
    expect(done.body.number.status).toBe("connected");
    expect(posts).toHaveLength(1);
  });

  it("says so for a number that is not on the account", async () => {
    const { status, body } = await call("POST", "/business/numbers/twilio/PN9999/connect", admin.auth, {});
    expect(status).toBe(404);
    expect(body.error).toBe("not_found");
    expect(posts).toHaveLength(0);
  });

  it("answers 503 without an agent URL, and without Twilio", async () => {
    testEnv.agentPublicUrl = "";
    const noAgent = await call("POST", "/business/numbers/twilio/PN0002/connect", admin.auth, {});
    expect(noAgent.status).toBe(503);
    expect(noAgent.body.error).toBe("agent_url_not_configured");

    testEnv.agentPublicUrl = AGENT;
    testEnv.twilioAccountSid = "";
    const noTwilio = await call("POST", "/business/numbers/twilio/PN0002/connect", admin.auth, {});
    expect(noTwilio.status).toBe(503);
    expect(noTwilio.body.error).toBe("twilio_not_configured");
    expect(posts).toHaveLength(0);
  });

  it("answers 502 twilio_auth when Twilio rejects the credentials", async () => {
    twilioAnswers401 = true;
    const { status, body } = await call("POST", "/business/numbers/twilio/PN0002/connect", admin.auth, {});
    expect(status).toBe(502);
    expect(body.error).toBe("twilio_auth");
  });
});
