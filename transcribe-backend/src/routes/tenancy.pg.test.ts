import { afterAll, describe, expect, it, mock } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

// WHO SEES WHAT. Three kinds of account, driven through the real app against a real Postgres, with
// REAL SESSION TOKENS — no stubbed guard anywhere in this file, because the guard is the thing under
// test. PGlite sits behind `db/client.js`, the DDL is the real one out of `client.ts`, and the rows
// are written by the real writers.
//
// The rules, in the order they were asked for:
//
//   1. A demo-stage customer sees the demo and only the demo, and only their own record in it. Not
//      the prospect list, not the CRM, not the analytics across everybody, and not another
//      prospect — which answers NOT FOUND rather than "forbidden", so the refusal cannot be used to
//      find out which ids are real.
//   2. A business sees its own information and nobody else's. Every scoped read takes `?userId=` as
//      an ADMIN's filter, so the tests below ask for someone else's id as a customer and check that
//      what comes back is still their own.
//   3. An admin sees everything.
//
// Run: bun test src/routes/tenancy.pg.test.ts
process.env.DATABASE_URL ??= "postgres://unused/unused";
process.env.AUTH_SECRET ??= "test-secret-test-secret-test-secret-0123";

const db = await PGlite.create();

// A postgres.js-shaped tagged template over PGlite. A fragment is recognised by its shape rather
// than a private symbol — see `auth/auth.test.ts` for what that guards against when several test
// files share one module registry.
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

