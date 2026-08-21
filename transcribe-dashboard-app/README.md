# transcribe-dashboard-app

Standalone dashboard for the **voicemail transcription** service — how many voicemails the
[transcribe-app](../transcribe-app/) has processed over time. A **React + Vite + TypeScript** SPA
that reads `GET /transcribe/stats` from the shared [backend-app](../backend-app/).

Migrated out of `admin-dashboard-app` (which had it as a tab) so the transcription metrics can live
and deploy on their own.

## What it shows

- **Total transcribed / Today / Last 7 days / Runs / Failed** — headline stat tiles.
- **Transcribed per day** — a 14-day mini bar chart.
- **Recent runs** — the latest transcribe-app passes with their counts.

Data flow: the transcribe-app POSTs each run's summary to the backend (`POST /transcribe/runs`),
which stores it in `voicemail_runs`; this app reads the aggregate from `GET /transcribe/stats`.

## Styling

Uses the TecAce design system (`.claude/skills/tecace-design`): the DS token CSS lives in
`src/tecace/` and `src/index.css` maps the app's tokens onto it, so it matches the admin dashboard
and follows the light/dark toggle (top-right).

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
