# transcribe-backend

Standalone backend for the **voicemail transcription metrics**, split out of the shared
[backend-app](../backend-app/). **Elysia** (Bun locally, Vercel/Node in prod) + Postgres.

- **`POST /transcribe/runs`** — the [transcribe-app](../transcribe-app/) reports each run's counts
  here (guarded by the `x-transcribe-key` header when `TRANSCRIBE_INGEST_KEY` is set).
- **`GET /transcribe/stats`** — the [transcribe-dashboard-app](../transcribe-dashboard-app/) reads
  the aggregate. **Requires a signed-in dashboard user** (`Authorization: Bearer <token>`).
- **`GET /auth/setup-state`**, **`POST /auth/setup`** — first-run account creation (below).
- **`POST /auth/login`**, **`GET /auth/me`**, **`POST /auth/logout`** — dashboard sign-in.
- **`GET|POST /auth/users`**, **`POST /auth/users/:id/password`**, **`POST /auth/users/:id/revoke`**,
  **`DELETE /auth/users/:id`** — account management, for the dashboard's Accounts page.
- **`GET /health`** — liveness.

Owns two tables, `voicemail_runs` (one row per transcribe pass) and `users` (dashboard accounts).
The schema self-migrates on the first request; or run it eagerly with `bun run db:migrate`.

**Wipe the metrics** (e.g. before a customer handoff, to remove all test data) with
`bun run db:clear` — it empties `voicemail_runs` (keeps the table). It acts on whatever
`DATABASE_URL` points at, so to clear production, run it with the production connection string:

```bash
DATABASE_URL="<production connection string>" bun run db:clear
```

Or run the SQL directly in the Neon/Vercel SQL console: `TRUNCATE TABLE voicemail_runs;`

## Dashboard accounts

Sign-in is **email + password**, with accounts in the `users` table. Passwords are scrypt hashes
(`node:crypto`, so it behaves the same under Bun and Vercel's Node runtime); a successful login
returns an HMAC-signed session token that the dashboard sends as `Authorization: Bearer <token>`.
Tokens last `AUTH_TOKEN_TTL_HOURS` (default 7 days).

There is **no open sign-up**. Accounts come from exactly three places:

1. **First-run setup.** While the `users` table is empty, the dashboard shows "Create the first
   account" instead of a sign-in form, and `POST /auth/setup` creates that account and signs it in.
   The route closes permanently as soon as any account exists (the check and the insert are a single
   statement, so two simultaneous setups can't both win). `GET /auth/setup-state` is what the
   dashboard asks to decide which screen to show.
2. **The dashboard's Accounts page.** Any signed-in person can add, reset, sign out, or remove
   teammates. There are no roles — everyone with an account here is staff. New accounts get a
   generated password, shown once.
3. **This CLI** — the escape hatch for when nobody can get in:

```bash
bun run auth create jane@tecace.com "Jane Kim"   # prints a generated password ONCE
bun run auth list                                # who has an account + last sign-in
bun run auth reset jane@tecace.com               # new password (signs that account out)
bun run auth revoke jane@tecace.com              # sign out everywhere, password unchanged
bun run auth delete jane@tecace.com
```

Point it at whichever database you mean to touch — for production accounts:

```bash
DATABASE_URL="<production connection string>" AUTH_SECRET="<production secret>" bun run auth create ...
```

Two secrets, two different callers — don't mix them up:

| Secret | Who sends it | Where |
| --- | --- | --- |
| `TRANSCRIBE_INGEST_KEY` | transcribe-app | `x-transcribe-key` header on `POST /transcribe/runs` |
| `AUTH_SECRET` | nobody — it signs session tokens | server-side only |

Session tokens are **stateless**, so `POST /auth/logout` is the client discarding its token. To
invalidate a token someone still holds (a lost laptop), use "Sign out" on the Accounts page or run
`bun run auth revoke <email>` — both bump that account's `token_version`, which rejects every token
issued before it. A password reset does the same. Changing `AUTH_SECRET` signs *everyone* out.

An account can't remove itself, and the last remaining account can't be removed at all — otherwise
the only way back in would be the CLI.

`bun test` covers sign-in, the guards, first-run setup, account management, and revocation with an
in-memory stand-in for the database (no Postgres needed).

## Run locally

```bash
cd transcribe-backend
bun install
cp .env.example .env    # set DATABASE_URL (and BUSINESS_TIMEZONE / TRANSCRIBE_INGEST_KEY)
bun run dev             # http://localhost:8001
```

With an empty database the dashboard walks you through creating the first account — no CLI needed.

`AUTH_SECRET` is optional locally (a random one is generated per process, so a restart signs you
out) and **required in production**.

## Deploy

Its own Vercel project (Root Directory = `transcribe-backend`). Vercel serves the Elysia app
(`src/app.ts` default export).

Environment variables (Project → Settings → Environment Variables): `DATABASE_URL`,
`TRANSCRIBE_INGEST_KEY`, `CORS_ORIGIN` (the transcribe dashboard's origin), and `AUTH_SECRET`.
Generate the secret with `openssl rand -hex 32`, or without openssl:

```bash
bun -e "console.log(crypto.randomUUID().replace(/-/g,'') + crypto.randomUUID().replace(/-/g,''))"
```

Two Vercel-specific things to get right:

- **Set `AUTH_SECRET` for every environment the backend runs in — Preview included.** Vercel sets
  `NODE_ENV=production` on Preview deployments as well, so `src/config/env.ts` refuses to boot
  without it and every request 500s. Giving Preview its own secret is good hygiene: a session from a
  preview URL then won't work against production.
- **Env changes only reach a new deployment.** After adding or rotating a variable, redeploy —
  existing deployments keep the values they were built with.

Then `bun run db:migrate` against the production DB, or let the first request create the tables.
Open the dashboard and create the first account through the setup screen; everyone else gets added
from its Accounts page.

## Wiring (what points here now)

- **transcribe-app** `.env`: `BACKEND_URL` → this backend's URL, `TRANSCRIBE_INGEST_KEY` → the same
  secret set here.
- **transcribe-dashboard-app**: `VITE_BACKEND_URL` → this backend's URL. Add its origin to
  `CORS_ORIGIN` here.

## Database

`voicemail_runs` is independent of the main backend's `intakes`. Point `DATABASE_URL` at a fresh
database for a clean split, or at the main backend's database to keep any rows already recorded
there.
