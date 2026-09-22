# Ranged usage totals implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `GET /usage/minutes?userId=<id>&from=<iso>&to=<iso>` answers how much call time a business used between two instants, alongside the monthly totals it already returns.

**Architecture:** A new append-only `agent_call_sessions` table gets one row per reported call — owner, seconds, start, arrival — written in the same transaction as the existing monthly counter, so the two can never disagree. `POST /usage/minutes` gains an optional `startedAt` and derives it from arrival time when absent. The read path stays byte-for-byte identical unless both `from` and `to` are given; with them, each business row gains `periodMinutes` / `periodCalls` and the response gains `from`, `to`, `settled`, `settleSeconds` and `coverageFrom`. Range parsing and the settle rule live in a pure module so they can be tested without a database.

**Tech Stack:** Bun + Elysia + postgres.js (Bun locally, Node runtime on Vercel), `bun test`.

**Spec:** `docs/superpowers/specs/2026-09-22-usage-minutes-range-design.md`. Read its Decisions table before starting — particularly that duplicate reports are deliberately **not** handled and there is no `callId`.

**Git:** do **not** commit. The user handles all git. Steps end at "files ready for review".

**Conventions:** paths relative to `transcribe-backend/` unless they start with `docs/`. Windows, Git Bash; quote paths containing spaces. Run `bun test` and `bun run typecheck` from `transcribe-backend/`. No database is needed for the tests (they mock `../db/client.js`), and none of these tasks require a live Postgres.

**House style to follow:** comments explain *why*, not what (read `src/db/callMinutes.ts` for the register). Errors are `status(400, { error: "snake_case", message: "A sentence." })`, as `BUSINESS_NOT_FOUND` in `src/routes/usage.ts` already is. SQL goes through the tagged template with bound values.

---

## File map

- Create `src/usage/range.ts` — pure: parse/validate a range, the settle rule, the derived start time. No imports from `db/`.
- Create `src/usage/range.test.ts` — its tests.
- Create `src/db/callSessions.ts` — the table's queries: insert one session, sum a range per owner, earliest session.
- Modify `src/db/client.ts` — `initDb` creates `agent_call_sessions`; `migrateIfNeeded` probes it.
- Modify `src/db/callMinutes.ts` — `addCallSeconds` also writes the session row, in one transaction.
- Modify `src/config/env.ts` — `settleSeconds` from `USAGE_SETTLE_SECONDS` (default 3600).
- Modify `src/routes/usage.ts` — accept `startedAt` on POST; `from`/`to` on GET; the two error codes.
- Create `src/routes/usage.test.ts` — route tests against mocked db modules.
- Modify `docs/usage-api.md` — the integrator-facing write-up.
- Modify `.env.example` — the new variable.

---

### Task 1: The pure range module

**Files:** Create `src/usage/range.ts`, `src/usage/range.test.ts`

- [x] **Step 1: Write the failing tests**

