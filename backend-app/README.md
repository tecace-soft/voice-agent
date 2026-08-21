# Backend

The shared backend / API service — the single place that owns the system's data and
business logic, exposed over an HTTP API.

Built with **[Elysia](https://elysiajs.com/)** (TypeScript, end-to-end type-safe). Runs on
**[Bun](https://bun.sh/)** locally and deploys to **Vercel** as serverless functions on the
Node runtime — the code is runtime-agnostic (Postgres access is via **[postgres.js](https://github.com/porsager/postgres)**, not a Bun-only API).

## Role in the workspace

- **Consumers:** the **[`admin-dashboard-app/`](../admin-dashboard-app/)** uses it now, and
  the **[`voice-agent-app/`](../voice-agent-app/)** will use it eventually (today the voice
  agent talks to Cal.com / Sheets / Gemini directly; over time that moves behind this API).
- Runs and deploys independently, with its own configuration.

## Setup

Requires **[Bun](https://bun.sh/)** (1.3+) and a **PostgreSQL** database. Install deps:

```bash
cd backend-app
bun install
cp .env.example .env          # then adjust (PORT, NODE_ENV, DATABASE_URL)
```

Point `DATABASE_URL` at a Postgres instance, then create the schema:

```bash
bun run db:migrate            # create/update the `intakes` table, then exit
```

(Running locally with `bun run dev` also creates the schema on startup; the Vercel
deployment does not — run `db:migrate` against your database once.)

## Running it

```bash
bun run dev        # watch mode — restarts on change
bun run start      # run once
```

The server starts on `PORT` (default **8000**):

```bash
curl http://localhost:8000/           # {"name":"backend-app","message":"Elysia is running"}
curl http://localhost:8000/health     # {"status":"ok","uptime":...}

# Store an intake (validated, then persisted to Postgres):
curl -X POST http://localhost:8000/intake \
  -H 'content-type: application/json' \
  -d '{"name":"Jane Doe","email":"jane@example.com","phoneNumber":"+1-555-123-4567","purpose":"Product demo callback","requestedDate":"2026-08-01"}'
# -> 201 {"status":"created","intake":{"id":"...","scheduledAt":"...","createdAt":"...", ...}}

# List intakes for the dashboard (newest first, paged + filterable):
curl 'http://localhost:8000/intake?limit=50&offset=0'
curl 'http://localhost:8000/intake?status=new'                       # by lifecycle status
curl 'http://localhost:8000/intake?q=demo'                           # search name/email/purpose
curl 'http://localhost:8000/intake?scheduledFrom=2026-08-01T00:00:00Z&scheduledTo=2026-08-31T23:59:59Z'
# -> {"total":N,"limit":50,"offset":0,"intakes":[ {...}, ... ]}   (total reflects the filters)

# Fetch one by id:
curl http://localhost:8000/intake/<id>       # -> {"intake":{...}}  (404 if absent)

# Agent workflow: poll the queue, then write back the outcome.
curl 'http://localhost:8000/intake?status=new'               # clients still needing a call
curl -X PATCH http://localhost:8000/intake/<id>/status \
  -H 'content-type: application/json' -d '{"status":"booked"}'
# -> {"status":"updated","intake":{...,"status":"booked"}}   (409 if the slot is taken)

# Cancel a booking (frees the slot, keeps the client) — or delete the client outright.
curl -X DELETE http://localhost:8000/intake/<id>/booking   # -> {"status":"canceled",...}
curl -X DELETE http://localhost:8000/intake/<id>           # -> {"status":"deleted","id":"..."}

# Schedule: which slots are taken vs. available (derived from booked intakes).
curl 'http://localhost:8000/schedule?from=2026-08-03&to=2026-08-07'
# -> {"timezone":"...","slotMinutes":30,"days":[{"date":"2026-08-03","slots":[{"start","end","available"},...]}]}
curl 'http://localhost:8000/schedule/availability?dateTime=2026-08-03T09:00:00Z'
# -> {"dateTime":"...","available":true,"reason":"available"}

# Wanted slot taken? Get the nearest available alternatives (closest first).
curl 'http://localhost:8000/schedule/suggestions?dateTime=2026-08-03T12:00:00Z&limit=3'
# -> {"requested":{...,"available":false,"reason":"taken"},
#     "suggestions":[{"start","end","date","minutesFromWanted":-60}, ...]}
```

### Intake API

One `intakes` record is shared by all three consumers: the **form** creates it, the
**agent** reads the queue and records the outcome, the **dashboard** displays it.

Lifecycle (`status`): **`new`** (just submitted) → **`contacted`** (agent reached them) →
**`booked`** (consultation scheduled) *or* **`unreachable`** (couldn't get through). A
booking can later be **`canceled`**, which frees its slot but keeps the client record.

| Method & path | Consumer | Notes |
| --- | --- | --- |
| `POST /intake` | Form | Validates body; **201** with the stored record. New records start as `new`. |
| `GET /intake` | Dashboard / Agent | List, newest first. Paging: `?limit` (1–200, default 50), `?offset` (default 0). Filters (optional, AND-combined): `?status`, `?q` (substring over name/email/purpose), `?scheduledFrom` / `?scheduledTo` (ISO date-time range). Returns `{total,limit,offset,intakes}` — `total` reflects the filters. The agent polls `?status=new`. |
| `GET /intake/:id` | Dashboard / Agent | Fetch one intake. `id` must be a UUID; **404** if not found. |
| `PATCH /intake/:id/status` | Agent | Advance the lifecycle: body `{"status":"contacted"\|"booked"\|"unreachable"\|"new"}` (not `canceled` — see below). When booking, an optional **`dateTime`** books the client at the slot they chose on the call (else their form time). **404** if not found; **422** on unknown status. Booking is guarded — **409** if the slot overlaps an existing booking, **422** if it's in the past. |
| `PATCH /intake/:id/notes` | Agent | Attach the post-call summary: body `{"notes":"..."}`. **404** if not found. |
| `DELETE /intake/:id/booking` | Dashboard / Agent | Cancel a booking: `booked → canceled`, freeing the slot; the client record is kept. **404** if not found; **409** (`not_booked`) if the client has no active booking. |
| `DELETE /intake/:id` | Dashboard | Permanently delete a client (hard delete). Frees their slot if booked. **200** `{status:"deleted"}`; **404** if not found. |

Record shape (camelCase): `id, name, email, phoneNumber, purpose, requestedDate, scheduledAt, status, notes, createdAt, updatedAt`. (No `language` — the agent detects the lead's language from how they answer the phone.)

### Schedule API

The bookable **slot grid** = business hours (`SCHEDULE_*` env, see `.env.example`) in a
timezone, split into fixed-length slots. A slot is **taken** when a `booked` intake's
window overlaps it; **available** otherwise. Booked times are derived from the `intakes`
table — no separate bookings store.

| Method & path | Purpose | Notes |
| --- | --- | --- |
| `GET /schedule` | Slot grid for a date range | `?from=YYYY-MM-DD` (required), `?to=YYYY-MM-DD` (defaults to `from`; max 62 days). Returns `{timezone, slotMinutes, days:[{date, slots:[{start, end, available}]}]}`. Non-workdays yield an empty `slots` array. |
| `GET /schedule/availability` | Check one specific instant | `?dateTime=<ISO>`. Returns `{dateTime, available, reason}` where reason is `available` / `in_past` / `taken` / `not_a_slot_boundary` / `outside_business_hours`. A time earlier than now is always `in_past`. |
| `GET /schedule/suggestions` | Nearest available slots to a wanted time | `?dateTime=<ISO>` (required), `?limit` (1–20, default 3), `?withinDays` (1–62, default 14). Returns `{requested:{dateTime,available,reason}, suggestions:[{start,end,date,minutesFromWanted}]}`. Suggestions are free, **future** slots ordered by distance from the wanted time (ties → earlier first); it skips weekends/off-hours automatically. Works even when the request is in the past: the search anchors at today, so a past date rolls forward to today's remaining slots (if any) or the next open day. The agent uses this whenever the requested slot comes back `taken` or `in_past`. |

Booking is guarded at the write: `PATCH /intake/:id/status → booked` returns **409** if the
requested time overlaps an already-booked slot (window = `SCHEDULE_SLOT_MINUTES`), and
**422** (`in_past`) if the slot has already passed.

Other scripts: `bun run typecheck` (tsc, no emit) · `bun run build` (bundle to `dist/`).

## Deploying to Vercel

The API deploys to Vercel as serverless functions (Node runtime — needed for the Postgres
TCP connection). Elysia's `app.handle(request)` is a web-standard handler; `api/index.ts`
exposes it per HTTP method and `vercel.json` rewrites every path to it, so Elysia does all
the routing.

1. **Import the repo** into a Vercel project, **Root Directory = `backend-app`**.
2. **Build Command:** leave empty (Vercel builds the `api/` functions itself — don't run
   the Bun-specific `build` script).
3. **Environment variables** (Project Settings → Environment Variables): `DATABASE_URL`
   (use Vercel Postgres/Neon's **pooled** connection string, with `?sslmode=require`),
   the `SCHEDULE_*` vars, and `CORS_ORIGIN` (your frontends' URLs).
4. **Create the tables once:** run `bun run db:migrate` locally with `DATABASE_URL` pointed
   at the Vercel/Neon database (the serverless functions don't migrate on cold start).

Locally it still runs as a normal Bun server (`bun run dev`); the same code runs on Node
under Vercel because Postgres access uses postgres.js, not a Bun-only API.

## Project layout

```
backend-app/
  api/
    index.ts           # Vercel serverless entry — forwards each method to app.handle
  vercel.json          # rewrites all paths to /api (Elysia handles routing)
  src/
    index.ts           # local entrypoint — starts the HTTP server (app.listen, Bun)
    app.ts             # composes the Elysia app from controllers (exported, testable) + CORS
    config/
      env.ts           # typed env access — DB, CORS, schedule config
    db/
      client.ts        # shared postgres.js client + schema init
      intakes.ts       # intakes repository (create / list / get / status / book / cancel / delete)
      migrate.ts       # standalone migration entrypoint (bun run db:migrate)
    schedule/
      slots.ts         # pure, timezone-aware slot-grid logic (no DB)
    routes/
      health.ts        # health/liveness controller
      intake.ts        # intake API — create, list/filter, get, advance status, cancel, delete
      schedule.ts      # schedule API — slot grid, availability, suggestions
  package.json
  tsconfig.json
  .env.example
```

### Conventions

- **One `Elysia` instance per controller**, composed onto the app with `.use(...)` — the
  Elysia-recommended pattern (method chaining preserves end-to-end type inference).
- **`src/app.ts` builds the app without `.listen()`** so tests can drive it directly via
  `app.handle(new Request(...))`; **`src/index.ts` owns the server lifecycle**.
- Add a feature: create `src/routes/<feature>.ts` exporting an `Elysia` instance, then
  `.use()` it in `src/app.ts`.

See the workspace [root README](../README.md) for how the apps fit together.
