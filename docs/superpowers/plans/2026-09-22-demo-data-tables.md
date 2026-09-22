# Demo data tables implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the promo's final Redis export a permanent home in transcribe-db: four `demo_*` tables and a re-runnable importer. No API routes and no front-end change.

**Architecture:** A pure mapping layer (`src/demo/map.ts`) turns Redis records into row objects and is tested without a database. A writer (`src/db/demoImport.ts`) upserts those rows in one transaction. A CLI (`src/db/importDemo.ts`) does the I/O. The schema joins `initDb()` and the `migrateIfNeeded()` probe, the pattern every other table here uses.

**Tech Stack:** Bun, TypeScript, postgres.js 3.4.9, `bun test`, and `@electric-sql/pglite` (already a devDependency) for the real-Postgres test.

**Source of truth:** `docs/superpowers/specs/2026-09-22-demo-data-tables-design.md`. Read it first — it records the verified facts about the data (counts, that both event lists are real and disjoint, that every foreign key resolves).

**No commits.** The user handles all git write operations. Leave changes in the working tree and list them at the end.

---

## File structure

| File | Responsibility |
| --- | --- |
| `src/demo/map.ts` (new) | Pure: one Redis record → one row object. No I/O, no SQL. |
| `src/demo/map.test.ts` (new) | Mapping tests, from miniature fixtures shaped like the real export. |
| `src/demo/dump.ts` (new) | Pure: group the dump's keys into entities, check referential integrity. |
| `src/demo/dump.test.ts` (new) | Grouping and integrity tests. |
| `src/db/client.ts` (modify) | The four `CREATE TABLE`s, their indexes, and four probe lines. |
| `src/db/demoImport.ts` (new) | The writer: upserts every entity in one transaction, returns counts. |
| `src/db/importDemo.ts` (new) | The CLI entry point: read file, parse, write, print. |
| `src/db/demoImport.pg.test.ts` (new) | The whole schema and importer against PGlite. |
| `package.json` (modify) | One script: `demo:import`. |

`map.ts` and `dump.ts` are separate because they fail differently: a mapping bug is about one record's fields, an integrity failure is about the set as a whole.

---

### Task 1: Row types and the customer mapping

**Files:**
- Create: `src/demo/map.ts`
- Test: `src/demo/map.test.ts`

- [x] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "bun:test";
import { toCustomerRow } from "./map.js";

// Shaped exactly like customers:<id> in the export, trimmed to what the mapping reads.
const FULL = {
  id: "sE8vbvPuW4vY",
  active: true,
  businessName: "Consulate General of the Republic of Korea",
  label: "Seattle",
  contactName: "Dana Reyes",
  contactEmail: "dana@example.test",
  notes: "Met at the expo",
  websiteUrl: "https://example.test",
  mapsUrl: "https://maps.app.goo.gl/x",
  resolvedMapsUrl: "https://www.google.com/maps/place/x",
  researchNotes: "Ask about hours",
  profile: { name: "Consulate", services: ["visas"] },
  dossier: "# Consulate\n\nNotes.",
  sources: [{ title: "Site", url: "https://example.test" }],
  prompts: { live: "You are Alex", backend: "", greeting: "", edited: false },
  callSound: { ambience: "office" },
  voice: "gleam",
  agentName: "Alex",
  language: "ko",
  demoMinutes: 5,
  stage: "new",
  status: "ready",
  error: "",
  lastContactedAt: "2026-09-21T06:00:00.000Z",
  followUpAt: "2026-09-25T06:00:00.000Z",
  createdAt: "2026-09-21T03:19:45.645Z",
  updatedAt: "2026-09-21T06:15:52.686Z",
  researchedAt: "2026-09-21T06:15:52.686Z",
};

// What most of the real export looks like: the optional half is simply absent.
const MINIMAL = {
  id: "ix-TJazEwZw9",
  active: true,
  businessName: "TecAce Software",
  profile: {},
  dossier: "",
  sources: [],
  prompts: {},
  voice: "gleam",
  agentName: "Alex",
  status: "ready",
  createdAt: "2026-09-20T04:40:00.000Z",
  updatedAt: "2026-09-20T04:41:00.000Z",
};

describe("toCustomerRow", () => {
  it("carries every field across, with instants as Dates", () => {
    const row = toCustomerRow(FULL);
    expect(row.id).toBe("sE8vbvPuW4vY");
    expect(row.businessName).toBe("Consulate General of the Republic of Korea");
    expect(row.operatorNotes).toBe("Met at the expo"); // renamed: `notes` is the CRM list
    expect(row.demoMinutes).toBe(5);
    expect(row.stage).toBe("new");
    expect(row.createdAt).toEqual(new Date("2026-09-21T03:19:45.645Z"));
    expect(row.researchedAt).toEqual(new Date("2026-09-21T06:15:52.686Z"));
    // The blobs pass through untouched — they are only ever read whole.
    expect(row.profile).toEqual({ name: "Consulate", services: ["visas"] });
    expect(row.sources).toEqual([{ title: "Site", url: "https://example.test" }]);
    expect(row.callSound).toEqual({ ambience: "office" });
  });

  it("turns an absent optional into null, not undefined or an empty string", () => {
    const row = toCustomerRow(MINIMAL);
    expect(row.label).toBeNull();
    expect(row.contactName).toBeNull();
    expect(row.operatorNotes).toBeNull();
    expect(row.demoMinutes).toBeNull();
    expect(row.stage).toBeNull();
    expect(row.followUpAt).toBeNull();
    expect(row.researchedAt).toBeNull();
    expect(row.callSound).toBeNull();
    // Absent blobs still have to satisfy NOT NULL.
    expect(row.profile).toEqual({});
    expect(row.sources).toEqual([]);
    expect(row.dossier).toBe("");
  });

  it("treats an empty string as absent for `error`, which the promo writes both ways", () => {
    expect(toCustomerRow(FULL).error).toBeNull();
    expect(toCustomerRow({ ...FULL, error: "Research failed" }).error).toBe("Research failed");
  });

  it("refuses a record with no id or no businessName, rather than writing a useless row", () => {
    expect(() => toCustomerRow({ ...MINIMAL, id: "" })).toThrow(/id/);
    expect(() => toCustomerRow({ ...MINIMAL, businessName: undefined })).toThrow(/businessName/);
  });
});
```

- [x] **Step 2: Run it to watch it fail**

Run: `bun test src/demo/map.test.ts`
Expected: FAIL — `Cannot find module './map.js'`.

- [x] **Step 3: Write the mapping**

Create `src/demo/map.ts`:

```ts
// Redis record -> row object. Pure: no I/O and no SQL, so the shape of the data can be pinned
// without a database. The promo's own field names are on the left (lib/types.ts), ours on the right.

