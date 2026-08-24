# transcribe-dashboard-app

Standalone dashboard for the **voicemail transcription** service — how many voicemails the
[transcribe-app](../transcribe-app/) has processed over time. A **React + Vite + TypeScript** SPA
that reads `GET /transcribe/stats` from the standalone [transcribe-backend](../transcribe-backend/).

Migrated out of `admin-dashboard-app` (which had it as a tab) so the transcription metrics can live
and deploy on their own.

## What it shows

A sidebar shell (rail → header → KPI row → chart → table) with four views:

- **Overview** — four KPI cards (total transcribed, today, last 7 days, success rate) each with a
  trend badge; a per-run area chart with an "all / last 30 / last 10 runs" range picker; and a
  tabbed run table (recent · all · failed · empty passes) with column toggles and pagination.
- **Daily activity** — the 14-day daily series as an area chart plus a per-day totals table.
- **All runs** / **Failed runs** — the run log on its own, newest first.

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