Create `src/usage/range.test.ts`:
```ts
import { describe, expect, it } from "bun:test";

// Pure range arithmetic for the ranged usage totals — no database, no clock of its own.
process.env.DATABASE_URL ??= "postgres://unused/unused";
process.env.AUTH_SECRET ??= "test-secret-test-secret-test-secret-0123";

const { MAX_RANGE_DAYS, isSettled, parseRange, startedAtFor } = await import("./range.js");

describe("parseRange", () => {
  it("is absent when neither bound is given", () => {
    expect(parseRange(undefined, undefined)).toEqual({ kind: "absent" });
  });

  it("accepts an offset or Z, and keeps the instant", () => {
    const utc = parseRange("2026-08-15T07:00:00Z", "2026-09-15T07:00:00Z");
    const offset = parseRange("2026-08-15T00:00:00-07:00", "2026-09-15T00:00:00-07:00");
    expect(utc.kind).toBe("range");
    expect(offset.kind).toBe("range");
    if (utc.kind !== "range" || offset.kind !== "range") return;
    expect(utc.from.toISOString()).toBe("2026-08-15T07:00:00.000Z");
    expect(offset.from.getTime()).toBe(utc.from.getTime());
  });

  it("refuses one bound without the other", () => {
    expect(parseRange("2026-08-15T07:00:00Z", undefined)).toEqual({ kind: "error", error: "invalid_range" });
    expect(parseRange(undefined, "2026-09-15T07:00:00Z")).toEqual({ kind: "error", error: "invalid_range" });
  });

  it("refuses a malformed timestamp", () => {
    expect(parseRange("last tuesday", "2026-09-15T07:00:00Z").kind).toBe("error");
    expect(parseRange("2026-13-45T00:00:00Z", "2026-09-15T07:00:00Z").kind).toBe("error");
    // A date with no time has no instant: two callers in two timezones would mean different things.
    expect(parseRange("2026-08-15", "2026-09-15").kind).toBe("error");
  });

  it("refuses a reversed or empty window", () => {
    expect(parseRange("2026-09-15T07:00:00Z", "2026-08-15T07:00:00Z")).toEqual({ kind: "error", error: "invalid_range" });
    expect(parseRange("2026-09-15T07:00:00Z", "2026-09-15T07:00:00Z")).toEqual({ kind: "error", error: "invalid_range" });
  });

  it("refuses a window longer than the maximum", () => {
    const from = "2026-01-01T00:00:00Z";
    const ok = new Date(Date.parse(from) + MAX_RANGE_DAYS * 86400_000).toISOString();
    const tooLong = new Date(Date.parse(from) + (MAX_RANGE_DAYS * 86400_000) + 1000).toISOString();
    expect(parseRange(from, ok).kind).toBe("range");
    expect(parseRange(from, tooLong)).toEqual({ kind: "error", error: "range_too_long" });
  });
});

describe("isSettled", () => {
  const to = new Date("2026-09-15T07:00:00Z");

  it("is unsettled until the window has passed", () => {
    expect(isSettled(to, new Date("2026-09-15T07:30:00Z"), 3600)).toBe(false);
  });

  it("is settled once it has", () => {
    expect(isSettled(to, new Date("2026-09-15T08:00:00Z"), 3600)).toBe(true);
    expect(isSettled(to, new Date("2026-09-15T09:00:00Z"), 3600)).toBe(true);
  });
});

describe("startedAtFor", () => {
  const reportedAt = new Date("2026-09-15T07:00:00Z");

  it("derives the start from the report when none is sent", () => {
    expect(startedAtFor(undefined, 90, reportedAt).toISOString()).toBe("2026-09-15T06:58:30.000Z");
  });

  it("uses a sensible reported start", () => {
    expect(startedAtFor("2026-09-15T06:55:00Z", 90, reportedAt).toISOString()).toBe("2026-09-15T06:55:00.000Z");
  });

  it("ignores a start that can't be right, rather than moving usage into another month", () => {
    // A clock ahead of ours, a clock far behind, and nonsense: all fall back to the derived value.
    const derived = "2026-09-15T06:58:30.000Z";
    expect(startedAtFor("2026-09-15T07:30:00Z", 90, reportedAt).toISOString()).toBe(derived);
    expect(startedAtFor("2026-09-13T07:00:00Z", 90, reportedAt).toISOString()).toBe(derived);
    expect(startedAtFor("whenever", 90, reportedAt).toISOString()).toBe(derived);
  });
});
```

- [x] **Step 2: Run them to see them fail**

Run: `bun test src/usage/range.test.ts`
Expected: FAIL — cannot resolve `./range.js`.

- [x] **Step 3: Implement**

