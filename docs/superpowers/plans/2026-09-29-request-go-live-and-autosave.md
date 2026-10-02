# Request go live + autosave — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An onboarding customer can ask for their line to go live (admin answers Go live / Not yet), and business settings save as you type.

**Spec:** `docs/superpowers/specs/2026-09-29-request-go-live-and-autosave-design.md`

**Architecture:** Backend keeps the request as four nullable `users.live_*` columns (the `onboarding_*` pattern), exposes it on the readiness body and on `PublicUser`, with one customer route and one admin route. The dashboard reads readiness in one place (`BusinessPage`) and hands it to the strip and to Launch instructions; one `RequestGoLive` component draws the button/dialog/state in both. Autosave is a small hook (`useAutosave`) wrapped around each text section's existing save function.

**Tech Stack:** Bun + Elysia + Postgres (PGlite in tests); React + TS + Vite, shadcn under `.tw`, Vitest; Python Playwright regression against `fake_backend.py`.

---

## File map

| File | Change |
|---|---|
| `transcribe-backend/src/db/client.ts` | 4 `ALTER TABLE users ADD COLUMN` + probe |
| `transcribe-backend/src/db/onboarding.ts` | `requestLive`, `declineLive`; `markLive` clears `live_*` |
| `transcribe-backend/src/db/users.ts` | COLUMNS + `UserRecord` + `PublicUser.liveRequest` |
| `transcribe-backend/src/business/readiness.ts` | `owner` on items, `customerReady` |
| `transcribe-backend/src/db/readiness.ts` | `requestStateFor(userId)` |
| `transcribe-backend/src/routes/business.ts` | readiness body + `POST /business/request-live` |
| `transcribe-backend/src/routes/lifecycle.ts` | `POST /auth/users/:id/decline-live` |
| `transcribe-backend/src/business/readiness.test.ts`, `routes/customerLifecycle.pg.test.ts` | tests |
| `tecace-voice-agent-dashboard/src/api/backend.ts`, `api/types.ts` (AuthUser) | types + `requestGoLive`, `declineGoLive` |
| `tecace-voice-agent-dashboard/src/settings/sections/RequestGoLive.tsx` | **new**: button + dialog + state |
| `tecace-voice-agent-dashboard/src/settings/sections/LaunchGuide.tsx` | onboarding NextStep from readiness |
| `tecace-voice-agent-dashboard/src/settings/BusinessSettings.tsx` | pass readiness; autosave |
| `tecace-voice-agent-dashboard/src/settings/useAutosave.ts` | **new**: debounce/queue/guard hook |
| `tecace-voice-agent-dashboard/src/settings/SettingsShell.tsx` | `SaveRow` shows autosave status |
| `tecace-voice-agent-dashboard/src/pages/BusinessPage.tsx` | strip rewritten, readiness passed down |
| `tecace-voice-agent-dashboard/src/pages/AccountsPage.tsx` | request note, Not yet, pill |
| `tecace-voice-agent-dashboard/src/App.tsx`, `components/Sidebar.tsx` | Accounts badge |
| `tecace-voice-agent-dashboard/tests/*` | autosave + request tests |
| `tecace-voice-agent-dashboard/scripts/regression/fake_backend.py`, `business_tabs.py`, `accounts_lifecycle.py` | routes/fields + checks |
| `tecace-voice-agent-dashboard/src/changelog.ts`, `package.json`, `package-lock.json` | 0.0.11 |
| `HISTORY.md` | entry on top |

---

### Task 1: Backend state and readiness shape

- [ ] Write failing tests in `business/readiness.test.ts`: every item has `owner`; `business_info`/`settings_published`/`contact_number` are `customer`, the rest `admin`; `customerReady` is true when profile live + published even with no number, false when unpublished.
- [ ] Run `bun test src/business/readiness.test.ts` → FAIL.
- [ ] Add `owner: "customer" | "admin"` to `ReadinessItem`, set it on each item, add `customerReady` to `Readiness`:
  ```ts
  const customerReady = items.every((i) => i.owner !== "customer" || i.ok || !i.required);
  return { ready: ..., customerReady, items };
  ```
- [ ] Columns in `db/client.ts` after `live_at`:
  ```ts
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS live_requested_at TIMESTAMPTZ`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS live_request_note TEXT`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS live_declined_at TIMESTAMPTZ`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS live_decline_note TEXT`;
  ```
  and probe `SELECT live_requested_at, live_declined_at FROM users LIMIT 1`.
- [ ] `db/onboarding.ts`: `requestLive(userId, note)` (`WHERE status='pre-production'`, coalesce first date, newest note, clear declined), `declineLive(userId, note)` (`WHERE status='pre-production' AND live_requested_at IS NOT NULL`), `markLive` also nulls the four columns.
- [ ] `db/users.ts`: COLUMNS gain `live_requested_at AS "liveRequestedAt", live_request_note AS "liveRequestNote"`; `PublicUser.liveRequest: {requestedAt, note} | null`.
- [ ] `db/readiness.ts`: `liveRequestFor(userId)` → `{request, declined}` read from `users`.
- [ ] Run `bun test src/business/readiness.test.ts` → PASS; `bun run typecheck`.

### Task 2: Backend routes

- [ ] Failing tests in `routes/customerLifecycle.pg.test.ts` › "readiness and Go live", after "is an admin's door":
  - customer request before publishing → 409 `not_ready`, `unmet` = `["settings_published"]`;
  - admin (acting with `?userId`) cannot request for them → 403;
  - after publishing: request 200, readiness `request.note` set, `customerReady` true, `ready` false;
  - request again keeps `requestedAt`, takes new note;
  - `/auth/users` list shows `liveRequest` for dana;
  - admin `decline-live` with note → readiness `declined.note`, `request` null; second decline → 409 `no_request`;
  - customer declines → 403; ask again clears declined;
  - existing Go live test: afterwards `request` and `declined` are null; request from production → 409 `not_onboarding`.
