# Twilio integration: number assignment, forwarding verification, SMS

Date: 2026-09-28. Owner: Hans. Follows `2026-09-27-phase-gates-design.md`, which put "buy numbers through
the Twilio API / webhook setup" out of scope. This is that work.

## Goal

The customer journey is demo → onboarding (`pre-production`) → Live (`production`). When an account goes
live, the admin attaches a Twilio number to the business, Twilio's webhooks for that number are set by
the backend (not by hand in the console), the customer forwards their real line to it, and the dashboard
tells everyone whether forwarding actually works. Later, the same number texts callers.

## What exists

- `agent_numbers` (one number per customer, one customer per number), admin CRUD + assign routes
  (`/business/numbers*`), the admin Numbers page (numbers typed in by hand).
- `POST /auth/users/:id/go-live` gated on readiness (`number_assigned` required); `GET /business/config`
  refuses non-production owners (`not_live_stage`).
- `ForwardingSection.tsx` — carrier dial codes only; nothing checks that forwarding is on.
- openai-agent-app: `/incoming` reads `ForwardedFrom`, transfers via Twilio REST with a global caller ID,
  posts `/usage/minutes` and `/calls` at call end. Number webhooks are set in the Twilio console by hand.
- No Twilio code in transcribe-backend. `sms_consents` and the SMS copy helpers exist; nothing sends SMS.

## Decisions

1. **Twilio REST is called from transcribe-backend** (`TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` there), through
   a thin fetch client (`src/twilio/client.ts`) — no SDK. Every external call in this backend is `fetch`, and
   the `*.pg.test.ts` files fake the outside world by swapping `globalThis.fetch`.
2. **The backend never sits on the voice TwiML path.** `VoiceUrl` stays on the VPS agent
   (`AGENT_PUBLIC_URL/incoming`); the backend receives only `StatusCallback` (after the call). A Vercel cold
   start must never delay the first second of a call.
3. **Numbers are assigned from the Accounts Go live panel**: pick an unassigned pool number (existing
   `assign`) or buy one (`buy { assignTo }`, local or toll-free). Assigning or buying configures the webhooks.
   The Numbers page manages inventory: sync, buy, repair webhooks, release.
4. **Forwarding verification = active test + passive detection.** The test is a *self-call*: the backend has
   Twilio dial the business's real line (`profile.phone`) **from the business's own agent number**. If
   forwarding is on, the carrier sends that call back to the agent number and Twilio raises a new inbound
   call with `To = agent`, `From = agent`, `ForwardedFrom = business line`. The backend decides from
   StatusCallback (authoritative); the agent app short-circuits `From == To` with a short spoken line and
   a hangup (no OpenAI session, no minutes) and reports `POST /business/forwarding/arrived`. Passive: any
   real inbound call whose `ForwardedFrom` is the business line marks the number verified.
5. **Forwarding does not block Go live** (the customer forwards after going live). `forwarding_verified` is an
   advisory readiness item; a production account with no verification shows "Live · waiting for
   forwarding". No new `users.status` value.
6. **SMS: toll-free first.** Callers dial the business's own number, so the agent number's area code is
   invisible to them; a toll-free number needs one verification form per number and no per-customer
   10DLC brand/campaign. TecAce (the Twilio account holder, an ISV) files it with the customer's business
   details. 10DLC for local numbers is deferred.
7. `PUBLIC_BACKEND_URL` is **required** for Twilio features: it builds `StatusCallback`/`SmsUrl` and is the URL
   signatures are checked against. The request's `Host` is never trusted.

## Data model (additive DDL, probes in `migrateIfNeeded` before the `demo_customers_code_guard` probe)

`agent_numbers` gains: `twilio_sid` (unique partial), `number_type` (`local|tollfree|NULL`), `capabilities` JSONB,
`voice_url`, `voice_fallback_url`, `status_callback_url`, `sms_url`, `webhook_state` (`unknown|ok|stale|error`,
default `unknown`), `webhook_error`, `webhooks_checked_at`, `synced_at`, `purchased_at`, `purchase_request_id`
(unique partial — idempotent Buy), `released_at`, `released_by`; phase 2: `forwarding_verified_at`,
`forwarding_from_e164`, `forwarding_source` (`test|passive`), `forwarding_last_seen_at`; phase 3: `sms_state`
(`none|pending_verification|verified|rejected`), `sms_verification_sid`, `sms_state_at`, `sms_state_detail`.
Released rows are hidden from `listAgentNumbers`/`assign`/`findByPhone`. `DELETE /business/numbers/:id` stays
"forget the row" (hand-registered numbers); Release is the Twilio action.

`forwarding_tests` (phase 2): `user_id, number_id, agent_e164, target_e164, outbound_sid, inbound_sid, status
(dialing|verified|not_forwarded|failed|timed_out), outbound_status, detail, requested_by, started_at,
finished_at`; one `dialing` row per account (unique partial index).

