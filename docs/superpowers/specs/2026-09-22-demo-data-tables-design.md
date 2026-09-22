# Demo data tables in transcribe-backend — design

**Date:** 2026-09-22
**Project:** `transcribe-backend/`
**Source data:** `redis-transcripts-2026-09-22.zip` — the final export of the promo's Upstash Redis.

## Goal

Give the promo's demo data a permanent home in transcribe-db, so the Demo section can eventually be
served from our own backend instead of the promo's `/api/admin/*`.

**This step is the schema and the importer only.** No API routes, no front-end change: the Demo tabs
go on reading the promo through the `/promo-api` proxy exactly as they do today. Confirmed with the
user 2026-09-22, along with: the promo has stopped collecting, so this is the last export and
transcribe-db is the system of record from here.

## What is in the export (checked, not assumed)

49 Redis keys, ~400 KB of JSON.

| Redis key | Count | Becomes |
| --- | --- | --- |
| `customers` (set) | 10 ids | — (an index; the rows carry the same ids) |
| `customers:<id>` | 10 | `demo_customers` |
| `calls:<id>` (set) | 8 | — (an index) |
| `calls:<id>:<callId>` | 21 | `demo_calls` |
| `events` (legacy list) | 5 | `demo_call_events` |
| `events:<id>` | 46 | `demo_call_events` |
| `notes:<id>` | 0 | `demo_notes` (empty, but part of the contract) |

Verified about the data itself:

- Every id is 12 characters of `[A-Za-z0-9_-]` (nanoid). The `customers` set matches the
  `customers:*` keys exactly.
- Every call's `customerId` and every event's `customerId` exists. No duplicate call ids. So the
  foreign keys below can be real ones, not advisory.
- Every call is `status: "completed"` and has `endedAt`, `durationSec` and `turns`. **15 of 21 are
  `isTest: true`** — the dashboards' "include my test calls" switch matters on this data.
- 15 calls carry a structured `review` (`tested`, `worked`, `struggled`, `gaps`, `sentiment`, `at`,
  `model`). Transcript entries are always `{id, speaker, text, startMs, endMs}`, speaker one of
  `caller` / `receptionist`.
- The CRM dimension is effectively empty: every `stage` is `new` or absent, and there are no notes,
  no `followUpAt` and no `lastContactedAt`.
- **The two event lists do not overlap.** The legacy `events` list holds 5 events, all from
  2026-09-20 and all carrying `ipHash` and no `visitorId`; the per-customer lists hold 46, all
  carrying `visitorId` and no `ipHash`. No pair shares a `(customerId, at)`, or even falls within
  two seconds. The promo's own `readEvents` (`lib/calls.ts:159`) concatenates the legacy list and
  the per-customer lists, so **all 51 are real and all 51 count** — importing both reproduces the
  numbers the promo showed.
- Fields the type allows that this data never uses: `contactName`, `contactEmail`, `notes`,
  `demoMinutes`, `lastContactedAt`, `followUpAt`, `error`. They are still columns — the schema
  follows `lib/types.ts`, not one snapshot, because the Demo tabs write them.

## Decisions

| Question | Decision |
| --- | --- |
| Table naming | Prefixed **`demo_`**. They share a database with the transcribe tables and are a different product; the prefix keeps that obvious in every query and backup |
| Primary keys | **The promo's own string ids.** They appear in demo links (`/c/<id>`), in the exported CSVs and in the transcripts. Renumbering them would break links for no gain |
| Deep records | **JSONB** for `profile`, `sources`, `prompts`, `call_sound`, `transcript`, `review`; columns for everything filtered, sorted or counted (`stage`, `status`, `started_at`, `is_test`, `duration_sec`, `customer_id`). The blobs are only ever read whole |
| `dossier` | **TEXT**, not JSONB — it is markdown |
| `Customer.notes` | Column **`operator_notes`**, so it is not confused with `demo_notes` (the CRM note list). Two different things in the promo, one of them badly named |
| Event identity | No natural id, so a **unique index** on `(customer_id, type, at, COALESCE(visitor_id,''), COALESCE(ip_hash,''))` makes re-import idempotent. Two genuine events identical to the millisecond, from one visitor, on one customer, would collapse — implausible, and cheaper than inventing a surrogate key the source never had |
| Event provenance | A **`source`** column (`legacy` / `customer`), since the two lists carry different fields and the legacy one is the older format. Keeps the distinction the promo's code makes |
| Re-runnable | **Yes**, though the export is final: every insert is an upsert on the primary key. A half-finished import must be safe to simply run again |
| Transaction | **One.** A partial import is worse than none — the tabs' numbers would be silently short |
| The `.md` file | **Not imported.** It is a human-readable rendering of the same transcripts already in the JSON |

