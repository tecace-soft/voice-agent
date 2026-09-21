# tecace-voice-agent-dashboard

The TecAce voice agent dashboard — one front end combining the transcribe dashboard
(`../transcribe-dashboard-app`) and the prospect demo tool (`voiceagent_promo`, being brought in
stage by stage; today: the admin-only Demos section's plumbing). React + Vite + TypeScript;
transcribe screens in plain CSS, promo screens in Tailwind + shadcn, kept apart by cascade layers.
Conventions: `CLAUDE.md`. Design: `../docs/superpowers/specs/2026-09-21-combined-dashboard-design.md`.

## Run

```sh
cp .env.example .env   # set VITE_BACKEND_URL (transcribe-backend) and PROMO_API_URL (voiceagent_promo)
npm install
npm run dev            # http://localhost:5175
```

- `npm run build` — type-check and build to `dist/`. `vercel.json` rewrites all routes to
  `index.html` for SPA deploys.
- `npm test` — unit tests (Vitest).
- `npm run gen:preflight` — regenerate `src/styles/ui-preflight.css` after upgrading tailwindcss.
- `python scripts/regression/compare.py` — proves the transcribe screens match the original app;
  `tw_probe.py` checks the Tailwind side; `demos_e2e.py` walks the Demos section against a fake
  promo (see `scripts/regression/README.md`; run them one at a time).

## The promo (Demos section)

Demos screens talk to voiceagent_promo through `/promo-api`, which the dev and preview servers proxy
to `PROMO_API_URL` (default `http://localhost:3000` — run `npm run dev` in the promo repo). The
promo's own admin password unlocks them once per browser; signing out of the dashboard, or the
dashboard session expiring, locks them again.

**Before the first deploy:** Vercel doesn't run the Vite proxy, so `vercel.json` needs two
rewrites, above the SPA fallback, pointing at the promo's deployed origin — and no wider than this:
`/promo-api/:path*` → `<promo>/api/:path*` and `/promo-page/c/:path*` → `<promo>/c/:path*`.
Without them the Demos section reports "Demo service unreachable".
