# tecace-voice-agent-dashboard

The TecAce voice agent dashboard — one front end combining the transcribe dashboard
(`../transcribe-dashboard-app`) and the prospect demo tool (`voiceagent_promo`, being brought in
stage by stage; today: the admin-only Demos section's plumbing). React + Vite + TypeScript;
transcribe screens in plain CSS, promo screens in Tailwind + shadcn, kept apart by cascade layers.
Conventions: `CLAUDE.md`. Design: `../docs/superpowers/specs/2026-09-21-combined-dashboard-design.md`.

## Run

```sh
cp .env.example .env   # set BACKEND_URL (transcribe-backend) and PROMO_API_URL (voiceagent_promo)
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

The prospect-facing demo page (`/c/<id>`) is **not** served here: the promo serves it, and this app
only links to it. Set `VITE_PUBLIC_DEMO_BASE_URL` (build time) to the promo's public origin — it is
the origin of the demo links the Prospects and Share screens copy and email, and without it they
fall back to this dashboard's own origin (its sign-in page). `npm run build` warns when it is unset.

**Before the first deploy:** Vercel doesn't run the Vite proxy, so `vercel.json` needs one rewrite,
above the SPA fallback, pointing at the promo's deployed origin — and no wider than this:
`/promo-api/:path*` → `<promo>/api/:path*`. Without it the Demos section reports "Demo service
unreachable".

**Also check at first deploy:**
- The promo's `/api/session` rate limit (5 calls/min) keys on `x-forwarded-for`. Behind a Vercel
  rewrite it may see Vercel's egress address rather than each admin's, putting every admin's test
  calls in one bucket. (Through the local Vite proxy every caller is keyed as `local`.)
- Re-running research can take over a minute (the promo route allows 300 s). A rewrite's own proxy
  timeout may answer with a gateway error while the research still finishes on the promo; the page
  reloads the record either way, but confirm the timeout.

## Trying a real test call

The end-to-end script proves everything up to the promo's session request (with a fake microphone),
but not the conversation itself. To hear one:

1. In the voiceagent_promo repo: `.env.local` with `OPENAI_API_KEY`, `ADMIN_PASSWORD` and
   `ADMIN_SESSION_SECRET`, then `npm run dev` (port 3000).
2. Here: `PROMO_API_URL=http://localhost:3000` (and `BACKEND_URL` for the dashboard sign-in),
   then `npm run dev` and open http://localhost:5175.
3. Sign in as an admin, open **Demos**, unlock with the promo's `ADMIN_PASSWORD`, open a *ready*
   prospect and press the test call. Allow the microphone.

It is a real GPT-Live-1 session, billed to that OpenAI key. It's tagged as a test, so it doesn't
spend the prospect's demo minutes and is left out of the prospect's numbers.