Create `src/usage/range.ts`:
```ts
// The arithmetic behind a ranged usage total, kept away from the database so it can be read and
// tested on its own: what a valid range is, when a period's total stops changing, and which instant
// a reported call belongs to.

/** A year and a day: long enough for an annual report, short enough that a typo can't scan years. */
export const MAX_RANGE_DAYS = 366;

/** How far a reported start may lag its report before we disbelieve it (the ingest's own cap). */
const MAX_CALL_SECONDS = 86400;

export type ParsedRange =
  | { kind: "absent" }
  | { kind: "range"; from: Date; to: Date }
  | { kind: "error"; error: "invalid_range" | "range_too_long" };

// An instant, not a date: "2026-08-15" means different moments in different timezones, and a usage
// boundary that moves with the reader is a boundary nobody can reconcile.
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function instant(value: string): Date | null {
  if (!INSTANT.test(value)) return null;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at;
}

/**
 * `from` inclusive, `to` exclusive, so back-to-back periods neither overlap nor leave a gap.
 * Both or neither: one bound alone is a caller mistake, and guessing the other would quietly answer
 * a different question than the one asked.
 */
export function parseRange(from: string | undefined, to: string | undefined): ParsedRange {
  if (from === undefined && to === undefined) return { kind: "absent" };
  if (from === undefined || to === undefined) return { kind: "error", error: "invalid_range" };

  const start = instant(from.trim());
  const end = instant(to.trim());
  if (!start || !end) return { kind: "error", error: "invalid_range" };
  // Equal bounds are an empty window: a caller bug, not an answer of zero.
  if (start.getTime() >= end.getTime()) return { kind: "error", error: "invalid_range" };
  if (end.getTime() - start.getTime() > MAX_RANGE_DAYS * 86400_000) {
    return { kind: "error", error: "range_too_long" };
  }
  return { kind: "range", from: start, to: end };
}

/**
 * Whether a period's total can still rise. A call is only reported once it ends, so one that started
 * before `to` may still be running; after `settleSeconds` past `to` there is nothing left to arrive.
 */
export function isSettled(to: Date, now: Date, settleSeconds: number): boolean {
  return now.getTime() >= to.getTime() + settleSeconds * 1000;
}

/**
 * When a reported call started. The agent reports as the call ends, so arrival minus its length is
 * right to within the round-trip; an explicit `startedAt` is better and is used when it is credible.
 * A start in the future or absurdly far back means a wrong clock on the agent's host, and trusting it
 * would move a business's usage into the wrong period.
 */
export function startedAtFor(reported: string | undefined, seconds: number, reportedAt: Date): Date {
  const derived = new Date(reportedAt.getTime() - seconds * 1000);
  if (!reported) return derived;
  const at = instant(reported.trim());
  if (!at) return derived;
  const lag = reportedAt.getTime() - at.getTime();
  if (lag < 0 || lag > MAX_CALL_SECONDS * 1000) return derived;
  return at;
}
```

- [x] **Step 4: Run the tests to see them pass**

Run: `bun test src/usage/range.test.ts`
Expected: all pass.

- [x] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: no output.

- [x] **Step 6: Files ready for review** (no commit)

---

### Task 2: The table

**Files:** Modify `src/db/client.ts`

- [x] **Step 1: Create it in `initDb`**

In `src/db/client.ts`, directly after the `agent_call_minutes` block and before the `api_keys` block, add:
```ts
  // One row per reported agent session, so usage can be totalled over any range — the monthly
  // counter above can only answer "this month" and "last month". Written in the same transaction as
  // that counter (src/db/callMinutes.ts), so the two can never disagree about a call.
  //
  // owner_key matches the counter's: the account that owned the agent's number when the call was
  // reported, or 'unassigned'. Fixed at write time, so reassigning a number later doesn't rewrite
  // history. started_at is what every range is measured by; reported_at is when the agent told us,
  // and the two differ by the call's length (or by however late the report was).
  await sql`
    CREATE TABLE IF NOT EXISTS agent_call_sessions (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_key   TEXT NOT NULL,
      user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
      seconds     INTEGER NOT NULL CHECK (seconds >= 0 AND seconds <= 86400),
      started_at  TIMESTAMPTZ NOT NULL,
      reported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (owner_key = COALESCE(user_id::text, 'unassigned'))
    )
  `;
  // The range query is always "this owner, between two instants"; the second index is for
  // coverageFrom, a MIN over the whole table.
  await sql`CREATE INDEX IF NOT EXISTS idx_agent_call_sessions_owner_started ON agent_call_sessions (owner_key, started_at)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_agent_call_sessions_started ON agent_call_sessions (started_at)`;
```

- [x] **Step 2: Probe it in `migrateIfNeeded`**

In the same file, in `migrateIfNeeded`'s probe list, after `await sql\`SELECT 1 FROM agent_call_minutes LIMIT 1\`;` add:
```ts
    await sql`SELECT 1 FROM agent_call_sessions LIMIT 1`;
```
(without this, a database created against the older schema never gets the new table — the probe is what decides whether `initDb` runs).

- [x] **Step 3: Verify**

Run: `bun run typecheck && bun test`
Expected: no output from typecheck; all existing tests pass (they mock the client, so nothing here runs).

- [x] **Step 4: Files ready for review** (no commit)

---

### Task 3: Queries for the new table

