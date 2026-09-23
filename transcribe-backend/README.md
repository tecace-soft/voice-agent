# transcribe-backend

Standalone backend for the **voicemail transcription metrics**, split out of the shared
[backend-app](../backend-app/). **Elysia** (Bun locally, Vercel/Node in prod) + Postgres.

- **`POST /transcribe/runs`** — the [transcribe-app](../transcribe-app/) reports each run's counts
  here, with the **mailbox they were fetched from** (guarded by the `x-transcribe-key` header when
  `TRANSCRIBE_INGEST_KEY` is set).
- **`GET /transcribe/stats`** — the [transcribe-dashboard-app](../transcribe-dashboard-app/) reads
  the aggregate. **Requires a signed-in dashboard user** (`Authorization: Bearer <token>`).
- **`GET /auth/setup-state`**, **`POST /auth/setup`** — first-run account creation (below).
- **`POST /auth/login`**, **`GET /auth/me`**, **`POST /auth/logout`** — dashboard sign-in.
- **`GET|POST /auth/users`**, **`POST /auth/users/:id/password`**, **`POST /auth/users/:id/revoke`**,
  **`DELETE /auth/users/:id`** — account management, for the dashboard's Accounts page.
- **`GET /transcribe/analytics`** — the dashboard's Analytics view: all-time totals, the last 100
  **transcribed sessions** with their own figures, hour-of-day and weekday patterns, run cadence,
  and the per-session output distribution, aggregated in SQL over the whole history (`/stats` only
  ships a 60-run window). Any signed-in user, same as `/stats`.
- **`POST /feedback`**, **`GET /feedback/mine`** — anyone signed in sends a note and reads their own.
- **`GET /feedback`**, **`GET /feedback/open-count`**, **`POST /feedback/:id/status`** — admins read
  everyone's and resolve them.
- **`GET /health`** — liveness.

Owns three tables: `voicemail_runs` (one row per transcribe pass), `users` (dashboard accounts), and
`feedback` (notes sent from the dashboard). The schema self-migrates on the first request; or run it
eagerly with `bun run db:migrate`.

**Wipe the metrics** (before a customer handoff, or to start clean on mailbox-attributed data) with
`bun run db:clear`. It prints the current per-mailbox breakdown first, then deletes:

```bash
bun run db:clear                              # every run
bun run db:clear --unattributed               # only runs with no mailbox
bun run db:clear --mailbox you@tecace.com     # only that mailbox
bun run db:clear --dry-run                    # show the breakdown, delete nothing
```

It only ever touches `voicemail_runs` — dashboard accounts and feedback are left alone, so nobody
loses their login. **Destructive and irreversible**, and it acts on whatever `DATABASE_URL` points
at, so to clear production run it with the production connection string:

```bash
DATABASE_URL="<production connection string>" bun run db:clear --dry-run   # look first
DATABASE_URL="<production connection string>" bun run db:clear
```

## Dashboard accounts

