import { afterAll, describe, expect, it, mock } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

// The customer's permanent id and the moves between stages (request, approve, decline, Go live),
// against a real Postgres.
//
// Same harness as `lifecycle.pg.test.ts` (PGlite behind `db/client.js`, the real DDL lifted out of
// `client.ts`, the real importer, real tokens), because what matters here is Postgres behaviour: the
// sequence, the code trigger, the backfill's ordering and idempotence, and the route moving the
// right account.
//
// Run: bun test src/routes/customerLifecycle.pg.test.ts
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

const source = await Bun.file("src/db/client.ts").text();
const initBody = source.slice(source.indexOf("export async function initDb"), source.indexOf("// On Vercel"));
const DDL = [...initBody.matchAll(/sql`([\s\S]*?)`/g)].map(([, statement = ""]) => statement);
const CODE_START = DDL.findIndex((statement) =>
  statement.includes("CREATE SEQUENCE IF NOT EXISTS customer_code_seq"),
);

async function execAll(target: PGlite, statements: string[]) {
  for (const statement of statements) {
    try {
      await target.exec(statement);
    } catch (error) {
      throw new Error(`DDL failed: ${statement.trim().slice(0, 90)}\n${(error as Error).message}`);
    }
  }
}

await execAll(db, DDL);

const { createUser } = await import("../db/users.js");
const { createToken } = await import("../auth/session.js");

const hash = "x".repeat(60);
const bearer = (user: { id: string; tokenVersion: number }) =>
  `Bearer ${createToken(user.id, user.tokenVersion).token}`;

const boss = (await createUser({
  email: "boss@tecace.com",
  name: "Boss",
  passwordHash: hash,
  role: "admin",
}))!;
const dana = (await createUser({ email: "dana@harbor.test", name: "Dana", passwordHash: hash }))!;
const rival = (await createUser({ email: "rival@keep.test", name: "Rival", passwordHash: hash }))!;
const cafe = (await createUser({ email: "cafe@example.test", name: "Cafe", passwordHash: hash }))!;
const stray = (await createUser({ email: "stray@example.test", name: "Stray", passwordHash: hash }))!;
const ADMIN = bearer(boss);

const RICH = "harbordental1";
const THIN = "thinprospect1";
const KEEP = "keepprospect1";

const PROFILE = {
  name: "Harbor Dental",
  category: "Dental practice",
  hours: [{ day: "Monday", open: "8am", close: "5pm" }],
  services: [{ name: "Cleaning", price: "$120" }],
  faqs: [{ q: "Do you take walk-ins?", a: "Before noon, yes." }],
};
const PROMPTS = { live: "You are Alex.", backend: "Harbor Dental.", greeting: "Hi.", edited: false };

const customer = (
  id: string,
  businessName: string,
  createdAt: string,
  extra: Record<string, unknown>,
) => ({
  type: "string",
  ttl: -1,
  value: {
    id,
    businessName,
    active: true,
    dossier: "",
    sources: [],
    agentName: "Alex",
    status: "ready",
    stage: "interested",
    createdAt,
    updatedAt: createdAt,
    profile: PROFILE,
    prompts: PROMPTS,
    ...extra,
  },
});

const { parseDump } = await import("../demo/dump.js");
const { importDump } = await import("../db/demoImport.js");
await importDump(
  parseDump({
    data: {
      customers: { type: "set", ttl: -1, value: [RICH, THIN, KEEP] },
      [`customers:${RICH}`]: customer(RICH, "Harbor Dental", "2026-09-01T10:00:00.000Z", {}),
      [`customers:${THIN}`]: customer(THIN, "Nameless Cafe", "2026-09-02T10:00:00.000Z", {
        profile: { name: "Nameless Cafe" },
      }),
      [`customers:${KEEP}`]: customer(KEEP, "Keep Dental", "2026-09-03T10:00:00.000Z", {
        profile: { ...PROFILE, name: "Keep Dental" },
      }),
    },
  }),
);