**Files:** Create `src/db/callSessions.ts`

- [x] **Step 1: Write it**

Create `src/db/callSessions.ts`:
```ts
import { toMinutes } from "./callMinutes.js";
import { sql } from "./client.js";

// Reads over agent_call_sessions: what a business used between two instants, and how far back the
// table can answer at all. The write lives in callMinutes.ts, inside the counter's transaction.

/** Minutes and call count for one owner over a range. */
export interface PeriodTotals {
  /** One decimal, like the monthly figures — this API is read in minutes (see toMinutes). */
  periodMinutes: number;
  periodCalls: number;
}

/**
 * Per-owner totals for `from` (inclusive) to `to` (exclusive), by the call's start — a call counts
 * wholly in the period it started in, never split across two.
 *
 * Returned as a map keyed by owner_key so the caller can merge it into the rows it already has;
 * owners with no calls in the range are simply absent (the caller reads them as zero).
 */
export async function periodTotalsByOwner(
  from: Date,
  to: Date,
  ownerKey?: string,
): Promise<Map<string, PeriodTotals>> {
  const rows = (await sql`
    SELECT owner_key             AS "ownerKey",
           COALESCE(SUM(seconds), 0)::int AS "periodSeconds",
           COUNT(*)::int         AS "periodCalls"
    FROM agent_call_sessions
    WHERE started_at >= ${from} AND started_at < ${to}
      AND ${ownerKey === undefined ? sql`TRUE` : sql`owner_key = ${ownerKey}`}
    GROUP BY owner_key
  `) as unknown as { ownerKey: string; periodSeconds: number; periodCalls: number }[];

  // Summed in seconds and rounded once, so a period's minutes never drift with its number of calls.
  return new Map(rows.map((r) => [r.ownerKey, { periodMinutes: toMinutes(r.periodSeconds), periodCalls: r.periodCalls }]));
}

/**
 * The earliest session on record, or null when there are none. Ranged totals can only cover calls
 * recorded since this table shipped; returning this lets a caller tell "nothing happened" apart from
 * "we weren't counting yet" instead of reading a confident zero.
 */
export async function earliestSessionAt(): Promise<string | null> {
  const [row] = (await sql`
    SELECT MIN(started_at) AS "earliest" FROM agent_call_sessions
  `) as unknown as { earliest: Date | null }[];
  return row?.earliest ? new Date(row.earliest).toISOString() : null;
}
```

- [x] **Step 2: Verify**

Run: `bun run typecheck && bun test`
Expected: clean; existing tests pass.

- [x] **Step 3: Files ready for review** (no commit)

---

### Task 4: Write the session with the counter

**Files:** Modify `src/db/callMinutes.ts`

`addCallSeconds` currently runs one upsert against the module-level `sql`. It must now write two rows atomically. postgres.js gives a transaction-scoped tagged template through `sql.begin`, with the same call shape, so the existing statement moves inside unchanged apart from the handle it uses.

- [x] **Step 1: Take a `startedAt` and open a transaction**

In `src/db/callMinutes.ts`, change `addCallSeconds`'s signature and body so that:
1. it accepts a fourth parameter `startedAt: Date` (required — the route always computes one via `startedAtFor`);
2. the existing upsert runs inside `sql.begin(async (tx) => { … })` against `tx` instead of `sql` (the SQL text itself is unchanged, including the `WITH owner AS (…)` clause and the `RETURNING m.owner_key AS "ownerKey"`);
3. inside the same transaction, after the upsert, the session row is inserted:
```ts
    await tx`
      INSERT INTO agent_call_sessions (owner_key, user_id, seconds, started_at, reported_at)
      SELECT COALESCE(owner.user_id::text, ${UNASSIGNED}::text), owner.user_id,
             ${seconds}::int, ${startedAt}::timestamptz, ${now}::timestamptz
      FROM (
        SELECT (SELECT user_id FROM agent_numbers WHERE phone_e164 = ${phone}::text) AS user_id
      ) owner
    `;
```
4. the transaction returns the `ownerKey`, and the existing `listCallMinutes(ownerKey, now)` read stays **outside** the transaction, exactly as now.

Add a comment above the function saying why both writes are in one transaction: a session row without its counter increment (or the reverse) would make the ranged totals and the monthly totals disagree about a call, and nothing would ever reconcile them.

