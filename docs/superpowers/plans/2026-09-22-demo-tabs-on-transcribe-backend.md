# Demo tabs on transcribe-backend — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve the dashboard's Demo tabs from transcribe-db instead of the promo — the four reads and the CRUD writes — and remove the two actions that cannot move.

**Architecture:** The promo's `lib/analytics.ts` is pure, so it is **copied verbatim** into the backend. Database rows are turned back into the promo's domain objects by the inverse of the importer's mappers, so each route handler reads like the promo's original and the numbers match by construction.

**Tech Stack:** Bun, Elysia, postgres.js, `bun test` + PGlite; React/Vite on the dashboard; Python/Playwright for the regression harness.

**Source of truth:** `docs/superpowers/specs/2026-09-22-demo-tabs-on-transcribe-backend-design.md`.

**Promo repo (read-only reference):** `C:\Users\Michael Knutsen\Documents\projects\test_demo\voiceagent_promo`.

**No commits.** The user handles all git operations.

---

## File structure

**transcribe-backend**

| File | Responsibility |
| --- | --- |
| `src/demo/types.ts` (new) | The subset of the promo's `lib/types.ts` the analytics and routes need. |
| `src/demo/analytics.ts` (new) | **Verbatim** copy of the promo's `lib/analytics.ts`. |
| `src/demo/analytics.parity.test.ts` (new) | Diffs the copy against the promo's file so it cannot drift. |
| `src/demo/rows.ts` (new) | Row → domain object; the inverse of `map.ts`. |
| `src/demo/rows.test.ts` (new) | Round-trip tests over the real export. |
| `src/db/demoRead.ts` (new) | Loaders, ordered as the promo's were. |
| `src/db/demoWrite.ts` (new) | patch / create / delete / addNote / patchCall. |
| `src/routes/demo.ts` (new) | The eight handlers, admin-guarded. |
| `src/routes/demo.pg.test.ts` (new) | Every endpoint against PGlite. |
| `src/app.ts` (modify) | `.use(demo)`. |

**tecace-voice-agent-dashboard**

| File | Responsibility |
| --- | --- |
| `src/demos/api.ts` (rewrite) | `demoFetch` → `BACKEND_URL/demo/*` with the dashboard's bearer token. |
| `src/demos/DemosGate.tsx` (rewrite) | The `.tw` boundary and an error card. No unlock. |
| `src/demos/PromoAuth.tsx`, `src/demos/UnlockCard.tsx` | **Deleted.** |
| `src/demos/screens/*`, `components/admin/*`, `hooks/useLiveCall.ts` | `promoFetch` → `demoFetch`; the two dead actions removed. |
| `src/App.tsx`, `vite.config.ts` | Drop the promo gate wiring and the `/promo-api` proxy. |
| `scripts/regression/*` | The fake promo folds into `fake_backend.py`; `demos_e2e.py` reworked. |

---

### Task 1: The promo's types and analytics, copied

**Files:** create `src/demo/types.ts`, `src/demo/analytics.ts`, `src/demo/analytics.parity.test.ts`

- [x] **Step 1: Copy the two files**

From the promo repo, copy `lib/analytics.ts` to `src/demo/analytics.ts` **byte for byte**, changing
only its import line: `from "./types"` → `from "./types.js"`. Change nothing else — not formatting,
not a comment, not an `import type` ordering.

Then create `src/demo/types.ts` holding exactly the declarations `analytics.ts` imports, copied from
the promo's `lib/types.ts`: `CUSTOMER_STAGES`, `CustomerStage`, `CustomerStatus`, `Customer`,
`BusinessProfile`, `CustomerPrompts`, `CallSound`, `ResearchSource`, `CrmNote`, `TranscriptEntry`,
`TranscriptSpeaker`, `CallStatus`, `CallSentiment`, `CallReview`, `CallLog`, `TrackEvent`,
`CustomerStats`, and anything those reference transitively. Copy each declaration verbatim.

- [x] **Step 2: Make it compile**

Run `bun run typecheck`. Fix **only** what genuinely does not compile — most likely
`noUncheckedIndexedAccess` on array indexing inside `analytics.ts`. For every such fix, add a line to
a new `src/demo/PORTING.md` naming the file, the line and why. Do not restructure anything.