## 1. Schema

Created by `initDb()` and probed by `migrateIfNeeded()`, the pattern the other tables use.

### `demo_customers`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `TEXT PK` | the promo's nanoid |
| `active` | `BOOLEAN NOT NULL DEFAULT true` | |
| `business_name` | `TEXT NOT NULL` | what research starts from |
| `label`, `contact_name`, `contact_email`, `operator_notes`, `website_url`, `maps_url`, `resolved_maps_url`, `research_notes` | `TEXT` | all nullable |
| `profile` | `JSONB NOT NULL DEFAULT '{}'` | name, category, address, phone, hours, services, highlights, policies, faqs, rating, lat, lng |
| `dossier` | `TEXT NOT NULL DEFAULT ''` | markdown |
| `sources` | `JSONB NOT NULL DEFAULT '[]'` | research citations |
| `prompts` | `JSONB NOT NULL DEFAULT '{}'` | live, backend, greeting, edited |
| `call_sound` | `JSONB` | |
| `voice`, `agent_name`, `language` | `TEXT` | `language` absent means English |
| `demo_minutes` | `INTEGER` | absent means the promo's default |
| `stage` | `TEXT` | `CHECK (stage IS NULL OR stage IN ('new','contacted','interested','won','lost'))` — `CUSTOMER_STAGES` |
| `status` | `TEXT NOT NULL` | `new` / `researching` / `ready` / `failed` |
| `error` | `TEXT` | why research failed |
| `last_contacted_at`, `follow_up_at`, `researched_at` | `TIMESTAMPTZ` | |
| `created_at`, `updated_at` | `TIMESTAMPTZ NOT NULL` | the promo's own, not the import's |
| `imported_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | when this row was loaded |

### `demo_calls`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `TEXT PK` | |
| `customer_id` | `TEXT NOT NULL REFERENCES demo_customers(id) ON DELETE CASCADE` | |
| `live_session_id` | `TEXT` | `"unknown"` in much of this data |
| `started_at` | `TIMESTAMPTZ NOT NULL` | |
| `ended_at` | `TIMESTAMPTZ` | |
| `status` | `TEXT NOT NULL` | `CHECK (status IN ('started','completed','failed','abandoned'))` |
| `duration_sec`, `turns` | `INTEGER` | `CHECK (duration_sec IS NULL OR duration_sec >= 0)` |
| `end_reason` | `TEXT` | |
| `is_test` | `BOOLEAN NOT NULL DEFAULT false` | 15 of 21 here |
| `visitor_id`, `ip_hash`, `user_agent` | `TEXT` | |
| `transcript` | `JSONB NOT NULL DEFAULT '[]'` | `{id, speaker, text, startMs, endMs}[]` |
| `review` | `JSONB` | null when the model was never asked |
| `imported_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

Indexes: `(customer_id, started_at DESC)` for a prospect's call list; `(started_at)` for the
analytics window.

