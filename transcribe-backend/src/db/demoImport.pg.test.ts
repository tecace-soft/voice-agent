import { beforeAll, describe, expect, it, mock } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

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
// double-encoded JSON value, which a shim that forwarded raw values could not.
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

await mock.module("./client.js", () => ({
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

const { parseDump } = await import("../demo/dump.js");
const { importDump } = await import("./demoImport.js");

const customer = (id: string, businessName: string) => ({
  type: "string", ttl: -1,
  value: {
    id, businessName, active: true, profile: { name: businessName }, dossier: "# " + businessName,
    sources: [{ url: "https://example.test" }], prompts: { live: "You are Alex", edited: false },
    voice: "gleam", agentName: "Alex", status: "ready", stage: "new",
    createdAt: "2026-09-20T04:40:00.000Z", updatedAt: "2026-09-20T04:41:00.000Z",
  },
});

const DUMP = {
  data: {
    customers: { type: "set", ttl: -1, value: ["aaaaaaaaaaaa", "bbbbbbbbbbbb"] },
    "customers:aaaaaaaaaaaa": customer("aaaaaaaaaaaa", "Harbor Dental"),
    "customers:bbbbbbbbbbbb": customer("bbbbbbbbbbbb", "Cedar Bakery"),
    "calls:aaaaaaaaaaaa:c1": {
      type: "string", ttl: -1,
      value: {
        id: "c1", customerId: "aaaaaaaaaaaa", status: "completed",
        startedAt: "2026-09-20T04:42:19.298Z", endedAt: "2026-09-20T04:44:20.204Z",
        durationSec: 119, turns: 22, isTest: true, visitorId: "v1",
        transcript: [{ id: "t1", speaker: "caller", text: "Hi", startMs: 0, endMs: 900 }],
        review: { sentiment: "happy" },
      },
    },
    events: {
      type: "list", ttl: -1,
      value: ['{"type":"page_view","customerId":"aaaaaaaaaaaa","at":"2026-09-20T04:42:10.049Z","ipHash":"ee5c"}'],
    },
    "events:bbbbbbbbbbbb": {
      type: "list", ttl: -1,
      value: [{ type: "page_view", customerId: "bbbbbbbbbbbb", at: "2026-09-21T03:50:20.109Z", visitorId: "229f" }],
    },
    "notes:aaaaaaaaaaaa": {
      type: "list", ttl: -1,
      value: [{ id: "n1", at: "2026-09-21T06:00:00.000Z", text: "Called back" }],
    },
  },
};

const countOf = async (table: string) =>
  Number(((await db.query(`SELECT count(*)::int AS n FROM ${table}`)).rows as any[])[0].n);

describe("the demo schema and importer, against a real Postgres", () => {
  it("imports every entity", async () => {
    const counts = await importDump(parseDump(DUMP));
    expect(counts).toEqual({ customers: 2, calls: 1, events: 2, notes: 1 });
    expect(await countOf("demo_customers")).toBe(2);
    expect(await countOf("demo_calls")).toBe(1);
    expect(await countOf("demo_call_events")).toBe(2);
    expect(await countOf("demo_notes")).toBe(1);
  });

  it("stores the blobs as JSON that can be read back, not as strings", async () => {
    const [row] = (await db.query(
      `SELECT profile->>'name' AS name, jsonb_array_length(transcript) AS turns,
              review->>'sentiment' AS sentiment
       FROM demo_customers c JOIN demo_calls t ON t.customer_id = c.id WHERE c.id = 'aaaaaaaaaaaa'`,
    )).rows as any[];
    expect(row.name).toBe("Harbor Dental");
    expect(row.turns).toBe(1);
    expect(row.sentiment).toBe("happy");
  });

  it("keeps both event eras apart", async () => {
    const rows = (await db.query(
      `SELECT source, visitor_id, ip_hash FROM demo_call_events ORDER BY at`,
    )).rows as any[];
    expect(rows.map((r) => r.source)).toEqual(["legacy", "customer"]);
    expect(rows[0].ip_hash).toBe("ee5c");
    expect(rows[0].visitor_id).toBeNull();
    expect(rows[1].visitor_id).toBe("229f");
  });

  it("is idempotent: a second run of the same dump inserts nothing new", async () => {
    const counts = await importDump(parseDump(DUMP));
    expect(counts).toEqual({ customers: 0, calls: 0, events: 0, notes: 0 });
    expect(await countOf("demo_customers")).toBe(2);
    expect(await countOf("demo_call_events")).toBe(2); // the expression index did its job
  });

  it("updates a changed customer in place rather than duplicating it", async () => {
    const changed = structuredClone(DUMP);
    changed.data["customers:aaaaaaaaaaaa"].value.businessName = "Harbor Dental Group";
    changed.data["customers:aaaaaaaaaaaa"].value.stage = "interested";
    await importDump(parseDump(changed));
    const [row] = (await db.query(
      `SELECT business_name, stage FROM demo_customers WHERE id = 'aaaaaaaaaaaa'`,
    )).rows as any[];
    expect(row.business_name).toBe("Harbor Dental Group");
    expect(row.stage).toBe("interested");
    expect(await countOf("demo_customers")).toBe(2);
  });

  it("refuses a stage the CHECK does not allow", async () => {
    const bad = structuredClone(DUMP);
    bad.data["customers:bbbbbbbbbbbb"].value.stage = "maybe";
    await expect(importDump(parseDump(bad))).rejects.toThrow();
    // The transaction rolled back, so the good rows from this attempt are not half-applied.
    expect(await countOf("demo_customers")).toBe(2);
  });

  it("cascades: deleting a customer takes its calls, events and notes with it", async () => {
    await db.exec(`DELETE FROM demo_customers WHERE id = 'aaaaaaaaaaaa'`);
    expect(await countOf("demo_calls")).toBe(0);
    expect(await countOf("demo_notes")).toBe(0);
    expect(await countOf("demo_call_events")).toBe(1); // Cedar Bakery's survives
  });
});

// A dry run does the whole import and rolls it back, so its counts are the counts a real run would
// produce. That is worth pinning: if the rollback ever stopped working, `--dry-run` against
// production would silently write instead of reporting.
describe("importDump({ dryRun: true })", () => {
  beforeAll(async () => {
    // The tests above leave the tables part-filled; start from empty so the numbers below mean
    // "everything in DUMP" rather than "whatever the previous describe happened to leave".
    await db.exec("TRUNCATE demo_customers, demo_calls, demo_call_events, demo_notes CASCADE");
  });

  it("reports what a real run would insert, and writes nothing", async () => {
    const counts = await importDump(parseDump(DUMP), { dryRun: true });
    expect(counts).toEqual({ customers: 2, calls: 1, events: 2, notes: 1 });
    expect(await countOf("demo_customers")).toBe(0);
    expect(await countOf("demo_calls")).toBe(0);
    expect(await countOf("demo_call_events")).toBe(0);
    expect(await countOf("demo_notes")).toBe(0);
  });

  it("reports only the difference against a part-loaded database", async () => {
    await importDump(parseDump(DUMP));
    await db.exec("DELETE FROM demo_customers WHERE id = 'bbbbbbbbbbbb'");
    // One customer is missing, and the cascade took its event with it — so a real run would insert
    // exactly those two rows back. A dry run that merely counted the file would say 2 and 2.
    expect(await importDump(parseDump(DUMP), { dryRun: true }))
      .toEqual({ customers: 1, calls: 0, events: 1, notes: 0 });
    expect(await countOf("demo_customers")).toBe(1); // and still wrote nothing
  });

  it("reports all zeros once everything is loaded — how to confirm an import landed", async () => {
    await importDump(parseDump(DUMP));
    expect(await importDump(parseDump(DUMP), { dryRun: true }))
      .toEqual({ customers: 0, calls: 0, events: 0, notes: 0 });
  });
});
