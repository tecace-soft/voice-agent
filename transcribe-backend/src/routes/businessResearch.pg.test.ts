import { afterAll, describe, expect, it, mock } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

// `POST /business/research`: a business re-runs the research that fills Business information, instead
// of typing it all again. Driven through the real routes against a real Postgres (PGlite, the harness
// demoResearch.pg.test.ts uses). The research run is real code; only its paid OpenAI call is answered
// in-process (`globalThis.fetch`). Its prompts are pinned in `src/demo/research.test.ts`.
//
// Run: bun test src/routes/businessResearch.pg.test.ts
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

// The research run's one outside call — OpenAI's Responses API — answered here, as
// demoResearch.pg.test.ts does it. Not `mock.module("../demo/research.js")`: Bun keeps a module mock
// for every file in the run, and the demo's own research tests would get this stand-in too.
// `asked` is the searching pass's prompt, which carries the name, links and notes the run was given.
const asked: string[] = [];
let researchFails: string | null = null;
const FOUND = {
  name: "Glow Spa",
  category: "Day spa",
  address: "5 Pine St, Seattle, WA",
  phone: "+1 206 555 0100",
  website: "https://glowspa.example",
  hours: [{ day: "Monday", open: "09:00", close: "18:00", closed: false }],
  services: [{ name: "Facial", price: "$90", description: null }],
  highlights: ["Free parking"],
  policies: { reservations: "Book online", other: [] },
  faqs: [
    { q: "Do you take walk-ins?", a: "Yes, when a therapist is free." },
    { q: "Is there parking?", a: "Free parking behind the building." },
  ],
  sources: [{ url: "https://glowspa.example/faq", title: "FAQ" }],
};
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init: RequestInit = {}) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : String(input?.url);
  if (!url.endsWith("/responses")) return realFetch(input, init);
  const body = JSON.parse(String(init.body ?? "{}"));
  const searching = Array.isArray(body.tools) && body.tools.length > 0;
  if (searching) {
    asked.push(String(body.input));
    if (researchFails) {
      return new Response(JSON.stringify({ error: { message: researchFails } }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }
    return Response.json({ output_text: "# Glow Spa\n\n## Published FAQs\n- Do you take walk-ins? Yes." });
  }
  return Response.json({ output_text: JSON.stringify(FOUND) });
}) as unknown as typeof fetch;

const { createUser, findUserByEmail, setLifecycleById } = await import("../db/users.js");
const { createToken } = await import("../auth/session.js");
const { saveProfile, findProfile } = await import("../db/businessProfiles.js");
const { env } = await import("../config/env.js");
const { business } = await import("./business.js");
const { Elysia } = await import("elysia");
const app = new Elysia().use(business);

const settings = env as unknown as Record<string, unknown>;
const TEST_ENV: Record<string, unknown> = {
  openaiApiKey: "sk-test-not-a-real-key",
  openaiBaseUrl: "https://openai.invalid/v1",
  researchProvider: "",
};
const ENV_BEFORE = Object.fromEntries(Object.keys(TEST_ENV).map((key) => [key, settings[key]]));
Object.assign(settings, TEST_ENV);
afterAll(async () => {
  Object.assign(settings, ENV_BEFORE);
  globalThis.fetch = realFetch;
  await db.close();
});

async function bearerFor(email: string, role: "admin" | "user"): Promise<string> {
  const user = (await createUser({ email, name: email, passwordHash: "x".repeat(60), role }))!;
  return `Bearer ${createToken(user.id, user.tokenVersion).token}`;
}
const ADMIN = await bearerFor("admin@tecace.com", "admin");
const DEMO = await bearerFor("dana@tecace.com", "user");
const dana = (await findUserByEmail("dana@tecace.com"))!;
await setLifecycleById(dana.id, { status: "demo" } as never);

const STORED = {
  name: "Glow Spa",
  category: "Spa",
  address: "5 Pine St, Seattle, WA",
  website: "https://glowspa.example",
  hours: [],
  services: [],
  highlights: [],
  policies: {},
  faqs: [{ q: "Do you sell gift cards?", a: "Yes, at the front desk." }],
};

