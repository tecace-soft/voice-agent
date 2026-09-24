import { afterAll, describe, expect, it, mock } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

// The one-way door out of the demo, driven end to end against a real Postgres: PGlite behind
// `db/client.js`, the real DDL out of `client.ts`, the real importer for the demo seed, the real
// writers and the real Elysia app.
//
// WHAT THIS FILE IS FOR. The requirement is not "the copy happens" — that much a unit test could
// assert. It is that AFTER the copy the two records are unrelated: what a customer changes in their
// Business tabs must not reach the demo an operator is still showing, and what the operator changes
// in the demo must not reach the customer's live receptionist. Both halves of that are proved here by
// making the edits through the real endpoints the two sides actually use — `PUT /business/knowledge`
// and `PATCH /demo/customers/:id` — and then reading the other side back. A mocked data layer, or
// hand-written INSERTs, could only prove that this test agrees with itself.
//
// The stand-in, exactly as `demo.pg.test.ts` does it, is the auth guard: an admin, a signed-in
// non-admin and an anonymous caller all have to reach the same app, and minting three real sessions
// would test `auth/session.ts` over again rather than these routes.
//
// Run: bun test src/routes/lifecycle.pg.test.ts
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
const NON_ADMIN = await bearerFor("jane@tecace.com", "user");

// ----------------------------------------------------------------------------------------------
// The demo seed, through the real importer from the promo's own export shape — so the rows under
// these routes were written by the code that writes them in production.
const RICH = "harbordental1"; // a worked-up prospect: hours, services, policies, a hand-edited prompt
const THIN = "thinprospect1"; // researched and abandoned: a name and nothing else

const DEMO_PROFILE = {
  name: "Harbor Dental",
  category: "Dental practice",
  address: "12 Wharf St, Portland, ME",
  phone: "+1 207 555 0142",
  website: "https://harbordental.test",
  // Written the way an operator types them, not the way they are stored: proving the promotion
  // shapes what it copies rather than trusting a profile a model wrote months ago.
  hours: [
    { day: "Monday", open: "8am", close: "5:30pm" },
    { day: "Tuesday", open: "8am", close: "5:30pm" },
    { day: "Wednesday", open: "8am", close: "5:30pm" },
    { day: "Thursday", open: "8am", close: "5:30pm" },
    { day: "Friday", open: "8am", close: "5:30pm" },
  ],
  services: [{ name: "Cleaning", price: "$120" }, { name: "Whitening" }],
  highlights: ["Same-week appointments"],
  policies: { cancellation: "24 hours' notice", parking: "Free lot behind the building" },
  faqs: [{ q: "Do you take walk-ins?", a: "Before noon, yes." }],
};

// `edited: true` on purpose: a hand-written prompt is the thing most easily lost in a migration, and
// it has to arrive on the other side still marked as hand-written or the next save rebuilds over it.
const DEMO_PROMPTS = {
  live: "You are Alex, the receptionist at Harbor Dental. Be brief.",
  backend: "Harbor Dental, Portland. Cleanings and whitening.",
  greeting: "Harbor Dental, this is Alex — how can I help?",
  edited: true,
};

const customer = (id: string, businessName: string, extra: Record<string, unknown>) => ({
  type: "string",
  ttl: -1,
  value: {
    id,
    businessName,
    active: true,
    dossier: "",
    sources: [{ url: "https://harbordental.test" }],
    voice: "gleam",
    agentName: "Alex",
    status: "ready",
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-02T10:00:00.000Z",
    ...extra,
  },
});

const DUMP = {
  data: {
    customers: { type: "set", ttl: -1, value: [RICH, THIN] },
    [`customers:${RICH}`]: customer(RICH, "Harbor Dental", {
      profile: DEMO_PROFILE,
      prompts: DEMO_PROMPTS,
      dossier: "# Harbor Dental\n\nA dental practice on the Portland waterfront.",
      language: "es",
      contactEmail: "dana@harbor.test",
    }),
    // Nothing a caller could be told: the promotion has to refuse this rather than hand somebody an
    // account whose number answers as a business it cannot say anything about.
    [`customers:${THIN}`]: customer(THIN, "Nameless Cafe", {
      profile: { name: "Nameless Cafe" },
      prompts: { live: "You are Alex.", backend: "", greeting: "Hello.", edited: false },
    }),
  },
};