- [ ] Run → FAIL.
- [ ] `routes/business.ts`: readiness GET spreads `await liveRequestFor(target)`; `POST /request-live` `{note?: string ≤ 1000}` — `authenticate`, refuse admin (`403 own_account_only`), refuse non-`pre-production` (409 `not_onboarding`), refuse `!customerReady` (409 `not_ready` with `unmet` customer ids), `requestLive`, return the readiness body.
- [ ] `routes/lifecycle.ts`: `POST /:id/decline-live` `{note?}` admin only → `declineLive` or 409 `no_request`; returns `{user}`.
- [ ] Run `bun test src/routes/customerLifecycle.pg.test.ts` → PASS; full `bun test`; `bun run typecheck`.

### Task 3: Dashboard API + request component

- [ ] `api/backend.ts`: `ReadinessItem.owner`, `Readiness.customerReady/request/declined`; `requestGoLive(note?)`, `declineGoLive(id, note?)`. `AuthUser.liveRequest?`.
- [ ] New `settings/sections/RequestGoLive.tsx`: props `{readiness, canRequest (false for an admin viewing), onChanged, variant: "strip" | "card"}`. States: not ready → "{n} of {m} done" (strip) / nothing (card); ready → **Request go live** button; requested → "Waiting for us" badge + date; declined → "Not yet: note" + **Ask again**. Dialog: title "Request go live", optional note (max 1000), **Send request**, errors shown in the dialog.
- [ ] Vitest `tests/requestGoLive.test.tsx`: each state renders its text/button; sending calls `requestGoLive` with the note and then `onChanged`.

### Task 4: Customer screens

- [ ] `BusinessPage.tsx`: `statusNotice` for onboarding becomes the strip (`RequestGoLive variant="strip"`), with the stage line; admin viewing sees state without button plus "Go live from Accounts". Pass `readiness` and `onReadinessChanged={() => load(true)}` to `BusinessSettings`.
- [ ] `BusinessSettings.tsx`: new props `readiness`, `canRequestLive`, `onReadinessChanged`; LaunchGuide gets `readiness` + `requestSlot` instead of the hand-built checklist.
- [ ] `LaunchGuide.tsx` onboarding `NextStep`: "Your part" (customer items; unticked link to `business-info` / `transfers`) and "Our part" (admin items, neutral dot, "We do this when you request go live", ticked when ok); footer = `requestSlot`. Stage card copy "Moves on when you request go live and we switch your line on".

### Task 5: Admin screens

- [ ] `AccountsPage.tsx` `GoLive`: when `readiness.request`, a line "Go live requested {date}" + note; **Not yet** button → small inline form with note → `declineGoLive` → reload. Row pill "Go live requested" where `user.liveRequest`.
- [ ] `App.tsx`: admin count of `listAccounts()` with `liveRequest`, passed to `Sidebar` as `liveRequests`; Sidebar shows `nav-count` on the Accounts item.

### Task 6: Autosave

- [ ] Vitest `tests/useAutosave.test.ts` (fake timers): no save before 1.5 s; one save after; change during in-flight save → exactly one more save after it; invalid → no save, status `invalid` with reason; `flush()` saves at once; error → status `error`, `retry()` saves.
- [ ] New `settings/useAutosave.ts`:
  ```ts
  export type AutosaveStatus = "idle" | "pending" | "saving" | "saved" | "invalid" | "error";
  export function useAutosave(opts: { value: unknown; save: () => Promise<void>; validate?: () => string | null; delay?: number; enabled?: boolean })
    : { status: AutosaveStatus; message: string | null; savedAt: Date | null; flush: () => Promise<void>; retry: () => void }
  ```
  Skips the first render and any value equal (JSON) to the last saved value.
- [ ] `BusinessSettings.tsx`: `run()` gains a `quiet` mode (no `saved`/`saving` page-level flags) used by autosave; one `useAutosave` per section (knowledge, faqs, agent, rules); validators: business name required; FAQ rows need both question and answer. Section change flushes (`onSection` wrapper); `beforeunload` while any is pending/saving/error. Toolbar text "Changes save automatically".
- [ ] `SaveRow` takes `status`/`message`/`savedAt`/`onRetry`; shows "Saving…", "Saved · 3:04 PM", "Unsaved changes", "Not saved: …", "Couldn't save: … Retry"; button "Save now" disabled when nothing pending. Demo pages don't use SaveRow (check with grep) — keep old props working if they do.
- [ ] `npm test`, `npm run typecheck`.

### Task 7: Regression, changelog, HISTORY

- [ ] `fake_backend.py`: readiness `owner`/`customerReady`/`request`/`declined`, `POST /business/request-live`, `POST /auth/users/<id>/decline-live`, `liveRequest` on users; go-live clears.
- [ ] `business_tabs.py`: autosave (type in Business information, wait, "Saved" without pressing Save; clear name → "Not saved"); request flow on the strip and Launch instructions. `accounts_lifecycle.py`: pill, Not yet, Go live clears. Fix any selector the Save → autosave change broke in other scripts.
- [ ] Run every regression script one at a time (`compare.py` IDENTICAL).
- [ ] Changelog 0.0.11 (today) + `package.json`/`package-lock.json`; `npx vitest run tests/changelog.test.ts`.
- [ ] HISTORY.md entry on top (English, ⚠ for autosave reaching live callers and the new routes/columns).
- [ ] Commit only when the user asks.
