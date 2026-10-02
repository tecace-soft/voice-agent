# Call summary emails — design

Date: 2026-10-02 · Status: approved in conversation, awaiting spec review

## Goal

A business can switch on an option in the combined dashboard so that after every call the
receptionist answers, a short summary of the call is emailed to the account's registered email,
with a link to the full transcript in the dashboard.

## Decisions

- **Where:** a new **Call emails** section in Business settings, in the *Calls* menu group
  (next to Take a message / Transfers). Admins can set it on a user's behalf like every other section.
- **Content:** summary + key fields + link. The full transcript stays in the dashboard.
- **Default:** off for existing and new accounts (opt-in).
- **Recipient:** `users.email` of the call's owner. One user = one business today, so there is
  exactly one recipient; no address field.
- **Scope:** inbound receptionist calls only — those are the calls the agent posts to
  `POST /calls`. Outbound lead callbacks are not posted there and are out of scope.
- **Mechanism:** send from `POST /calls` right after the row is inserted, awaited with a 5 s cap
  (transcribe-backend runs on Vercel, where work left running after the response can be dropped;
  the agent posts after the call has ended, so nobody waits on it). Rejected:
  a sweep job with a `summary_emailed_at` column (survives restarts, but more code and latency for
  little gain) and sending from `openai-agent-app` (second SMTP setup + user lookup in another app).

## Backend (`transcribe-backend`)

### Schema

`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_call_summaries BOOLEAN NOT NULL DEFAULT false`,
added to the self-migration in `src/db/client.ts` alongside the other later-added `users` columns.

It lives on `users`, not `business_profiles`, because the setting belongs to the recipient's inbox
and must work before a business profile row exists (`PUT /business/forward-accept` returns 409 in
that case; this one must not).

### Data layer (`src/db/users.ts`)

- `setEmailCallSummaries(userId, enabled): Promise<UserRecord | null>` (null = no such account → 404)
- Expose the flag on `UserRecord` (as `emailCallSummaries`) so reads and the call hook use
  `findUserById`; no separate getter.

### Routes (`src/routes/business.ts`)

Same guard and target resolution as `PUT /business/forward-accept`: `authenticate`, then
`profileTargetFor(user, query.userId)` so an admin can act for a user.

- `GET /business/call-emails` → `200 {enabled: boolean, email: string}` — `email` is the target
  user's registered address, shown in the UI as the recipient.
- `PUT /business/call-emails` body `{enabled: boolean}` → `200 {enabled, email}`.
  Unknown target user → 404 (as the other routes do).

### Sending (`src/routes/calls.ts`)

After `insertInboundCall` returns in `POST /calls`:

1. If the row has no `userId` (dialled number not assigned) → nothing.
2. `findUserById(userId)`; if missing or `emailCallSummaries` is false → nothing. (There is no
   "disabled" account status to check — `unassigned | demo | pre-production | production` all
   receive mail if they switched it on.)
3. Otherwise `await sendMail(callSummaryMail(user, row), { timeoutMs: 5_000 })` — awaited so a
   serverless function isn't stopped mid-send, capped at 5 s so insert + send stays under the
   agent's 10 s HTTP timeout. `sendMail` never throws and is a no-op when SMTP isn't configured.
   Any error in steps 1–2 is caught and logged; `POST /calls` returns 201 regardless.

### Message (`src/email/mailer.ts`)

`callSummaryMail(to, call)` beside the existing builders, plain text like them:

- **Subject:** `New call from {callerName || caller || "an unknown caller"}`
- **Body:** lines only for fields that are present —
  caller (name + number), callback number, request, requested time, outcome, duration (`m:ss`),
  then the summary paragraph, then `View the full transcript: {dashboardLink("#/calls")}`,
  then `SIGN`.

## Dashboard (`tecace-voice-agent-dashboard`)

- `src/routing.ts`: add `"call-emails"` to `SECTION_IDS`.
- `src/settings/SettingsShell.tsx` `SECTION_META` and `SECTION_GROUPS`: add
  "Call emails" to the *Calls* group. Business only — `DemoSettings` doesn't list it (a demo has no
  account inbox).
- `src/api/backend.ts`: `getCallEmails(userId?)` and `saveCallEmails(enabled, userId?)`.
- `src/settings/sections/CallEmailsSection.tsx`: Tailwind/shadcn (inside the page's `.tw`), one
  `Switch` "Email me a summary after each call", helper line "Sent to {email}" and a short note that
  the full transcript stays under Transcripts. Follows the `tecace-dashboard-ui` skill (sentence case,
  tokens only).
- The section loads and saves its own state (`GET`/`PUT /business/call-emails`): save-on-flip with
  rollback on failure, like the Forwarding switch. It does not go through `BusinessSettings`' `run`
  helper, which expects a `BusinessProfile` back. `BusinessSettings.tsx` only adds the section entry.

## Tests

- `transcribe-backend` (`bun test`, `useTestMailer(outbox)`):
  - `POST /calls` for an owner with the flag on → one mail to their address, subject and link correct.
  - flag off → no mail; unassigned dialled number → no mail; mail failure → still 201.
  - `PUT` then `GET /business/call-emails` round-trips; admin `?userId=` targets that user; a
    non-admin can't target someone else.
- Dashboard: `npm test`; `scripts/regression/fake_backend.py` gains the two routes and
  `business_tabs.py` is updated for the extra menu item (it counts the menu) and checks the switch
  saves to `/business/call-emails`. Run the regression scripts one at a time.

## Release bookkeeping

- `src/changelog.ts`: today already has release 0.0.14 (2026-10-02), so add a `new` item to it —
  "Get a summary of each call by email: turn it on under Business settings › Call emails." No
  version bump.
- `HISTORY.md` (top): new `users.email_call_summaries` column, `GET/PUT /business/call-emails`,
  `POST /calls` now may send mail; `⚠` production needs `SMTP_*` and `DASHBOARD_URL` set on
  transcribe-backend for the emails to go out.
- No git commits — the user commits and pushes.

## Out of scope

Outbound-call emails, HTML email, attaching the full transcript, extra/alternate recipients,
per-outcome filters, retry on SMTP failure.