- [x] **Step 3: Write the parity test**

```ts
import { describe, expect, it } from "bun:test";

// analytics.ts is a verbatim copy of the promo's lib/analytics.ts — that is what lets the Overview
// and CRM numbers match the promo by construction rather than by re-derivation. This test fails if
// either side is edited, so the copy cannot quietly drift into a reimplementation.
const PROMO = String.raw`C:\Users\Michael Knutsen\Documents\projects\test_demo\voiceagent_promo\lib\analytics.ts`;

describe("analytics.ts stays a verbatim copy", () => {
  it("differs from the promo's only by the documented lines", async () => {
    const promoFile = Bun.file(PROMO);
    if (!(await promoFile.exists())) return; // the promo repo is not on every machine
    const theirs = (await promoFile.text()).replace(/\r\n/g, "\n").split("\n");
    const ours = (await Bun.file("src/demo/analytics.ts").text()).replace(/\r\n/g, "\n").split("\n");
    expect(ours.length).toBe(theirs.length);
    const differing = ours
      .map((line, i) => (line === theirs[i] ? null : i + 1))
      .filter((n): n is number => n !== null);
    // Every difference must be listed in PORTING.md, by line number.
    const porting = await Bun.file("src/demo/PORTING.md").text();
    for (const line of differing) expect(porting).toContain(`analytics.ts:${line}`);
  });
});
```

- [x] **Step 4: Record the deviations and run it**

Write `src/demo/PORTING.md` listing every differing line as `analytics.ts:<n> — <why>` (the import
line at minimum). Run `bun test src/demo/analytics.parity.test.ts` — expected PASS. Then
`bun run typecheck` (silent) and `bun test` (the existing 153 still pass).

---

### Task 2: Rows back into domain objects

**Files:** create `src/demo/rows.ts`, `src/demo/rows.test.ts`

- [x] **Step 1: Write the failing round-trip test**

The property that matters: the importer's mapper and this one are inverses, over the **real** data.

```ts
import { describe, expect, it } from "bun:test";
import { toCallRow, toCustomerRow, toEventRow } from "./map.js";
import { fromCallRow, fromCustomerRow, fromEventRow } from "./rows.js";

const DUMP = process.env.DEMO_DUMP ?? "data/redis-full-dump-2026-09-22.json";

// Absent optionals are dropped by the promo's own writer too, so compare only the keys it sets.
const defined = (o: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

describe("row -> domain is the inverse of domain -> row", () => {
  it("round-trips every real customer, call and event", async () => {
    const file = Bun.file(DUMP);
    if (!(await file.exists())) return; // the export is git-ignored; skip where it is absent
    const data = (await file.json()).data as Record<string, { value: any }>;
    let customers = 0, calls = 0, events = 0;
    for (const [key, entry] of Object.entries(data)) {
      if (key.startsWith("customers:")) {
        expect(defined(fromCustomerRow(toCustomerRow(entry.value)))).toEqual(defined(entry.value));
        customers += 1;
      } else if (/^calls:[^:]+:[^:]+$/.test(key)) {
        expect(defined(fromCallRow(toCallRow(entry.value)))).toEqual(defined(entry.value));
        calls += 1;
      }
    }
    for (const [key, entry] of Object.entries(data)) {
      if (key !== "events" && !key.startsWith("events:")) continue;
      const source = key === "events" ? "legacy" : "customer";
      for (const raw of (entry.value as unknown[]).map((v) => (typeof v === "string" ? JSON.parse(v) : v))) {
        expect(defined(fromEventRow(toEventRow(raw, source)))).toEqual(defined(raw));
        events += 1;
      }
    }
    expect({ customers, calls, events }).toEqual({ customers: 10, calls: 21, events: 51 });
  });
});
```

- [x] **Step 2: Run it to watch it fail**

`bun test src/demo/rows.test.ts` → FAIL (no `./rows.js`).

- [x] **Step 3: Write `src/demo/rows.ts`**

Export `fromCustomerRow(row: DemoCustomerRow): Customer`, `fromCallRow(row: DemoCallRow): CallLog`,
`fromEventRow(row: DemoEventRow): TrackEvent`, each the mirror of `map.ts`:

