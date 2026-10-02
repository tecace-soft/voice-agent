# Request go live, and autosave in business settings — design

**Date:** 2026-09-29
**Projects:** `transcribe-backend/`, `tecace-voice-agent-dashboard/`
**Follows:** phase gates (`2026-09-27-phase-gates-design.md`), Twilio numbers phase 1
(`2026-09-28-twilio-numbers-forwarding-design.md`), Launch instructions redesign (HISTORY 2026-09-28 22:10).

> **Status: design approved in chat (2026-09-29).** Autosave in every stage (onboarding and live) was
> chosen over "onboarding only" and over a full draft/publish layer for the text sections.

## Problem

1. **No way to say "I'm done".** Demo → onboarding has a customer request (Request setup) and an admin
   answer (Approve / Decline). Onboarding → live has only the admin's Go live button on Accounts; the
   customer finishes their settings and has nothing to press, and the admin has nothing telling them
   to look.
2. **Two checklists that disagree.** The customer's Launch instructions card builds its own 3-item list
   in `BusinessSettings.tsx`; the strip above the studio (`BusinessPage.tsx` `statusNotice`) shows the
   backend's real readiness, including items only an admin can tick (number, webhooks) as a red ✕.
3. **Explicit Save only.** Business information, Agent profile, FAQs and House rules keep typing in
   memory until Save is pressed; moving away loses it silently.

## What exists (read from the code, 2026-09-29)

- `users` has `onboarding_requested_at / _note`, `onboarding_declined_at / _note` (demo stage only,
  `db/onboarding.ts`) and `live_at` (set by `markLive`).
- `GET /business/readiness` (own, or `?userId` for admin) → `{status, ready, items[]}`; items
  `business_info`, `settings_published`, `number_assigned`, `published_matches_number`,
  `webhooks_configured` (required when the number is Twilio-managed), `contact_number` (advice).
- `POST /auth/users/:id/go-live` (admin, `routes/lifecycle.ts`) re-runs readiness, 409 `not_ready`.
- Admin Accounts › Stage panel `GoLive` (`pages/AccountsPage.tsx`): checklist, Assign a number, Go live.
- Admin sidebar badge: `countSetupRequests()` → `/demo/setup-requests` (demo stage only), on
  Demo › Customers.
- Call-settings sections (Take a message, Text a link, Transfers) already save a draft on every change
  (`makeUpdater`) and go out with Publish. Unchanged by this work.

## Design

### 1. State (backend, additive)

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS live_requested_at    TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS live_request_note    TEXT;  -- ≤ 1000, customer's words
ALTER TABLE users ADD COLUMN IF NOT EXISTS live_declined_at     TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS live_decline_note    TEXT;  -- ≤ 1000, admin's words, shown to the customer
```

Separate from the `onboarding_*` columns on purpose: those are read as "setup requested" by
`openSetupRequests`, the Demos customer bodies and their badge/filter, all keyed on the demo stage.
Probe added to `migrateIfNeeded` like the phase-gates columns.

```
pre-production ──customer: request (customer items ticked)──▶ pre-production + live_requested_at
     ▲                                                              │
     └──admin: not yet (note)───────────────────────────────────────┤
                                                                    └──admin: go live──▶ production (request cleared)