// The phone agent's key, for `/business/config`. Spread over the real env: mock.module is
// process-wide (see usage.test.ts for why a partial env breaks later files).
const AGENT_KEY = "test-agent-key";
const { env: realEnv } = await import("../config/env.js");
await mock.module("../config/env.js", () => ({ env: { ...realEnv, agentConfigKey: AGENT_KEY } }));

const { findProfile } = await import("../db/businessProfiles.js");
const { setLifecycleById, findUserById } = await import("../db/users.js");
const { lifecycle } = await import("./lifecycle.js");
const { demo } = await import("./demo.js");
const { business } = await import("./business.js");
const { Elysia } = await import("elysia");
const app = new Elysia().use(lifecycle).use(demo).use(business);

const call = async (method: string, path: string, auth?: string, body?: unknown) => {
  const headers: Record<string, string> = {};
  if (auth) headers.authorization = auth;
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
  );
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
};

const insertDemo = (target: PGlite, id: string, created = "now()") =>
  target.query(
    `INSERT INTO demo_customers (id, business_name, status, created_at, updated_at)
     VALUES ($1, $1, 'ready', ${created}, ${created})`,
    [id],
  );

afterAll(async () => {
  await db.close();
});

// ----------------------------------------------------------------------------------------------
describe("customer_code", () => {
  const code = async (business: string | null, seq = 1) =>
    (await db.query<{ c: string }>("SELECT demo_customer_code($1, $2) AS c", [business, seq])).rows[0]!.c;

  it("is four letters from the business name and the number", async () => {
    const cases: Record<string, string> = {
      "Global Harvest Foods, LLC": "GLHF",
      "H Mart Bellevue": "HMAB",
      "Consulate General of the Republic of Korea in Seattle": "CGRK",
      "Meet Korean BBQ": "MEKB",
      "SHK Group, PLLC": "SHGR",
      "Northwest Hearth & Home": "NOHH",
      "Seoul Trading USA Co.": "SETU",
      "TecAce Software, Ltd.": "TESO",
      "Dr. Philip K. Jung, DDS": "PHKJ",
      "Washington State Department of Labor & Industries (L&I)": "WSDL",
      Wowrack: "WOWR",
      "H Mart": "HMAR",
      "Al": "ALXX",
      "The LLC": "THLL",
      "서울식당": "CUST",
      "": "CUST",
    };
    for (const [business, letters] of Object.entries(cases)) {
      expect([business, await code(business, 7)]).toEqual([business, `${letters}-0007`]);
    }
    expect(await code(null)).toBe("CUST-0001");
    // lpad truncates; the width grows with the number instead.
    expect(await code("Wowrack", 10000)).toBe("WOWR-10000");
  });

  it("gives every imported demo a code", async () => {
    const { rows } = await db.query<{ customer_code: string }>(
      "SELECT customer_code FROM demo_customers ORDER BY customer_seq",
    );
    expect(rows.map((row) => row.customer_code)).toEqual(["HADE-0001", "NACA-0002", "KEDE-0003"]);
  });

  it("cannot be written, on insert or after", async () => {
    await expect(
      db.query(`UPDATE demo_customers SET customer_code = 'HADE-9999' WHERE id = $1`, [RICH]),
    ).rejects.toThrow();
    await expect(
      db.query(`UPDATE demo_customers SET customer_seq = 9999 WHERE id = $1`, [RICH]),
    ).rejects.toThrow();

    const scratch = await PGlite.create();
    await execAll(scratch, DDL);
    await scratch.query(
      `INSERT INTO demo_customers (id, business_name, status, created_at, updated_at, customer_code)
       VALUES ('x', 'Cedar Bakery', 'ready', now(), now(), 'MINE-0001')`,
    );
    const { rows } = await scratch.query<{ customer_code: string }>("SELECT customer_code FROM demo_customers");
    expect(rows[0]!.customer_code).toBe("CEBA-0001");
    await scratch.close();
  });

  it("stays the same when the business is renamed", async () => {
    await db.query(`UPDATE demo_customers SET business_name = 'Harbor Smiles' WHERE id = $1`, [RICH]);
    const { rows } = await db.query<{ customer_code: string }>(
      "SELECT customer_code FROM demo_customers WHERE id = $1",
      [RICH],
    );
    expect(rows[0]!.customer_code).toBe("HADE-0001");
    await db.query(`UPDATE demo_customers SET business_name = 'Harbor Dental' WHERE id = $1`, [RICH]);
  });

  const codesOf = async (target: PGlite) =>
    Object.fromEntries(
      (
        await target.query<{ id: string; customer_code: string }>("SELECT id, customer_code FROM demo_customers")
      ).rows.map((row) => [row.id, row.customer_code]),
    );

  it("numbers an existing database's rows oldest first, once, and carries on from there", async () => {
    const old = await PGlite.create();
    await execAll(old, DDL.slice(0, CODE_START));
    // Inserted out of date order, so numbering by insertion would give a different answer.
    await insertDemo(old, "bbb", "'2026-02-01T00:00:00Z'");
    await insertDemo(old, "aaa", "'2026-03-01T00:00:00Z'");
    await insertDemo(old, "ccc", "'2026-01-01T00:00:00Z'");
    await execAll(old, DDL.slice(CODE_START));

    expect(await codesOf(old)).toEqual({ ccc: "CCCX-0001", bbb: "BBBX-0002", aaa: "AAAX-0003" });

    // The whole schema again, as a cold start does: nothing is renumbered.
    await execAll(old, DDL);
    expect(await codesOf(old)).toEqual({ ccc: "CCCX-0001", bbb: "BBBX-0002", aaa: "AAAX-0003" });

    await insertDemo(old, "ddd");
    expect((await codesOf(old)).ddd).toBe("DDDX-0004");

    // A deleted customer's number is not handed out again.
    await old.query(`DELETE FROM demo_customers WHERE id = 'ddd'`);
    await insertDemo(old, "eee");
    expect((await codesOf(old)).eee).toBe("EEEX-0005");
    await old.close();
  });

  it("re-codes a database that has the old CUST- codes once, keeping the numbers", async () => {
    const old = await PGlite.create();
    await execAll(old, DDL.slice(0, CODE_START));
    // The schema as it was before the letters: a generated CUST- column.
    await execAll(old, [
      "CREATE SEQUENCE IF NOT EXISTS customer_code_seq",
      "ALTER TABLE demo_customers ADD COLUMN customer_seq BIGINT NOT NULL DEFAULT nextval('customer_code_seq')",
      `ALTER TABLE demo_customers ADD COLUMN customer_code TEXT GENERATED ALWAYS AS
         ('CUST-' || lpad(customer_seq::text, greatest(4, length(customer_seq::text)), '0')) STORED`,
      "CREATE UNIQUE INDEX idx_demo_customers_code ON demo_customers (customer_code)",
    ]);
    await old.query(
      `INSERT INTO demo_customers (id, business_name, status, created_at, updated_at) VALUES
         ('gh', 'Global Harvest Foods, LLC', 'ready', now(), now()),
         ('ko', '서울식당', 'ready', now(), now()),
         ('hm', 'H Mart Bellevue', 'ready', now(), now())`,
    );
    expect(await codesOf(old)).toEqual({ gh: "CUST-0001", ko: "CUST-0002", hm: "CUST-0003" });

    await execAll(old, DDL.slice(CODE_START));
    expect(await codesOf(old)).toEqual({ gh: "GLHF-0001", ko: "CUST-0002", hm: "HMAB-0003" });

    // Renamed afterwards, then a cold start: the code stays what it became.
    await old.query(`UPDATE demo_customers SET business_name = 'Harvest Foods' WHERE id = 'gh'`);
    await execAll(old, DDL);
    expect((await codesOf(old)).gh).toBe("GLHF-0001");
    await old.close();
  });
});

