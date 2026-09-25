# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Team sync log (`HISTORY.md`) — required

Several people work in this repo in parallel. After any change others must know about, **add an entry at the top of [HISTORY.md](HISTORY.md)** (newest first, never append at the bottom, never rewrite others' entries).

- Log only sync-worthy items: API route/body changes, DB schema/migrations, env vars, shared files/components, ports, conventions, PORTING.md syncs, anything that could cause a merge conflict or break another app. Skip typo fixes and internal refactors.
- **Write entries in English** (not everyone on the team reads Korean).
- Keep it short: header `## YYYY-MM-DD HH:MM · <name> · <area>`, then 1–4 bullets. Prefix required follow-ups with `⚠`.
- Read the latest HISTORY.md entries before starting work, and before merging.
- Commit the HISTORY.md entry together with the change it describes.

Roles:
- **Demos owner** — works mainly in `tecace-voice-agent-dashboard/src/demos/`. If a change needs something outside that folder (`transcribe-backend/src/demo/`, `src/routing.ts`, styles, `api/`), log it with `⚠` for the integrator.
- **Integrator** — merges and integrates the whole repo. When merging, reconcile HISTORY.md (keep all entries, re-sort newest-first) and log the merge itself if it changed behaviour.

## Workspace shape

Monorepo-style workspace: each top-level directory is a **self-contained app** (own deps, `.env`, README) sharing one git history. There is no root build/test tooling — `cd` into an app and follow its README. `.env` files are git-ignored and per-machine (see each app's `.env.example`).

| Dir | Stack | Role |
|---|---|---|
| `voice-agent-app/` | Python | Original voice intake agent (Retell-era; Twilio inbound + Google Form poll, Cal.com booking) |
| `openai-agent-app/` | Python | Same lead-callback agent on OpenAI Realtime + Twilio; reuses `backend-app` tools over HTTP. Two processes: `scripts/run_server.py` (call audio) + `scripts/run_poller.py` (who to call) |
| `backend-app/` | Bun + Elysia | Shared API for the intake/booking system (Cal.com, Retell tools/webhook, email, Postgres) |
| `form-app/`, `admin-dashboard-app/` | React + Vite | Lead intake form; admin dashboard for `backend-app` |
| `transcribe-app/` | Python | Voicemail pipeline: IMAP `.wav` → Whisper → Claude extraction → Google Sheet; reports each run to `transcribe-backend` (`scripts/run_poller.py` long-running, `run_transcribe.py` one pass) |
| `transcribe-backend/` | Bun + Elysia + Postgres | Backend for transcribe metrics, auth/accounts, business profiles, call minutes, and the `/demo/*` routes (demo prospects/CRM/test call/research) |
| `transcribe-dashboard-app/` | React + Vite | **Original** transcribe dashboard — kept as the baseline the combined dashboard is regression-compared against |
| `tecace-voice-agent-dashboard/` | React + Vite + TS | **Current combined dashboard**: transcribe screens + admin-only Demos section, single sign-in against `transcribe-backend` |
| `deploy/` | systemd | Host-level VPS units (docker stats sampler) |

Design specs/plans live in `docs/superpowers/{specs,plans}/`. Note `docs/superpowers/combined-dashboard-deployment.md` predates the move of demo data into transcribe-db (it still describes a `/promo-api` proxy and `VITE_PUBLIC_DEMO_BASE_URL`); trust `tecace-voice-agent-dashboard/CLAUDE.md` and README over it.

## Commands

Bun apps (`backend-app`, `transcribe-backend`): `bun install`, `bun run dev` (watch), `bun run typecheck`, `bun run db:migrate`. `transcribe-backend` also has `bun test` (single file: `bun test src/auth/auth.test.ts`), `db:clear`, `demo:import`, and `auth` (account CLI). Schema self-migrates on first request.

Vite apps (`form-app`, `admin-dashboard-app`, `transcribe-dashboard-app`, `tecace-voice-agent-dashboard`): `npm|bun run dev`, `build` (= `tsc --noEmit && vite build`), `typecheck`. Only `tecace-voice-agent-dashboard` has tests: `npm test` (Vitest; one file: `npx vitest run tests/styles.test.ts`) and `npm run gen:preflight`. Dev port there is 5175.

Python apps: per-app venv, `pip install -e .`, then run scripts under `scripts/`. `scripts/checks/verify_*.py` are connectivity/content checks against real services (no pytest suite).

## Combined dashboard (`tecace-voice-agent-dashboard`) — read its CLAUDE.md first

Non-obvious constraints that span many files:
- **Two styling systems** isolated by CSS cascade layers: transcribe screens = hand-rolled CSS; promo/Demos screens = Tailwind v4 + shadcn scoped under `.tw` (`@scope`). Don't mix classes; promo vars are `--ui-*`; portals must target a `.tw` container. `src/styles/ui-preflight.css` is generated.
- `src/demos/` is a **verbatim port** of the external `voiceagent_promo` repo @ f482848; every deviation is logged in `src/demos/PORTING.md` (and `transcribe-backend/src/demo/PORTING.md`). Keep the logs current.
- Demo API bodies must keep matching the promo's `/api/admin/*` shapes since the screens parse them as-is; `demoFetch` returns a raw `Response`.
- Prospect page `/c/<id>` is a **second entry document** (`c.html` → `src/public/`); nothing under `src/public/` may import dashboard auth (enforced by `tests/public-entry.test.ts`).
- New views need a `PATHS` entry in `src/routing.ts`.
- UI/style/chart work must follow the `tecace-dashboard-ui` skill (brand blue #116DFF, sentence case, tokens not hex). The same rules apply to `admin-dashboard-app` and `transcribe-dashboard-app` (plain CSS only, no Tailwind migration).
- Regression after styling changes: `npm test`, then Python scripts in `scripts/regression/` (`compare.py` must print `IDENTICAL`, plus `tw_probe.py`, `demos_e2e.py`, `business_tabs.py`, `public_page.py`, `accounts_lifecycle.py`, `demo_customer.py`). Run them **one at a time** — they share ports; they run against `fake_backend.py`.
- Test call and research runs are real, billable OpenAI calls gated by `OPENAI_API_KEY` on `transcribe-backend`.
