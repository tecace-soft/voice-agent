# Demo tabs served from transcribe-backend — design

**Date:** 2026-09-22
**Projects:** `transcribe-backend/`, `tecace-voice-agent-dashboard/`
**Follows:** `2026-09-22-demo-data-tables-design.md` (the `demo_*` tables and the importer, now loaded
into production).

## Goal

Make the dashboard's Demo tabs read and write the data now in transcribe-db, instead of proxying to
the promo. The promo has stopped collecting and, in a deployed build, is unreachable anyway — there
is no `/promo-api` rewrite in `vercel.json` — so today every Demo tab shows "Demo service
unreachable".

**In scope** (decided with the user 2026-09-22): the four reads *and* the CRUD writes.
**Not possible, so removed from the UI:** "Re-research" (needs the promo's Claude research pipeline)
and "Call now" (needs the promo's OpenAI realtime session).

## What the tabs actually call

Taken from the ported screens, not from memory:

| Endpoint | Method | Used by | This step |
| --- | --- | --- | --- |
| `/api/admin/analytics?days&includeTests` | GET | Overview | ✅ |
| `/api/admin/customers` | GET | Customers | ✅ |
| `/api/admin/customers` | POST | New customer dialog | ✅ |
| `/api/admin/customers/:id` | GET | Detail, CRM drawer | ✅ |
| `/api/admin/customers/:id` | PATCH | Detail, drawer, table, pipeline | ✅ |
| `/api/admin/customers/:id` | DELETE | Customers table | ✅ |
| `/api/admin/customers/:id/notes` | GET/POST | CRM tab | ✅ |
| `/api/admin/customers/:id/calls` | PATCH | Activity tab (mark test) | ✅ |
| `/api/admin/customers/:id/research` | POST | "Re-research" | ❌ removed |
| `/api/session` + call beacons | POST | "Call now" | ❌ removed |

## Decisions

| Question | Decision |
| --- | --- |
| Where the routes live | **`src/routes/demo.ts`**, mounted at **`/demo`**, mirroring the promo's paths minus `/api/admin`. `promoFetch("/api/admin/customers")` becomes `demoFetch("/customers")` |
| How the numbers are computed | **Port `lib/analytics.ts` verbatim.** It is 528 lines and **pure** — it imports only types and `CUSTOMER_STAGES`, never the datastore. Copying it means the KPIs, day buckets, per-customer stats and activity feed match the promo *by construction* rather than by re-derivation |
| How rows become domain objects | **`fromCustomerRow` / `fromCallRow` / `fromEventRow`**, the inverse of the importer's mappers. The tables were designed to mirror `lib/types.ts`, so this is mechanical. Route handlers then read like the promo's, because they operate on the same objects |
| Ordering | Fixed by the promo's own loaders and reproduced in SQL: customers `created_at DESC`, calls `started_at DESC` (both `listCalls` and `listAllCalls`), notes newest first |
| Authentication | **The dashboard's own admin session.** The Demo group is already admin-only. The promo's unlock card is removed — it POSTs to a login that no longer exists, so keeping it would gate the tabs behind a sign-in that cannot succeed. One sign-in instead of two |
| `/promo-api` proxy | **Deleted** from `vite.config.ts`. Nothing proxies to the promo any more |
| The two impossible actions | **Hidden**, not disabled (user's choice). Logged in `PORTING.md` as a deliberate deviation |
| Write semantics | The promo's PATCH merge rules are the contract: trimmed strings, `""` clears a field, absent leaves it alone. Reproduced, with tests, because the drawer and the table depend on the difference |

## Architecture

```
tecace-voice-agent-dashboard
  src/demos/api.ts          demoFetch() -> BACKEND_URL/demo/*, dashboard bearer token
  src/demos/DemosGate.tsx   .tw boundary + error card only (no unlock)
  (deleted) PromoAuth.tsx, UnlockCard.tsx

transcribe-backend
  src/routes/demo.ts        the 8 handlers, admin-guarded, mirroring the promo's
  src/demo/analytics.ts     verbatim copy of the promo's lib/analytics.ts
  src/demo/types.ts         the subset of lib/types.ts those functions need
  src/demo/rows.ts          row -> domain object (inverse of map.ts)
  src/db/demoRead.ts        loaders, ordered as above
  src/db/demoWrite.ts       patch / create / delete / addNote / patchCall
```

The split matters: `analytics.ts` stays a verbatim copy so it can be re-diffed against the promo,
and everything database-shaped stays out of it.

## Response shapes

Unchanged from the promo, because the screens are verbatim ports and parse them as they are:

- `GET /demo/analytics` → `{ kpis, window, callsPerDay, topCustomers, recentCalls, realCallCount, testCallCount, includeTests }`
- `GET /demo/customers` → `{ customers: CustomerWithStats[] }`
- `GET /demo/customers/:id` → `{ customer, stats, calls, events, notes }`
- `GET /demo/crm` → `{ customers, feed }`
- Errors keep the promo's `{ error: string }` JSON shape and its status codes (400 on a bad body,
  404 on an unknown id), because `readJson` in the ported code branches on exactly that.

## Testing

- **Analytics parity:** the copy is byte-identical to the promo's file apart from the import line;
  a test asserts that by diffing, so a later edit cannot silently drift.
- **Row round-trip:** `toCustomerRow` → `fromCustomerRow` returns the original record for all 10 real
  customers, and the same for calls and events. This is the property the whole port rests on.
- **Routes against PGlite**, in the pattern `demoImport.pg.test.ts` established: every endpoint,
  the PATCH merge rules (trim, `""` clears, absent leaves alone), 404s, and that a non-admin is
  refused.
- **The regression harness needs real work.** `demos_e2e.py` (108 checks) and `fake_promo.py` are
  built around the promo proxy, the unlock card and the promo cookie. The fake promo becomes demo
  routes on `fake_backend.py`, and the unlock/lock checks are replaced by admin-session checks.
  This is the largest single piece of this change and is a task of its own, not an afterthought.

## Risks

- **The harness rewrite is bigger than the feature.** Budgeted explicitly above.
- **`analytics.ts` expects complete objects.** `fromCallRow` must reconstruct `transcript` and
  `review` exactly, or `turns ?? transcript.length` and the gap rollup quietly change. Covered by
  the round-trip test.
- **Two sign-ins become one.** Anyone used to the unlock card will find it gone; that is the point,
  but it is a visible behaviour change.

## Out of scope

- Re-research and the live test call, and therefore the promo's Claude/OpenAI configuration.
- The public demo page (`/c/<id>`), which stays on the promo — stage 5's decision is unchanged.
- Any change to the transcribe tabs.