// ----------------------------------------------------------------------------------------------
describe("customerCode and phase on the demo reads", () => {
  it("are on every customer in the list, in demo while nobody has moved", async () => {
    const res = await call("GET", "/demo/customers", ADMIN);
    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.body.customers.map((c: any) => [c.id, c]));
    expect(byId[RICH].customerCode).toBe("HADE-0001");
    expect(byId[RICH].phase).toBe("demo");
    expect(byId[THIN].accountEmail).toBeNull();
  });

  it("are on the CRM board and the detail page too", async () => {
    const crm = await call("GET", "/demo/crm", ADMIN);
    expect(crm.body.customers.find((c: any) => c.id === KEEP).customerCode).toBe("KEDE-0003");
    const one = await call("GET", `/demo/customers/${THIN}`, ADMIN);
    expect(one.body.customer.customerCode).toBe("NACA-0002");
    expect(one.body.customer.phase).toBe("demo");
  });
});

// ----------------------------------------------------------------------------------------------
describe("asking to be set up (request, decline)", () => {
  it("turns away an anonymous caller and an account outside the demo stage", async () => {
    expect((await call("POST", `/demo/customers/${RICH}/request-onboarding`)).status).toBe(401);
    expect(
      (await call("POST", `/demo/customers/${RICH}/request-onboarding`, bearer(stray))).status,
    ).toBe(403);
  });

  it("answers somebody else's demo as not found", async () => {
    await setLifecycleById(dana.id, { businessId: RICH, status: "demo" });
    const res = await call("POST", `/demo/customers/${THIN}/request-onboarding`, bearer(dana), {});
    expect(res.status).toBe(404);
  });

  it("records the customer's request and note, and stays in the demo", async () => {
    const res = await call("POST", `/demo/customers/${RICH}/request-onboarding`, bearer(dana), {
      note: "  We'd like to start next week.  ",
    });
    expect(res.status).toBe(200);
    expect(res.body.customer.phase).toBe("demo");
    expect(res.body.customer.request.note).toBe("We'd like to start next week.");
    expect(res.body.customer.declined).toBeNull();

    const list = await call("GET", "/demo/customers", ADMIN);
    expect(list.body.customers.find((c: any) => c.id === RICH).request).not.toBeNull();
  });

  it("keeps the first time they asked when they ask again, with the newest note", async () => {
    const first = (await call("GET", `/demo/customers/${RICH}`, ADMIN)).body.customer.request;
    const again = await call("POST", `/demo/customers/${RICH}/request-onboarding`, bearer(dana), {
      note: "Any update?",
    });
    expect(again.body.customer.request.requestedAt).toBe(first.requestedAt);
    expect(again.body.customer.request.note).toBe("Any update?");
  });

  it("leaves approving and declining to an admin", async () => {
    expect((await call("POST", `/demo/customers/${RICH}/onboard`, bearer(dana))).status).toBe(403);
    expect(
      (await call("POST", `/demo/customers/${RICH}/decline-request`, bearer(dana), {})).status,
    ).toBe(403);
  });

  it("an admin declines with a note the customer sees, once", async () => {
    const res = await call("POST", `/demo/customers/${RICH}/decline-request`, ADMIN, {
      note: "We need your opening hours first.",
    });
    expect(res.status).toBe(200);
    expect(res.body.customer.request).toBeNull();
    expect(res.body.customer.declined.note).toBe("We need your opening hours first.");

    const mine = await call("GET", `/demo/customers/${RICH}`, bearer(dana));
    expect(mine.body.customer.declined.note).toBe("We need your opening hours first.");

    expect((await call("POST", `/demo/customers/${RICH}/decline-request`, ADMIN, {})).status).toBe(409);
  });

  it("asking again clears the decline", async () => {
    const res = await call("POST", `/demo/customers/${RICH}/request-onboarding`, bearer(dana), {});
    expect(res.status).toBe(200);
    expect(res.body.customer.request.note).toBeNull();
    expect(res.body.customer.declined).toBeNull();
  });
});

