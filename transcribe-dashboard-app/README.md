# transcribe-dashboard-app

Standalone dashboard for the **voicemail transcription** service — how many voicemails the
[transcribe-app](../transcribe-app/) has processed over time. A **React + Vite + TypeScript** SPA
that reads `GET /transcribe/stats` from the standalone [transcribe-backend](../transcribe-backend/).

Migrated out of `admin-dashboard-app` (which had it as a tab) so the transcription metrics can live
and deploy on their own.

## Signing in

The dashboard is behind a sign-in screen — `GET /transcribe/stats` requires a session, so there is
nothing to render without one.

**Sign in is always the landing screen.** While the database has no accounts at all, it also offers
a **"Create the first account"** button underneath — that leads to a name/email/password form, and
signs you in as an admin. The button disappears (and the backend closes the route) the moment any
account exists.

**Everyone after that** is added from the **Accounts** page in the sidebar. There is no public
sign-up; the backend CLI (`cd ../transcribe-backend && bun run auth ...`) stays available for when
nobody can get in.

Accounts are either **admin** or **user**:

- **user** — signs in and reads the dashboard. The Accounts nav item isn't rendered for them.
- **admin** — the same, plus the Accounts page (add a user with a generated password shown once,
  reset a password, sign an account out everywhere, remove it, promote/demote) and All feedback.

Hiding the page is a convenience only — the backend refuses account routes from a `user` regardless,
and reads the role fresh on every request, so a promotion or demotion applies without re-signing in.
The last admin can't be demoted or removed.

`POST /auth/login` returns a session token, kept in `localStorage` (`transcribe.token`) and sent as
`Authorization: Bearer <token>` on every request. On load the app calls `GET /auth/me` to restore
the session; any 401 (expired token, or one revoked with `bun run auth revoke`) drops straight back
to the sign-in screen. The signed-in person shows at the bottom of the sidebar, with sign-out.

## What it shows

A sidebar shell (rail → header → KPI row → chart → table) with four views:

- **Overview** — four KPI cards (total transcribed, today, last 7 days, success rate) each with a
  trend badge; a per-run area chart with an "all / last 30 / last 10 runs" range picker; and a
  tabbed run table (recent · all · failed · empty passes) with column toggles and pagination.
- **Analytics** — the operational view, over the app's whole history rather than the 60-run window
  the other pages read, and broken out **by session rather than by day**. Headline rates (success,
  already-handled, typical gap between runs with the longest stall, share of passes that found
  nothing), then **Transcribed sessions**: every run that transcribed something as its own entry
  with its own found / transcribed / already-handled / failed, success rate, share that was new
  work, the gap since the previous run, and a bar splitting what it found. Orderable newest or
  biggest, paged. Below that, the distribution of what a session transcribes (never an average
  across every run, which the empty passes would make meaningless), hour-of-day and weekday
  patterns, and the all-time breakdown.
  Reads `GET /transcribe/analytics`.
- **Daily activity** — the 14-day daily series as an area chart plus a per-day totals table.
- **All runs** / **Failed runs** — the run log on its own, newest first.
- **Send feedback** — anyone signed in writes a note to the team (a bug, an idea, a question about
  the data) and sees their own past notes with whether they've been dealt with.
- **All feedback** (admins) — everything anyone has sent, filterable by open/resolved, with
  mark-resolved and reopen. The count of open notes badges the sidebar.

All four read the single `GET /transcribe/stats` response; the deltas (today vs yesterday, this week
vs last week) are derived from its 14-day `daily` series in `src/stats.ts`.

Data flow: the transcribe-app POSTs each run's summary to the backend (`POST /transcribe/runs`),
which stores it in `voicemail_runs`; this app reads the aggregate from `GET /transcribe/stats`.

## Styling

Follows the **`tecace-dashboard-ui`** skill — see [CLAUDE.md](./CLAUDE.md) before touching any UI.
The design system's token CSS lives in `src/tecace/`; `src/index.css` maps the app's component
styles onto those tokens (never hardcode a hex). Plain React + hand-rolled CSS, no Tailwind/shadcn.
Light/dark via `data-theme` on `<html>`, toggled from the header.

Layout pieces live in `src/components/` (`Sidebar`, `StatCard`, `AreaChart`, `RunsTable`, `TabBar`)
and the views in `src/pages/`.

## Setup

```bash
cd transcribe-dashboard-app
npm install
cp .env.example .env    # set VITE_BACKEND_URL to your backend
npm run dev             # http://localhost:5174
```

## Deploy

Its own Vercel project (Root Directory = `transcribe-dashboard-app`, Vite preset). Set
`VITE_BACKEND_URL` to the backend URL, and make sure the backend's `CORS_ORIGIN` includes this
app's origin. `vercel.json` rewrites all routes to `index.html` (SPA).

Same TypeScript pin as the sibling apps: `typescript@5` (the default `typescript@7` pull breaks the
Vercel build).
