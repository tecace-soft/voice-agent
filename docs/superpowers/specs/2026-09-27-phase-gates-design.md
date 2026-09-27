# Phase gates: demo → onboarding → production — design

**Date:** 2026-09-27
**Projects:** `transcribe-backend/`, `tecace-voice-agent-dashboard/`
**Follows:** the customer lifecycle v2 work (CUST ids, `phase`, self-onboarding; HISTORY 2026-09-25) and
the receptionist settings / call settings work (HISTORY 2026-09-26).
**Sub-project A of two.** Sub-project B (production dashboard: receptionist call analytics, call list
with transcripts, phase-specific navigation) gets its own spec after this one lands.

> **Status: design approved in chat (2026-09-27), awaiting written-spec review.**

## Goal

Make each phase mean something, and make the moves between them deliberate:

| Phase | `users.status` | Customer can | Who moves it on |
|---|---|---|---|
| Demo | `demo` | Look at their receptionist. **Nothing is editable.** Ask to set it up. | Customer requests → **admin approves** |
| Onboarding | `pre-production` | Edit every settings section, publish call settings, run in-app test calls | **Admin "Go live"**, only when the readiness checklist passes |
| Production | `production` | Same as onboarding, and the phone line answers | — |

Payment is out of scope (manual / external). Buying Twilio numbers through the Twilio API is out of
scope: an admin registers and assigns a number on the existing Numbers page, as today.

Decided with the user 2026-09-27: demo fully read-only; request + admin approval; admin Go live
behind a checklist; transcripts, not audio recordings (sub-project B).

## What exists today (read from the code, 2026-09-27)

- `users.status` ∈ `unassigned | demo | pre-production | production` (CHECK in `db/client.ts`).
  `phaseOf` (`db/customerLifecycle.ts`) maps `pre-production → onboarding`, `production →
  production`, anything else → `demo`.
- Only `demo` changes access (`authenticateDemo` scope `own`). Nothing distinguishes
  `pre-production` from `production`.
- A demo-stage customer **can edit** today: `CUSTOMER_MAY_EDIT` in `routes/demo.ts` allows
  `profile, prompts, regeneratePrompts, agentName, voice, language, callSound`, and ProspectScreen
  shows them a Save button.
- `POST /demo/customers/:id/onboard` lets the customer move themselves to `pre-production`
  (`startOnboarding` in `business/promote.ts`: copy demo → business profile, seed the call-settings
  draft, set status). No approval.
- Production is reached only through the admin's generic Stage select (`POST /auth/users/:id/status`),
  with no checks.