- `Date` → `toISOString()`;
- `null` → **omit the key** (the promo's types use optional properties, and `analytics.ts` branches
  on `undefined`, e.g. `call.turns ?? call.transcript.length`) — do not emit `null`;
- `operator_notes` → `notes`; JSONB blobs pass straight through with the right type assertion.

Run the test until it passes. If a field cannot round-trip, fix `rows.ts`; only if the importer
genuinely loses information, say so in the report rather than weakening the test.

- [x] **Step 4: Full check**

`bun test` and `bun run typecheck`.

---

### Task 3: The loaders

**Files:** create `src/db/demoRead.ts`

- [x] **Step 1: Write it**

Mirror the promo's `lib/store.ts` / `lib/calls.ts` loaders, with their ordering:

```ts
listCustomers(): Promise<Customer[]>            // ORDER BY created_at DESC
getCustomer(id): Promise<Customer | null>
listAllCalls(): Promise<CallLog[]>              // ORDER BY started_at DESC
listCalls(customerId): Promise<CallLog[]>       // ORDER BY started_at DESC
readEvents(customerId?): Promise<TrackEvent[]>  // all, or one customer's
listNotes(customerId): Promise<CrmNote[]>       // newest first
```

Each selects the columns, maps through `rows.ts`, and returns domain objects. Select columns
explicitly — never `SELECT *` — so a later column cannot silently change a shape.

- [x] **Step 2: Typecheck**

`bun run typecheck` — silent. No test here; Task 7 exercises these against a real database.

---

### Task 4: The writers

**Files:** create `src/db/demoWrite.ts`

- [x] **Step 1: Read the promo's merge rules first**

Read `app/api/admin/customers/[id]/route.ts` (PATCH) and `app/api/admin/customers/route.ts` (POST)
in the promo repo. The merge contract is the thing to reproduce exactly: **strings are trimmed**,
**`""` clears a field**, **an absent key leaves the stored value alone**. The drawer and the
customers table both depend on that difference.

- [x] **Step 2: Write it**

```ts
patchCustomer(id, patch): Promise<Customer | null>   // merge rules above; bumps updated_at
createCustomer(input): Promise<Customer>             // new nanoid-style id, status "new"
deleteCustomer(id): Promise<boolean>                 // cascades to calls/events/notes
addNote(customerId, text): Promise<CrmNote>
patchCall(customerId, callId, patch): Promise<CallLog | null>  // isTest only in this step
```

`analyze: true` on the calls PATCH belongs to the retired research pipeline: accept the request and
return the call unchanged rather than 500ing, and note it in `src/demo/PORTING.md`.

For the new id, match the promo's shape — 12 characters of `[A-Za-z0-9_-]` — so ids stay uniform.

- [x] **Step 3: Typecheck**

`bun run typecheck` — silent.

---

### Task 5: The read routes

**Files:** create `src/routes/demo.ts`; modify `src/app.ts`

- [x] **Step 1: Read the promo's four handlers**

`app/api/admin/analytics/route.ts`, `customers/route.ts` (GET), `customers/[id]/route.ts` (GET), and
`crm/route.ts`. Reproduce each body as closely as the language allows — same variable names, same
comments where they still apply — replacing its `lib/store` / `lib/calls` calls with `demoRead.ts`.

- [x] **Step 2: Write the routes**

Mounted at `/demo`, every handler guarded by `authenticateAdmin(headers.authorization, false)` —
the pattern in `src/routes/apiKeys.ts`. A non-admin gets the same `UNAUTHORIZED` shape the rest of
this API uses. Endpoints:

```
GET /demo/analytics?days=7|30|90&includeTests=1
GET /demo/customers
GET /demo/customers/:id          -> { customer, stats, calls, events, notes }, 404 { error } if absent
GET /demo/crm                    -> { customers, feed }
```

Response bodies must match the promo's exactly — the screens are verbatim ports and parse them as
they are. Errors keep the promo's `{ error: string }` shape.

- [x] **Step 3: Register and typecheck**

Add `.use(demo)` to `src/app.ts` beside `.use(apiKeys)`. Run `bun run typecheck` and `bun test`.