- [x] **Step 2: Verify**

Run: `bun test` — all pass; `src/db/callMinutes.test.ts` still does (it exercises the pure month
helpers, which are untouched).
Run: `bun run typecheck` — expect **exactly one** error, `src/routes/usage.ts … Expected 4 arguments,
but got 2`: the route is the only caller and Task 6 updates it. Any other error is yours to fix here.

- [x] **Step 3: Files ready for review** (no commit)

---

### Task 5: The settle window in config

**Files:** Modify `src/config/env.ts`, `.env.example`

- [x] **Step 1: Read and validate it**

In `src/config/env.ts`, next to the other numeric settings, add:
```ts
// How long after a period ends its usage total stops changing. A call is only reported once it ends,
// so one that started just before the boundary may still be running; an hour is far longer than any
// real agent call, and the API tells callers the number it used.
const settleSeconds = Number(process.env.USAGE_SETTLE_SECONDS ?? 3600);
if (!Number.isFinite(settleSeconds) || settleSeconds < 0) {
  throw new Error("USAGE_SETTLE_SECONDS must be a non-negative number of seconds.");
}
```
and add `settleSeconds,` to the exported `env` object.

- [x] **Step 2: Document it**

In `.env.example`, after the `BUSINESS_TIMEZONE` entry, add:
```bash
# How long after a period ends before its usage total is reported as settled (seconds). A call is
# only counted when it ends, so a call still running when the period closed arrives afterwards.
USAGE_SETTLE_SECONDS=3600
```

- [x] **Step 3: Verify**

Run: `bun run typecheck && bun test`
Expected: clean; all pass.

- [x] **Step 4: Files ready for review** (no commit)

---

### Task 6: The route

**Files:** Modify `src/routes/usage.ts`

- [x] **Step 1: Accept `startedAt` on the ingest**

In the `POST /usage/minutes` handler:
1. add to the body schema, after `agentNumber`:
```ts
        // When the call started, if the agent knows. Absent, the backend derives it from arrival —
        // the report is sent as the call ends, so that is right to within the round-trip.
        startedAt: t.Optional(t.String({ maxLength: 40 })),
```
2. in the handler, compute the instant and pass it through:
```ts
      const now = new Date();
      const startedAt = startedAtFor(body.startedAt, body.durationSeconds, now);
      return {
        timezone: env.timezone,
        minutes: await addCallSeconds(body.durationSeconds, body.agentNumber, now, startedAt),
      };
```
3. import `startedAtFor` from `../usage/range.js`.
The response shape is unchanged.

- [x] **Step 2: Accept the range on the read**