// ----------------------------------------------------------------------------------------------
describe("POST /demo/customers/:id/onboard (the admin's Approve)", () => {
  it("moves the linked account: copy, pre-production, won, request answered", async () => {
    const res = await call("POST", `/demo/customers/${RICH}/onboard`, ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.copied).toBe(true);
    expect(res.body.user.id).toBe(dana.id);
    expect(res.body.user.status).toBe("pre-production");
    expect(res.body.customer.phase).toBe("onboarding");
    expect(res.body.customer.stage).toBe("won");
    expect(res.body.customer.customerCode).toBe("HADE-0001");
    expect(res.body.customer.request).toBeNull();
    expect((await findProfile(dana.id))?.businessName).toBe("Harbor Dental");

    const list = await call("GET", "/demo/customers", ADMIN);
    const harbor = list.body.customers.find((c: any) => c.id === RICH);
    expect(harbor.phase).toBe("onboarding");
    expect(harbor.accountEmail).toBe("dana@harbor.test");
  });

  it("does not run twice, and the customer can no longer ask", async () => {
    expect((await call("POST", `/demo/customers/${RICH}/onboard`, ADMIN)).status).toBe(409);
    // Past the demo stage, the demo routes are closed to the customer.
    expect(
      (await call("POST", `/demo/customers/${RICH}/request-onboarding`, bearer(dana), {})).status,
    ).toBe(403);
  });

  it("needs a linked account", async () => {
    expect((await call("POST", `/demo/customers/${THIN}/onboard`, ADMIN)).status).toBe(409);
  });

  it("refuses a demo too thin to copy, and leaves the stage alone", async () => {
    await setLifecycleById(cafe.id, { businessId: THIN });
    const res = await call("POST", `/demo/customers/${THIN}/onboard`, ADMIN);
    expect(res.status).toBe(422);
    expect((await findUserById(cafe.id))?.status).toBe("unassigned");
    expect(await findProfile(cafe.id)).toBeNull();
  });

  it("keeps business information the account already has", async () => {
    await setLifecycleById(rival.id, { businessId: KEEP });
    // The admin's own one-way door, through the same helper, then back to the demo by hand.
    const promoted = await call("POST", `/auth/users/${rival.id}/promote`, ADMIN);
    expect(promoted.status).toBe(200);
    expect(promoted.body.user.status).toBe("pre-production");
    await db.query(`UPDATE business_profiles SET source_text = 'Their own words.' WHERE user_id = $1`, [
      rival.id,
    ]);
    await setLifecycleById(rival.id, { status: "demo" });

    const res = await call("POST", `/demo/customers/${KEEP}/onboard`, ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.copied).toBe(false);
    expect((await findProfile(rival.id))?.sourceText).toBe("Their own words.");
  });
});

