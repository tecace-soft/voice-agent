# Backend

The shared backend / API service — the single place that owns the system's data and
business logic, exposed over an HTTP API.

Built with **[Elysia](https://elysiajs.com/)** on the **[Bun](https://bun.sh/)** runtime
(TypeScript, end-to-end type-safe).

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

Point `DATABASE_URL` at a Postgres instance. The server uses Bun's native Postgres client
(no external driver) and creates the `intakes` table automatically on startup; you can also
run migrations explicitly:

```bash
bun run db:migrate            # create/update the schema, then exit
```

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
  -d '{"language":"English","name":"Jane Doe","email":"jane@example.com","phoneNumber":"+1-555-123-4567","purpose":"Product demo callback","dateTime":"2026-08-01T15:30:00Z"}'
# -> 201 {"status":"created","intake":{"id":"...","scheduledAt":"...","createdAt":"...", ...}}

# List intakes for the dashboard (newest first, paged + filterable):
curl 'http://localhost:8000/intake?limit=50&offset=0'
curl 'http://localhost:8000/intake?language=English'                 # exact, case-insensitive
curl 'http://localhost:8000/intake?q=demo'                           # search name/email/purpose
curl 'http://localhost:8000/intake?scheduledFrom=2026-08-01T00:00:00Z&scheduledTo=2026-08-31T23:59:59Z'
# -> {"total":N,"limit":50,"offset":0,"intakes":[ {...}, ... ]}   (total reflects the filters)

# Fetch one by id:
curl http://localhost:8000/intake/<id>       # -> {"intake":{...}}  (404 if absent)

# Agent workflow: poll the queue, then write back the outcome.
curl 'http://localhost:8000/intake?status=new'               # clients still needing a call
curl -X PATCH http://localhost:8000/intake/<id>/status \
  -H 'content-type: application/json' -d '{"status":"booked"}'
# -> {"status":"updated","intake":{...,"status":"booked"}}
```

### Intake API

One `intakes` record is shared by all three consumers: the **form** creates it, the
**agent** reads the queue and records the outcome, the **dashboard** displays it.

Lifecycle (`status`): **`new`** (just submitted) → **`contacted`** (agent reached them) →
**`booked`** (consultation scheduled) *or* **`unreachable`** (couldn't get through).

| Method & path | Consumer | Notes |
| --- | --- | --- |
| `POST /intake` | Form | Validates body; **201** with the stored record. New records start as `new`. |
| `GET /intake` | Dashboard / Agent | List, newest first. Paging: `?limit` (1–200, default 50), `?offset` (default 0). Filters (optional, AND-combined): `?status`, `?language` (exact, case-insensitive), `?q` (substring over name/email/purpose), `?scheduledFrom` / `?scheduledTo` (ISO date-time range). Returns `{total,limit,offset,intakes}` — `total` reflects the filters. The agent polls `?status=new`. |
| `GET /intake/:id` | Dashboard / Agent | Fetch one intake. `id` must be a UUID; **404** if not found. |
| `PATCH /intake/:id/status` | Agent | Advance the lifecycle: body `{"status":"contacted"\|"booked"\|"unreachable"\|"new"}`. **404** if not found; **422** on an unknown status. |

Record shape (camelCase): `id, language, name, email, phoneNumber, purpose, scheduledAt, status, createdAt, updatedAt`.

Other scripts: `bun run typecheck` (tsc, no emit) · `bun run build` (bundle to `dist/`).

## Project layout

```
backend-app/
  src/
    index.ts           # entrypoint — starts the HTTP server (app.listen)
    app.ts             # composes the Elysia app from controllers (exported, testable)
    config/
      env.ts           # typed environment access (Bun auto-loads .env)
    db/
      client.ts        # shared Postgres client + schema init (Bun native SQL)
      intakes.ts       # intakes repository (create / list / get / update status)
      migrate.ts       # standalone migration entrypoint (bun run db:migrate)
    routes/
      health.ts        # health/liveness controller
      intake.ts        # intake API — create, list/filter, get, advance status
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