const { parseDump } = await import("../demo/dump.js");
const { importDump } = await import("../db/demoImport.js");
await importDump(parseDump(DUMP));

const { findProfile } = await import("../db/businessProfiles.js");
const { getCustomer } = await import("../db/demoRead.js");
const { auth } = await import("./auth.js");
const { lifecycle } = await import("./lifecycle.js");
const { business } = await import("./business.js");
const { demo } = await import("./demo.js");
const { Elysia } = await import("elysia");

// Every controller the lifecycle touches, because the separation this file is about spans them: the
// promotion writes through one, the two later edits go through two others, and `GET /auth/users` is
// how an admin reads a stage back without trusting the handler that set it.
const app = new Elysia().use(auth).use(lifecycle).use(business).use(demo);

const hash = "x".repeat(60);
const ABSENT = "00000000-0000-4000-8000-000000000000";
const dana = (await createUser({ email: "dana@harbor.test", name: "Dana Reed", passwordHash: hash }))!;
const rival = (await createUser({ email: "rival@harbor.test", name: "Rival", passwordHash: hash }))!;
const cafe = (await createUser({ email: "cafe@example.test", name: "Cafe", passwordHash: hash }))!;
const boss = (await createUser({
  email: "boss@tecace.com",
  name: "Boss",
  passwordHash: hash,
  role: "admin",
}))!;

const call = async (
  method: string,
  path: string,
  options: { auth?: string; body?: unknown } = {},
) => {
  const response = await app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: {
        ...(options.auth ? { authorization: options.auth } : {}),
        ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    }),
  );
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
};

afterAll(async () => {
  await db.close();
});

describe("who may move a customer along", () => {
  it("turns an anonymous caller away from all three", async () => {
    for (const [method, path, body] of [
      ["POST", `/auth/users/${dana.id}/business`, { businessId: RICH }],
      ["POST", `/auth/users/${dana.id}/status`, { status: "production" }],
      ["POST", `/auth/users/${dana.id}/promote`, undefined],
    ] as const) {
      const res = await call(method, path, { body });
      expect(res.status).toBe(401);
    }
  });

  it("turns a signed-in customer away, saying what needs an admin", async () => {
    const res = await call("POST", `/auth/users/${dana.id}/status`, {
      auth: NON_ADMIN,
      body: { status: "production" },
    });
    expect(res.status).toBe(403);
    expect(res.body.message).toBe("Only an admin can change a customer's stage.");
  });
});