Sign-in is **email + password**, with accounts in the `users` table. Passwords are scrypt hashes
(`node:crypto`, so it behaves the same under Bun and Vercel's Node runtime); a successful login
returns an HMAC-signed session token that the dashboard sends as `Authorization: Bearer <token>`.
Tokens last `AUTH_TOKEN_TTL_HOURS` (default 7 days).

### Roles

Every account is an **admin** or a **user**:

| | user | admin |
| --- | --- | --- |
| Sign in, read the dashboard | ✅ | ✅ |
| Send feedback, read their own | ✅ | ✅ |
| Add / reset / sign out / remove accounts | — | ✅ |
| Promote and demote others | — | ✅ |
| Read everyone's feedback and resolve it | — | ✅ |

The dashboard hides its Accounts page from a `user`, but that is a convenience — every account route
requires an admin server-side. The role is read from the database on each request, so a demotion
takes effect immediately rather than when that person's token expires.

Two things are refused so nobody can lock the team out: the **last admin** can't be demoted or
removed, and the **last account** can't be removed at all.

### Where accounts come from

There is **no open sign-up**. Accounts come from exactly four places:

1. **First-run setup.** The dashboard always lands on sign-in, but while the `users` table is empty
   it also offers a "Create the first account" button; `POST /auth/setup` creates that account — as
   an **admin**, since somebody has to be able to add everyone else — and signs it in.
   The route closes permanently as soon as any account exists (the check and the insert are a single
   statement, so two simultaneous setups can't both win). `GET /auth/setup-state` is what the
   dashboard asks to decide which screen to show.
2. **The dashboard's Accounts page.** An admin adds, resets, signs out, removes, promotes, and
   demotes users. New accounts get a generated password, shown once, and default to `user`.
3. **`SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`** — an optional bootstrap admin, applied on the
   first request after a deploy. It creates the account if that email has none, promotes it if it
   exists without admin, and *never* changes an existing account's password. Use it to exist as an
   admin before the dashboard is ever opened; delete the variables afterwards. See `.env.example`.
4. **This CLI** — the escape hatch for when nobody can get in:

```bash
bun run auth create jane@tecace.com "Jane Kim"           # a `user`; prints a password ONCE
bun run auth create jane@tecace.com "Jane Kim" --admin   # ...or an admin
bun run auth list                                # accounts, roles, last sign-in
bun run auth role jane@tecace.com admin          # promote (or `user` to demote)
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

An account can't remove itself, and neither the last admin nor the last account can be removed —
otherwise the only way back in would be the CLI.

### Mailboxes — who sees which voicemail data

Every run is attributed to the mailbox the transcribe-app fetched it from (`voicemail_runs.
mailbox_email`), and that address is what ties the data to a person:

| | `user` | `admin` |
| --- | --- | --- |
| Reads | only the mailbox matching **their own account email** | every mailbox, or one at a time |
| `?mailbox=` on `/stats` and `/analytics` | ignored | filters; `unattributed` isolates pre-mailbox runs |
| `GET /transcribe/mailboxes` | 403 | per-mailbox totals — runs, found, transcribed, skipped, failed, today, last 7 days, active days, first/last run — ordered by volume |

The scoping is decided server-side in `scopeFor()` from the session, so the query parameter is only
ever a filter for an admin and never a way in — a `user` asking for someone else's mailbox still
gets their own. A user whose email matches no mailbox simply matches no rows, which is the honest
answer rather than an error.

`mailbox_email` is nullable: runs reported before this existed are **unattributed**, visible only to
an admin (an account email always contains "@", so it can never match `IS NULL`). Older
transcribe-app builds that don't send the address keep reporting successfully — those runs just land
unattributed.

### Analytics

`src/db/analytics.ts` answers three operational questions in one round trip: is the app keeping up
(totals + success/skip rates), is it running on schedule (`cadence` — the gaps between consecutive
runs), and when does work arrive (`byHour` / `byWeekday`, bucketed in `BUSINESS_TIMEZONE`).

It is organised by **session, not by day** — a calendar day is an arbitrary bucket for a job that
runs on its own schedule. `sessions` returns each run that transcribed something, newest first, with
`sincePreviousSeconds`: the gap to the previous run **of any kind**, empty passes included. The
window runs over every row and the filter to transcribed runs happens after it, because measuring
only against the previous *transcribed* run would hide a poller that was running fine but finding
nothing.

`perRun` deliberately ships a **distribution rather than an average**: most passes find nothing, so
`processed / runs` describes no run that has ever happened. It carries the count of runs that
transcribed something, the median and maximum across only those runs, the exact histogram (grouped
by output — small, since a run handles a handful of voicemails), and the ten biggest runs
individually.

The median gap uses **`percentile_disc`**, not `percentile_cont`: the discrete median returns a gap
that actually happened, where the continuous one averages the two middle values and can report a
cadence the app has never had — a poller that runs every 30 minutes but occasionally stalls for days
would otherwise "typically" run every few hours, which is true of no run at all.

### Feedback

`feedback` holds notes people send from the dashboard: a category (`bug` / `idea` / `data` /
`other`), the message, and a status (`open` / `resolved`, with who resolved it and when). The
author's name and email are copied onto the row at submit time and `user_id` is `ON DELETE SET
NULL`, so a note still says who wrote it after that account is removed. The author is always taken
from the session, never the request body.

`bun test` covers sign-in, the guards, first-run setup, account management, roles, revocation, and
feedback with an in-memory stand-in for the database (no Postgres needed).

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
`TRANSCRIBE_INGEST_KEY`, `CORS_ORIGIN` (the transcribe dashboard's origin), `AUTH_SECRET`, and
optionally `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` to have an admin account waiting.
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

## Demo data (the promo's Redis export)

The `demo_*` tables hold the voiceagent-promo demo data — prospects, their demo calls with full
transcripts, page-view events and CRM notes — imported from the promo's final Upstash Redis export
of 2026-09-22. The promo has stopped collecting, so this database is the system of record for it.

Nothing serves these tables yet: the dashboard's Demo tabs still read the promo through the
`/promo-api` proxy. The import is safe to run at any time and safe to re-run.

### Where the file lives

Put the export in `data/` — **git-ignored** (the repo root ignores `data/`, and `data/.gitignore`
repeats it), because it holds real business names, addresses, phone numbers and complete call
transcripts. Keep it out of the repo and out of any deploy bundle.

```bash
mkdir -p data
unzip -o ~/Downloads/redis-transcripts-2026-09-22.zip redis-full-dump-2026-09-22.json -d data/
```

The zip also carries three CSVs and a Markdown transcript rendering. The importer reads only the
JSON, which is a superset of all of them.

### Running it

The tables are created on the next cold start by the schema probe, or eagerly with
`bun run db:migrate`. `demo:import` also calls `initDb()` itself, so a first run needs no setup.

```bash
bun run demo:import data/redis-full-dump-2026-09-22.json --dry-run   # look first
bun run demo:import data/redis-full-dump-2026-09-22.json
```

Against production, supply the connection string for the command. **PowerShell has no inline
`VAR=value cmd` form** — that is bash syntax, and pasting it gives
`The term 'DATABASE_URL=...' is not recognized`. Set the variable first instead:

```powershell
$env:DATABASE_URL = "<production connection string>"
bun run demo:import data/redis-full-dump-2026-09-22.json --dry-run
bun run demo:import data/redis-full-dump-2026-09-22.json
$env:DATABASE_URL = $null   # or just close the window
```

```bash
# bash / Git Bash
DATABASE_URL="<production connection string>" bun run demo:import data/redis-full-dump-2026-09-22.json --dry-run
DATABASE_URL="<production connection string>" bun run demo:import data/redis-full-dump-2026-09-22.json
```

**The connection string is not the backend's URL.** It starts with `postgres://`, not `https://`;
`https://transcribe-app-backend.vercel.app` is the deployed API, not its database. Take it from the
Vercel project's Settings → Environment Variables → `DATABASE_URL`, or run `vercel env pull .env`
in this directory to write a local `.env` and skip the variable entirely. Use the POOLED host (it
contains `-pooler`) and keep `?sslmode=require`. The importer refuses anything that is not a
`postgres://` URL rather than timing out against it.

The 2026-09-22 export should report **10 customers, 21 calls, 51 events, 0 notes**. Different
numbers mean a different file — stop and check which one you have.

`--dry-run` performs the entire import and then rolls the transaction back, so its counts are the
counts a real run would produce, including constraint failures. It is not a file inspection: it
will tell you that 10 customers are already present and only 2 would be new.

### Re-running, and what the counts mean

Every write is an upsert keyed on the promo's own ids, so importing the same file twice is a no-op:
the second run reports **0 inserted** and leaves the row count unchanged. "Inserted" counts only new
rows — a record already present is updated in place and not counted. Re-running after a run that
failed halfway needs no cleanup; the whole import is one transaction, so a failure leaves nothing
behind.

To confirm an import landed, run it again with `--dry-run`: all zeros means the database already
holds everything in the file.

### If it refuses

- `❌ DATABASE_URL is not set` — the file parsed fine; there is just no database to import into.
  Either `cp .env.example .env` and set it, or pass it inline as shown above.
- `❌ not a Redis export: expected an object with a 'data' object` — wrong file (a CSV, or the zip
  itself rather than the JSON inside it).
- `❌ N record(s) name a customer the dump does not contain:` followed by the offending ids — the
  export is internally inconsistent. Nothing is written. This is checked before any database work,
  so it costs nothing and cannot half-apply.
