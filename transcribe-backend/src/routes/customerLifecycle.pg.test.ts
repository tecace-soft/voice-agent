import { afterAll, describe, expect, it, mock } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

// The customer's permanent id and the customer's own "Start onboarding", against a real Postgres.
//
// Same harness as `lifecycle.pg.test.ts` (PGlite behind `db/client.js`, the real DDL lifted out of
// `client.ts`, the real importer, real tokens), because what matters here is Postgres behaviour: the
// sequence, the generated column, the backfill's ordering and idempotence, and the route moving the
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

const { findProfile } = await import("../db/businessProfiles.js");
const { setLifecycleById, findUserById } = await import("../db/users.js");
const { lifecycle } = await import("./lifecycle.js");
const { demo } = await import("./demo.js");
const { Elysia } = await import("elysia");
const app = new Elysia().use(lifecycle).use(demo);

const call = async (method: string, path: string, auth?: string) => {
  const response = await app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: auth ? { authorization: auth } : {},
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
  it("gives every imported demo a CUST- code", async () => {
    const { rows } = await db.query<{ customer_code: string }>(
      "SELECT customer_code FROM demo_customers ORDER BY customer_seq",
    );
    expect(rows.map((row) => row.customer_code)).toEqual(["CUST-0001", "CUST-0002", "CUST-0003"]);
  });

  it("cannot be written", async () => {
    await expect(
      db.query(`UPDATE demo_customers SET customer_code = 'CUST-9999' WHERE id = $1`, [RICH]),
    ).rejects.toThrow();
  });

  it("numbers an existing database's rows oldest first, once, and carries on from there", async () => {
    const old = await PGlite.create();
    await execAll(old, DDL.slice(0, CODE_START));
    // Inserted out of date order, so numbering by insertion would give a different answer.
    await insertDemo(old, "bbb", "'2026-02-01T00:00:00Z'");
    await insertDemo(old, "aaa", "'2026-03-01T00:00:00Z'");
    await insertDemo(old, "ccc", "'2026-01-01T00:00:00Z'");
    await execAll(old, DDL.slice(CODE_START));

    const codes = async () =>
      Object.fromEntries(
        (
          await old.query<{ id: string; customer_code: string }>(
            "SELECT id, customer_code FROM demo_customers",
          )
        ).rows.map((row) => [row.id, row.customer_code]),
      );
    expect(await codes()).toEqual({ ccc: "CUST-0001", bbb: "CUST-0002", aaa: "CUST-0003" });

    // The whole schema again, as a cold start does: nothing is renumbered.
    await execAll(old, DDL);
    expect(await codes()).toEqual({ ccc: "CUST-0001", bbb: "CUST-0002", aaa: "CUST-0003" });

    await insertDemo(old, "ddd");
    expect((await codes()).ddd).toBe("CUST-0004");

    // A deleted customer's number is not handed out again.
    await old.query(`DELETE FROM demo_customers WHERE id = 'ddd'`);
    await insertDemo(old, "eee");
    expect((await codes()).eee).toBe("CUST-0005");

    // lpad truncates; the width grows with the number instead.
    await old.query(`SELECT setval('customer_code_seq', 9999)`);
    await insertDemo(old, "fff");
    expect((await codes()).fff).toBe("CUST-10000");
    await old.close();
  });
});

// ----------------------------------------------------------------------------------------------
describe("customerCode and phase on the demo reads", () => {
  it("are on every customer in the list, in demo while nobody has moved", async () => {
    const res = await call("GET", "/demo/customers", ADMIN);
    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.body.customers.map((c: any) => [c.id, c]));
    expect(byId[RICH].customerCode).toBe("CUST-0001");
    expect(byId[RICH].phase).toBe("demo");
    expect(byId[THIN].accountEmail).toBeNull();
  });

  it("are on the CRM board and the detail page too", async () => {
    const crm = await call("GET", "/demo/crm", ADMIN);
    expect(crm.body.customers.find((c: any) => c.id === KEEP).customerCode).toBe("CUST-0003");
    const one = await call("GET", `/demo/customers/${THIN}`, ADMIN);
    expect(one.body.customer.customerCode).toBe("CUST-0002");
    expect(one.body.customer.phase).toBe("demo");
  });
});

// ----------------------------------------------------------------------------------------------
describe("POST /demo/customers/:id/onboard", () => {
  it("turns away an anonymous caller and an account outside the demo stage", async () => {
    expect((await call("POST", `/demo/customers/${RICH}/onboard`)).status).toBe(401);
    expect((await call("POST", `/demo/customers/${RICH}/onboard`, bearer(stray))).status).toBe(403);
  });

  it("answers somebody else's demo as not found", async () => {
    await setLifecycleById(dana.id, { businessId: RICH, status: "demo" });
    const res = await call("POST", `/demo/customers/${THIN}/onboard`, bearer(dana));
    expect(res.status).toBe(404);
  });

  it("moves the customer who pressed it: copy, pre-production, won", async () => {
    const res = await call("POST", `/demo/customers/${RICH}/onboard`, bearer(dana));
    expect(res.status).toBe(200);
    expect(res.body.copied).toBe(true);
    expect(res.body.user.status).toBe("pre-production");
    expect(res.body.customer.phase).toBe("onboarding");
    expect(res.body.customer.stage).toBe("won");
    expect(res.body.customer.customerCode).toBe("CUST-0001");
    expect((await findProfile(dana.id))?.businessName).toBe("Harbor Dental");

    const list = await call("GET", "/demo/customers", ADMIN);
    const harbor = list.body.customers.find((c: any) => c.id === RICH);
    expect(harbor.phase).toBe("onboarding");
    expect(harbor.accountEmail).toBe("dana@harbor.test");
  });

  it("does not run twice", async () => {
    // Past the demo stage, the demo routes are closed to the customer.
    expect((await call("POST", `/demo/customers/${RICH}/onboard`, bearer(dana))).status).toBe(403);
    expect((await call("POST", `/demo/customers/${RICH}/onboard`, ADMIN)).status).toBe(409);
  });

  it("needs a linked account when an admin presses it", async () => {
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

    const res = await call("POST", `/demo/customers/${KEEP}/onboard`, bearer(rival));
    expect(res.status).toBe(200);
    expect(res.body.copied).toBe(false);
    expect((await findProfile(rival.id))?.sourceText).toBe("Their own words.");
  });
});