In the `GET /usage/minutes` handler:
1. widen the query schema:
```ts
    {
      query: t.Object({
        userId: t.Optional(t.String({ maxLength: 64 })),
        // Validated in the handler rather than by the schema, so a bad value is answered with this
        // API's own 400 shape instead of the framework's 422.
        from: t.Optional(t.String({ maxLength: 40 })),
        to: t.Optional(t.String({ maxLength: 40 })),
      }),
    },
```
2. at the top of the handler, before any authentication, parse the range and answer a bad one immediately:
```ts
      const range = parseRange(query.from, query.to);
      if (range.kind === "error") {
        return status(400, {
          error: range.error,
          message:
            range.error === "range_too_long"
              ? `A range may cover at most ${MAX_RANGE_DAYS} days.`
              : "Send from and to as ISO 8601 instants with an offset or Z, with from before to.",
        });
      }
```
3. Every existing `return { timezone: env.timezone, minutes: … }` becomes a call to one local helper that adds the range fields when there is a range. Add it above the route:
```ts
// The read has six answer sites (an API key for all businesses, the unassigned bucket, a named one,
// or one with no totals yet; a customer; an admin) and one
// answer shape. Without a range this is exactly what it has always returned; with one, each business
// gains its period totals and the response says how far the data goes back and whether it can still
// change.
async function respond(minutes: OwnerCallMinutes[], range: ParsedRange) {
  if (range.kind !== "range") return { timezone: env.timezone, minutes };
  const [totals, coverageFrom] = await Promise.all([
    periodTotalsByOwner(range.from, range.to),
    earliestSessionAt(),
  ]);
  const zero = { periodMinutes: 0, periodCalls: 0 };
  return {
    timezone: env.timezone,
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    settled: isSettled(range.to, new Date(), env.settleSeconds),
    settleSeconds: env.settleSeconds,
    coverageFrom,
    minutes: minutes.map((m) => ({
      ...m,
      ...(totals.get(m.userId ?? UNASSIGNED) ?? zero),
    })),
  };
}
```
4. Replace each of the handler's **six** returns of that shape with `return respond(<the same minutes array>, range);` — API key with no userId, with `unassigned`, with a named business found, with a named business that's a real customer but has no totals (`emptyMinutesFor`); then the customer path; then the admin path. (The POST's return is a different shape — one record, not an array — and stays as it is.) — the authorisation logic, the `business_not_found` path and `emptyMinutesFor` all stay exactly as they are.
5. Imports to add: `earliestSessionAt`, `periodTotalsByOwner` from `../db/callSessions.js`; `MAX_RANGE_DAYS`, `isSettled`, `parseRange`, `startedAtFor`, and the type `ParsedRange` from `../usage/range.js`; the type `OwnerCallMinutes` from `../db/callMinutes.js`.

- [x] **Step 3: Verify**

Run: `bun run typecheck && bun test`
Expected: clean; all pass.

- [x] **Step 4: Files ready for review** (no commit)

---

### Task 7: Route tests

**Files:** Create `src/routes/usage.test.ts`

Follow `src/auth/auth.test.ts`: mock the db modules with `mock.module` and call `app.handle(new Request(…))`, so `bun test` needs no Postgres.

- [x] **Step 1: Write the tests**

Create `src/routes/usage.test.ts`:
```ts
import { describe, expect, it, mock } from "bun:test";

// The ranged usage read, against in-memory stand-ins for the database modules. Run: bun test
process.env.AUTH_SECRET ??= "test-secret-test-secret-test-secret-0123";
process.env.DATABASE_URL ??= "postgres://unused/unused";
process.env.USAGE_SETTLE_SECONDS ??= "3600";

const JANE_ID = "11111111-1111-1111-1111-111111111111";

const minutesRow = {
  userId: JANE_ID,
  email: "jane@tecace.com",
  name: "Jane Kim",
  businessName: "Harbor Dental",
  currentMonth: "2026-09",
  currentSeconds: 600,
  currentMinutes: 10,
  previousMonth: "2026-08",
  previousSeconds: 120,
  previousMinutes: 2,
  updatedAt: "2026-09-15T18:00:00.000Z",
};

// What the range query would return for Jane; the unassigned bucket is deliberately absent, so the
// test also pins that a business with no calls in the range reads as zero rather than disappearing.
const totals = new Map([[JANE_ID, { periodMinutes: 90.4, periodCalls: 37 }]]);

await mock.module("../db/client.js", () => ({
  sql: Object.assign(() => [], { end: async () => {} }),
  initDb: async () => {},
  ensureDbReady: async () => {},
}));
await mock.module("../db/callMinutes.js", () => ({
  UNASSIGNED: "unassigned",
  addCallSeconds: async () => minutesRow,
  emptyMinutesFor: () => minutesRow,
  listCallMinutes: async () => [minutesRow],
}));
await mock.module("../db/callSessions.js", () => ({
  periodTotalsByOwner: async () => totals,
  earliestSessionAt: async () => "2026-09-01T00:00:00.000Z",
}));
await mock.module("../auth/apiKey.js", () => ({
  INVALID_API_KEY: { error: "invalid_api_key", message: "That API key is not valid." },
  looksLikeApiKey: (header?: string) => (header ?? "").startsWith("Bearer ak_"),
  authenticateApiKey: async (header?: string) => (header === "Bearer ak_good" ? { id: "key-1" } : null),
}));

const { usage } = await import("./usage.js");
const { Elysia } = await import("elysia");
const app = new Elysia().use(usage);

const get = (path: string) =>
  app.handle(new Request(`http://localhost${path}`, { headers: { authorization: "Bearer ak_good" } }));

describe("GET /usage/minutes without a range", () => {
  it("answers exactly as it always has", async () => {
    const body = await (await get("/usage/minutes")).json();
    expect(Object.keys(body).sort()).toEqual(["minutes", "timezone"]);
    expect(body.minutes[0].periodMinutes).toBeUndefined();
  });
});

describe("GET /usage/minutes with a range", () => {
  it("adds the period totals and the range fields", async () => {
    const res = await get("/usage/minutes?from=2026-08-15T07:00:00Z&to=2026-09-15T07:00:00Z");
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.from).toBe("2026-08-15T07:00:00.000Z");
    expect(body.to).toBe("2026-09-15T07:00:00.000Z");
    expect(body.settleSeconds).toBe(3600);
    expect(body.settled).toBe(true); // the window is long past
    expect(body.coverageFrom).toBe("2026-09-01T00:00:00.000Z");
    expect(body.minutes[0]).toMatchObject({ periodMinutes: 90.4, periodCalls: 37, currentSeconds: 600 });
  });

  it("reports a business with no calls in the range as zero, not as missing", async () => {
    await mock.module("../db/callSessions.js", () => ({
      periodTotalsByOwner: async () => new Map(),
      earliestSessionAt: async () => null,
    }));
    const body = await (await get("/usage/minutes?from=2026-08-15T07:00:00Z&to=2026-09-15T07:00:00Z")).json();
    expect(body.minutes[0]).toMatchObject({ periodMinutes: 0, periodCalls: 0 });
    expect(body.coverageFrom).toBeNull();
    await mock.module("../db/callSessions.js", () => ({
      periodTotalsByOwner: async () => totals,
      earliestSessionAt: async () => "2026-09-01T00:00:00.000Z",
    }));
  });

  it("is unsettled while a call started before `to` could still be running", async () => {
    const to = new Date(Date.now() - 60_000).toISOString();
    const from = new Date(Date.now() - 3_600_000).toISOString();
    const body = await (await get(`/usage/minutes?from=${from}&to=${to}`)).json();
    expect(body.settled).toBe(false);
  });
});

