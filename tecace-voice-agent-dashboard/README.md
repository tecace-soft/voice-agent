# tecace-voice-agent-dashboard

The TecAce voice agent dashboard — one front end combining the transcribe dashboard
(`../transcribe-dashboard-app`) and the prospect demo tool (`voiceagent_promo`, whose admin screens
and data now live here as the admin-only Demo section). React + Vite + TypeScript;
transcribe screens in plain CSS, promo screens in Tailwind + shadcn, kept apart by cascade layers.
Conventions: `CLAUDE.md`. Design: `../docs/superpowers/specs/2026-09-21-combined-dashboard-design.md`.

## Run

```sh
cp .env.example .env   # set BACKEND_URL (transcribe-backend)
npm install
npm run dev            # http://localhost:5175
```

- `npm run build` — type-check and build to `dist/`. `vercel.json` rewrites all routes to
  `index.html` for SPA deploys.
- `npm test` — unit tests (Vitest).
- `npm run gen:preflight` — regenerate `src/styles/ui-preflight.css` after upgrading tailwindcss.
- `python scripts/regression/compare.py` — proves the transcribe screens match the original app;
  `tw_probe.py` checks the Tailwind side; `demos_e2e.py` walks the Demo section against a fake
  backend (see `scripts/regression/README.md`; run them one at a time).

## The Demo section

The Demo screens' data lives in transcribe-db and is served by transcribe-backend under `/demo/*`,
guarded by the dashboard's own admin session — the same `BACKEND_URL` and the same bearer token as
every other screen. There is no proxy, no second sign-in and no promo password; the Demo group is
admin-only, so an admin session is all it takes.

Two promo actions could not come with the data and are gone from the UI: **Re-research** (needed the
promo's Claude research pipeline) and the **test call** (needed the promo's OpenAI realtime session).

The prospect-facing demo page (`/c/<id>`) is **not** served here: the promo serves it, and this app
only links to it. Set `VITE_PUBLIC_DEMO_BASE_URL` (build time) to the promo's public origin — it is
the origin of the demo links the Prospects and Share screens copy and email, and without it they
fall back to this dashboard's own origin (its sign-in page). `npm run build` warns when it is unset.