`twilio_call_events` (phase 2): the raw StatusCallback — `call_sid, parent_call_sid, direction, from_e164,
to_e164, forwarded_from, caller_name, call_status, duration_seconds, sequence, user_id, number_id, raw, received_at`;
unique `(call_sid, call_status, COALESCE(sequence,-1))` so Twilio's retries are no-ops. Joins
`inbound_calls.call_sid` (the agent's transcript) once the agent sends `callSid`.

`sms_messages` (phase 3): the message log; `sms_consents` stays the consent state.

## Routes

Refusals use `{ error, message, field? }`. Shared: 409 `twilio_not_configured`, 409 `webhooks_not_configured`,
502 `twilio_error { code }`.

Admin (`authenticateAdmin`): `GET /business/numbers?includeReleased=1`; `GET /business/numbers/webhooks`;
`POST /business/numbers/sync` → `{numbers, added, updated, missing}`; `GET /business/numbers/available?type=
local|tollfree&areaCode&contains&limit`; `POST /business/numbers/buy {phoneNumber? | type+areaCode?, label?,
assignTo?, requestId?}` (webhooks set in the purchase request itself; `already_has_number` checked before
buying; Twilio 21422/21421 → 409 `number_taken`, 21452 → 409 `no_numbers_in_area`);
`POST /business/numbers/:id/configure`; `POST /business/numbers/:id/release {confirm}` (409 `number_assigned`;
Twilio 404 = success); `POST /business/numbers/:id/assign` now runs `ensureWebhooks` best-effort afterwards.

Customer or admin (`?userId=`): `GET /business/forwarding` → `{agentNumber, businessPhone, verified, verifiedAt,
source, forwardedFrom, lastSeenAt, activeTest, lastTest}` (runs the lazy sweeps first — no cron on Vercel);
`POST /business/forwarding/test` → 202 `{test}` (409 `no_number|no_business_phone|same_number|test_in_progress`,
403 `demo_read_only`, 429 `too_many_tests`).

Agent (`x-agent-key`): `POST /business/forwarding/arrived {to, from, forwardedFrom?, callSid?}`; `POST /calls`
gains `callSid`, passive detection on `forwardedFrom`, and drops self-call records (`caller == dialled`).

Twilio (`X-Twilio-Signature` over `PUBLIC_BACKEND_URL + path + query` and the sorted POST params):
`POST /twilio/voice-status` (idempotent insert, then forwarding verdicts); phase 3 `POST /twilio/sms`,
`/twilio/sms-status`, `/twilio/tollfree-verification`.

Test verdicts: an inbound leg on the agent number with `ForwardedFrom == target` or `From == target` (carrier
rewrote the CLI) or `From == agent` (self-call) while a `dialing` test exists → `verified`. Outbound leg
`busy`/`no-answer` → `not_forwarded`; `failed`/`canceled` → `failed`; `completed` with no inbound leg within
20 s → `not_forwarded` ("the business line answered itself"). `Timeout = FORWARDING_TEST_TIMEOUT_SECONDS`
(default 40 — longer than a carrier's no-answer forwarding delay).

Readiness: `webhooks_configured` required only when the number is managed (`twilio_sid` set) AND Twilio is
configured on the server; `forwarding_verified` advisory.

## Environment

```
TWILIO_ACCOUNT_SID= / TWILIO_AUTH_TOKEN=   # unset → Twilio routes answer 409 twilio_not_configured; all else works
AGENT_PUBLIC_URL=https://31-97-214-59.sslip.io   # VoiceUrl=<this>/incoming, VoiceFallbackUrl=<this>/incoming-fallback
PUBLIC_BACKEND_URL=                        # required for Twilio; must equal the origin Twilio calls
TWILIO_VALIDATE_SIGNATURE=true             # false only for a local curl
FORWARDING_TEST_TIMEOUT_SECONDS=40         # 10–120
TWILIO_MESSAGING_SERVICE_SID=              # phase 3, optional
```

## Dashboard

- Numbers page: "Sync from Twilio"; Type and Webhooks columns (ok / stale / error / registered by hand);
  Configure and Release for managed numbers, Delete for hand-registered ones; a "Buy a number" card
  (toll-free recommended when texting is wanted / local, area code, search, buy). `compare.py` gets an
  `EXPECTED_CHANGES` entry for `admin:numbers:light`.
- Accounts → Go live panel: when `number_assigned` is unmet, an inline "Assign a number" form (pool select
  or buy new). Phase 2: a forwarding status line for production accounts.
- Business page → Call forwarding section: "Test forwarding" button with polling and the verdict; the
  status card shows "Verified {date} from {number}" or "Not verified yet". Status pill: "Live · waiting for
  forwarding" until verified. Hidden for demo accounts (no number).
- No new views, routes or settings sections.

## Agent app (phase 2, three edits)

`/incoming`: `to_e164(From) == to_e164(To)` → `<Say>Forwarding test successful…</Say><Hangup/>`, skip the
warm-up, fire-and-forget `POST /business/forwarding/arrived`. `_finalize_call`: add `callSid` to `/calls`.
`build_transfer_twiml`: `callerId = dialled or MAIN_LINE_NUMBER or TWILIO_FROM_NUMBER`. ⚠ The VPS runs
`michael/inbound_call`; these must land on the deployed branch.

## Phases

0. Plumbing: env, `twilio/{client,signature,webhooks}.ts` + unit tests.
1. Inventory sync, search/buy (local/toll-free), webhook configure/repair, release, assign from Go live,
   readiness `webhooks_configured`, Numbers page + Go live form, `fake_backend.py`.
2. `twilio_call_events` + `/twilio/voice-status`, `forwarding_tests` + `/business/forwarding*`, `/calls`
   `callSid` + passive detection, readiness `forwarding_verified`, agent app edits, Forwarding section UI.
3. SMS: toll-free verification request + status callback, inbound SMS (YES/STOP/HELP → `sms_consents`),
   `sendLink` honouring double opt-in, agent-key `POST /business/sms/send-link`, delivery status.

## Risks

- Signature URL mismatch (`PUBLIC_BACKEND_URL` vs the origin Twilio actually calls) is the likeliest failure;
  log the hashed URL on 403.
- A number-level `StatusCallback` fires once, at call end; progress events exist only on REST-created calls.
- `ForwardedFrom` varies by carrier; `verified` is claimed only on positive evidence.
- Twilio has no idempotency key for purchases: `requestId` + pre-buy `already_has_number` + unique index;
  an orphan at Twilio after a DB failure is picked up by `sync`.
- Buying and test calls are billable.
