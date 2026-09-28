# HISTORY

Team sync log. **Newest on top.** Only what others need to know — not a changelog of every commit.
Rules: see "Team sync log" in `CLAUDE.md`.

Format:

```
## 2026-09-27 21:30 · bottomup32 · transcribe-backend, openai-agent-app (Appointments on real phone calls)
- `GET /business/config` (agent) gains `business.booking`: `{providerName, kind, title, durationMinutes, horizonDays, instructions}` when the PUBLISHED call settings have booking on AND a readable calendar is connected; otherwise `null`. Additive.
- openai-agent-app (both bridges): with `booking` set, the inbound call gets `check_availability` / `book_appointment` (answered by `POST /business/calendar/agent-tool` with `AGENT_CONFIG_KEY`, the dialled number and the caller's number), `transfer_to_human` reworded, and the rule book's "you cannot book" lines swapped + an Appointments section (`realtime/booking_inbound.py`). Without it the prompt is byte-identical. Check: `python scripts/checks/verify_booking.py`.
- ⚠ Deploy: the phone agent needs `BUSINESS_CONFIG_URL` pointing at the backend whose calendar should be used (staging: `https://va-staging-backend.vercel.app`) and the same `AGENT_CONFIG_KEY` as that backend. Real calls only reach accounts in `production` / `unassigned` stage (phase gates).