```

Go live does **not** require a request: an admin can still switch a line on unasked (today's path).

### 2. Readiness gets an owner and the request

Each readiness item gains `owner: "customer" | "admin"` (additive):

| id | owner |
|---|---|
| `business_info`, `settings_published`, `contact_number` | customer |
| `number_assigned`, `webhooks_configured`, `published_matches_number` | admin |

(`published_matches_number` can only be judged once the admin has assigned a number; when it fails,
the admin tells the customer what to change — its `detail` says what.)

The response adds `customerReady: boolean` (every required customer item ok), `request:
{requestedAt, note} | null` and `declined: {declinedAt, note} | null`. Both the customer's page and
the admin's Go live panel already read this route, so neither needs a second call.

### 3. Routes

| Route | Who | Does | Refuses |
|---|---|---|---|
| `POST /business/request-live` `{note?}` | the account itself (not an admin acting for it) | `live_requested_at = coalesce(existing, now())`, newest note, clears declined; returns the readiness body | 409 `not_onboarding` unless `pre-production`; 409 `not_ready` `{unmet:[ids]}` unless `customerReady` |
| `POST /auth/users/:id/decline-live` `{note?}` | admin | clears the request, sets declined + note | 409 `no_request` when none is open |
| `POST /auth/users/:id/go-live` (existing) | admin | as today, and `markLive` also clears `live_*` | unchanged |

Each write names the stage it expects in its `WHERE` (the `db/onboarding.ts` pattern). Errors are
`{error, message}`; the dashboard shows `message` in place.

`PublicUser` (`db/users.ts`) gains `liveRequest: {requestedAt, note} | null` so the Accounts list and
the sidebar count need no extra route.

### 4. Dashboard — customer (onboarding)

- **Strip above the studio** (`BusinessPage.tsx` `statusNotice`), rewritten to match the demo's
  Request setup strip (`Lifecycle.tsx` variant `strip`):
  - not ready: "You're being set up. Finish your part, then request go live." + "{n} of {m} done" link
    → Launch instructions.
  - ready, not asked: "Your part is done. Request go live and we'll switch your line on." + **Request
    go live** button.
  - asked: "Go live requested on {date}. We'll assign your number and switch your line on." +
    "Waiting for us" badge.
  - declined: the admin's note ("Not yet: …") + **Ask again**.
  - An admin viewing the account sees the same state, without the button, and "Go live from Accounts".
- **Launch instructions › last card** (`LaunchGuide.tsx` `NextStep`, onboarding): the real readiness
  items, grouped **Your part** (ticks, and a link to the section that fixes each unticked one) and
  **Our part** (number, calls reach the receptionist — never a red ✕, "We do this when you request go
  live"). Footer: the same button/badge/declined state as the strip. `BusinessSettings` stops
  building its own checklist and passes readiness through.
- One dialog, shared by both places: title "Request go live", body "We'll check your setup, assign your
  receptionist's number and switch your line on. You'll then forward your calls to it.", optional note
  ("Anything we should know? For example: start on Monday."), **Send request**.
- Copy: Onboarding stage card `next` → "Moves on when you request go live and we switch your line
  on"; `PHASE_NOTE.onboarding` unchanged.
- After sending, the page re-reads readiness (strip and card change together).

### 5. Dashboard — admin

- Sidebar: **Accounts** gets a count of accounts with an open go-live request (same `nav-count`
  style as Demo › Customers), from `listAccounts()` in `App.tsx`.
- Accounts list: a "Go live requested" pill beside the stage.
- Stage panel `GoLive`: when a request is open, the customer's date and note above the checklist, and
  **Not yet** (dialog with a note) beside **Go live**. The existing Assign a number stays where it is.

### 6. Autosave — business settings (every stage)

Applies to `BusinessSettings.tsx` sections Business information, Agent profile, FAQs and House rules.

- **When:** 1.5 s after the last change in a section, and at once when the person leaves the section
  or the page is hidden (`visibilitychange`). One save per section at a time; a change made while a
  save is in flight queues one more save after it (never two in parallel, never a lost edit).
- **Guard:** no autosave while the section is invalid — Business information with an empty business
  name, an FAQ with a question but no answer (or the reverse). The status then reads "Not saved:
  {reason}". Explicit Save runs the same check. This keeps a live profile from dropping to
  message-taking because a field was cleared mid-edit.
- **Status in place of the old Save row** (`SaveRow`): "Saving…", "Saved · {time}", "Unsaved changes",
  "Couldn't save: {message}" + **Retry**. The Save button stays, labelled **Save now**, disabled when
  nothing is pending.
- **Leaving with a pending or failed save:** `beforeunload` warning. Switching account (admin) flushes
  first.
- **Not autosaved:** the prompt editor in Custom training (saving it marks prompts "edited by hand" and
  freezes them — that stays a deliberate press of Save prompts), Rebuild, and Edit description (re-read
  by the model). Call-settings sections keep draft + Publish.
- Toolbar text "Each section saves on its own" → "Changes save automatically".
- Demo operator pages (`ProspectScreen` page-level Save) are out of scope.

## Testing

- **Backend** (`bun test`, PGlite `*.pg.test.ts`): request refused outside `pre-production` and while
  a customer item is unticked (409 lists them); request idempotent (keeps first date, newest note);
  admin-for-customer cannot request; decline needs an open request; go-live clears the request;
  readiness items carry `owner`, `customerReady`, `request`, `declined`; `PublicUser.liveRequest`.
- **Dashboard unit** (Vitest): autosave debounce, queueing, invalid guard, flush on section change,
  status text; request states of the strip and card.
- **Regression:** `fake_backend.py` gains the routes and fields; `business_tabs.py` covers autosave
  (type → "Saved" without pressing Save; empty name → "Not saved") and the request flow (not ready →
  ready → requested → declined → ask again); `accounts_lifecycle.py` covers the badge, the pill, Not
  yet and Go live clearing the request. All regression scripts one at a time; `compare.py` IDENTICAL.

## Rollout

- Changelog: today's entry (0.0.11) — new "Request go live when your setup is done"; improved
  "Settings save as you type"; admin line "Go live requests on Accounts, with Not yet".
- ⚠ HISTORY: new `users.live_*` columns, `POST /business/request-live`, `POST /auth/users/:id/decline-live`,
  readiness `owner` / `customerReady` / `request` / `declined`, `PublicUser.liveRequest`, autosave
  (text sections now reach live callers ~1.5 s after typing stops).
- No `openai-agent-app` or `transcribe-app` change.

## As built (2026-09-29)

- `liveRequestFor` / `requestLive` / `declineLive` live in `db/onboarding.ts` next to the demo-stage
  request (the plan had the read in `db/readiness.ts`).
- `Readiness` / `ReadinessItem` types moved to the dashboard's `src/api/types.ts`: Launch instructions
  is shared with the public demo page, which must not import `api/backend.ts`
  (`tests/public-entry.test.ts`).
- Autosave core is `src/settings/autosave.ts` (pure, unit-tested), the hook `useAutosave.ts`, rules in
  `sectionChecks.ts`. Profile saves are queued so Business information and FAQs never lay their part
  over a stale profile. `BusinessSettings` is keyed by account; a waiting change is saved on unmount,
  before Re-read / Edit description, on section change and when the tab is hidden.
- Autosaved sections keep their own draft (a save no longer copies the server's normalised value back
  into the form), so typing during a save is never overwritten.

## Out of scope

Email/SMS notification of a request (no mail sender); a draft/publish layer for the text sections;
autosave on demo operator pages; payment.
