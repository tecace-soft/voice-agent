# Bringing the Demo test call back — design

**Date:** 2026-09-23
**Projects:** `transcribe-backend/`, `tecace-voice-agent-dashboard/`
**Follows:** `2026-09-22-demo-tabs-on-transcribe-backend-design.md`, which moved the Demo tabs onto
transcribe-db and **removed** the test call because it needed the promo's OpenAI machinery.

> **Status: approved, in implementation (2026-09-23).** Briefly paused while we checked whether
> `openai-agent-app` could serve this instead; it cannot without disproportionate work, and it would
> play the wrong persona — see "Why not the agent app" below. Resumed as designed.

## Goal

Restore the **"Call now"** panel on a prospect's detail page, served entirely by transcribe-backend,
and with it the post-call review that turns a finished call into its Tested / Worked / Fell short
summary. After this the Demo section is 1:1 with the promo apart from "Re-research", which stays
retired.

Decided with the user 2026-09-23: **the review comes back too**, and the key is the one the agent
app already uses.

## What a test call actually needs

Read out of the promo's `app/api/session/route.ts`, not assumed. It is **much smaller than the
promo's route**, because everything expensive sits behind `if (!isTest)` and exists to protect the
*public* demo, which stays on the promo:

| The promo's session route does | For an admin test call |
| --- | --- |
| IP rate limit | Keep — cheap, and an admin can still fat-finger a retry loop |
| Demo allowance (`demoAllowance`) | **Skipped** — `if (!isTest)` |
| Per-customer concurrency reservation | **Skipped** — `if (!isTest)` |
| Global `LIVE_SESSION_LIMIT` seat | **Skipped** — `if (!isTest)` |
| `markLive` / `listLiveSessions` | **Not needed** — only the skipped paths use them |
| `visitorId()` cookie | **Not needed** — the caller is a signed-in admin |
| `isAdminRequest()` to authorise `isTest` | Becomes the route's own admin guard |
| Create the call row before calling OpenAI | **Keep** — and delete it if OpenAI fails |
| `callClock` + `createLiveSession` | **Keep** — this is the actual work |

So the whole reservation apparatus — the part with the subtle ordering comments about simultaneous
callers — is out of scope, because it protects a path we are not building.

## Architecture

```
dashboard (re-ported verbatim from the promo)
  src/demos/hooks/useLiveCall.ts        WebRTC offer/answer, mic, live transcript, end report
  src/demos/components/call/CallPanel.tsx
  src/demos/lib/ringtone.ts
  src/demos/screens/ProspectScreen.tsx  the right-hand column comes back

transcribe-backend
  src/demo/openai.ts      ports lib/openai.ts — OpenAIError, createLiveSession, createResponse
  src/demo/callClock.ts   ports lib/call-clock.ts — today's date + opening hours for the prompt
  src/demo/callReview.ts  ports lib/call-review.ts (+ extractJson, transcriptText)
  src/routes/demo.ts      POST /demo/session, POST /demo/calls/:callId
```

`openai.ts`, `call-clock.ts` and `call-review.ts` are **verbatim ports** with their `process.env`
reads routed through `config/env.ts`, the same discipline `analytics.ts` follows — and the same
parity idea applies: they are copies, not reimplementations.

## The two routes

**`POST /demo/session`** — admin only.
Body `{ customerId, sdp, timeZone? }`. Answers `{ callId, sessionId, sdp, greeting }`.

1. Admin guard (this replaces the promo's `isTest === true && isAdminRequest()`; every call from
   here is a test call, so the row is always written `is_test = true`).
2. IP rate limit, the promo's numbers: 5 per minute.
3. `getCustomer` → 404 `"This demo isn't available."`, 403 `"This demo is paused."` if inactive,
   409 `"This demo is still being prepared."` unless `status === "ready"`.
4. Insert the call row first (`status: "started"`), exactly as the promo does and for its stated
   reason. On any later failure, delete it — a phantom "started" call otherwise sits in the
   Activity tab and skews `inFlightCalls` for ten minutes.
5. `callClock(now, timeZone, profile.hours)` appended to both prompts, then `createLiveSession`.
6. Save the returned `liveSessionId`.

**`POST /demo/calls/:callId`** — admin only.
Body `{ customerId?, status, durationSec, endReason, transcript }`. Answers `{ ok, reviewed }`.
Idempotent: a beacon landing after the normal report gets `{ ok: true, alreadyReported: true }`
and changes nothing, because `status !== "started"` by then. Then `reviewCall` runs and, if it
returns something, is saved. A failed review is saved as no review — never a failed call.

