import { afterAll, describe, expect, it, mock } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

// Call settings through the real routes against a real Postgres (PGlite), with the harness
// lifecycle.pg.test.ts uses: the real DDL, the real writers, real session tokens.
//
// What matters here is the draft/published split: a save changes only the draft, callers keep the
// published copy until Publish, and a customer can only ever touch their own.
//
// Run: bun test src/routes/callSettings.pg.test.ts
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

const { app } = await import("../app.js");
const { findUserByEmail } = await import("../db/users.js");
const { createAgentNumber, assignAgentNumber } = await import("../db/agentNumbers.js");

const jane = (await findUserByEmail("jane@tecace.com"))!;
const number = await createAgentNumber({ phone: "+12065550100", label: "Jane's line" });
await assignAgentNumber(number.id, jane.id);

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

const billing = { id: "billing", mode: "warm", name: "Billing", numbers: ["(206) 555-0134"] };

afterAll(async () => {
  await db.close();
});

describe("call settings", () => {
  it("starts empty, with nothing to publish", async () => {
    const res = await call("GET", "/business/call-settings", JANE);
    expect(res.status).toBe(200);
    expect(res.body.draft.transfer.scenarios).toEqual([]);
    expect(res.body.published).toBeNull();
    expect(res.body.dirty).toBe(false);
    expect(res.body.agentNumber).toBe("+12065550100");
  });

  it("saves a draft without publishing it", async () => {
    const res = await call("PUT", "/business/call-settings", JANE, { draft: { transfer: { scenarios: [billing] } } });
    expect(res.status).toBe(200);
    expect(res.body.draft.transfer.scenarios[0].numbers).toEqual(["+12065550134"]);
    expect(res.body.published).toBeNull();
    expect(res.body.dirty).toBe(true);
  });

  it("refuses a bad value and names the field", async () => {
    const res = await call("PUT", "/business/call-settings", JANE, {
      draft: { transfer: { scenarios: [{ ...billing, numbers: ["206 555 0100"] }] } },
    });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe("transfer.scenarios[0].numbers[0]");
    expect(res.body.message).toContain("ring itself");
    // and the draft that was there is untouched
    const after = await call("GET", "/business/call-settings", JANE);
    expect(after.body.draft.transfer.scenarios[0].numbers).toEqual(["+12065550134"]);
  });

  it("publishes the draft, then has nothing left to publish", async () => {
    const res = await call("POST", "/business/call-settings/publish", JANE);
    expect(res.status).toBe(200);
    expect(res.body.published.transfer.scenarios[0].name).toBe("Billing");
    expect(res.body.dirty).toBe(false);
    expect(res.body.publishedAt).toBeTruthy();
    const again = await call("POST", "/business/call-settings/publish", JANE);
    expect(again.status).toBe(409);
  });

  it("keeps callers on the published copy while the draft changes", async () => {
    const res = await call("PUT", "/business/call-settings", JANE, {
      draft: { transfer: { scenarios: [{ ...billing, name: "Accounts" }] } },
    });
    expect(res.body.draft.transfer.scenarios[0].name).toBe("Accounts");
    expect(res.body.published.transfer.scenarios[0].name).toBe("Billing");
    expect(res.body.dirty).toBe(true);
  });

  it("keeps waterfall behind an admin switch", async () => {
    const waterfall = { ...billing, id: "all", mode: "waterfall", name: "Anyone", numbers: ["2065550141", "2065550142"] };
    // Without the feature a waterfall is kept but switched off — never on.
    const kept = await call("PUT", "/business/call-settings", JANE, { draft: { transfer: { scenarios: [waterfall] } } });
    expect(kept.status).toBe(200);
    expect(kept.body.draft.transfer.scenarios[0].enabled).toBe(false);

    const selfService = await call("PUT", `/business/call-settings/waterfall?userId=${jane.id}`, JANE, { allowed: true });
    expect(selfService.status).toBe(403);

    const on = await call("PUT", `/business/call-settings/waterfall?userId=${jane.id}`, ADMIN, { allowed: true });
    expect(on.status).toBe(200);
    expect(on.body.waterfallAllowed).toBe(true);

    const saved = await call("PUT", "/business/call-settings", JANE, { draft: { transfer: { scenarios: [waterfall] } } });
    expect(saved.status).toBe(200);
    expect(saved.body.draft.transfer.waterfallEnabled).toBe(true);
    expect(saved.body.draft.transfer.scenarios[0].enabled).toBe(true);
  });

  it("lets a customer see only their own, and an admin act for them", async () => {
    const bobs = await call("GET", `/business/call-settings?userId=${jane.id}`, BOB);
    // A customer's userId is ignored: they get their own, empty, settings.
    expect(bobs.body.draft.transfer.scenarios).toEqual([]);
    const admins = await call("GET", `/business/call-settings?userId=${jane.id}`, ADMIN);
    expect(admins.body.draft.transfer.scenarios[0].name).toBe("Anyone");
  });

  it("needs a session", async () => {
    const res = await call("GET", "/business/call-settings", "Bearer nope");
    expect(res.status).toBe(401);
  });
});

