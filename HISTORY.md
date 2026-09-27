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

## 2026-09-27 06:40 · bottomup32 · dashboard (phase gates, UI)
- Demo customer: "Start onboarding" → **Request setup** (optional note); they stay in the demo until an admin approves. Operator's demo page: open request with **Approve** / **Decline** (note). Demo › Customers: "Setup requested" filter + badge.
- Accounts › Stage: production is no longer in the select; an account in pre-production shows the Go live checklist (`GET /business/readiness?userId=`) and a **Go live** button. Business page: a pre-production account sees its checklist instead of "Answering calls to …".
- `onOnboarded` removed from `App.tsx` / `DemosView` / `ProspectScreen`. Regression: `fake_backend.py` gains request/decline/go-live/readiness; `demo_customer.py` and `accounts_lifecycle.py` check the new flow.
- ⚠ Demos owner: `Lifecycle.tsx`, `ProspectScreen.tsx` (two lines + `mergeLifecycle`), `CustomerTable.tsx`, `types.ts` (PORTING.md).

## 2026-09-27 06:40 · bottomup32 · transcribe-backend (phase gates, backend)
- DB (self-migrating, additive): `users.onboarding_requested_at`, `onboarding_request_note`, `onboarding_declined_at`, `onboarding_decline_note`, `live_at` (+ probe). One-time backfill: a non-admin `unassigned` account with an assigned number AND a live business profile becomes `production` (today: the one live receptionist customer).
- API: new `POST /demo/customers/:id/request-onboarding` (customer), `POST /demo/customers/:id/decline-request` (admin), `GET /business/readiness` (`?userId` for admin), `POST /auth/users/:id/go-live` (admin; 409 `not_ready` + `unmet`). Customer bodies gain `request`, `declined`, `liveAt`.
- Behaviour changes: demo customers can no longer PATCH their demo (403); `/demo/customers/:id/onboard` is admin-only (= Approve); `/auth/users/:id/status` refuses `production` (409 `use_go_live`); `/business/config` answers `assigned:false, reason:"not_live_stage"` for `demo`/`pre-production` accounts; publishing call settings is 403 for demo accounts.
- ⚠ Michael: production ownership moves to this work (spec `docs/superpowers/specs/2026-09-27-phase-gates-design.md`). Confirm the backfill before deploy; DB backup first. ⚠ Dashboard: "Start onboarding" must become "Request setup" (next commit).

## 2026-09-27 06:10 · bottomup32 · dashboard (call forwarding guide)
- New settings section `forwarding` ("Call forwarding", Go live group) in `src/settings/sections/ForwardingSection.tsx`: missed calls vs every call, dial codes per carrier (AT&T/T-Mobile, Verizon, landline, business phone apps) filled with the assistant's number, turn-off codes, how to test. Routes `#/business/forwarding`, `#/demos/prospects/<id>/forwarding`; `SECTION_IDS` gained `"forwarding"`.
- `SettingsSection.guide?: boolean` — a guide section stays clickable on the read-only demo-customer screen (no disabled fieldset). Launch instructions lost its inline code table; it now links to Call forwarding.
- Frontend only, no API change. `business_tabs.py` checks moved from Launch to Call forwarding.

## 2026-09-27 · bottomup32 · dashboard (settings studio + customer preview)
- `src/settings/SettingsShell.tsx` rewritten as a studio (layout B): grouped menu (Business / Calls / Tuning / Go live, `SECTION_GROUPS`), the section, and a resizable test console, each scrolling on its own under one bar (Save or Publish, Demo › Onboarding › Live stepper). Props `aside`, `toolbar(section)`, `phase`, `readOnly`, `notice`; `narrow` removed. Business Publish moved from each section into the bar (`PublishControl`); the business test call is the console (`useTestCalls` shared with Test & improve).
- Demo page (`ProspectScreen`): tabs outside the card, Test call only in the Settings tab. The demo's own customer now sees ALL sections read-only (no Save, no PATCH) with examples and an example call linking to their `/c/<id>`. New `src/settings/examples.tsx` (start-from-example templates, sample call exchanges, tips) used by admin and customer views.
- Regression: `demo_customer.py` expects the read-only preview; `demos_e2e.py` checks the studio layout and clicks the Settings tab before the test call. All scripts pass (run with `BACKEND_URL=http://127.0.0.1:<harness port>`).
- ⚠ Demos owner: ProspectScreen layout changed (PORTING.md). ⚠ Worktrees: never `git worktree remove` a worktree holding a `node_modules` junction — git follows it and deletes the real packages.

## 2026-09-27 · bottomup32 · transcribe-backend (customer IDs)
- DB (self-migrating): `demo_customers.customer_code` is now `<4 letters from business name>-<seq>` (e.g. `GLHF-0009`, `HMAB-0011`) instead of `CUST-0009`. Set once by trigger `demo_customers_code_guard` on INSERT; any later UPDATE of it raises; renaming the business keeps it. Numbers unchanged.
- The old generated column is converted and existing rows re-coded once on the first request of the new backend (`migrateIfNeeded` now probes for the trigger). The currently deployed backend keeps working with the new schema.
- ⚠ Michael: backend redeploy needed; IDs people already wrote down (`CUST-xxxx`) change once — the number part stays the same. DB backup before deploy.