- `GET /business/config` (the phone agent's lookup) answers for any assigned number with a live
  profile. **It never reads `users.status`**, so an onboarding customer with a number is live.
- `POST /business/call-settings/publish` is not phase-gated.

**Production data (Neon copy `hans-local-test`, read-only query 2026-09-27):** 7 accounts, all
`unassigned` (5 admins, 2 users). The one account with an assigned number and a live profile is
`unassigned` and took 70 calls in the last 30 days. Any gate keyed on `status = 'production'` alone
would cut that customer off.

## Design

### 1. State (backend, additive)

Status keeps its four values. The request is a sub-state of `demo`, stored as timestamps on `users`:

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_requested_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_request_note TEXT;   -- ≤ 1000 chars, customer's words
ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_declined_at  TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_decline_note TEXT;   -- admin's words, shown to the customer
ALTER TABLE users ADD COLUMN IF NOT EXISTS live_at TIMESTAMPTZ;            -- set by Go live
```

Plus probes in `migrateIfNeeded`. No CHECK change, so the deployed backend keeps working against the
new schema.

Derived for API bodies (never stored): `request: null | { requestedAt, note }` and
`declined: null | { declinedAt, note }` on the demo customer body next to `phase`, and on the user
body the dashboard already reads (`/auth/me`).

**One-time backfill** (idempotent, in `initDb`): an `unassigned` non-admin user who has an assigned
agent number **and** a live business profile becomes `production` with `live_at = now()`. On today's
data that is exactly the one live customer. Rerunning finds nothing.

```
demo ──customer: request──▶ demo + requested_at
  ▲                              │
  └──admin: decline (note)───────┤
                                 └──admin: approve (= startOnboarding)──▶ pre-production
pre-production ──admin: go live (checklist passes)──▶ production (+ live_at)
```

### 2. Routes

| Route | Who | Does | Refuses |
|---|---|---|---|
| `POST /demo/customers/:id/request-onboarding` `{note?}` | demo customer (own) | sets `onboarding_requested_at = coalesce(existing, now())`, note, clears declined | 409 if not `demo`; 404 not theirs |
| `POST /demo/customers/:id/decline-request` `{note?}` | admin | clears requested_at, sets declined_at + note | 409 if no open request |
| `POST /demo/customers/:id/onboard` (existing) | **admin only now** (was customer too) — this is "Approve" | unchanged (`startOnboarding`, CRM stage `won`), and clears requested_at | unchanged (409/422) |
| `GET /business/readiness` (`?userId` for admin) | own customer or admin | the checklist below | — |
| `POST /auth/users/:id/go-live` `{force?: false}` | admin | re-runs readiness; all required pass → status `production`, `live_at = now()` | 409 `{error:"not_ready", unmet:[ids]}`; 409 if not `pre-production` |
| `POST /auth/users/:id/status` (existing) | admin | `production` is **refused** here (409 `use_go_live`); other values unchanged | — |

Readiness checklist (`business/readiness.ts`, one pure function over profile + number + call
settings, unit-tested):

| id | Check | Required |
|---|---|---|
| `business_info` | business profile is live (`IS_LIVE`: name + facts) | yes |
| `settings_published` | `business_call_settings.published` exists | yes |
| `number_assigned` | an agent number is assigned to the account | yes |
| `published_matches_number` | the published settings validate against the assigned number (the check publish already runs) | yes |
| `contact_number` | the business has a phone / transfer number on file | no — warning |

Response: `{ ready: boolean, items: [{ id, ok, required, label, detail? }] }`. Labels are sentence
case English, shown as-is by the dashboard.

### 3. Gates

- **Demo read-only.** `CUSTOMER_MAY_EDIT` becomes empty: every `PATCH /demo/customers/:id` from a
  demo-scoped customer is 403 `{error:"read_only", message:"Your receptionist can be changed once
  it is being set up."}`. Admin edits are unchanged. `callSettings` PATCH from a customer: same 403.
- **Phone line.** `/business/config` answers `{assigned:false, reason:"not_live_stage"}` when the
  number's account is `demo` or `pre-production`. `unassigned` and `production` behave as today.
  (Onboarding customers test in the app, not on the line.)
- **Publish.** `POST /business/call-settings/publish` from a `demo` account → 403. Onboarding,
  production and admins unchanged.
- **Assigning a number** does not change status (unchanged); it is one checklist item.

### 4. Dashboard

Chosen to stay out of `src/settings/` and `ProspectScreen.tsx`: session voice-agent-92 is reworking
both (2026-09-27) and its version already makes the demo customer read-only (no Save, sections as
previews, a disabled fieldset, a Demo › Onboarding › Live stepper). This work rebases onto that
commit and adds no second read-only wrapper.

- **Demo customer (ProspectScreen, `operator=false`)**
  - Read-only UI: done by the settings rework. This spec adds the backend 403 behind it.
  - `Lifecycle.tsx`: `StartOnboarding` becomes `RequestSetup` — card "Want this for your business?"
    → dialog with an optional note → `POST …/request-onboarding`. After: "Requested on {date} — we'll
    be in touch." If declined: the admin's note and the button again.
- **Onboarding customer (Business page)**: a readiness card above the settings, from
  `GET /business/readiness` — required items ticked or not, the warning item, and "Your
  administrator will switch the line on when everything is ticked." (Wiring the existing Launch
  section to the same data waits until the settings rework lands.)
- **Admin — Demo › Customers (`CustomerTable.tsx`)**: phase filter gains "Requested"; a
  "Requested" badge next to the phase badge. A few lines, logged in PORTING.md.
- **Admin — ProspectScreen (`operator=true`)**: when a request is open, a card with the note and
  **Approve** (→ `/onboard`) / **Decline** (dialog with note) — inside `Lifecycle.tsx`.
- **Admin — Accounts › Stage panel**: the readiness list for that account and a **Go live** button,
  disabled until ready; the Stage select no longer offers production (it would 409).
- UI follows the `tecace-dashboard-ui` skill; promo-side markup stays inside `.tw`.

### 5. Errors

Every refusal is a 4xx with `{error, message}` and the dashboard shows `message` in place (dialog or
card), never a silent failure. Go live's 409 lists unmet items by id and the panel ticks them.

### 6. Testing

- Backend (`bun test`, PGlite `*.pg.test.ts` pattern): request idempotent / not-demo 409 / not-own
  404; decline; approve admin-only (customer now 403); readiness each item on and off; go-live 409
  lists unmet, passes when ready, refuses non-`pre-production`; `/status` refuses production;
  `/business/config` `not_live_stage` for demo and pre-production, unchanged for `unassigned` and
  `production`; demo PATCH 403; publish 403 for demo; backfill converts exactly the numbered+live
  `unassigned` user and is a no-op on rerun.
- Dashboard: `npm test`, typecheck; `fake_backend.py` gains the new routes and fields;
  `demo_customer.py` updated (no Save, request flow, declined state), `accounts_lifecycle.py`
  (Go live disabled until ready, production not in Stage select); `demos_e2e.py` (Requested filter,
  Approve/Decline). All seven regression scripts, one at a time, with
  `BACKEND_URL=http://127.0.0.1:8899 PYTHONUTF8=1`.

### 7. Rollout

- ⚠ HISTORY entry: new columns, routes, the `/onboard` permission change, `/status` refusing
  production, `/business/config` `not_live_stage`, the backfill.
- ⚠ Michael: production ownership moves here (this spec). Backend redeploy + DB backup before it;
  the backfill flips the one live customer to `production` — confirm before deploy.
- Work happens on branch `feature/phase-gates` in its own git worktree, rebased onto the other
  sessions' commits before merging back to `Main-Hans`: customer IDs (`51b472a`, done — keep its
  `demo_customers_code_guard` probe at the end of `migrateIfNeeded`, never write `customer_code` /
  `customer_seq`) and the settings rework (voice-agent-92). Backend first (no overlap), dashboard
  after the settings rework is committed.

## Out of scope

Payment / plan selection; Twilio API number purchase and webhook setup; email notifications (no mail
sender in transcribe-backend); audio recordings; the production dashboard (sub-project B).