describe("GET /usage/minutes range errors", () => {
  const cases: [string, string][] = [
    ["a reversed window", "?from=2026-09-15T07:00:00Z&to=2026-08-15T07:00:00Z"],
    ["an empty window", "?from=2026-09-15T07:00:00Z&to=2026-09-15T07:00:00Z"],
    ["one bound alone", "?from=2026-09-15T07:00:00Z"],
    ["a malformed instant", "?from=2026-08-15&to=2026-09-15"],
  ];
  for (const [what, query] of cases) {
    it(`refuses ${what} with invalid_range`, async () => {
      const res = await get(`/usage/minutes${query}`);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("invalid_range");
    });
  }

  it("refuses a range over the maximum with range_too_long", async () => {
    const res = await get("/usage/minutes?from=2024-01-01T00:00:00Z&to=2026-01-01T00:00:00Z");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("range_too_long");
  });

  it("refuses a bad range before it checks the key, so the caller learns the real problem", async () => {
    const res = await app.handle(
      new Request("http://localhost/usage/minutes?from=nonsense&to=2026-09-15T07:00:00Z", {
        headers: { authorization: "Bearer ak_bad" },
      }),
    );
    expect(res.status).toBe(400);
  });
});
```

- [x] **Step 2: Run them**

Run: `bun test src/routes/usage.test.ts`
Expected: all pass. If the mocked module shapes don't match what `usage.ts` imports (for instance a name this plan didn't anticipate), fix the mock to match the real module — never the route to match the mock.

- [x] **Step 3: Whole suite and typecheck**

Run: `bun test && bun run typecheck`
Expected: every test passes; typecheck silent.

- [x] **Step 4: Files ready for review** (no commit)

---

### Task 8: The integrator's documentation

**Files:** Modify `docs/usage-api.md`

This is the file handed to other teams; it is written for someone outside this codebase, so match its
existing voice and completeness (read it first — 364 lines, worked `curl` examples with responses).

- [x] **Step 1: Write the additions**

1. **Endpoints at a glance:** add a row — `GET /usage/minutes?userId=<id>&from=<iso>&to=<iso>` → "That business's minutes, and its totals between two instants."
2. **A new section, "Usage between two dates"**, placed after the single-business section:
   - `from` inclusive, `to` exclusive, ISO 8601 instants with an offset or `Z` (a plain date is refused — it means different moments in different timezones). Back-to-back ranges neither overlap nor leave a gap.
   - A call counts wholly in the period its **start** falls in; it is never split.
   - `periodMinutes` (one decimal) and `periodCalls` per business; `from`, `to`, `settled`,
     `settleSeconds`, `coverageFrom` on the response. Say plainly that this is minutes, not the
     seconds originally asked for, and that summing several rounded periods can differ slightly from
     one range covering them — ask for the single range when it must be exact.
   - A worked `curl` example with a full response body, in the style of the existing ones.
3. **"When a total stops changing":** `settled` is false until `settleSeconds` (3600 by default) after `to`, because a call is only counted once it ends and one may still have been running when the period closed. Poll again after that for a number that won't move.
4. **"How far back the data goes":** `coverageFrom` is the first call on record. A range entirely before it reads as zero because nothing was recorded then, not because nothing happened; monthly totals cover earlier periods.
5. **Errors:** add `invalid_range` and `range_too_long` (max 366 days) to the error table in that section's style, each with the condition that triggers it.
6. **Keys:** in "Before you start", note that an integration with separate staging and production systems should ask for **two keys, one per environment** — they are separate secrets, revocable independently, and both read the same live data.

- [x] **Step 2: Check the examples are true**

Every field in the new example must match what the code returns (`respond()` in `src/routes/usage.ts`), including the millisecond-precision ISO strings. Read the handler again rather than trusting this plan's snippet.

- [x] **Step 3: Files ready for review** (no commit)

---

### Task 9: Final verification

**Files:** none (runs only)

- [x] **Step 1: Run everything**

```bash
bun test
bun run typecheck
```
Expected: all tests pass (the new `range` and `usage` suites among them); typecheck silent.

- [x] **Step 2: Report** the results, the list of files for the user to review and commit, and the deployment note: **`USAGE_SETTLE_SECONDS` is optional** (defaults to 3600), and the new table is created on the next cold start by the existing `ensureDbReady` probe — no manual migration step, though `bun run db:migrate` against the production `DATABASE_URL` does it eagerly if preferred. **Stage done.**

---

## Shipping notes (2026-09-22, after review)

**Done and verified:** `bun test` → 125 pass / 0 fail across 6 files; `bun run typecheck` clean.
Reviewed twice; approved.

**Verified against a real Postgres (added after the review).** The review closed with "no test has
executed any of this feature's SQL". That has since been done: the 37 DDL statements from `initDb`
and the real `addCallSeconds` / `listCallMinutes` / `periodTotalsByOwner` / `earliestSessionAt` were
run against PGlite (Postgres 16 in WASM), through a postgres.js-shaped shim that builds `$1..$n` and
splices nested `sql` fragments. 10 checks, all passing:

- the counter still totals 120 → 300 seconds (2 → 5 minutes) for the same business, with its name
  and email intact, and still rolls the month over carrying the old total into `previous`;
- the session `INSERT` executes — `NULLIF($2::text, $3::text)::uuid` really does yield a NULL
  `user_id` for the unassigned bucket and satisfy the table's CHECK;
- `from` inclusive / `to` exclusive holds on rows starting exactly on each bound, back-to-back ranges
  sum to the whole, the sum is owner-scoped, and `SUM(seconds)::bigint` comes back as a number;
- **the transaction is atomic**: with the sessions table renamed away, the counter does not move.

Both are mutation-checked — flipping the boundary to `>` / `<=` fails the boundary test, and the
rollback test only passes because the write genuinely failed.

That harness is **not in the suite**: it needs `@electric-sql/pglite` as a devDependency, which is a
call for the repo owner. It is kept at `scratchpad/pgcheck-harness.test.ts` and can be landed as a
real test (the import path at the top becomes a normal package import) if wanted.

**Still worth one smoke test on first deploy**, because PGlite is not the production engine and this
proves nothing about the deployed environment: `bun run db:migrate`, one `curl` POST with an
`x-agent-key`, one ranged GET spanning it. The failure mode it guards is specific — a failing
session insert rolls the counter increment back with it, and the agent's report is fire-and-forget,
so the minutes would be lost silently rather than logged.

**Test-hygiene items folded in after approval** (`src/routes/usage.test.ts`, behaviour unchanged):
the env stub uses a non-default `settleSeconds: 900` and spreads the real env rather than replacing
it, and the module-scope captures reset in `beforeEach` with each POST asserting it reached the
handler. Both mutation-checked: hard-coding `settleSeconds: 3600` in the route fails the range test,
and a POST that stops reaching the handler fails all three write tests.