## Decisions

| Question | Decision |
| --- | --- |
| Auth | **Admin session**, like every other `/demo` route. The test call is an operator tool; the public demo stays on the promo |
| Env names | **`OPENAI_API_KEY`** and **`OPENAI_LIVE_MODEL`** (default `gpt-live-1`), matching `openai-agent-app`'s `.env.example` rather than the promo's `LIVE_MODEL` — one convention per repo. Also `OPENAI_BACKEND_MODEL`, `CALL_REVIEW_MODEL`, `OPENAI_BASE_URL`, `DEFAULT_TIMEZONE` |
| A missing key | **Fails with the promo's own message** (`"OPENAI_API_KEY is not set on the server."`, 500) rather than at import time — the other Demo tabs must keep working on a deployment with no key |
| `isTest` | **Always true.** Every call from this panel is the operator's own and must stay out of the customer-facing numbers, which is what `includeTests` already distinguishes |
| The "Analyze" button | **Comes back**, now that `reviewCall` exists to make it mean something. Its `analyze: true` branch on `PATCH /demo/customers/:id/calls` stops being a no-op |
| Review model | `CALL_REVIEW_MODEL`, default `gpt-5.6-terra` as the promo has it |
| The reservation apparatus | **Not ported** (see the table above) |

## Testing

- **Parity:** `openai.ts`, `call-clock.ts` and `call-review.ts` are diffed against the promo's, with
  every deviation listed by line in `src/demo/PORTING.md` — the mechanism already protecting
  `analytics.ts`.
- **Routes against PGlite**, in the established pattern, with `fetch` stubbed so no real OpenAI call
  is made: a session writes a `started` row and returns the greeting; an OpenAI failure deletes that
  row again (the property worth pinning); a report completes the call, stores the transcript and
  sets `turns`; a second report is a no-op; a non-admin gets 403; an inactive or unready customer
  gets its own status code.
- **Review:** given a stubbed model response, the parsed review is saved; given a failure or a call
  below `MIN_CALLER_LINES`, the call is saved with no review and no error.
- **Harness:** `demos_e2e.py` regains the test-call checks it lost — the fake backend answers
  `/demo/session`, and Edge's fake microphone lets the panel build a real WebRTC offer, as it did
  before. **No real OpenAI call in any test.**

## Risks

- **A test call spends real OpenAI realtime minutes.** Admin-only auth plus the rate limit is the
  whole protection; there is no allowance on this path by design.
- **Verbatim ports that touch the network** are harder to keep honest than `analytics.ts` was, since
  the parity test cannot exercise them. The route tests stub `fetch` at the boundary instead.
- `gpt-live-1` availability is an account property. A wrong model name surfaces as OpenAI's own
  error through `OpenAIError`, with its status forwarded — which is why that class is ported rather
  than flattened into a 500.

## Out of scope

- The public demo page and its allowance, concurrency and visitor tracking — still the promo's.
- "Re-research", which needs the research pipeline.
- Any change to the transcribe tabs.

## Why not the agent app (checked 2026-09-23)

The question was whether the test call could run on `openai-agent-app` rather than calling OpenAI
directly. It already shares the model — both run `gpt-live-1` on the same `OPENAI_API_KEY` — but
nothing else lines up:

| | openai-agent-app | this test call |
| --- | --- | --- |
| Transport | Twilio Media Streams over WebSocket: G.711 μ-law, 8 kHz, base64 | browser WebRTC, SDP offer/answer |
| To OpenAI | `websockets.connect(...)` — the WS flavour of GPT-Live | `POST /live/sessions` — the WebRTC flavour |
| Which persona | resolved from the **dialled number** via `fetch_business_config` | the researched prospect in `demo_customers.prompts` |

There is no WebRTC or SDP anywhere in the agent app. Routing the browser into it would mean
terminating WebRTC server-side, transcoding Opus to μ-law 8 kHz, fabricating Twilio envelopes and a
`streamSid` past its path secret — and then teaching it to resolve a persona from a demo customer
id instead of a dialled number, because the ten demo prospects have no agent numbers. That is a
large amount of machinery to make the demo play the *wrong* receptionist: the point of the demo is
that each prospect hears one researched for their own business.

If the real goal is "the demo should behave like our actual agent", that is a **prompts-and-tools**
convergence, not an audio one, and it is a separate piece of work.