// ----------------------------------------------------------------------------------------------
describe("readiness and Go live", () => {
  const NUMBER = "+12065550100";
  const agentConfig = async () => {
    const response = await app.handle(
      new Request(`http://localhost/business/config?to=${encodeURIComponent(NUMBER)}`, {
        headers: { "x-agent-key": AGENT_KEY },
      }),
    );
    return (await response.json()) as { assigned: boolean; reason?: string };
  };
  const unmetOf = (body: any) =>
    body.items.filter((item: any) => item.required && !item.ok).map((item: any) => item.id).sort();

  it("lists what is missing, to the customer and to an admin alike", async () => {
    const own = await call("GET", "/business/readiness", bearer(dana));
    expect(own.status).toBe(200);
    expect(own.body.status).toBe("pre-production");
    expect(own.body.ready).toBe(false);
    expect(unmetOf(own.body)).toEqual(["number_assigned", "published_matches_number", "settings_published"]);
    expect(own.body.items.find((item: any) => item.id === "business_info").ok).toBe(true);

    const asAdmin = await call("GET", `/business/readiness?userId=${dana.id}`, ADMIN);
    expect(unmetOf(asAdmin.body)).toEqual(unmetOf(own.body));
  });

  it("will not go live until the list is ticked, and says what is missing", async () => {
    const res = await call("POST", `/auth/users/${dana.id}/go-live`, ADMIN);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("not_ready");
    expect([...res.body.unmet].sort()).toEqual([
      "number_assigned",
      "published_matches_number",
      "settings_published",
    ]);
    expect((await findUserById(dana.id))?.status).toBe("pre-production");
  });

  it("is an admin's door", async () => {
    expect((await call("POST", `/auth/users/${dana.id}/go-live`, bearer(dana))).status).toBe(403);
  });

  it("keeps an onboarding customer's number off the phone line", async () => {
    const { createAgentNumber, assignAgentNumber } = await import("../db/agentNumbers.js");
    const number = await createAgentNumber({ phone: NUMBER, label: "Harbor" });
    await assignAgentNumber(number.id, dana.id);
    expect(await agentConfig()).toMatchObject({ assigned: false, reason: "not_live_stage" });
  });

  it("goes live once the number is assigned and the settings published", async () => {
    const { publishCallSettings, saveCallSettingsDraft } = await import("../db/callSettings.js");
    const { emptyCallSettings } = await import("../business/callSettings.js");
    await saveCallSettingsDraft(dana.id, emptyCallSettings());
    await publishCallSettings(dana.id, emptyCallSettings());

    const ready = await call("GET", "/business/readiness", bearer(dana));
    expect(ready.body.ready).toBe(true);

    const res = await call("POST", `/auth/users/${dana.id}/go-live`, ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.user.status).toBe("production");
    const harbor = (await call("GET", `/demo/customers/${RICH}`, ADMIN)).body.customer;
    expect(harbor.phase).toBe("production");
    expect(typeof harbor.liveAt).toBe("string");

    expect(await agentConfig()).toMatchObject({ assigned: true });
  });

  it("does not go live twice", async () => {
    const res = await call("POST", `/auth/users/${dana.id}/go-live`, ADMIN);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("not_onboarding");
  });

  it("a demo account cannot publish call settings", async () => {
    await setLifecycleById(cafe.id, { status: "demo" });
    const res = await call("POST", "/business/call-settings/publish", bearer(cafe));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("demo_read_only");
  });
});