/** A production business with a stored profile. One per test: a run is limited to one a minute per account. */
async function aBusiness(email: string) {
  const auth = await bearerFor(email, "user");
  const user = (await findUserByEmail(email))!;
  await setLifecycleById(user.id, { status: "production" } as never);
  await saveProfile(
    user.id,
    "Glow Spa.",
    { businessName: "Glow Spa", hoursText: null, openHour: null, closeHour: null, website: null, facts: "Spa." },
    { transferNumber: null, agentName: "Mia", greeting: null, transferTopics: null, houseRules: null },
    { profile: STORED as never, prompts: null as never, voice: "gleam", language: null },
  );
  return { id: user.id, auth };
}
const jane = await aBusiness("jane@tecace.com");

async function call(path: string, auth: string, payload?: unknown) {
  const response = await app.handle(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { authorization: auth, "content-type": "application/json" },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    }),
  );
  return { status: response.status, body: (await response.json()) as any };
}

describe("POST /business/research", () => {
  it("researches the business by its stored name and website, and answers with the filled-in details", async () => {
    const res = await call("/business/research", jane.auth, {});
    expect(res.status).toBe(200);
    expect(asked.at(-1)).toContain('"Glow Spa"');
    expect(asked.at(-1)).toContain("https://glowspa.example");
    expect(res.body.profile).toMatchObject({ name: "Glow Spa", category: "Day spa" });
    expect(res.body.profile.faqs).toHaveLength(2);
    expect(res.body.sources[0]).toMatchObject({ url: "https://glowspa.example/faq" });
  });

  // The business reviews what came back and saves it from the form; a run never overwrites what is
  // live on its own.
  it("saves nothing", async () => {
    const stored = await findProfile(jane.id);
    expect(stored?.profile?.category).toBe("Spa");
    expect(stored?.profile?.faqs).toEqual(STORED.faqs);
  });

  it("uses the name, links and notes the business typed instead", async () => {
    const kim = await aBusiness("kim@tecace.com");
    const res = await call("/business/research", kim.auth, {
      businessName: "Glow Day Spa",
      websiteUrl: "https://glow.example",
      mapsUrl: "https://maps.google.com/?cid=1",
      notes: "Second location opened in May.",
    });
    expect(res.status).toBe(200);
    expect(asked.at(-1)).toContain('"Glow Day Spa"');
    expect(asked.at(-1)).toContain("https://glow.example");
    expect(asked.at(-1)).toContain("Second location opened in May.");
  });

  it("lets an admin run it for a customer", async () => {
    const lee = await aBusiness("lee@tecace.com");
    const res = await call(`/business/research?userId=${lee.id}`, ADMIN, {});
    expect(res.status).toBe(200);
    expect(asked.at(-1)).toContain('"Glow Spa"');
  });

  it("refuses a demo-stage account, and an account with no business yet", async () => {
    expect((await call("/business/research", DEMO, {})).status).toBe(403);
    const before = asked.length;
    const none = await call(`/business/research?userId=${dana.id}`, ADMIN, {});
    expect(none.status).toBe(409);
    expect(asked.length).toBe(before);
  });

  it("says so when the server has no OpenAI key, without running anything", async () => {
    const before = asked.length;
    settings.openaiApiKey = undefined;
    try {
      const res = await call(`/business/research?userId=${jane.id}`, ADMIN, {});
      expect(res.status).toBe(503); // checked before the limit, so it doesn't use up a run
      expect(res.body.error).toBe("no_openai_key");
      expect(asked.length).toBe(before);
    } finally {
      settings.openaiApiKey = "sk-test-not-a-real-key";
    }
  });

  // Never 401: that is the dashboard's own session, and it signs the person out on it.
  it("reports a failed run as 502 with the reason", async () => {
    const max = await aBusiness("max@tecace.com");
    researchFails = "The search timed out.";
    try {
      const res = await call(`/business/research?userId=${max.id}`, ADMIN, {});
      expect(res.status).toBe(502);
      expect(res.body.message).toMatch(/timed out/);
    } finally {
      researchFails = null;
    }
  });

  it("runs once a minute per account — each run is a paid web search", async () => {
    const before = asked.length;
    const again = await call("/business/research", jane.auth, {});
    expect(again.status).toBe(429);
    expect(asked.length).toBe(before);
  });
});