## YYYY-MM-DD HH:MM · <name> · <area>
- What changed that affects others (API shape, env var, schema, shared file, port, convention)
- ⚠ Action needed by others, if any
```

---

## 2026-09-27 23:00 · bottomup32 · transcribe-backend, dashboard (customers: research optional, delete a selection)
- `POST /demo/customers` takes `research` (boolean, default true = old behaviour). `false` saves at `status: "ready"` with no run/`researchedAt`; the dashboard badges it "Not researched" and the customer page offers **Run research**. New dialog buttons: **Add customer** (no research) / **Add and research**.
- `DELETE /demo/customers/:id` now answers 409 `code: "has_account"` when a non-demo account is linked; a linked demo-stage account is unlinked and open sign-up requests for it are declined. Customers table: row checkboxes + Delete for the selection.
- Regression: `fake_backend.py` honours `research: false`; `demos_e2e.py` uses "Add and research". Backend 873/873, vitest 310/310, demos_e2e/tw_probe/demo_customer pass, compare IDENTICAL.
- Local dev (Hans): `transcribe-backend/.env.local` now points at Neon branch `staging` (same DB as `va-staging-backend`). Local code self-migrates that DB (additive DDL only).

## 2026-09-27 22:00 · bottomup32 · dashboard (customer page tabs, FAQ editor, studio type size)
- `src/chrome.tsx` studio asks are now counted in `App.tsx` (was a boolean): the customer page's Activity/Sources/Share tabs no longer drop back to the full sidebar + "Demo / Detail" bar after Settings was opened. `setStudio(on)` signature unchanged.
- New `src/settings/sections/FaqEditor.tsx` replaces `KnowledgeEditor sections={["faqs"]}` in the FAQs section (demo, business, public read-only): card per question, growing answer box, reorder, count of 20, search past 6. Inputs are labelled `Question N` / `Answer N` (was `Question` / `Answer`); `business_tabs.py` updated. KnowledgeEditor itself is untouched.
- `.settings-studio` no longer shrinks `ta-body-2`/`ta-label-1`/`ta-headline-2`; its Input/Textarea read at 15px (Input 36px tall); studio nav 14px. Scoped to the studio — transcribe screens and `compare.py` unaffected.

## 2026-09-27 · bottomup32 · transcribe-backend, dashboard (demo → onboarding: sign-up, one approval, sign-in links)
- Public demo page (`/c/<id>`) shows the settings studio read-only ("Editable after setup") and **Request setup** = sign-up (name, email, password, 6-digit email code) → account in `demo`, linked to that demo, request to admin. New entry **`/start`** (`start.html`, `src/start/`): self-service sign-up → new demo → research on screen. Admin approval is the gate on both paths.
- API (dashboard-only): `/auth/signup/claim|start|research`, `/auth/verify[/resend]`, `/auth/forgot`, `/auth/tokens/inspect|accept`, `/auth/me/password`, `/auth/users/:id/invite`, `GET /demo/setup-requests`. `/demo/customers/:id/onboard` and `/auth/users/:id/promote` now share `business/onboard.ts approveOnboarding` (response adds `invite`, `emailed`); `/auth/users/:id/status` → pre-production answers 409 `use_onboard` for a demo-linked account without a profile. Public user adds `signupSource`, `emailVerified`; setup-state adds `mail`, `signup`; public demo read adds `setup`.
- Schema: `users.email_verified_at`, `users.signup_source`, tables `signup_requests`, `auth_tokens`. ⚠ New env: `SMTP_HOST/PORT/USERNAME/PASSWORD/FROM`, `DASHBOARD_URL`, `ADMIN_NOTIFY_EMAIL`, `SIGNUP_RESEARCH_DAILY_CAP` (default 30). Without SMTP: claims wait as admin requests (account made on approve), `/start` is closed. New dep `nodemailer` in transcribe-backend.
- Shared dashboard files: `src/settings/demoSections.tsx` (sections for operator/owner/public), `sections/appointments/AppointmentsRules.tsx` (split from AppointmentsSection), `src/session/token.ts` (token storage), `vercel.json` `/start` rewrite, `vite.config.ts` third input. Regression: new `signup.py`; `public_page.py`, `demos_e2e.py` (badge request allowed), `compare.py` (hides the sidebar Change-password button) updated; all 9 pass, compare IDENTICAL.

## 2026-09-27 · bottomup32 · deploy (Vercel: previews off for non-master branches)
- Set an Ignored Build Step on `transcribe-app-backend`, `tecace-voice-agent-dashboard` and `voice-agent-voicemail-dashboard`: `[ "$VERCEL_GIT_COMMIT_REF" != "master" ]` — only `master` builds; every other branch is skipped. This closes the risk logged below (a pushed branch's preview backend ran on the PRODUCTION DB and would self-migrate it when opened). Production deploys from `master` are unchanged.
- ⚠ Michael: to preview a branch again, remove the step (Project → Settings → Git → Ignored Build Step) or point the backend's Preview `DATABASE_URL` at a Neon branch first. Staging lives on separate projects (`voice-agent-staging`, `va-staging-backend`, Neon branch `staging`), deployed by CLI.

## 2026-09-27 · bottomup32 · transcribe-backend, dashboard (public demo page: settings played out, redesign)
- `/c/<id>` redesigned call first: top bar, call card, "Try saying" cards generated from the demo's call settings, an action feed during the call (transfer ringing, texted link, message, demo-calendar booking — all marked Demo, nothing real), and an after-call summary. The nine-scenarios link/teaser are gone; `/c/<id>/scenarios` shows the demo.
- API: `GET /demo/public/customers/:id` adds `capabilities` (no staff numbers). New `POST /demo/public/tool` (demo calendar; live public call of that demo only). `POST /demo/public/session` is now composed by `composeSession("public-demo")` with transfer/link/message/booking tools. ⚠ New env flag `PUBLIC_DEMO_COMPOSED` (default on; `false` = old stored prompts, no tools).
- Shared: `src/settings/simulator/cards.tsx` (TestCallPanel now uses it; operator wording unchanged); `useLiveCall` returns `callIdNow()`. Tests: backend +7 (compose, calendar, public view, demoCall public tool/flag), dashboard `tests/public-capabilities.test.ts`; `public_page.py` updated.

## 2026-09-27 · bottomup32 · transcribe-backend, dashboard (Appointments: fix + end-to-end tests)
- Fix: `POST /business/calendar/agent-tool` (phone) booked under the DRAFT rules when nothing had ever been published (`calendar.ts` `bookingContext` fell back to the draft). It now uses only the published copy; never published = booking off on the phone. The in-app test tool still uses the draft.
- New `transcribe-backend/src/routes/appointments.e2e.pg.test.ts` (30 tests, fake CalDAV server behind mocked fetch): connect / refuse, target, rules validation, session tools on/off, openings vs busy time, test booking (`[Test]`), phone booking under published rules, tenancy, disconnect. New `tecace-voice-agent-dashboard/tests/appointments-simulator.test.ts` (11 tests).
- Test console events: a refused booking now shows the backend's reason ("Booking refused: No calendar is connected."); a runner that throws logs `booking_failed`.
- Staging deployment (separate from production): Vercel `voice-agent-3-phases` (dashboard) + `va-staging-backend` on Neon branch `staging` (copied from main 2026-09-27). Deployed by CLI from `git archive`; neither project is git-linked. ⚠ No GEMINI_API_KEY there yet (business-description extraction off).

## 2026-09-27 · bottomup32 · dashboard (settings studio B2: full screen, one bar, icon rail)
- New `src/chrome.tsx`: a page can ask for the studio chrome (`useStudioChrome`) and fill the app's top bar (`TopbarMain` / `TopbarEnd`). While asked, `App.tsx` folds the sidebar to a 56px icon rail (`.app[data-nav="rail"]`, the header toggle unfolds it), drops the content padding (`.content-bleed`), and hides the "Demo / Detail" crumbs, the mailbox picker and Refresh. The slots only mount while asked, so every other view's markup is unchanged (`compare.py` IDENTICAL).
- `SettingsShell`: no card; menu 216px with Demo › Onboarding › Live at its foot; content up to 860px; console 380px (resizable), `asideBare` for consoles that draw their own tabs. Toolbar (Save / Publish / saved state) + panel toggle go to the top bar's end. Density: `.settings-studio` narrows `.ta-body-2/.ta-label-1/.ta-headline-2`.
- `TestCallPanel`: tabs Test call / Example call / Events (texts show under the conversation), new props `example`, `footer`, `notice`; orb 40px. Transfers list has column heads (Name / Type / Rings / When / On, container-query based); transfer types and the caller-ID note are plain text.
- Business page: the business card is folded into the top bar (breadcrumb, line-status pill); readiness / not-live notices are one line across the studio. Demo customer's view: same frame, read-only, with one "Request setup" strip. Regression scripts updated (`demos_e2e.py` B2 checks, `business_tabs.py`, `demo_customer.py`); all 8 pass.

## 2026-09-27 · bottomup32 · integration (merge + deploy check)
- Merged `feature/appointments` into Main-Hans (fast-forward, 0978d69). Not merged: `proposal/customer-master-backend` (superseded by the customer-ID and lifecycle work) and `origin/michael/drive_attempt` (Michael's experiment). Backend 517/517 with `SKIP_PROMO_PARITY=1` (parity is pinned to Michael's local promo path; against a local promo clone at HEAD it's 11/12, a pre-existing sync gap). Dashboard 286/286; all 8 regression scripts pass.
- ⚠ Deploy risk: `transcribe-app-backend` (and both dashboards) build a Preview for every pushed branch (no Ignored Build Step), and the backend's `DATABASE_URL` is set for Preview too. Pushing Main-Hans creates a preview backend on the PRODUCTION DB, and its first request runs this branch's self-migrations there (customer-code re-coding, phase-gate backfill, new tables). Previews are behind Vercel SSO, so only a team member opening it triggers this. Don't push Main-Hans until either Preview `DATABASE_URL` is removed/pointed at a Neon branch, or an Ignored Build Step skips non-`master` branches (Michael's call).
- New Vercel project plan: separate backend + dashboard projects, backend `DATABASE_URL` on a Neon branch (not production), dashboard `BACKEND_URL` → new backend, backend `CORS_ORIGIN` → new dashboard URL.

## 2026-09-27 · bottomup32 · dashboard (settings studio, closer to the B mockup)
- Demo page header is one row (business, badges, segmented tabs, operator controls); stat cards moved into the Activity tab; the studio now fits one screen under it.
- Transfers, links and message scenarios: compact rows (coloured type tags, mono numbers) that open their form in place (`InlineEditor`, `ScenarioRow`, `Tag` in `settings/sections/shared.tsx`) instead of a dialog.
- Test console (`settings/simulator/TestCallPanel.tsx`) rewritten: compact call row (44px orb, Call/End, mute) + Transcript / Texts / Events tabs; pending transfer pinned above. Event labels in `simulator/eventLabels.ts`. Aria labels unchanged (`Call now`, `End the call`, `Start a new call`).
- Regression scripts updated (`business_tabs.py` inline form, `demos_e2e.py` console row); all 8 pass. ⚠ feature/appointments: rebase TestCallPanel onto this.

## 2026-09-27 07:30 · bottomup32 · transcribe-backend, dashboard (Appointments: real calendar booking)
- New: the assistant books callers into the business's calendar. Connect in Business › Appointments: **Apple Calendar** (Apple ID + app-specific password, CalDAV), **other CalDAV** (Fastmail, Nextcloud…), **Cal.com** (API key), **Calendly** (personal access token; booking API needs a paid Calendly plan), **Squarespace Scheduling / Acuity** (User ID + API key), **Google Calendar** and **Outlook** (OAuth sign-in). Reservation systems (OpenTable, Resy, Tock, SevenRooms, Toast, Yelp, Eat App, Reserve with Google), Square, Zoho, HubSpot, Zoom/Meet = "Coming soon" (partner-only / own OAuth review).
- DB (self-migrating, additive): `calendar_connections` (one per account, credentials AES-GCM sealed) and `appointment_bookings`; probes added to `migrateIfNeeded` (next to `call_settings`, not at the end). Call settings gain `appointments` {enabled, title, durationMinutes, bufferMinutes, minNoticeMinutes, horizonDays, hours, instructions} — draft/publish like the rest; old rows read as off.
- API (additive): `GET/DELETE /business/calendar`, `POST /business/calendar/connect`, `POST /business/calendar/oauth/start`, `GET /calendar/oauth/{google,microsoft}/callback` (no session; signed state), `GET /business/calendar/targets`, `PUT /business/calendar/target`, `POST /business/calendar/availability`, `POST /business/calendar/tool` (in-app test call; books for real, titled "[Test]"), `POST /business/calendar/agent-tool` (phone agent: `x-agent-key` + dialled `to`, published rules). `composeSession` takes `booking` and adds `check_availability` / `book_appointment`; `callRules({ canBook })` swaps the "you are not the booking system" lines only when booking is on AND a calendar is connected — identical text otherwise.
- ⚠ Michael (deploy): set `CALENDAR_SECRET` (else AUTH_SECRET is used); for Google/Outlook register OAuth apps and set `GOOGLE_CLIENT_ID/SECRET`, `MICROSOFT_CLIENT_ID/SECRET`, `PUBLIC_BACKEND_URL` (redirect URIs in `.env.example`). Without them those two show "Needs setup"; the rest work.
- ⚠ Integrator: the phone agent (openai-agent-app) still has to call `/business/calendar/agent-tool` for the two tools when phase 3 wires composed sessions to real calls. ⚠ Demos owner: `lib/integrations.ts` (`soon` flag) and `SchedulePanel.tsx` ("Coming soon" tag, one line of copy) — PORTING.md. Regression: new `scripts/regression/appointments.py`; `fake_backend.py` gains `/business/calendar/*`.

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