### `demo_call_events`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `UUID PK DEFAULT gen_random_uuid()` | the source has no id |
| `customer_id` | `TEXT NOT NULL REFERENCES demo_customers(id) ON DELETE CASCADE` | |
| `type` | `TEXT NOT NULL` | only `page_view` exists so far; not constrained, the promo adds types freely |
| `at` | `TIMESTAMPTZ NOT NULL` | |
| `visitor_id`, `ip_hash` | `TEXT` | the two eras of the data; exactly one is set in practice |
| `source` | `TEXT NOT NULL` | `CHECK (source IN ('legacy','customer'))` |
| `imported_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

Unique index on `(customer_id, type, at, COALESCE(visitor_id,''), COALESCE(ip_hash,''))`.
Index on `(customer_id, at)`.

### `demo_notes`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `TEXT PK` | `CrmNote.id` |
| `customer_id` | `TEXT NOT NULL REFERENCES demo_customers(id) ON DELETE CASCADE` | |
| `at` | `TIMESTAMPTZ NOT NULL` | |
| `text` | `TEXT NOT NULL` | |
| `imported_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

Index on `(customer_id, at DESC)`. Empty from this export; it exists because the CRM tab writes
notes and the schema should not have to change when it does.

## 2. The importer

`bun run demo:import <path-to-redis-full-dump.json>` → `src/db/importDemo.ts`, in the style of the
existing `src/db/migrate.ts` and `src/auth/cli.ts` scripts.

1. Read and parse the dump; refuse anything without a `data` object (a wrong file must fail loudly,
   not import zero rows and report success).
2. Group the keys into customers, calls, events and notes; parse list entries, which are JSON
   strings in Redis lists.
3. **Check referential integrity before writing**: every call's and event's `customerId` must exist.
   Report what is missing and import nothing, rather than dropping rows quietly.
4. Upsert everything in **one transaction**, `ON CONFLICT (id) DO UPDATE` for the keyed tables and
   `ON CONFLICT DO NOTHING` against the events' unique index.
5. Print a table of counts — inserted, updated, skipped — per entity, and the customers and calls it
   saw, so the operator can compare against this document's numbers.

The mapping from a Redis record to a row is **pure and separately testable**: `src/demo/map.ts`
exports one function per entity, and the script does the I/O.

## 3. Testing

Following the `bun test` style already in this repo:

- **Pure mapping tests** against fixtures taken from the real export (a customer with every optional
  field absent; one with them present; a call with and without a review; a legacy event and a
  per-customer event): the ISO strings become Dates, absent optionals become null, JSONB blobs pass
  through unchanged, and `source` is set from which list the event came out of.
- **Integrity-check tests**: a call whose customer is missing aborts the import and names the id.
- **A real-Postgres pass.** The ranged-usage feature shipped with its SQL unexecuted, and it was
  worth running PGlite (Postgres 16 in WASM) against it afterwards to find out the DDL and the casts
  were right. The same check applies here and is more valuable, because this schema is bigger and
  the importer writes every table: create the schema, import the real export, and assert the row
  counts (10 / 21 / 51 / 0), the foreign keys and that a second run changes nothing. This needs
  `@electric-sql/pglite` as a **devDependency** — the one dependency this plan adds, and the
  decision is the repo owner's (see Open question).

## 4. Rollout

1. Ship the schema and the importer. The tables are created on the next cold start by the existing
   `ensureDbReady` probe, or eagerly with `bun run db:migrate`.
2. Run the import once against the production `DATABASE_URL` and check the counts.
3. Later, and separately: read routes over these tables, then repoint the Demo tabs off the
   `/promo-api` proxy. Nothing in this step depends on that, and that step is where the promo's
   analytics (`lib/analytics.ts`) has to be reproduced.

## Open question for the user

**May the importer's verification add `@electric-sql/pglite` as a devDependency?** Without it the
tests prove the mapping but not the SQL, and the first real execution of this schema would be the
production import. It adds one dev-only package (~30 MB, WASM Postgres, no service to run).

## Out of scope

- Read routes and any front-end change — the Demo tabs keep reading the promo.
- Reproducing `lib/analytics.ts` in the backend.
- The public demo page and the live test call, which stay on the promo.
- Importing the `.md` transcript rendering, or the three CSVs: the JSON dump is a superset.