---

### Task 6: The write routes

**Files:** modify `src/routes/demo.ts`

- [x] **Step 1: Add them**

```
POST   /demo/customers               -> 201 { customer }; 400 { error } on a blank businessName
PATCH  /demo/customers/:id           -> { customer }; 404 if absent
DELETE /demo/customers/:id           -> { ok: true }
GET    /demo/customers/:id/notes     -> { notes }
POST   /demo/customers/:id/notes     -> 201 { note }; 400 on blank text
PATCH  /demo/customers/:id/calls     -> { call }  (body { callId, isTest } | { callId, analyze })
```

Same admin guard, same status codes and error shape as the promo's. Check the promo's route files
for each one rather than inferring.

- [x] **Step 2: Typecheck and test**

`bun run typecheck`, `bun test`.

---

### Task 7: The routes against a real Postgres

**Files:** create `src/routes/demo.pg.test.ts`

- [x] **Step 1: Write it**

Reuse the PGlite shim from `src/db/demoImport.pg.test.ts` verbatim (the tagged-template shim, the
`mock.module("./client.js")`, the DDL extraction — adjust the relative paths). Seed by importing the
miniature `DUMP` fixture from that file's pattern, then drive the Elysia app as
`src/routes/usage.test.ts` does, mocking the auth guard so an admin and a non-admin can both be
exercised.

Cover: every endpoint's happy path and shape; a 404 for an unknown customer; **the PATCH merge rules
(trim, `""` clears, absent leaves alone)** as three separate assertions; that a non-admin is refused
on a read *and* on a write; that DELETE cascades; and that `analyze: true` is accepted without error.

Also cover **the stage default** added to `demoRead.ts` after Task 3's review: a `demo_customers`
row with a NULL `stage` must read back as `stage: "new"` from both `listCustomers` and
`getCustomer`. Two of the ten real customers have no stage, and the CRM board and the drawer's
stage select read the field directly, so this is load-bearing rather than cosmetic.

- [x] **Step 2: Prove two are not vacuous**

Break each, confirm the named test fails, restore, re-run:
1. Make PATCH treat `""` as "leave alone" → the "clears a field" assertion must fail.
2. Drop the admin guard from one read route → the non-admin test must fail.

Record both failure messages.

- [x] **Step 3: Full check**

`bun test`, `bun run typecheck`.

---

### Task 8: Point the dashboard at the backend

**Files:** rewrite `src/demos/api.ts`; delete `src/demos/PromoAuth.tsx`, `src/demos/UnlockCard.tsx`; modify `src/demos/DemosGate.tsx`, `src/App.tsx`

- [x] **Step 1: Rewrite `src/demos/api.ts`**

`demoFetch(path, init)` keeps **`promoFetch`'s exact signature** — a raw `Response`, so the ported
screens' own `readJson` goes on working untouched:

```ts
// The Demo screens came from the promo and still call `readJson(response)` themselves, so this
// returns the Response untouched, exactly as promoFetch did. What changed is where it goes: the
// demo data now lives in transcribe-db, behind the dashboard's own admin session, so there is no
// second sign-in and no proxy.
const BASE_URL: string = __BACKEND_URL__;

export async function demoFetch(path: string, init?: RequestInit): Promise<Response> {
  if (!path.startsWith("/")) throw new Error(`demoFetch takes a /path (got ${path})`);
  const headers = new Headers(init?.headers);
  headers.set("accept", "application/json");
  const token = getToken();
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (init?.body !== undefined) headers.set("content-type", "application/json");
  try {
    return await fetch(`${BASE_URL}/demo${path}`, { ...init, headers });
  } catch {
    throw new Error("Couldn't reach the server.");
  }
}
```

Delete `promoFetch`, `promoUrl`, `promoRequest`, `probePromo`, `unlockPromo`, `lockPromo`,
`setPromoLockedHandler`, `PromoError` and `PromoAccess` — every one exists only for the promo.

- [x] **Step 2: Update the call sites**

In `src/demos/`, replace `promoFetch("/api/admin/X"` with `demoFetch("/X"` everywhere — the
`/api/admin` prefix moves into `demoFetch`'s `/demo` base. Update the import lines. Nothing else in
those files changes. `bun run typecheck` (or `npx tsc --noEmit`) must be clean.