## 2026-09-27 · bottomup32 · dashboard (dev server)
- `vite.config.ts`: `vite dev` / `vite preview` now rewrite `/c/*` to `c.html`, like `vercel.json`. Before, "Open demo" (`/c/<id>`) opened the dashboard locally. No effect on the deployed build.
- Regression on Windows: run the scripts with `BACKEND_URL=http://127.0.0.1:8899 PYTHONUTF8=1` — the dashboard `.env` otherwise wins over the harness backend, and the cp949 console crashes on "—". With both set, all seven pass.
- ⚠ Michael: the deployed transcribe-backend is behind this branch (`/business/call-settings`, `/demo/customers/:id/onboard`, `/business/test/*` return 404; CORS preflight lacks `PATCH` and `http://localhost:5175`). Local dashboard testing needs the local backend until it is redeployed.

## 2026-09-26 · bottomup32 · transcribe-backend, dashboard (review fixes + phase 2: in-app test calls)
- API (additive): `POST /business/test/session`, `POST /business/test/calls/:id`, `GET /business/test/calls` (recent test calls + monthly allowance), `PUT /business/test/cap` (admin). Env `APP_TEST_SECONDS_PER_MONTH` (default 1800). Test calls use the business's DRAFT call settings; customers are capped per calendar month (business timezone), admins are not.
- Behaviour change: `POST /demo/session` (operator test call) now sends the composed session (rule book + prompts + transfer/link/message blocks + tools) instead of `prompts.live + clock`. The public demo page is unchanged.
- Review fixes: publish re-validates the draft (agent number, waterfall plan flag); waterfall is gated on the account flag at call time and kept-but-off when not allowed; onboarding seeds over an admin-created empty row; the legacy `transfer_number` no longer comes back after publishing "no transfers"; hand-edited greeting prompts are honoured; open/closed reads any time format and overnight hours; duplicate scenario ids/names handled. Dashboard: saving one section no longer wipes other sections' edits; FAQs and Business information save separately; call-settings saves are serialized; a demo customer's Save sends only `CUSTOMER_MAY_EDIT` fields (it used to 403 every time); demo call-sound control restored.
- ⚠ Needs a real browser test call (OpenAI key): confirm the WebRTC data channel delivers delegate `response.event` function calls — the simulator depends on it. If not, the tools are called but nothing answers them.
- ⚠ Demos owner: `useLiveCall` gained `onToolCall`/`reportExtras`; ProspectScreen's test card is `TestCallPanel` (PORTING.md).

## 2026-09-26 · bottomup32 · transcribe-backend, dashboard (receptionist settings + call settings, phases 0–1)
- DB (self-migrating, additive): new `business_call_settings` (draft/published JSONB + `waterfall_allowed`), `app_test_calls`, `call_events`, `sms_consents`; columns `demo_customers.call_settings`, `users.test_seconds_cap`, `inbound_calls.call_sid` (+ unique partial index). Probes added to `migrateIfNeeded`.
- API (additive): `GET/PUT /business/call-settings`, `POST /business/call-settings/publish`, `PUT /business/call-settings/waterfall` (admin), `GET /business/session-preview`, `GET /demo/customers/:id/session-preview` (admin); `PATCH /demo/customers/:id` accepts `callSettings` (400 `{error, field}` on a bad value). New `src/session/` (rule book ported from the phone agent's Python prompt, prompt builder, `composeSession`) — not yet used by any live call. Business prompts are now built by `session/prompts.ts`; onboarding copies demo call settings into the business draft (unpublished) and rebuilds unedited prompts.
- Dashboard: Business page and a demo's page share one settings screen with a left menu (`src/settings/`): Business information, Agent profile, FAQs, Take a message, Appointments (soon), Text a link, Transfer calls, Custom training, Test & improve, Launch instructions. Section is in the URL (`#/business/transfers`). ProspectScreen's Knowledge/Schedule/Prompt tabs → one Settings tab (logged in `src/demos/PORTING.md`). `BusinessTabs.tsx` deleted.
- ⚠ Demos owner: ProspectScreen, KnowledgeEditor, PromptEditor, DemosView and `lib/types.ts` changed (default-preserving props; see PORTING.md). ⚠ Integrator: `/business/config` is unchanged for now — the phone agent still uses its own prompt until phase 3. ⚠ Regression: the dashboard `.env` `BACKEND_URL` overrides the harnesses' backend; run `compare.py`/`tw_probe.py`/`demos_e2e.py` with `BACKEND_URL=http://127.0.0.1:8899` (scripts/regression/README.md).
- ⚠ Security: real Neon credentials had been pasted (uncommitted) into `transcribe-backend/.env.example`; moved out to an ignored local file. Michael: consider rotating that password.

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
