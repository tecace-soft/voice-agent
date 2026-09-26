# HISTORY

Team sync log. **Newest on top.** Only what others need to know — not a changelog of every commit.
Rules: see "Team sync log" in `CLAUDE.md`.

Format:

```
## YYYY-MM-DD HH:MM · <name> · <area>
- What changed that affects others (API shape, env var, schema, shared file, port, convention)
- ⚠ Action needed by others, if any
```

---

## 2026-09-25 · bottomup32 · transcribe-backend DB access (local dev)
- Decided: test the customer-lifecycle branch locally against the PRODUCTION transcribe DB (not a Neon branch). The first request from the local backend will run the self-migration there (adds `demo_customers.customer_seq` / `customer_code`, backfills CUST- numbers). Additive; the deployed backend ignores the new columns.
- Blocked: `transcribe-app-backend` is not in bottomup32's Vercel account, so `vercel env pull` can't fetch `DATABASE_URL`; no `.env` with it exists on this machine.
- ⚠ Michael: please share the production `DATABASE_URL` (or add bottomup32 to the Vercel project), and OK the migration above. A `pg_dump` backup will be taken before connecting.
- ⚠ While connected, "Start onboarding" changes real accounts — test only with a test account.

## 2026-09-25 · bottomup32 · transcribe-backend, dashboard demos (customer lifecycle)
- DB: `demo_customers` gains `customer_seq` (sequence `customer_code_seq`) + generated `customer_code` (`CUST-0001`). Existing rows backfilled once by `created_at` on first request (self-migrating `initDb`). Permanent, never reused.
- API (additive): every `/demo` customer body now carries `customerCode`, `phase` (`demo`/`onboarding`/`production`, derived from the linked account's `users.status`) and `accountEmail`. New `POST /demo/customers/:id/onboard` — a demo-stage customer moves themselves to onboarding (copy demo → business info, status `pre-production`, CRM stage `won`). `/auth/users/:id/promote` now shares `startOnboarding` in `business/promote.ts`; behaviour unchanged.
- Dashboard: Demo › Customers shows ID + Phase columns/filter; the customer's "My receptionist" page has "Start onboarding"; `useAuth().refresh()` added. No new menus/routes.
- ⚠ Michael: backend change (schema + new route) — please review before deploy; take a DB backup first. Production (number assignment) remains yours; phase `production` is display-only here.

## 2026-09-25 · bottomup32 · deploy (dashboard)
- https://voice-agent-voicemail-dashboard.vercel.app currently serves the OLD `transcribe-dashboard-app` (title "Transcribe Dashboard", no Demo code). It was redeployed ~20:37 GMT, likely by a git auto-deploy from the wrong root directory. Backend is fine (`/demo/*` routes live).
- ⚠ Vercel project settings: Root Directory → `tecace-voice-agent-dashboard`; env `BACKEND_URL=https://transcribe-app-backend.vercel.app`; redeploy.
- ⚠ For local dev against the deployed backend, add `http://localhost:5175` to transcribe-backend's `CORS_ORIGIN` on Vercel.
- Only transcribe-backend touches the DB (`DATABASE_URL`). The old and new dashboards both reach it through `BACKEND_URL`; neither needs DB env.

## 2026-09-25 · bottomup32 · workspace
- Added root `CLAUDE.md` and this `HISTORY.md`. From now on, log sync-worthy changes here (newest on top).
- Roles: demos owner edits `tecace-voice-agent-dashboard/src/demos/`; integrator merges/integrates the whole repo.

## 2026-09-24 · Michael Knutsen · transcribe-backend, dashboard
- Business info (Knowledge/Prompt) migrated to follow the demo's knowledge + prompt model; Business page saves to `/business/knowledge`, `/business/prompts`.
- Dashboard browser tab icon updated.

## 2026-09-22 ~ 09-23 · Michael Knutsen · transcribe-backend, dashboard demos
- Demo data moved from promo Redis into transcribe-db `demo_*` tables, served at `/demo/*` (admin session). `/promo-api` proxy and promo password removed.
- Demo test call wired (`POST /demo/session`, `/demo/calls/:id`); needs `OPENAI_API_KEY` on transcribe-backend.
- `/usage/*` minutes accept a date range.