describe("linking an account to the demo it came from", () => {
  it("refuses an id no demo customer has", async () => {
    const res = await call("POST", `/auth/users/${dana.id}/business`, {
      auth: ADMIN,
      body: { businessId: "nosuchdemo01" },
    });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("no_demo");
  });

  it("refuses an account that does not exist", async () => {
    // A well-formed id that nobody has. `users.id` is a UUID column, so an id that is not one at all
    // fails in the driver rather than here — the same on every existing `/auth/users/:id` route, and
    // not something the dashboard can send.
    const res = await call("POST", `/auth/users/${ABSENT}/business`, {
      auth: ADMIN,
      body: { businessId: RICH },
    });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("not_found");
  });

  it("links, and says so on the account", async () => {
    const res = await call("POST", `/auth/users/${dana.id}/business`, {
      auth: ADMIN,
      body: { businessId: RICH },
    });
    expect(res.status).toBe(200);
    expect(res.body.user.businessId).toBe(RICH);
    // Linking is only a pointer — it must not have moved her stage or taken a section away.
    expect(res.body.user.status).toBe("unassigned");
  });

  it("is idempotent: linking the same account to the same demo again is fine", async () => {
    const res = await call("POST", `/auth/users/${dana.id}/business`, {
      auth: ADMIN,
      body: { businessId: RICH },
    });
    expect(res.status).toBe(200);
    expect(res.body.user.businessId).toBe(RICH);
  });

  it("will not give one demo record to two accounts, and names who has it", async () => {
    // Two accounts sharing a business would each promote from it and then diverge, with no way to
    // tell afterwards which one the operator meant.
    const res = await call("POST", `/auth/users/${rival.id}/business`, {
      auth: ADMIN,
      body: { businessId: RICH },
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("business_taken");
    expect(res.body.message).toContain("dana@harbor.test");
  });
});

describe("the copy", () => {
  it("refuses to promote an account with no demo behind it", async () => {
    const res = await call("POST", `/auth/users/${rival.id}/promote`, { auth: ADMIN });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("not_linked");
  });

  it("refuses a demo too thin to answer a phone with", async () => {
    await call("POST", `/auth/users/${cafe.id}/business`, {
      auth: ADMIN,
      body: { businessId: THIN },
    });
    const res = await call("POST", `/auth/users/${cafe.id}/promote`, { auth: ADMIN });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("thin_demo");
    // And nothing was written: a refused promotion leaves an account exactly as it was.
    expect(await findProfile(cafe.id)).toBeNull();
  });

  it("copies the prospect's own work into their account", async () => {
    const res = await call("POST", `/auth/users/${dana.id}/promote`, { auth: ADMIN });
    expect(res.status).toBe(200);

    const profile = (await findProfile(dana.id))!;
    expect(profile.profile!.name).toBe("Harbor Dental");
    expect(profile.profile!.services.map((s) => s.name)).toEqual(["Cleaning", "Whitening"]);
    expect(profile.profile!.faqs).toEqual([{ q: "Do you take walk-ins?", a: "Before noon, yes." }]);
    expect(profile.profile!.policies.cancellation).toBe("24 hours' notice");
    // Shaped on the way through, not copied verbatim: "8am" is stored as a clock time.
    expect(profile.profile!.hours[0]).toEqual({ day: "Monday", open: "08:00", close: "17:30" });

    // The receptionist, as the prospect heard it.
    expect(profile.prompts!.greeting).toBe(DEMO_PROMPTS.greeting);
    expect(profile.prompts!.live).toBe(DEMO_PROMPTS.live);
    expect(profile.prompts!.edited).toBe(true);
    expect(profile.agentName).toBe("Alex");
    expect(profile.voice).toBe("gleam");
    expect(profile.language).toBe("es");
  });

  it("renders the four things the phone agent reads, which a demo never had", async () => {
    const profile = (await findProfile(dana.id))!;
    expect(profile.businessName).toBe("Harbor Dental");
    expect(profile.hoursText).toBe("Monday to Friday 08:00 to 17:30");
    expect(profile.openHour).toBe(8);
    expect(profile.closeHour).toBe(17);
    expect(profile.facts).toContain("Cleaning");
    expect(profile.facts).toContain("Same-week appointments");
    // The whole point of the derived columns: with them the agent answers AS this business.
    expect(profile.isLive).toBe(true);
  });

  it("leaves the settings a demo cannot know unset rather than guessing them", async () => {
    const profile = (await findProfile(dana.id))!;
    // A transfer number in particular decides whether the agent offers a person at all; inventing
    // one would route a real caller somewhere nobody chose.
    expect(profile.transferNumber).toBeNull();
    expect(profile.greeting).toBeNull();
    expect(profile.houseRules).toBeNull();
  });

  it("gives them a description to re-read, taken from the research", async () => {
    const profile = (await findProfile(dana.id))!;
    expect(profile.sourceText).toContain("Portland waterfront");
  });

  it("moves them out of the demo view, but not into production", async () => {
    // Read out of the accounts list rather than off the promote response, so this is the stored
    // stage and not what the handler said it did. `pre-production` is the honest answer: they can
    // see and edit everything, and no number is answering yet.
    const res = await call("GET", "/auth/users", { auth: ADMIN });
    const row = res.body.users.find((u: { id: string }) => u.id === dana.id);
    expect(row.status).toBe("pre-production");
    expect(row.businessId).toBe(RICH);
  });

  it("will not run twice, because a second run would discard their edits", async () => {
    const res = await call("POST", `/auth/users/${dana.id}/promote`, { auth: ADMIN });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("already_promoted");
  });
});

// ----------------------------------------------------------------------------------------------
// The requirement, in both directions. Each edit below goes through the endpoint that side of the
// product really uses, and then the OTHER side is read back.
describe("after the copy the two are strangers", () => {
  it("an edit in the Business tabs does not reach the demo", async () => {
    const before = (await getCustomer(RICH))!;
    const edited = {
      ...before.profile,
      phone: "+1 207 555 0199",
      highlights: ["Evening appointments"],
    };
    const res = await call("PUT", `/business/knowledge?userId=${dana.id}`, {
      auth: ADMIN,
      body: { profile: edited },
    });
    expect(res.status).toBe(200);

    const saved = (await findProfile(dana.id))!;
    expect(saved.profile!.phone).toBe("+1 207 555 0199");
    expect(saved.facts).toContain("Evening appointments");

    const demoNow = (await getCustomer(RICH))!;
    expect(demoNow.profile.phone).toBe("+1 207 555 0142");
    expect(demoNow.profile.highlights).toEqual(["Same-week appointments"]);
  });

  it("an edit in the demo does not reach the customer's receptionist", async () => {
    const res = await call("PATCH", `/demo/customers/${RICH}`, {
      auth: ADMIN,
      body: {
        agentName: "Robin",
        profile: { ...DEMO_PROFILE, name: "Harbor Dental & Ortho", phone: "+1 207 555 0000" },
        prompts: { ...DEMO_PROMPTS, greeting: "Harbor Dental and Ortho, Robin speaking." },
      },
    });
    expect(res.status).toBe(200);

    const demoNow = (await getCustomer(RICH))!;
    expect(demoNow.profile.name).toBe("Harbor Dental & Ortho");
    expect(demoNow.agentName).toBe("Robin");

    const saved = (await findProfile(dana.id))!;
    expect(saved.profile!.name).toBe("Harbor Dental");
    expect(saved.businessName).toBe("Harbor Dental");
    expect(saved.agentName).toBe("Alex");
    expect(saved.prompts!.greeting).toBe(DEMO_PROMPTS.greeting);
    // Her own earlier edit is still hers, too.
    expect(saved.profile!.phone).toBe("+1 207 555 0199");

    // And again through the endpoint the Business tabs actually read, not just the table. The way
    // this requirement would realistically be broken later is a well-meaning fallback in the route —
    // "no profile? show them the demo's" — which a direct row read would never notice.
    const shown = await call("GET", `/business/profile?userId=${dana.id}`, { auth: ADMIN });
    expect(shown.status).toBe(200);
    expect(shown.body.profile.profile.name).toBe("Harbor Dental");
    expect(shown.body.profile.prompts.greeting).toBe(DEMO_PROMPTS.greeting);
  });

  it("and the demo can be re-pointed at nobody without disturbing her account", async () => {
    // Unlinking is how an operator recycles a demo record. It says nothing about the account's data,
    // which is the whole reason the link is only a pointer.
    const res = await call("POST", `/auth/users/${dana.id}/business`, {
      auth: ADMIN,
      body: { businessId: null },
    });
    expect(res.status).toBe(200);
    expect(res.body.user.businessId).toBeNull();

    const saved = (await findProfile(dana.id))!;
    expect(saved.profile!.name).toBe("Harbor Dental");
    expect(saved.isLive).toBe(true);
  });
});

describe("the stage itself", () => {
  it("takes each of the four stages", async () => {
    for (const status of ["unassigned", "demo", "pre-production", "production"] as const) {
      const res = await call("POST", `/auth/users/${dana.id}/status`, {
        auth: ADMIN,
        body: { status },
      });
      expect(res.status).toBe(200);
      expect(res.body.user.status).toBe(status);
    }
  });

  it("refuses a stage the database would not accept", async () => {
    const res = await call("POST", `/auth/users/${dana.id}/status`, {
      auth: ADMIN,
      body: { status: "live" },
    });
    expect(res.status).toBe(422);
  });

  it("will not hide the Accounts page from an admin", async () => {
    const res = await call("POST", `/auth/users/${boss.id}/status`, {
      auth: ADMIN,
      body: { status: "demo" },
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("admin_demo");
  });

  it("starts every existing account unplaced, gating nothing", async () => {
    // The account that matters here is the live voicemail customer: the lifecycle was added around
    // them, and `unassigned` is what makes that a no-op rather than a demotion.
    const res = await call("GET", "/auth/users", { auth: ADMIN });
    const rivalRow = res.body.users.find((u: { id: string }) => u.id === rival.id);
    expect(rivalRow.status).toBe("unassigned");
    expect(rivalRow.businessId).toBeNull();
  });
});