const makeTag = () => (strings: TemplateStringsArray, ...values: unknown[]) => ({
  strings,
  values,
  then(resolve: any, reject: any) {
    const built = build(strings, values, { n: 0 });
    return db.query(built.text, built.values).then((r) => r.rows).then(resolve, reject);
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
const body = source.slice(source.indexOf("export async function initDb"), source.indexOf("// On Vercel"));
for (const [, statement = ""] of body.matchAll(/sql`([\s\S]*?)`/g)) {
  try {
    await db.exec(statement);
  } catch (error) {
    throw new Error(`DDL failed: ${statement.trim().slice(0, 90)}\n${(error as Error).message}`);
  }
}

// ----------------------------------------------------------------------------------------------
// Two prospects, so "only their own" has something to be wrong about.
const MINE = "minedemo00001";
const THEIRS = "theirdemo0001";

const customer = (id: string, businessName: string) => ({
  type: "string",
  ttl: -1,
  value: {
    id,
    businessName,
    active: true,
    profile: { name: businessName, address: `1 ${businessName} Way` },
    prompts: { live: `You are Alex at ${businessName}.`, backend: "", greeting: "Hello.", edited: false },
    dossier: `# ${businessName}`,
    sources: [],
    voice: "gleam",
    agentName: "Alex",
    status: "ready",
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-02T10:00:00.000Z",
  },
});

const { parseDump } = await import("../demo/dump.js");
const { importDump } = await import("../db/demoImport.js");
await importDump(
  parseDump({
    data: {
      customers: { type: "set", ttl: -1, value: [MINE, THEIRS] },
      [`customers:${MINE}`]: customer(MINE, "My Cafe"),
      [`customers:${THEIRS}`]: customer(THEIRS, "Their Salon"),
      // An operator's private note on the record the customer can read, so the test can prove it
      // does not travel with it.
      [`notes:${MINE}`]: {
        type: "list",
        ttl: -1,
        value: [{ id: "n1", at: "2026-09-10T10:00:00.000Z", text: "Haggling on price" }],
      },
    },
  }),
);

const { createUser, setLifecycleById } = await import("../db/users.js");
const { createToken } = await import("../auth/session.js");
const { saveProfile } = await import("../db/businessProfiles.js");
const { app } = await import("../app.js");

const hash = "x".repeat(60);

// A real token for a real row: this is how the dashboard signs in, and the guard reads the account
// out of the database on every request.
async function account(
  email: string,
  options: { role?: "admin" | "user"; businessId?: string; status?: "demo" | "production" } = {},
) {
  const user = (await createUser({ email, name: email, passwordHash: hash, role: options.role }))!;
  if (options.businessId || options.status) {
    await setLifecycleById(user.id, { businessId: options.businessId, status: options.status });
  }
  return { id: user.id, token: createToken(user.id, user.tokenVersion).token };
}

const admin = await account("admin@tecace.com", { role: "admin" });
// The prospect who is trying their demo, and the one whose record is none of their business.
const prospect = await account("owner@mycafe.test", { businessId: MINE, status: "demo" });
const rival = await account("owner@theirsalon.test", { businessId: THEIRS, status: "demo" });
// A customer who has moved on: they configure their receptionist in the Business section now.
const live = await account("owner@bakery.test", { status: "production" });
// And an account nobody has placed in the lifecycle — the live voicemail customer's shape.
const voicemail = await account("sam@tecace.com");

// Two business profiles, so "their own information" has something to be wrong about.
for (const [who, name] of [[live, "Bakery"], [voicemail, "Voicemail Co"]] as const) {
  await saveProfile(
    who.id,
    `${name}, a business.`,
    {
      businessName: name,
      hoursText: "Monday to Friday 09:00 to 17:00",
      openHour: 9,
      closeHour: 17,
      website: null,
      facts: `- ${name} is open on weekdays`,
    },
    { transferNumber: null, agentName: null, greeting: null, transferTopics: null, houseRules: null },
    {
      profile: { name, category: "", address: "1 Main Street", hours: [], services: [], highlights: [], policies: {}, faqs: [] },
      prompts: { live: `You are at ${name}.`, backend: "", greeting: "Hello.", edited: false },
      voice: null,
      language: null,
    },
  );
}

const call = async (
  method: string,
  path: string,
  options: { token?: string; body?: unknown } = {},
) => {
  const response = await app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: {
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
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

describe("a demo-stage customer sees their own demo, and only that", () => {
  it("reads their own record", async () => {
    const res = await call("GET", `/demo/customers/${MINE}`, { token: prospect.token });
    expect(res.status).toBe(200);
    expect(res.body.customer.businessName).toBe("My Cafe");
  });

  it("does not get the operator's notes with it", async () => {
    // A CRM note is what we write about a deal. The admin reading the same record does get them,
    // which is what makes this a scope and not a feature that was never built.
    const mine = await call("GET", `/demo/customers/${MINE}`, { token: prospect.token });
    expect(mine.body.notes).toEqual([]);
    const asAdmin = await call("GET", `/demo/customers/${MINE}`, { token: admin.token });
    expect(asAdmin.body.notes).toHaveLength(1);
  });

  it("cannot read another prospect's record, and cannot tell that it exists", async () => {
    const res = await call("GET", `/demo/customers/${THEIRS}`, { token: prospect.token });
    expect(res.status).toBe(404);
    // Byte for byte what a made-up id answers: the refusal says nothing either way.
    const nobody = await call("GET", "/demo/customers/nosuchdemo01", { token: prospect.token });
    expect(res.body).toEqual(nobody.body);
  });

  it("cannot list the prospects, read the CRM, or see the pipeline analytics", async () => {
    for (const path of ["/demo/customers", "/demo/crm", "/demo/analytics"]) {
      const res = await call("GET", path, { token: prospect.token });
      expect(res.status).toBe(403);
      // These are the operator's own views, so they answer with the file's admin-only message
      // rather than the scoped one — there is no version of them that belongs to one customer.
      expect(res.body.message).toBe("Only an admin can read the demo data.");
    }
  });

  it("cannot reach the operator's own actions on their own record either", async () => {
    // Each of these is somebody spending our money or editing our pipeline: research is a model
    // call, /session is an unmetered live-API minute, notes are the CRM, and delete is a delete.
    const forbidden = [
      ["POST", `/demo/customers/${MINE}/research`, {}],
      ["POST", "/demo/session", { customerId: MINE, sdp: "v=0" }],
      ["GET", `/demo/customers/${MINE}/notes`, undefined],
      ["POST", `/demo/customers/${MINE}/notes`, { text: "hello" }],
      ["PATCH", `/demo/customers/${MINE}/calls`, { callId: "c1", isTest: true }],
      ["DELETE", `/demo/customers/${MINE}`, undefined],
      ["POST", "/demo/customers", { businessName: "A New One" }],
    ] as const;
    for (const [method, path, payload] of forbidden) {
      const res = await call(method, path, { token: prospect.token, body: payload });
      expect({ path, status: res.status }).toEqual({ path, status: 403 });
    }
  });

  it("corrects their own knowledge and prompts", async () => {
    const res = await call("PATCH", `/demo/customers/${MINE}`, {
      token: prospect.token,
      body: {
        profile: { name: "My Cafe", address: "2 Harbour Road", hours: [], services: [], highlights: [], policies: {}, faqs: [] },
        prompts: { greeting: "My Cafe, this is Alex." },
        agentName: "Alex",
      },
    });
    expect(res.status).toBe(200);
    expect(res.body.customer.profile.address).toBe("2 Harbour Road");
    expect(res.body.customer.prompts.greeting).toBe("My Cafe, this is Alex.");
  });

  it("cannot edit the commercial side of their own record, and is told which field", async () => {
    for (const [field, value] of [
      ["addDemoMinutes", 60],
      ["demoMinutes", 600],
      ["stage", "won"],
      ["active", true],
      ["contactEmail", "someone@else.test"],
      ["followUpAt", "2026-10-01T00:00:00.000Z"],
      ["notes", "our own notes"],
    ] as const) {
      const res = await call("PATCH", `/demo/customers/${MINE}`, {
        token: prospect.token,
        body: { [field]: value },
      });
      expect({ field, status: res.status }).toEqual({ field, status: 403 });
      expect(res.body.error).toContain(field);
    }
  });

  it("cannot edit another prospect's record at all", async () => {
    const res = await call("PATCH", `/demo/customers/${THEIRS}`, {
      token: prospect.token,
      body: { agentName: "Robin" },
    });
    expect(res.status).toBe(404);
    const theirs = await call("GET", `/demo/customers/${THEIRS}`, { token: admin.token });
    expect(theirs.body.customer.agentName).toBe("Alex");
  });

  it("and the other prospect's own account has the mirror image of all this", async () => {
    expect((await call("GET", `/demo/customers/${THEIRS}`, { token: rival.token })).status).toBe(200);
    expect((await call("GET", `/demo/customers/${MINE}`, { token: rival.token })).status).toBe(404);
  });
});

describe("an account that is not in the demo stage has no demo at all", () => {
  it("turns away a customer who has moved on to production", async () => {
    // Their receptionist is configured in the Business section now, from their own row. Handing
    // them the demo record back would be handing them a copy their edits never reach.
    const res = await call("GET", `/demo/customers/${MINE}`, { token: live.token });
    expect(res.status).toBe(403);
  });

  it("turns away an account nobody has placed in the lifecycle", async () => {
    const res = await call("GET", `/demo/customers/${MINE}`, { token: voicemail.token });
    expect(res.status).toBe(403);
  });

  it("turns away somebody who is not signed in", async () => {
    expect((await call("GET", `/demo/customers/${MINE}`)).status).toBe(401);
  });
});

describe("a business sees its own information and nobody else's", () => {
  it("answers with their own profile however the request is addressed", async () => {
    // `?userId=` is an ADMIN's filter everywhere in this API. Asked as a customer it is ignored,
    // rather than honoured or refused — the answer is simply their own.
    const own = await call("GET", "/business/profile", { token: live.token });
    const asIfOther = await call("GET", `/business/profile?userId=${voicemail.id}`, {
      token: live.token,
    });
    expect(own.status).toBe(200);
    expect(own.body.profile.businessName).toBe("Bakery");
    expect(asIfOther.body.profile.businessName).toBe("Bakery");
    expect(JSON.stringify(asIfOther.body)).not.toContain("Voicemail Co");
  });

  it("writes to their own profile however the request is addressed", async () => {
    const res = await call("PUT", `/business/knowledge?userId=${voicemail.id}`, {
      token: live.token,
      body: {
        profile: { name: "Bakery", address: "3 Mill Lane", hours: [], services: [], highlights: [], policies: {}, faqs: [] },
      },
    });
    expect(res.status).toBe(200);
    // Theirs changed; the other account's did not.
    const mine = await call("GET", "/business/profile", { token: live.token });
    expect(mine.body.profile.profile.address).toBe("3 Mill Lane");
    const other = await call("GET", `/business/profile?userId=${voicemail.id}`, {
      token: admin.token,
    });
    expect(other.body.profile.profile.address).toBe("1 Main Street");
  });

  it("sees only their own answered calls and their own minutes", async () => {
    const calls = await call("GET", `/calls?userId=${voicemail.id}`, { token: live.token });
    expect(calls.status).toBe(200);
    expect(calls.body.calls).toEqual([]);
    const minutes = await call("GET", `/usage/minutes?userId=${voicemail.id}`, {
      token: live.token,
    });
    expect(minutes.status).toBe(200);
    // One row, and it is theirs.
    expect(minutes.body.minutes).toHaveLength(1);
    expect(minutes.body.minutes[0].userId).toBe(live.id);
  });

  it("cannot manage the agent's phone numbers, the accounts, or the API keys", async () => {
    for (const path of ["/business/numbers", "/auth/users", "/api-keys"]) {
      const res = await call("GET", path, { token: live.token });
      expect({ path, status: res.status }).toEqual({ path, status: 403 });
    }
  });
});

describe("an admin sees everything", () => {
  it("reads either prospect and the whole pipeline", async () => {
    for (const path of [
      `/demo/customers/${MINE}`,
      `/demo/customers/${THEIRS}`,
      "/demo/customers",
      "/demo/crm",
      "/demo/analytics",
    ]) {
      const res = await call("GET", path, { token: admin.token });
      expect({ path, status: res.status }).toEqual({ path, status: 200 });
    }
  });

  it("reads any business's information by naming it", async () => {
    const res = await call("GET", `/business/profile?userId=${voicemail.id}`, {
      token: admin.token,
    });
    expect(res.body.profile.businessName).toBe("Voicemail Co");
  });

  it("and may still change the commercial side of a demo", async () => {
    const res = await call("PATCH", `/demo/customers/${MINE}`, {
      token: admin.token,
      body: { stage: "interested", addDemoMinutes: 10 },
    });
    expect(res.status).toBe(200);
    expect(res.body.customer.stage).toBe("interested");
  });
});