- [x] **Step 3: Simplify the gate**

`DemosGate` keeps the `.tw` wrapper, the flex column and the `Toaster`, and loses the auth states.
Keep a simple error card for an unreachable backend. Delete `PromoAuth.tsx` and `UnlockCard.tsx`,
and remove `PromoAuthProvider`, `lockPromo` and the `setPromoLockedHandler` wiring from `src/App.tsx`
(including from sign-out).

---

### Task 9: Remove what cannot move

**Files:** modify `src/demos/screens/ProspectScreen.tsx`, `src/demos/components/call/CallPanel.tsx` (and whatever renders it), delete `src/demos/hooks/useLiveCall.ts` if nothing else uses it; modify `vite.config.ts`, `src/demos/PORTING.md`

- [x] **Step 1: Hide the two actions**

Remove the **"Re-research"** button and its handler from `ProspectScreen`, and the **"Call now"**
panel from the prospect page. Remove the now-unreachable code they were the only caller of
(`useLiveCall`, `/api/session`, the call beacons) rather than leaving it dead. Keep the layout
otherwise identical — the surrounding grid should not collapse; check the screenshot after.

- [x] **Step 2: Drop the proxy**

Remove the `/promo-api` proxy and `PROMO_API_URL` from `vite.config.ts` and from `.env.example` /
README. Leave `VITE_PUBLIC_DEMO_BASE_URL` alone: the public demo page still lives on the promo.

- [x] **Step 3: Log it**

Add a dated section to `src/demos/PORTING.md`: the two removed actions, the `promoFetch` → `demoFetch`
rename, the deleted gate, and that the screens are otherwise still verbatim.

- [x] **Step 4: Check it builds**

`npx tsc --noEmit` and `npm run build`, both clean.

---

### Task 10: The regression harness

**Files:** modify `scripts/regression/fake_backend.py`, `scripts/regression/demos_e2e.py`, `scripts/regression/README.md`; delete `scripts/regression/fake_promo.py`

This is the largest task. The harness is built around a service that no longer exists.

- [x] **Step 1: Move the demo routes into the fake backend**

Port `fake_promo.py`'s handlers into `fake_backend.py` under `/demo/*`, keeping its fixtures (Harbor
Dental, Cedar Bakery) so the existing assertions still mean something. They now require the
dashboard's admin bearer token, not a cookie: a missing or non-admin token is a 401 in the backend's
own error shape. Delete `fake_promo.py`.

- [x] **Step 2: Rework `demos_e2e.py`**

Remove every check about the unlock card, the promo cookie, `PROMO_API_URL`, the proxy and
"promo down". Replace them with: a non-admin cannot reach a Demo view *or* the routes; an admin sees
data with no second sign-in; signing out ends access. Keep every check about the screens themselves —
the tables, charts, portals, the drawer's stale-read guard, the pipeline moves, the `@layer legacy`
scan. Delete the checks for the two removed actions.

- [x] **Step 3: Run the whole harness**

```bash
python scripts/regression/compare.py     # transcribe screens unchanged -> IDENTICAL
python scripts/regression/tw_probe.py    # 19 checks
python scripts/regression/demos_e2e.py   # reworked
```

All three must pass. Update `scripts/regression/README.md` to describe what the harness now covers.

---

### Task 11: Final verification

- [x] **Step 1: Everything**

```bash
cd transcribe-backend && bun test && bun run typecheck
cd ../tecace-voice-agent-dashboard && npx tsc --noEmit && npx vitest run && npm run build
python scripts/regression/compare.py && python scripts/regression/tw_probe.py && python scripts/regression/demos_e2e.py
```

- [x] **Step 2: Look at it**

Run the dashboard against the real backend and open all four Demo tabs. Confirm real data: 10
customers, and Harbor Dental's equivalents from the real export. Capture a screenshot of each tab.

- [x] **Step 3: Report** the results, the file list, and the deployment note: `BACKEND_URL` already
points at transcribe-backend, so no new environment variable is needed; the `/promo-api` rewrite
that was missing from `vercel.json` is no longer needed at all.

**Stage done.**