/** A JSON object as it comes out of the dump. */
export type Raw = Record<string, unknown>;

export interface DemoCustomerRow {
  id: string;
  active: boolean;
  businessName: string;
  label: string | null;
  contactName: string | null;
  contactEmail: string | null;
  /** The promo's `Customer.notes`: one free-text operator note, not the CRM note list. */
  operatorNotes: string | null;
  websiteUrl: string | null;
  mapsUrl: string | null;
  resolvedMapsUrl: string | null;
  researchNotes: string | null;
  profile: unknown;
  dossier: string;
  sources: unknown;
  prompts: unknown;
  callSound: unknown;
  voice: string | null;
  agentName: string | null;
  language: string | null;
  demoMinutes: number | null;
  stage: string | null;
  status: string;
  error: string | null;
  lastContactedAt: Date | null;
  followUpAt: Date | null;
  researchedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export class MappingError extends Error {}

/** A required string. An empty one is as useless as a missing one, so both are refused. */
function required(raw: Raw, field: string): string {
  const value = raw[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new MappingError(`${field} is required (got ${JSON.stringify(value)})`);
  }
  return value;
}

/** An optional string. Absent, null and "" all become null: the promo writes all three. */
function optional(raw: Raw, field: string): string | null {
  const value = raw[field];
  return typeof value === "string" && value !== "" ? value : null;
}

function optionalInt(raw: Raw, field: string): number | null {
  const value = raw[field];
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;
}

/** A required instant. A malformed one is a bug worth stopping for, not a null to explain later. */
export function instant(raw: Raw, field: string): Date {
  const value = raw[field];
  const date = typeof value === "string" ? new Date(value) : new Date(NaN);
  if (Number.isNaN(date.getTime())) {
    throw new MappingError(`${field} is not an ISO instant (got ${JSON.stringify(value)})`);
  }
  return date;
}

export function optionalInstant(raw: Raw, field: string): Date | null {
  if (raw[field] === undefined || raw[field] === null || raw[field] === "") return null;
  return instant(raw, field);
}

export function toCustomerRow(raw: Raw): DemoCustomerRow {
  return {
    id: required(raw, "id"),
    active: raw.active !== false, // absent means active, as the promo reads it
    businessName: required(raw, "businessName"),
    label: optional(raw, "label"),
    contactName: optional(raw, "contactName"),
    contactEmail: optional(raw, "contactEmail"),
    operatorNotes: optional(raw, "notes"),
    websiteUrl: optional(raw, "websiteUrl"),
    mapsUrl: optional(raw, "mapsUrl"),
    resolvedMapsUrl: optional(raw, "resolvedMapsUrl"),
    researchNotes: optional(raw, "researchNotes"),
    profile: raw.profile ?? {},
    dossier: typeof raw.dossier === "string" ? raw.dossier : "",
    sources: raw.sources ?? [],
    prompts: raw.prompts ?? {},
    callSound: raw.callSound ?? null,
    voice: optional(raw, "voice"),
    agentName: optional(raw, "agentName"),
    language: optional(raw, "language"),
    demoMinutes: optionalInt(raw, "demoMinutes"),
    stage: optional(raw, "stage"),
    status: optional(raw, "status") ?? "new",
    error: optional(raw, "error"),
    lastContactedAt: optionalInstant(raw, "lastContactedAt"),
    followUpAt: optionalInstant(raw, "followUpAt"),
    researchedAt: optionalInstant(raw, "researchedAt"),
    createdAt: instant(raw, "createdAt"),
    updatedAt: instant(raw, "updatedAt"),
  };
}
```

- [x] **Step 4: Run the test**

Run: `bun test src/demo/map.test.ts`
Expected: PASS, 4 tests.

---

### Task 2: The call mapping

**Files:**
- Modify: `src/demo/map.ts`
- Test: `src/demo/map.test.ts`

- [x] **Step 1: Write the failing test** (append to `src/demo/map.test.ts`)

```ts
import { toCallRow } from "./map.js";

const CALL = {
  id: "YFtOnvfqvaX5",
  customerId: "sE8vbvPuW4vY",
  liveSessionId: "unknown",
  startedAt: "2026-09-21T05:29:34.043Z",
  endedAt: "2026-09-21T05:33:35.345Z",
  status: "completed",
  durationSec: 241,
  turns: 33,
  endReason: "close_requested",
  isTest: true,
  visitorId: "dd2ac8c3-376a-437f-89aa-4fb4c8f47cda",
  userAgent: "Mozilla/5.0",
  transcript: [{ id: "caller-10000-1", speaker: "caller", text: "Hi", startMs: 10000, endMs: 11200 }],
  review: { tested: "Booking", sentiment: "happy", at: "2026-09-21T05:34:00.000Z", model: "x" },
};

describe("toCallRow", () => {
  it("carries the call across, transcript and review intact", () => {
    const row = toCallRow(CALL);
    expect(row.id).toBe("YFtOnvfqvaX5");
    expect(row.customerId).toBe("sE8vbvPuW4vY");
    expect(row.startedAt).toEqual(new Date("2026-09-21T05:29:34.043Z"));
    expect(row.endedAt).toEqual(new Date("2026-09-21T05:33:35.345Z"));
    expect(row.durationSec).toBe(241);
    expect(row.turns).toBe(33);
    expect(row.isTest).toBe(true);
    expect(row.transcript).toEqual(CALL.transcript);
    expect(row.review).toEqual(CALL.review);
  });

  it("handles a call still running: no end, no duration, no review", () => {
    const row = toCallRow({
      id: "x", customerId: "c", startedAt: "2026-09-21T05:29:34.043Z", status: "started",
    });
    expect(row.endedAt).toBeNull();
    expect(row.durationSec).toBeNull();
    expect(row.turns).toBeNull();
    expect(row.review).toBeNull();
    expect(row.isTest).toBe(false); // absent is not a test call
    expect(row.transcript).toEqual([]); // NOT NULL in the table
  });

  it("refuses a call with no customer, which could not be attached to anything", () => {
    expect(() => toCallRow({ ...CALL, customerId: "" })).toThrow(/customerId/);
  });

  it("refuses a status the table's CHECK would reject, naming it", () => {
    expect(() => toCallRow({ ...CALL, status: "wat" })).toThrow(/status.*wat/);
  });
});
```

- [x] **Step 2: Run it to watch it fail**

Run: `bun test src/demo/map.test.ts`
Expected: FAIL — `toCallRow is not a function`.

- [x] **Step 3: Add the mapping** (append to `src/demo/map.ts`)

```ts
/** lib/types.ts CallStatus. Mirrored by the table's CHECK, so a bad one is caught here first. */
export const CALL_STATUSES = ["started", "completed", "failed", "abandoned"] as const;

export interface DemoCallRow {
  id: string;
  customerId: string;
  liveSessionId: string | null;
  startedAt: Date;
  endedAt: Date | null;
  status: string;
  durationSec: number | null;
  turns: number | null;
  endReason: string | null;
  isTest: boolean;
  visitorId: string | null;
  ipHash: string | null;
  userAgent: string | null;
  transcript: unknown;
  review: unknown;
}

export function toCallRow(raw: Raw): DemoCallRow {
  const status = required(raw, "status");
  if (!(CALL_STATUSES as readonly string[]).includes(status)) {
    throw new MappingError(`status ${JSON.stringify(status)} is not one of ${CALL_STATUSES.join(", ")}`);
  }
  return {
    id: required(raw, "id"),
    customerId: required(raw, "customerId"),
    liveSessionId: optional(raw, "liveSessionId"),
    startedAt: instant(raw, "startedAt"),
    endedAt: optionalInstant(raw, "endedAt"),
    status,
    durationSec: optionalInt(raw, "durationSec"),
    turns: optionalInt(raw, "turns"),
    endReason: optional(raw, "endReason"),
    isTest: raw.isTest === true,
    visitorId: optional(raw, "visitorId"),
    ipHash: optional(raw, "ipHash"),
    userAgent: optional(raw, "userAgent"),
    transcript: raw.transcript ?? [],
    review: raw.review ?? null,
  };
}
```

- [x] **Step 4: Run the test**

Run: `bun test src/demo/map.test.ts`
Expected: PASS, 8 tests.

---

### Task 3: Events and notes

**Files:**
- Modify: `src/demo/map.ts`
- Test: `src/demo/map.test.ts`

- [x] **Step 1: Write the failing test** (append to `src/demo/map.test.ts`)

```ts
import { toEventRow, toNoteRow } from "./map.js";

describe("toEventRow", () => {
  // The older format: the legacy global list, ipHash and no visitorId.
  it("maps a legacy event and records which list it came from", () => {
    const row = toEventRow(
      { type: "page_view", customerId: "ix-TJazEwZw9", at: "2026-09-20T04:42:10.049Z", ipHash: "ee5c" },
      "legacy",
    );
    expect(row.customerId).toBe("ix-TJazEwZw9");
    expect(row.type).toBe("page_view");
    expect(row.at).toEqual(new Date("2026-09-20T04:42:10.049Z"));
    expect(row.ipHash).toBe("ee5c");
    expect(row.visitorId).toBeNull();
    expect(row.source).toBe("legacy");
  });

  it("maps a per-customer event, which carries a visitorId instead", () => {
    const row = toEventRow(
      { type: "page_view", customerId: "sE8vbvPuW4vY", at: "2026-09-21T03:50:20.109Z", visitorId: "229f" },
      "customer",
    );
    expect(row.visitorId).toBe("229f");
    expect(row.ipHash).toBeNull();
    expect(row.source).toBe("customer");
  });

  it("refuses an event with no type or no instant", () => {
    expect(() => toEventRow({ customerId: "c", at: "2026-09-20T04:42:10.049Z" }, "legacy")).toThrow(/type/);
    expect(() => toEventRow({ type: "page_view", customerId: "c", at: "nope" }, "legacy")).toThrow(/at/);
  });
});

describe("toNoteRow", () => {
  it("maps a CRM note", () => {
    const row = toNoteRow({ id: "n1", at: "2026-09-21T06:00:00.000Z", text: "Called back" }, "sE8vbvPuW4vY");
    expect(row).toEqual({
      id: "n1",
      customerId: "sE8vbvPuW4vY",
      at: new Date("2026-09-21T06:00:00.000Z"),
      text: "Called back",
    });
  });

  it("refuses a note with no text, which would render as an empty row", () => {
    expect(() => toNoteRow({ id: "n1", at: "2026-09-21T06:00:00.000Z", text: "" }, "c")).toThrow(/text/);
  });
});
```

- [x] **Step 2: Run it to watch it fail**

Run: `bun test src/demo/map.test.ts`
Expected: FAIL — `toEventRow is not a function`.

- [x] **Step 3: Add the mappings** (append to `src/demo/map.ts`)

```ts
/** Which list an event came out of. The two eras carry different fields — see the design doc. */
export type EventSource = "legacy" | "customer";

export interface DemoEventRow {
  customerId: string;
  type: string;
  at: Date;
  visitorId: string | null;
  ipHash: string | null;
  source: EventSource;
}

export function toEventRow(raw: Raw, source: EventSource): DemoEventRow {
  return {
    customerId: required(raw, "customerId"),
    type: required(raw, "type"),
    at: instant(raw, "at"),
    visitorId: optional(raw, "visitorId"),
    ipHash: optional(raw, "ipHash"),
    source,
  };
}

export interface DemoNoteRow {
  id: string;
  customerId: string;
  at: Date;
  text: string;
}

/** The customer id comes from the key (`notes:<customerId>`), not from the record. */
export function toNoteRow(raw: Raw, customerId: string): DemoNoteRow {
  return {
    id: required(raw, "id"),
    customerId,
    at: instant(raw, "at"),
    text: required(raw, "text"),
  };
}
```

- [x] **Step 4: Run the test**

Run: `bun test src/demo/map.test.ts`
Expected: PASS, 13 tests.

---

### Task 4: Reading the dump and checking it hangs together

**Files:**
- Create: `src/demo/dump.ts`
- Test: `src/demo/dump.test.ts`

- [x] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "bun:test";
import { parseDump, DumpError } from "./dump.js";

const customer = (id: string, businessName: string) => ({
  type: "string",
  ttl: -1,
  value: {
    id, businessName, active: true, profile: {}, dossier: "", sources: [], prompts: {},
    voice: "gleam", agentName: "Alex", status: "ready",
    createdAt: "2026-09-20T04:40:00.000Z", updatedAt: "2026-09-20T04:41:00.000Z",
  },
});

const call = (id: string, customerId: string) => ({
  type: "string",
  ttl: -1,
  value: {
    id, customerId, status: "completed", startedAt: "2026-09-20T04:42:19.298Z",
    endedAt: "2026-09-20T04:44:20.204Z", durationSec: 119, turns: 22, isTest: true, transcript: [],
  },
});

const DUMP = {
  exportedAt: "2026-09-22T21:37:19.717Z",
  source: "Upstash Redis (voiceagent-promo)",
  keyCount: 6,
  data: {
    customers: { type: "set", ttl: -1, value: ["aaaaaaaaaaaa", "bbbbbbbbbbbb"] },
    "customers:aaaaaaaaaaaa": customer("aaaaaaaaaaaa", "Harbor Dental"),
    "customers:bbbbbbbbbbbb": customer("bbbbbbbbbbbb", "Cedar Bakery"),
    "calls:aaaaaaaaaaaa": { type: "set", ttl: -1, value: ["c1"] },
    "calls:aaaaaaaaaaaa:c1": call("c1", "aaaaaaaaaaaa"),
    // A Redis list holds JSON strings, not objects — the parser has to cope with both.
    events: {
      type: "list", ttl: -1,
      value: ['{"type":"page_view","customerId":"aaaaaaaaaaaa","at":"2026-09-20T04:42:10.049Z","ipHash":"ee5c"}'],
    },
    "events:bbbbbbbbbbbb": {
      type: "list", ttl: -1,
      value: [{ type: "page_view", customerId: "bbbbbbbbbbbb", at: "2026-09-21T03:50:20.109Z", visitorId: "229f" }],
    },
  },
};

describe("parseDump", () => {
  it("groups the keys into entities", () => {
    const parsed = parseDump(DUMP);
    expect(parsed.customers.map((c) => c.id).sort()).toEqual(["aaaaaaaaaaaa", "bbbbbbbbbbbb"]);
    expect(parsed.calls.map((c) => c.id)).toEqual(["c1"]);
    expect(parsed.notes).toEqual([]);
  });

  it("takes events from BOTH lists and tags each with its source", () => {
    const parsed = parseDump(DUMP);
    expect(parsed.events).toHaveLength(2);
    expect(parsed.events.filter((e) => e.source === "legacy")).toHaveLength(1);
    expect(parsed.events.filter((e) => e.source === "customer")).toHaveLength(1);
    // The legacy entry was a JSON string inside the list.
    expect(parsed.events.find((e) => e.source === "legacy")?.ipHash).toBe("ee5c");
  });

  it("refuses a file that is not a dump, rather than importing nothing and reporting success", () => {
    expect(() => parseDump({})).toThrow(DumpError);
    expect(() => parseDump({ data: [] })).toThrow(DumpError);
    expect(() => parseDump(null)).toThrow(DumpError);
  });

  it("names every call whose customer is missing, and imports nothing", () => {
    const orphaned = structuredClone(DUMP);
    orphaned.data["calls:zzzzzzzzzzzz:c2"] = call("c2", "zzzzzzzzzzzz");
    expect(() => parseDump(orphaned)).toThrow(/c2.*zzzzzzzzzzzz/s);
  });

  it("names an event whose customer is missing", () => {
    const orphaned = structuredClone(DUMP);
    orphaned.data["events:zzzzzzzzzzzz"] = {
      type: "list", ttl: -1,
      value: [{ type: "page_view", customerId: "zzzzzzzzzzzz", at: "2026-09-21T03:50:20.109Z" }],
    };
    expect(() => parseDump(orphaned)).toThrow(/zzzzzzzzzzzz/);
  });
});
```

- [x] **Step 2: Run it to watch it fail**

Run: `bun test src/demo/dump.test.ts`
Expected: FAIL — `Cannot find module './dump.js'`.

- [x] **Step 3: Write the parser**

Create `src/demo/dump.ts`:

```ts
import {
  toCallRow, toCustomerRow, toEventRow, toNoteRow,
  type DemoCallRow, type DemoCustomerRow, type DemoEventRow, type DemoNoteRow, type Raw,
} from "./map.js";

// The export's own envelope: { exportedAt, source, keyCount, data }, where data maps a Redis key to
// { type, ttl, value }. Only `data` matters here.

export class DumpError extends Error {}

interface Entry {
  type: string;
  value: unknown;
}

export interface ParsedDump {
  customers: DemoCustomerRow[];
  calls: DemoCallRow[];
  events: DemoEventRow[];
  notes: DemoNoteRow[];
}

/** A Redis list holds strings; an export may have parsed them already. Accept both. */
function listEntries(value: unknown): Raw[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (typeof item !== "string") return item as Raw;
    try {
      return JSON.parse(item) as Raw;
    } catch {
      throw new DumpError(`a list entry is not JSON: ${item.slice(0, 80)}`);
    }
  });
}

export function parseDump(input: unknown): ParsedDump {
  const data = (input as { data?: unknown } | null)?.data;
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new DumpError("not a Redis export: expected an object with a `data` object");
  }
  const entries = data as Record<string, Entry>;

  const customers: DemoCustomerRow[] = [];
  const calls: DemoCallRow[] = [];
  const events: DemoEventRow[] = [];
  const notes: DemoNoteRow[] = [];

  for (const [key, entry] of Object.entries(entries)) {
    const value = entry?.value;
    // `customers` and `calls:<id>` are sets of ids — indexes into the records, nothing to import.
    if (key === "customers" || /^calls:[^:]+$/.test(key)) continue;

    if (key.startsWith("customers:")) {
      customers.push(toCustomerRow(value as Raw));
    } else if (/^calls:[^:]+:[^:]+$/.test(key)) {
      calls.push(toCallRow(value as Raw));
    } else if (key === "events") {
      for (const raw of listEntries(value)) events.push(toEventRow(raw, "legacy"));
    } else if (key.startsWith("events:")) {
      for (const raw of listEntries(value)) events.push(toEventRow(raw, "customer"));
    } else if (key.startsWith("notes:")) {
      const customerId = key.slice("notes:".length);
      for (const raw of listEntries(value)) notes.push(toNoteRow(raw, customerId));
    }
    // Anything else is a key this importer does not know about; leaving it is deliberate.
  }

  // Referential integrity up front: the alternative is dropping rows at INSERT time, where a
  // missing prospect becomes a foreign-key error with no indication of which record caused it.
  const known = new Set(customers.map((c) => c.id));
  const orphans = [
    ...calls.filter((c) => !known.has(c.customerId)).map((c) => `call ${c.id} -> ${c.customerId}`),
    ...events.filter((e) => !known.has(e.customerId)).map((e) => `event ${e.type}@${e.at.toISOString()} -> ${e.customerId}`),
    ...notes.filter((n) => !known.has(n.customerId)).map((n) => `note ${n.id} -> ${n.customerId}`),
  ];
  if (orphans.length > 0) {
    throw new DumpError(`${orphans.length} record(s) name a customer the dump does not contain:\n  ${orphans.join("\n  ")}`);
  }

  return { customers, calls, events, notes };
}
```

- [x] **Step 4: Run the test**

Run: `bun test src/demo/dump.test.ts`
Expected: PASS, 5 tests.

---

### Task 5: The schema

**Files:**
- Modify: `src/db/client.ts`

- [x] **Step 1: Add the four tables**

In `src/db/client.ts`, inside `initDb()`, **after the `api_keys` block and before the function's closing brace**, add:

```ts
  // ---- Demo data, imported from the promo's final Redis export (2026-09-22). ----
  // A different product sharing this database, hence the demo_ prefix. The ids are the promo's own
  // nanoids: they are in the demo links, the transcripts and the CSV exports, so renumbering them
  // would break links for no gain.
  await sql`
    CREATE TABLE IF NOT EXISTS demo_customers (
      id                TEXT PRIMARY KEY,
      active            BOOLEAN NOT NULL DEFAULT true,
      business_name     TEXT NOT NULL,
      label             TEXT,
      contact_name      TEXT,
      contact_email     TEXT,
      operator_notes    TEXT,          -- the promo's Customer.notes, not the CRM note list
      website_url       TEXT,
      maps_url          TEXT,
      resolved_maps_url TEXT,
      research_notes    TEXT,
      profile           JSONB NOT NULL DEFAULT '{}'::jsonb,
      dossier           TEXT NOT NULL DEFAULT '',   -- markdown, not JSON
      sources           JSONB NOT NULL DEFAULT '[]'::jsonb,
      prompts           JSONB NOT NULL DEFAULT '{}'::jsonb,
      call_sound        JSONB,
      voice             TEXT,
      agent_name        TEXT,
      language          TEXT,          -- absent means English
      demo_minutes      INTEGER,
      stage             TEXT CHECK (stage IS NULL OR stage IN ('new','contacted','interested','won','lost')),
      status            TEXT NOT NULL,
      error             TEXT,
      last_contacted_at TIMESTAMPTZ,
      follow_up_at      TIMESTAMPTZ,
      researched_at     TIMESTAMPTZ,
      created_at        TIMESTAMPTZ NOT NULL,   -- the promo's own timestamps, not the import's
      updated_at        TIMESTAMPTZ NOT NULL,
      imported_at       TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_demo_customers_stage ON demo_customers (stage)`;

  await sql`
    CREATE TABLE IF NOT EXISTS demo_calls (
      id              TEXT PRIMARY KEY,
      customer_id     TEXT NOT NULL REFERENCES demo_customers(id) ON DELETE CASCADE,
      live_session_id TEXT,
      started_at      TIMESTAMPTZ NOT NULL,
      ended_at        TIMESTAMPTZ,
      status          TEXT NOT NULL CHECK (status IN ('started','completed','failed','abandoned')),
      duration_sec    INTEGER CHECK (duration_sec IS NULL OR duration_sec >= 0),
      turns           INTEGER CHECK (turns IS NULL OR turns >= 0),
      end_reason      TEXT,
      is_test         BOOLEAN NOT NULL DEFAULT false,
      visitor_id      TEXT,
      ip_hash         TEXT,
      user_agent      TEXT,
      transcript      JSONB NOT NULL DEFAULT '[]'::jsonb,
      review          JSONB,
      imported_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_demo_calls_customer_started ON demo_calls (customer_id, started_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_demo_calls_started ON demo_calls (started_at)`;

  // The source has no event id, so identity is the tuple below. `source` keeps the distinction the
  // promo's own readEvents makes between its legacy global list and the per-customer ones.
  await sql`
    CREATE TABLE IF NOT EXISTS demo_call_events (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      customer_id TEXT NOT NULL REFERENCES demo_customers(id) ON DELETE CASCADE,
      type        TEXT NOT NULL,
      at          TIMESTAMPTZ NOT NULL,
      visitor_id  TEXT,
      ip_hash     TEXT,
      source      TEXT NOT NULL CHECK (source IN ('legacy','customer')),
      imported_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  // What makes a re-import idempotent. COALESCE because NULL never equals NULL in an index either.
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_demo_call_events_identity
      ON demo_call_events (customer_id, type, at, COALESCE(visitor_id, ''), COALESCE(ip_hash, ''))
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_demo_call_events_customer_at ON demo_call_events (customer_id, at)`;

  // Empty in the 2026-09-22 export — no note was ever written. It exists because the CRM tab writes
  // notes, and the schema should not need changing the day it does.
  await sql`
    CREATE TABLE IF NOT EXISTS demo_notes (
      id          TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL REFERENCES demo_customers(id) ON DELETE CASCADE,
      at          TIMESTAMPTZ NOT NULL,
      text        TEXT NOT NULL,
      imported_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_demo_notes_customer_at ON demo_notes (customer_id, at DESC)`;
```

- [x] **Step 2: Add the probe lines**

In `migrateIfNeeded()`, after `await sql\`SELECT 1 FROM api_keys LIMIT 1\`;`, add:

```ts
    await sql`SELECT 1 FROM demo_customers LIMIT 1`;
    await sql`SELECT 1 FROM demo_calls LIMIT 1`;
    await sql`SELECT 1 FROM demo_call_events LIMIT 1`;
    await sql`SELECT 1 FROM demo_notes LIMIT 1`;
```

Without these a database created before this change never gets the new tables: the probe would
succeed on the old ones and `initDb()` would never run.

- [x] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: silent.

---

### Task 6: The writer

**Files:**
- Create: `src/db/demoImport.ts`

- [x] **Step 1: Write it**

There is no separate unit test for this file: what it claims is about SQL, and Task 8 runs it against
a real Postgres. Do not add a mocked-`sql` test that would only restate the source.

```ts
import type { ParsedDump } from "../demo/dump.js";
import { sql } from "./client.js";

/** How many rows each entity newly inserted. A re-import of the same file reports all zeros. */
export interface ImportCounts {
  customers: number;
  calls: number;
  events: number;
  notes: number;
}

// JSONB columns are passed as text with an explicit ::jsonb cast rather than as objects: an untyped
// parameter resolves to text, and the cast is what makes the intent unambiguous — the same reason
// the counter's upsert casts its parameters.
const json = (value: unknown) => JSON.stringify(value ?? null);

/**
 * Load one parsed dump. Everything goes in ONE transaction: a half-finished import is worse than
 * none, because the Demo numbers would be quietly short and nothing would say so.
 *
 * Every write is an upsert, so a re-run is safe — the export is final, but an import that fails
 * halfway must be runnable again without cleaning up first.
 */
export async function importDump(parsed: ParsedDump): Promise<ImportCounts> {
  return sql.begin(async (tx) => {
    let customers = 0;
    for (const c of parsed.customers) {
      const rows = await tx`
        INSERT INTO demo_customers (
          id, active, business_name, label, contact_name, contact_email, operator_notes,
          website_url, maps_url, resolved_maps_url, research_notes, profile, dossier, sources,
          prompts, call_sound, voice, agent_name, language, demo_minutes, stage, status, error,
          last_contacted_at, follow_up_at, researched_at, created_at, updated_at
        ) VALUES (
          ${c.id}, ${c.active}, ${c.businessName}, ${c.label}, ${c.contactName}, ${c.contactEmail},
          ${c.operatorNotes}, ${c.websiteUrl}, ${c.mapsUrl}, ${c.resolvedMapsUrl}, ${c.researchNotes},
          ${json(c.profile)}::jsonb, ${c.dossier}, ${json(c.sources)}::jsonb, ${json(c.prompts)}::jsonb,
          ${c.callSound === null ? null : json(c.callSound)}::jsonb, ${c.voice}, ${c.agentName},
          ${c.language}, ${c.demoMinutes}, ${c.stage}, ${c.status}, ${c.error},
          ${c.lastContactedAt}, ${c.followUpAt}, ${c.researchedAt}, ${c.createdAt}, ${c.updatedAt}
        )
        ON CONFLICT (id) DO UPDATE SET
          active = EXCLUDED.active, business_name = EXCLUDED.business_name, label = EXCLUDED.label,
          contact_name = EXCLUDED.contact_name, contact_email = EXCLUDED.contact_email,
          operator_notes = EXCLUDED.operator_notes, website_url = EXCLUDED.website_url,
          maps_url = EXCLUDED.maps_url, resolved_maps_url = EXCLUDED.resolved_maps_url,
          research_notes = EXCLUDED.research_notes, profile = EXCLUDED.profile,
          dossier = EXCLUDED.dossier, sources = EXCLUDED.sources, prompts = EXCLUDED.prompts,
          call_sound = EXCLUDED.call_sound, voice = EXCLUDED.voice, agent_name = EXCLUDED.agent_name,
          language = EXCLUDED.language, demo_minutes = EXCLUDED.demo_minutes, stage = EXCLUDED.stage,
          status = EXCLUDED.status, error = EXCLUDED.error,
          last_contacted_at = EXCLUDED.last_contacted_at, follow_up_at = EXCLUDED.follow_up_at,
          researched_at = EXCLUDED.researched_at, created_at = EXCLUDED.created_at,
          updated_at = EXCLUDED.updated_at
        RETURNING (xmax = 0) AS inserted
      `;
      // xmax = 0 on a row the INSERT created; non-zero when ON CONFLICT updated an existing one.
      if ((rows[0] as { inserted: boolean } | undefined)?.inserted) customers += 1;
    }

    let calls = 0;
    for (const c of parsed.calls) {
      const rows = await tx`
        INSERT INTO demo_calls (
          id, customer_id, live_session_id, started_at, ended_at, status, duration_sec, turns,
          end_reason, is_test, visitor_id, ip_hash, user_agent, transcript, review
        ) VALUES (
          ${c.id}, ${c.customerId}, ${c.liveSessionId}, ${c.startedAt}, ${c.endedAt}, ${c.status},
          ${c.durationSec}, ${c.turns}, ${c.endReason}, ${c.isTest}, ${c.visitorId}, ${c.ipHash},
          ${c.userAgent}, ${json(c.transcript)}::jsonb,
          ${c.review === null ? null : json(c.review)}::jsonb
        )
        ON CONFLICT (id) DO UPDATE SET
          customer_id = EXCLUDED.customer_id, live_session_id = EXCLUDED.live_session_id,
          started_at = EXCLUDED.started_at, ended_at = EXCLUDED.ended_at, status = EXCLUDED.status,
          duration_sec = EXCLUDED.duration_sec, turns = EXCLUDED.turns,
          end_reason = EXCLUDED.end_reason, is_test = EXCLUDED.is_test,
          visitor_id = EXCLUDED.visitor_id, ip_hash = EXCLUDED.ip_hash,
          user_agent = EXCLUDED.user_agent, transcript = EXCLUDED.transcript, review = EXCLUDED.review
        RETURNING (xmax = 0) AS inserted
      `;
      if ((rows[0] as { inserted: boolean } | undefined)?.inserted) calls += 1;
    }

    // No target on the conflict: the identity is an expression index, and DO NOTHING against any
    // unique violation is exactly the intent — an event already loaded is simply already loaded.
    let events = 0;
    for (const e of parsed.events) {
      const rows = await tx`
        INSERT INTO demo_call_events (customer_id, type, at, visitor_id, ip_hash, source)
        VALUES (${e.customerId}, ${e.type}, ${e.at}, ${e.visitorId}, ${e.ipHash}, ${e.source})
        ON CONFLICT DO NOTHING
        RETURNING id
      `;
      if (rows.length > 0) events += 1;
    }

    let notes = 0;
    for (const n of parsed.notes) {
      const rows = await tx`
        INSERT INTO demo_notes (id, customer_id, at, text)
        VALUES (${n.id}, ${n.customerId}, ${n.at}, ${n.text})
        ON CONFLICT (id) DO UPDATE SET
          customer_id = EXCLUDED.customer_id, at = EXCLUDED.at, text = EXCLUDED.text
        RETURNING (xmax = 0) AS inserted
      `;
      if ((rows[0] as { inserted: boolean } | undefined)?.inserted) notes += 1;
    }

    return { customers, calls, events, notes };
  });
}
```

- [x] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: silent.

---

### Task 7: The CLI

**Files:**
- Create: `src/db/importDemo.ts`
- Modify: `package.json`

- [x] **Step 1: Write the script**

> **Corrected after Task 7's review.** The first draft of this file imported `./client.js` and
> `./demoImport.js` statically. ESM hoists those, and both reach `config/env.ts`, which throws at
> module scope when `DATABASE_URL` is unset — so on a checkout with no `.env`, `bun run demo:import`
> answered with a Postgres configuration stack trace instead of its usage line, and the "no database
> contacted" property could not be checked. Both are now dynamic imports placed after the guards.

```ts
import { parseDump } from "../demo/dump.js";

// Load the promo's Redis export into the demo_* tables:
//   bun run demo:import path/to/redis-full-dump-2026-09-22.json
// Idempotent: every write is an upsert, so a run that failed halfway can simply be run again.

const path = process.argv[2];
if (!path) {
  console.error("usage: bun run demo:import <path-to-redis-full-dump.json>");
  process.exit(2);
}

const file = Bun.file(path);
if (!(await file.exists())) {
  console.error(`❌ no such file: ${path}`);
  process.exit(2);
}

let parsed;
try {
  parsed = parseDump(await file.json());
} catch (error) {
  // A wrong file must fail loudly. Importing zero rows and reporting success is the failure mode
  // this check exists to prevent.
  console.error(`❌ ${(error as Error).message}`);
  process.exit(1);
}

console.log(
  `read ${path}: ${parsed.customers.length} customers, ${parsed.calls.length} calls, ` +
    `${parsed.events.length} events, ${parsed.notes.length} notes`,
);

// Everything above this line is cheap and offline. Only now do we need a database.
const { initDb, sql } = await import("./client.js");
const { importDump } = await import("./demoImport.js");

await initDb(); // idempotent; makes the tables exist before the first write
const counts = await importDump(parsed);

console.log("inserted:");
console.log(`  customers ${counts.customers} of ${parsed.customers.length}`);
console.log(`  calls     ${counts.calls} of ${parsed.calls.length}`);
console.log(`  events    ${counts.events} of ${parsed.events.length}`);
console.log(`  notes     ${counts.notes} of ${parsed.notes.length}`);
console.log("(a row already present was updated in place, not counted as inserted)");
await sql.end();
```

- [x] **Step 2: Add the npm script**

In `package.json`, in `"scripts"`, after the `db:clear` line:

```json
    "demo:import": "bun run src/db/importDemo.ts",
```

- [x] **Step 3: Check the usage message**

Run: `bun run demo:import`
Expected: prints the usage line and exits 2 (no database contacted).

- [x] **Step 4: Check a wrong file is refused**

Run: `bun run demo:import package.json`
Expected: `❌ not a Redis export: expected an object with a `data` object`, exit 1.

---

### Task 8: The whole thing against a real Postgres

**Files:**
- Create: `src/db/demoImport.pg.test.ts`

`@electric-sql/pglite` is already a devDependency — Postgres 16 compiled to WASM, no service to
start. This is the only test that proves the DDL is valid, the casts work and the upserts do what
they claim.

- [x] **Step 1: Write the test**

> **Known trap, found in Task 4.** This repo's tsconfig is `strict`, and TypeScript infers `DUMP` as
> an object literal with fixed keys. **Adding** a key to a clone (`clone.data["calls:zzz:c2"] = …`)
> is a `TS7053` error; Task 4 fixed it with
> `const clone = structuredClone(DUMP) as typeof DUMP & { data: Record<string, any> };`.
> The two mutations below only change *existing* keys, which should typecheck as written — but if
> `bun run typecheck` complains, apply that same widening rather than restructuring the fixture.

```ts
import { describe, expect, it, mock } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

process.env.DATABASE_URL ??= "postgres://unused/unused";
process.env.AUTH_SECRET ??= "test-secret-test-secret-test-secret-0123";

const db = await PGlite.create();

// A postgres.js-shaped tagged template over PGlite: it builds $1..$n and splices a nested fragment
// (sql`TRUE`) as text with its values merged, which is what postgres.js itself does.
const FRAGMENT = Symbol("fragment");

function build(strings: TemplateStringsArray, values: unknown[], counter: { n: number }) {
  let text = "";
  const out: unknown[] = [];
  strings.forEach((part, i) => {
    text += part;
    if (i >= values.length) return;
    const value = values[i] as any;
    if (value && value[FRAGMENT]) {
      const inner = build(value.strings, value.values, counter);
      text += inner.text;
      out.push(...inner.values);
    } else {
      counter.n += 1;
      text += "$" + counter.n;
      out.push(value instanceof Date ? value.toISOString() : value);
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
for (const [, statement] of body.matchAll(/sql`([\s\S]*?)`/g)) {
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
  Number((await db.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n);

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
```

- [x] **Step 2: Run it**

Run: `bun test src/db/demoImport.pg.test.ts`
Expected: PASS, 7 tests. If the DDL extraction throws, the message names the failing statement.

- [x] **Step 3: Prove two of these are not vacuous**

Temporarily break each, confirm the named test fails, then put it back:

1. In `src/db/client.ts`, drop `ON CONFLICT` handling by changing the events insert's index name so
   the unique index is never created (`idx_demo_call_events_identity` → `idx_demo_call_events_x`)
   **and** remove `UNIQUE` from it. Expected: "is idempotent" fails with 4 events.
2. In `src/db/demoImport.ts`, change the customer upsert's `RETURNING (xmax = 0) AS inserted` to
   `RETURNING true AS inserted`. Expected: "is idempotent" fails with `customers: 2`.

Record the observed failure messages in the final report. Restore both before moving on and re-run
the test to confirm 7 pass.

---

### Task 9: Run it on the real export

**Files:** none (runs only)

- [x] **Step 1: Import the real file into a scratch database**

The export is at `C:\Users\Michael Knutsen\Downloads\redis-transcripts-2026-09-22.zip`; the file
inside is `redis-full-dump-2026-09-22.json`. Do **not** run this against the production
`DATABASE_URL` — that is the user's call, in Task 10's report.

Extract it to the scratchpad and check the parse alone, which needs no database:

```bash
bun -e '
import { parseDump } from "./src/demo/dump.ts";
// argv.at(-1) is the path: under `bun -e` the script itself is not argv[1].
const parsed = parseDump(await Bun.file(process.argv.at(-1)).json());
console.log("customers", parsed.customers.length, "calls", parsed.calls.length,
            "events", parsed.events.length, "notes", parsed.notes.length);
console.log("legacy events", parsed.events.filter(e => e.source === "legacy").length);
console.log("test calls", parsed.calls.filter(c => c.isTest).length);
' <path-to-extracted>/redis-full-dump-2026-09-22.json
```

Expected, from the design doc's verified figures:

```
customers 10 calls 21 events 51 notes 0
legacy events 5
test calls 15
```

If any number differs, stop and report it — the mapping is dropping or inventing records.

- [x] **Step 2: Import it into PGlite end to end**

Write a throwaway script in the scratchpad that reuses `src/db/demoImport.pg.test.ts`'s shim to
create the schema and call `importDump` on the real parsed dump, then assert the same four counts
and that a second run inserts nothing. Report the counts. Delete the script afterwards.

---

### Task 10: Final verification and report

**Files:** none (runs only)

- [x] **Step 1: Run everything**

```bash
bun test
bun run typecheck
```

Expected: every test passes (the new `map`, `dump` and `demoImport.pg` suites among them, on top of
the 125 already there); typecheck silent.

- [x] **Step 2: Report**

Give the user:

1. The test and typecheck results, and the real-export counts from Task 9.
2. The failure messages from Task 8 Step 3, so the idempotency claim is evidenced rather than asserted.
3. The list of files to review and commit.
4. The deployment note: the tables are created on the next cold start by the existing `ensureDbReady`
   probe, or eagerly with `bun run db:migrate`; then
   `bun run demo:import <path>/redis-full-dump-2026-09-22.json` against the production
   `DATABASE_URL` loads the data. Nothing reads these tables yet, so the import is safe to run at
   any time and safe to re-run.
5. A reminder of what this step deliberately did **not** do: the Demo tabs still read the promo
   through the `/promo-api` proxy. Read routes over these tables are the next step, and that is
   where `lib/analytics.ts` has to be reproduced.

**Stage done.**

---

## Outcome (2026-09-22)

**Done.** `bun test` → 150 pass / 0 fail across 9 files (143 before, +7 from `demoImport.pg.test.ts`);
`bun run typecheck` clean. Each task was implemented by a fresh subagent and reviewed before the next
was dispatched.

**The real export, imported end to end into Postgres** (PGlite, throwaway test, since deleted):
10 customers / 21 calls / 51 events / 0 notes, exactly the design doc's figures; a second run
inserted nothing; 15 test calls, 15 reviews, 461 transcript turns and 5 legacy events all readable
back through JSONB operators; no orphaned call or event; the Korean-language record round-tripped
with its 14 533-character dossier and 8 sources intact.

**The idempotency test is not vacuous**, proven by mutation:
- identity index made non-unique → `is idempotent` fails with `events: 2` instead of `0`, and the
  cascade test then finds 3 rows where 1 is expected;
- `RETURNING (xmax = 0)` → `RETURNING true` → `is idempotent` fails with `customers: 2`.
Both files were restored and checksum-verified.

**Two defects in this plan were found and corrected during execution**, both by the implementing
subagent refusing to paper over a failure:
1. *Task 4* — the test fixture did not typecheck under `strict`: adding a key to a cloned object
   literal is `TS7053`. Fixed with a widening cast.
2. *Task 7* — `importDemo.ts` imported `./client.js` statically. ESM hoists that, and it reaches
   `config/env.ts`, which throws when `DATABASE_URL` is unset, so the CLI answered a missing
   argument with a Postgres configuration stack trace instead of its usage line. Both imports are
   now dynamic and sit after the guards; the code above has been corrected.

Task 8's `noUncheckedIndexedAccess` fixes (a destructuring default and one `rows as any[]`) were
typecheck-only and changed no behaviour.