// ----------------------------------------------------------------------------------------------
describe("accounts that were answering calls before the stages existed", () => {
  it("are moved to production once, and never again after an admin moves them back", async () => {
    const scratch = await PGlite.create();
    await execAll(scratch, DDL);
    const user = async (email: string, role = "user") =>
      (
        await scratch.query<{ id: string }>(
          `INSERT INTO users (email, name, role, password_hash) VALUES ($1, $1, $2, 'x') RETURNING id`,
          [email, role],
        )
      ).rows[0]!.id;
    const live = await user("live@example.test");
    const boss = await user("boss@example.test", "admin");
    const bare = await user("bare@example.test");
    for (const [id, phone] of [
      [live, "+12065550001"],
      [boss, "+12065550002"],
    ] as const) {
      await scratch.query(`INSERT INTO agent_numbers (phone_e164, user_id) VALUES ($1, $2)`, [phone, id]);
      await scratch.query(
        `INSERT INTO business_profiles (user_id, source_text, source_hash, business_name, facts)
         VALUES ($1, 'x', 'x', 'Live Co', 'We open at nine.')`,
        [id],
      );
    }
    const statusOf = async () =>
      Object.fromEntries(
        (
          await scratch.query<{ email: string; status: string }>("SELECT email, status FROM users")
        ).rows.map((row) => [row.email, row.status]),
      );

    await execAll(scratch, DDL);
    expect(await statusOf()).toEqual({
      "live@example.test": "production",
      "boss@example.test": "unassigned",
      "bare@example.test": "unassigned",
    });

    await scratch.query(`UPDATE users SET status = 'unassigned' WHERE id = $1`, [live]);
    await execAll(scratch, DDL);
    expect((await statusOf())["live@example.test"]).toBe("unassigned");
    expect(bare).toBeTruthy();
    await scratch.close();
  });
});
