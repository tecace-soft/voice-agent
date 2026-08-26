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

## The URL

What's on screen lives in the URL hash, so a refresh stays where you were rather than dropping back
to Overview:

```
#/analytics
#/overview?mailbox=sam%40tecace.com
#/overview?mailbox=unattributed
```

That also makes browser Back/Forward walk the views you visited, and a view something you can send
to someone — open a link while signed out and you land on it after signing in. A hash is used rather
than a real path so no server rewrite is involved and a stale link can't 404. An unknown view falls
back to Overview, and `?mailbox=` is ignored for a `user` (the backend pins them to their own
mailbox regardless). Lives in `src/routing.ts`.

## Whose data you see

Voicemail data is attributed to the mailbox the transcribe-app fetched it from, and matched to
people by email:

- A **user** sees only the mailbox matching their own account email — no picker, nothing to switch
  to, and no cards to open: their dashboard is simply their own data. If nothing has been
  transcribed for their address they get a plain explanation naming it, rather than a page of zeros.
- An **admin** gets a mailbox picker in the header: all mailboxes (the default), any single one, or
  the runs reported before mailboxes were recorded ("Unattributed"). It scopes every view, Analytics
  included.

When an admin is looking at **all** mailboxes, **Overview**, **Analytics** and **Daily activity**
all become one collapsible card per person instead of everyone's numbers blended together. The closed card carries
that person's headline figures (transcribed, today, last 7 days, failed) from the summary already
loaded; opening it fetches only their data and renders the very same page they would see for
themselves. Several can be open at once, and re-opening reuses what was already fetched. Narrow to a
single mailbox in the header and the accordion goes away — you get that dashboard directly.

Elsewhere the data on screen belongs to several people, so it is attributed per row: the run tables gain a **Mailbox** column, each analytics session is badged with
its address, and Analytics leads with a **"Whose data this is"** breakdown — runs, transcribed,
share and last run per mailbox, each clickable to scope the whole dashboard to it. Narrow to a
single mailbox and all of that disappears, since it would just be one address repeated down the
page.

Everywhere you pick or read a person — the header picker, the per-person cards, the Per person
table, the Analytics breakdown, the sidebar's "Showing" line — the **name leads and the address is
the smaller supporting line**, falling back to the address when no account matches it. The names
come from one shared lookup (`src/people.ts`), fetched once per session rather than once per
component.

The sidebar always says which mailbox is on screen. The backend decides the scope from the session,
so the picker narrows an admin's view rather than granting access.

## What it shows

A sidebar shell (rail → header → KPI row → chart → table) with four views:

- **Overview** — four KPI cards (total transcribed, today, last 7 days, success rate) each with a
  trend badge; a per-run area chart with an "all / last 30 / last 10 runs" range picker; and a
  tabbed run table (recent · all · failed · empty passes) with column toggles and pagination.
- **Per person** (admins) — how much each *user* is getting (admin accounts are left out: no mailbox
  is polled for them, so listing them all as "No data" would be a permanent row of false alarms): transcribed, share of the total,
  today, last 7 days, found, failed, runs and last run, one row per mailbox and ordered by volume.
  It joins the mailboxes that have reported data against the accounts that can sign in, so the
  mismatches are visible: **No account** is data nobody but an admin can see, **No data** is someone
  signing in to an empty dashboard. A "Needs attention" tab isolates just those, and clicking a
  person scopes the whole dashboard to them.
- **Analytics** — one person's operational view, over their whole history rather than the 60-run
  window the other pages read, and broken out **by session rather than by day**. A user sees only
  their own; an admin gets a card per person. Headline rates (success,
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
