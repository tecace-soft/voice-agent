import { describe, expect, it } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

// Why this file exists.
//
// The first production import stored every JSONB column double-encoded: Postgres held a JSON
// *string* where an object belonged, so `profile.name` was undefined and the Customers tab showed
// ten rows of "Unnamed". The data was fine; the binding was not.
//
// The mechanism is postgres.js's, and it is easy to walk into. The driver learns a parameter's type
// from the server's ParameterDescription — so `$1::jsonb` makes it OID 3802 — and types.js
// registers the json serializer (JSON.stringify) for that OID, which connection.js then applies:
// `parameters[i] = type in options.serializers ? options.serializers[type](x) : '' + x`.
// Pre-stringifying therefore encodes twice.
//
// The PGlite shim used by the other tests could not see this: it hands values to the database
// directly and never runs the driver's serializer. So this file tests the binding rule itself,
// against postgres.js's own serializer table, and guards the source shape that caused it.

const TYPES_URL = new URL("../../node_modules/postgres/src/types.js", import.meta.url).href;
const { serializers } = (await import(TYPES_URL)) as {
  serializers: Record<number, (x: unknown) => string>;
};

const JSONB = 3802;
const db = await PGlite.create();
await db.exec("CREATE TABLE binding (v JSONB)");

/** What Postgres ends up holding, given what the driver was handed for a jsonb parameter. */
async function store(handedToTheDriver: unknown) {
  const wire =
    JSONB in serializers ? serializers[JSONB]!(handedToTheDriver) : String(handedToTheDriver);
  await db.query("DELETE FROM binding");
  await db.query("INSERT INTO binding (v) VALUES ($1::jsonb)", [wire]);
  const [row] = (
    await db.query(`SELECT jsonb_typeof(v) AS kind, v->>'name' AS name FROM binding`)
  ).rows as { kind: string; name: string | null }[];
  return row!;
}

const profile = { name: "TecAce Software, Ltd.", services: ["a", "b"] };

describe("binding a value to a JSONB column", () => {
  it("has a driver-side serializer for jsonb at all — the fact the bug turned on", () => {
    expect(JSONB in serializers).toBe(true);
  });

  it("stores an object when handed the value", async () => {
    expect(await store(profile)).toEqual({ kind: "object", name: "TecAce Software, Ltd." });
  });

  it("stores an array when handed an array", async () => {
    expect((await store([])).kind).toBe("array");
  });

  it("stores a STRING when handed a pre-stringified value — the shipped bug", async () => {
    // Exactly what production held: jsonb_typeof 'string', and every field read back as null.
    expect(await store(JSON.stringify(profile))).toEqual({ kind: "string", name: null });
  });
});

// The check above models `sql.json(x)`, where the parameter's type is explicit. The original code
// used the other shape — a bare string plus a `::jsonb` cast — whose type only becomes jsonb at the
// server, which no local shim can reproduce. So that shape is guarded at the source instead.
describe("the writers bind JSON without pre-encoding it", () => {
  const writers = ["src/db/demoImport.ts", "src/db/demoWrite.ts"];

  it("never interpolates a JSON.stringify(...) into a statement", async () => {
    for (const path of writers) {
      const source = await Bun.file(path).text();
      // `${JSON.stringify(x)}` or `${json(x)}` inside a tagged template is the shape that broke.
      expect({ path, hits: [...source.matchAll(/\$\{[^}]*JSON\.stringify[^}]*\}/g)].length })
        .toEqual({ path, hits: 0 });
    }
  });

  it("casts nothing to ::jsonb, because sql.json already types the parameter", async () => {
    for (const path of writers) {
      const source = await Bun.file(path).text();
      expect({ path, hits: [...source.matchAll(/\}::jsonb/g)].length }).toEqual({ path, hits: 0 });
    }
  });
});
