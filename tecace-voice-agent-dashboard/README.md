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

Every promo admin action is served here, including the two that once could not come with the data:
the **test call** (`POST /demo/session`, `POST /demo/calls/:id`) and **Re-research**
(`POST /demo/customers/:id/research`, which also runs in the background on a new prospect, so a
newly created record starts at `status: "researching"`). Both are real, billable OpenAI calls
gated by the backend's `OPENAI_API_KEY`: with no key they fail with the backend's own message and
every other Demo screen keeps working.

The prospect-facing demo page (`/c/<id>`) **is** served here, as a second entry document
(`c.html`) rather than a dashboard view: a prospect opening a demo link gets that page and none of
the admin bundle, and it cannot be reached from the Demos tabs. It has three pages — the demo, its
scenarios and its pricing — and it talks to the backend's `/demo/public/*` routes, which take no
sign-in because whoever holds the link has no account.

There is nothing to configure for it. A demo link is this deployment's origin plus `/c/<id>`, so the
links the Prospects and Share screens copy and email are right by construction.
