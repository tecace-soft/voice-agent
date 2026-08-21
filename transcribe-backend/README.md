# transcribe-backend

Standalone backend for the **voicemail transcription metrics**, split out of the shared
[backend-app](../backend-app/). **Elysia** (Bun locally, Vercel/Node in prod) + Postgres.

- **`POST /transcribe/runs`** — the [transcribe-app](../transcribe-app/) reports each run's counts
  here (guarded by the `x-transcribe-key` header when `TRANSCRIBE_INGEST_KEY` is set).
- **`GET /transcribe/stats`** — the [transcribe-dashboard-app](../transcribe-dashboard-app/) reads
  the aggregate (open, like other dashboard reads).
- **`GET /health`** — liveness.

Owns one table, `voicemail_runs` (one row per transcribe pass). The schema self-migrates on the
first request; or run it eagerly with `bun run db:migrate`.

**Wipe the metrics** (e.g. before a customer handoff, to remove all test data) with
`bun run db:clear` — it empties `voicemail_runs` (keeps the table). It acts on whatever
`DATABASE_URL` points at, so to clear production, run it with the production connection string:

```bash
DATABASE_URL="<production connection string>" bun run db:clear
```

Or run the SQL directly in the Neon/Vercel SQL console: `TRUNCATE TABLE voicemail_runs;`

## Run locally

```bash
cd transcribe-backend
bun install
cp .env.example .env    # set DATABASE_URL (and BUSINESS_TIMEZONE / TRANSCRIBE_INGEST_KEY)
bun run dev             # http://localhost:8001
```

## Deploy

Its own Vercel project (Root Directory = `transcribe-backend`). Vercel serves the Elysia app
(`src/app.ts` default export). Set `DATABASE_URL`, `TRANSCRIBE_INGEST_KEY`, and `CORS_ORIGIN` (the
transcribe dashboard's origin). `bun run db:migrate` once against the production DB, or let the
first request create the table.

## Wiring (what points here now)

- **transcribe-app** `.env`: `BACKEND_URL` → this backend's URL, `TRANSCRIBE_INGEST_KEY` → the same
  secret set here.
- **transcribe-dashboard-app**: `VITE_BACKEND_URL` → this backend's URL. Add its origin to
  `CORS_ORIGIN` here.

## Database

`voicemail_runs` is independent of the main backend's `intakes`. Point `DATABASE_URL` at a fresh
database for a clean split, or at the main backend's database to keep any rows already recorded
there.