describe("a demo's call settings", () => {
  const DEMO = "acmedemo0001";
  const demoProfile = {
    name: "Acme Plumbing",
    category: "Plumber",
    address: "5 Pipe Rd, Seattle, WA",
    hours: [{ day: "Monday", open: "08:00", close: "17:00" }],
    services: [{ name: "Leak repair" }],
    highlights: [],
    policies: {},
    faqs: [],
  };

  it("saves through the demo PATCH, checked like a business's", async () => {
    await db.query(
      `INSERT INTO demo_customers (id, business_name, profile, prompts, voice, agent_name, status, created_at, updated_at)
       VALUES ($1, 'Acme Plumbing', $2, '{}'::jsonb, 'gleam', 'Sam', 'ready', now(), now())`,
      [DEMO, JSON.stringify(demoProfile)],
    );
    const bad = await call("PATCH", `/demo/customers/${DEMO}`, ADMIN, {
      callSettings: { links: { scenarios: [{ triggers: ["map"], url: "http://insecure.example.com" }] } },
    });
    expect(bad.status).toBe(400);
    expect(bad.body.field).toBe("links.scenarios[0].url");

    const ok = await call("PATCH", `/demo/customers/${DEMO}`, ADMIN, {
      callSettings: {
        transfer: {
          scenarios: [{ id: "emergency", mode: "waterfall", name: "Emergencies", numbers: ["2065550171", "2065550172"] }],
        },
      },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.customer.callSettings.transfer.scenarios[0].numbers).toEqual(["+12065550171", "+12065550172"]);
  });

  it("becomes the business's draft at onboarding, unpublished", async () => {
    const owner = (await findUserByEmail("bob@tecace.com"))!;
    const { setLifecycleById } = await import("../db/users.js");
    await setLifecycleById(owner.id, { businessId: DEMO, status: "demo" });
    // An admin touching the plan flag at the sale creates the row with an empty draft; the demo's
    // settings must still be copied over it.
    const flag = await call("PUT", `/business/call-settings/waterfall?userId=${owner.id}`, ADMIN, { allowed: false });
    expect(flag.status).toBe(200);

    // The admin's Approve: onboarding is admin-only.
    const moved = await call("POST", `/demo/customers/${DEMO}/onboard`, ADMIN);
    expect(moved.status).toBe(200);

    const settings = await call("GET", "/business/call-settings", BOB);
    expect(settings.body.draft.transfer.scenarios[0].name).toBe("Emergencies");
    expect(settings.body.published).toBeNull();
    expect(settings.body.dirty).toBe(true);
  });

  it("re-checks at publish: the demo's waterfall reaches callers switched off on an account without it", async () => {
    const published = await call("POST", "/business/call-settings/publish", BOB);
    expect(published.status).toBe(200);
    expect(published.body.published.transfer.scenarios[0].enabled).toBe(false);
    expect(published.body.published.transfer.waterfallEnabled).toBe(false);
  });

  it("refuses a malformed account id on the admin switch", async () => {
    const res = await call("PUT", "/business/call-settings/waterfall?userId=not-a-uuid", ADMIN, { allowed: true });
    expect(res.status).toBe(400);
  });
});

describe("the composed-session preview", () => {
  it("shows a business what its test call and its phone line are told", async () => {
    const { saveProfile } = await import("../db/businessProfiles.js");
    await saveProfile(
      jane.id,
      "Jane's Salon, hair cuts in Tacoma.",
      { businessName: "Jane's Salon", hoursText: null, openHour: null, closeHour: null, website: null, facts: "Hair cuts." },
      { transferNumber: null, agentName: "Mia", greeting: null, transferTopics: null, houseRules: "Mention parking." },
      {
        profile: { name: "Jane's Salon", category: "Hair salon", address: "1 A St, Tacoma, WA", hours: [], services: [], highlights: [], policies: {}, faqs: [] },
        prompts: null as never,
        voice: "gleam",
        language: null,
      },
    );
    const draft = await call("GET", "/business/session-preview", JANE);
    expect(draft.status).toBe(200);
    expect(draft.body.settings).toBe("draft");
    expect(draft.body.live).toContain("You are Mia, the phone receptionist at Jane's Salon");
    expect(draft.body.live).toContain("Mention parking.");
    expect(draft.body.live).toContain("# This call");
    expect(draft.body.transfers).toEqual(["Anyone"]);

    const phone = await call("GET", "/business/session-preview?settings=published", JANE);
    expect(phone.body.live).not.toContain("# This call");
    expect(phone.body.transfers).toEqual(["Billing"]);
  });
});
