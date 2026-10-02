# Scenario tests — design

Date: 2026-10-01 · Status: draft for review

## Goal

Let a TecAce admin check a business's receptionist without phoning it: pick written
scenarios, press **Run selected**, and get a text result per scenario (conversation, tool
calls, pass/fail with the reason). One press runs each selected scenario **once**, shows
the results, and stops. Nothing runs again until someone presses Run again.

Based on OpenAI's GPT-Live evaluation guide (the CRAWL approach: written customer lines →
synthesized speech → the real voice model → graded on tool calls and final state). We
borrow its ideas, not its code.

### In scope (v1)

- Inbound receptionist only (the composed session: `transfer_call`, `take_message`,
  `check_availability`, `book_appointment`, `end_call`).
- Scenarios from 12 built-in templates, filled from the business's settings; admins edit
  them or add their own.
- A runner in `openai-agent-app` that voices the customer lines and drives GPT-Live.
- Sandbox tools (no real bookings, messages or transfers).
- Code checks + an AI judge on `gpt-5.6-luna`.
- An admin-only results screen with history. Text only — no audio stored or played.

### Out of scope (later, each with its own design)

- AI customer (multi-turn role-play, the RUN approach).
- The improvement loop (derive scenarios from failures, save from real calls, prompt
  candidates, held-out set against overfitting).
- AI-suggested scenarios, repeat counts, schedules, automatic re-runs, business-owner access,
  audio playback, outbound lead-callback testing.

### Known v1 limits

- The runner reproduces the phone's session (same composer, models and `session.start`) but
  not the phone bridge's backstops (greeting rescue, take-message reminder, Korean guide), and
  the agent is told it's an in-app test from a withheld number. A failure is a finding about the
  receptionist's prompt and rules; phone-only behaviour is confirmed with a real call.
- Scenarios that don't apply to the settings being tested (e.g. booking off in Published) are
  recorded as run errors, not run.
- The one-pass lock is global across businesses.

## Cost control

- Runs only start from an admin pressing **Run selected**. No queue worker, no schedule,
  no retries.
- One press = each ticked scenario once, in order. The button shows the run count and an
  estimate before confirming ("8 scenarios, ~8 min, ~$0.60").
- One active pass at a time across all businesses; the button is disabled while one runs.
- Each run is force-ended at **90 s or 8 turns** (→ run error "time limit").
- **Stop** cancels the remaining runs; the current one finishes (≤ 90 s).
- `SCENARIO_RUNNER_ENABLED=false` makes the runner refuse all work.
- Every run records its measured total cost; the pass shows the sum.

## Models

| Role | Model |
|---|---|
| Voice (agent under test) | same as live calls: `OPENAI_LIVE_MODEL` (`gpt-live-1`) |
| Agent's backend delegate | same as live calls: `OPENAI_BACKEND_MODEL` (`gpt-5.6-terra`) |
| AI judge | `gpt-5.6-luna` (`SCENARIO_JUDGE_MODEL`) |
| Customer voice | OpenAI TTS (`SCENARIO_TTS_MODEL`, default `gpt-4o-mini-tts`) |

The agent is never tested on a different model than callers reach.

## Architecture

```
Dashboard (admin)            transcribe-backend                         openai-agent-app
Scenario tests section ──►   scenarios, passes, runs, snapshot,   ──►   scenario runner
  Run selected / Stop        sandbox tools, grading               ◄──   (TTS + GPT-Live socket)
  results (polls)      ◄──
```

1. Admin ticks scenarios, chooses Draft (default) or Published settings, confirms.
2. `transcribe-backend` creates a **pass** and one **run** per scenario, and snapshots the
   settings, the composed session (`composeSession`, channel `"sim"`) and each scenario
   with its placeholders resolved. Later edits don't affect a pass in progress.
3. `transcribe-backend` calls the runner `POST /passes/:id`; the runner answers 202.
4. Runner loop: `next` → TTS the lines → open a GPT-Live session from the snapshot → speak
   each line after the agent's turn ends → forward each tool call to the sandbox → close →
   post the result. Repeat until `next` says done (finished or cancelled).
5. `transcribe-backend` grades each result as it arrives and stores the verdict.
6. The dashboard polls the pass every 3 s while it's active.

A pass with no progress for 5 minutes (runner died) is shown as **interrupted** and stops
blocking new passes.

## Scenario format

Stored per business. Only `customerLines` and `language` reach the runner; `world` is used
by the sandbox; `expect` only by the grader.

```ts
type ScenarioDefinition = {
  customerLines: string[];          // 1–3, spoken in order
  language: "ko" | "en";
  world: {
    fullSlots?: string[];           // placeholders or ISO times the calendar treats as taken
    failTool?: string;              // this tool returns an error
    transferAnswer?: "accepted" | "declined" | "no_answer"; // default no_answer
  };
  expect: {
    tools?: { name: string; args?: Record<string, string>; times?: number }[];
    forbidden?: string[];
    final?: { bookings?: number; messages?: number };
    judge?: string[];               // plain-language items for the AI judge
  };
};
```

Placeholders are resolved when the pass starts, in the business's timezone, from the sandbox
calendar's real openings: `{slotA}` (the ISO time), `{slotA.spoken}` ("tomorrow at 3 PM" /
"내일 오후 3시"), `{slotA.day}`, `{slotA.clock}`, and the same for `{slotB}`. slotA is the first
opening at or after 3 PM on the first later day with openings; slotB is at least an hour later on
the **same day** (S06 needs both on one day). Any other `{slot…}` token is refused as unknown. The
table below writes `{tomorrow 15:00}` for readability.

### Templates

Each has an applicability check; inapplicable templates are not generated.

| ID | Applies when | Customer line(s) | world | expect |
|---|---|---|---|---|
| S01 hours | hours set | "What time are you open until today?" | — | judge: correct hours for today |
| S02 address | address set | "Where are you located?" | — | judge: registered address; no invented parking/directions |
| S03 unknown price | no price info | "How much does it cost?" | — | judge: doesn't state a price; offers the configured follow-up |
| S04 availability | booking on | "Is {tomorrow 15:00} available?" | — | tools: check_availability ×1; forbidden: book_appointment |
| S05 booking | booking on | "Please book {tomorrow 15:00} under Kim Minsu." | — | book_appointment start={tomorrow 15:00} ×1; final bookings 1 |
| S06 correction | booking on | "Book me for 3 tomorrow. Oh, not 3, make it 4." | — | book_appointment start={tomorrow 16:00} ×1; final bookings 1; judge: asks for a name if required |
| S07 missing info | booking on | "I'd like to book for tomorrow." | — | forbidden: book_appointment; judge: asks for the missing time/name |
| S08 slot full | booking on | "Please book {tomorrow 15:00} under Kim Minsu." | fullSlots [{tomorrow 15:00}] | final bookings 0; judge: says it's unavailable and offers alternatives |
| S09 transfer | someone reachable | "I'd like to speak to a staff member." | transferAnswer no_answer | transfer_call ×1; judge: offers to take a message after no answer |
| S10 message | always | "This is Kim Minsu, please call me at 010-1234-5678 about a quote." | — | take_message caller_name, callback_number=01012345678 ×1; final messages 1 |
| S11 number fix | always | "My number is 010-1234-5678 — no, the last digits are 5679." (+ name, purpose) | — | take_message callback_number=01012345679 ×1 |
| S12 tool fails | always | S05's line if booking on, else S10's | failTool book_appointment / take_message | judge: doesn't claim success; explains the follow-up |

Lines are written in Korean when the business's language is `ko`, otherwise in English (the
dashboard's default language is English). Lines that give a time or a phone number are followed
by a second line, "Yes, that's right.", so an agent that reads details back gets its answer. Admins edit any scenario; **Reset to template** restores a template one.

## Sandbox tools

`POST /internal/scenario-runs/:id/tool` `{name, args}` → `{output}`. Per-run state
(bookings, messages, transfer requests, calls) lives in `scenario_runs.sandbox_state`.

| Tool | Behaviour |
|---|---|
| `check_availability`, `book_appointment` | `runDemoAppointmentTool` on the snapshot settings, minus `world.fullSlots`; bookings recorded on the run only |
| `take_message` | recorded on the run |
| `transfer_call` | recorded; returns `world.transferAnswer` |
| `end_call` | recorded; the runner lets the farewell finish, then closes |
| `world.failTool` | returns an error; logged as a failed call, no booking or message saved |

No calendar, `appointment_bookings`, `inbound_calls`, SMS or Twilio writes. The `"sim"`
channel offers the same tools as the phone (no `send_link`).

## Grading

Verdict: **pass**, **fail**, or **run error** (agent not actually tested: socket/TTS/sandbox
failure, time limit, stopped, or judge failure). Run errors aren't counted as agent failures.

1. **Code checks** (free, first): expected tools called the right number of times with
   matching args (times compared as instants in the business timezone, phone numbers by
   digits, names case/space-insensitive); no forbidden tools; final sandbox state matches.
2. **AI judge** (`gpt-5.6-luna`): gets the transcript (customer lines as written, agent as
   transcribed), the tool log with results, `world`, the snapshot's business facts, and the
   scenario's `judge` items plus two standing items: *never claims an action succeeded
   without a successful tool call*, *states no facts absent from the business info*.
   Returns met/not met per item with a quoted line as evidence.

Pass only if every code check and judge item passes. Failures are concrete:
`✗ book_appointment.start: expected 16:00, got 15:00`.

## Runner (`openai-agent-app`)

- `scripts/run_scenario_runner.py`, a third Compose service, port 5070. Doesn't touch the
  call server or the poller.
- `POST /passes/:id` with `x-runner-key` → 202, then loops on the backend's `next`.
- Builds `session.start` from the snapshot with `build_composed_session_start`; audio
  `audio/pcmu` 8 kHz like the phone. Live URL overridable (`SCENARIO_LIVE_URL`) for the
  offline check.
- Turn-taking: speak the next line ~0.5 s after the agent's turn ends. After the last line,
  if the agent doesn't call `end_call`, wait 8 s of silence and close (completed, not an
  error).
- Records duration and cost (`VOICE_PRICE_PER_MINUTE`, `backend_cost`, TTS, judge is added
  by the backend).

## API (`transcribe-backend`)

Admin (`authenticateAdmin`, business via `?userId=`):

| Route | Purpose |
|---|---|
| `GET /business/scenarios` | list; generates from templates on first read; includes `perRunEstimateUsd` |
| `POST /business/scenarios` | add a custom scenario |
| `PUT /business/scenarios/:id` | edit |
| `DELETE /business/scenarios/:id` | delete |
| `POST /business/scenarios/:id/reset` | restore from template |
| `POST /business/scenario-passes` | `{settings: "draft"\|"published", scenarioIds}`; 409 if a pass is active, 503 if the runner is unreachable |
| `GET /business/scenario-passes` | history |
| `GET /business/scenario-passes/:id` | pass + runs |
| `POST /business/scenario-passes/:id/stop` | cancel remaining runs |

Runner-only (`x-runner-key` = `SCENARIO_RUNNER_KEY`):

| Route | Purpose |
|---|---|
| `GET /internal/scenario-passes/:id/next` | next run's job `{runId, session, customerLines, language, limits}` or `{done: true}` |
| `POST /internal/scenario-runs/:id/tool` | sandbox tool |
| `POST /internal/scenario-runs/:id/result` | `{status, errorReason?, startedAt, transcript, durationSec, costUsd}` → grades, stores verdict. Tool calls come from the sandbox's own log, not the runner; `startedAt` (when the live session started) lines them up with the transcript |

## Data (idempotent DDL in `initDb()` + a `migrateIfNeeded()` probe)

- `scenario_tests` — id, user_id, template_id (null = custom), title, definition JSONB,
  position, updated_at.
- `scenario_passes` — id, user_id, created_by, settings_kind, status
  (`running|completed|cancelled`; **interrupted** is computed when reading: running with no
  update for 5 minutes), time_zone, settings_snapshot JSONB (call settings + business profile),
  session_snapshot JSONB, created_at, updated_at, finished_at.
- `scenario_runs` — id, pass_id, scenario_id, position, scenario_snapshot JSONB (resolved),
  status (`queued|running|done`), verdict (`pass|fail|run_error`), failures JSONB,
  error_reason, transcript JSONB, sandbox_state JSONB, duration_sec,
  cost_usd, started_at, finished_at.

## Admin screen (`tecace-voice-agent-dashboard`)

Business settings → Tuning → **Scenario tests** (admin only; new section id
`scenario-tests`). Follows the `tecace-dashboard-ui` rules.

- Settings to test: Draft / Published.
- Scenario list: checkbox, ID + title, customer line, one-line expectation, Edit; Add scenario.
- **Run selected** with the estimate → while active "Running 3/8…" + **Stop**.
- Pass summary: `Draft settings · 1 Oct 14:02 · 8 runs · 6 passed · 1 failed · 1 run error · $0.58`.
- Run rows: verdict, scenario, duration, cost. Open → failure lines on top, then the
  conversation as the shared chat bubbles (`Exchange`, as `CallConversation` uses) with tool calls inline.
- History of earlier passes.
- A note, "Next: confirm on a real call with the Test call panel beside these settings." (the panel is already on screen, so no link).

## Configuration

| App | Env | Notes |
|---|---|---|
| transcribe-backend | `SCENARIO_RUNNER_URL`, `SCENARIO_RUNNER_KEY` | feature hidden/503 when unset |
| transcribe-backend | `SCENARIO_JUDGE_MODEL` | default `gpt-5.6-luna` |
| openai-agent-app | `SCENARIO_RUNNER_KEY`, `SCENARIO_RUNNER_ENABLED`, `SCENARIO_TTS_MODEL`, `SCENARIO_LIVE_URL` | uses existing `OPENAI_API_KEY`, `BUSINESS_CONFIG_URL`, live/backend model vars |

## Testing

- transcribe-backend (`bun test`): pure tests for template applicability and placeholder
  resolution, sandbox tools, code checks; judge with stubbed `fetch`; a PGlite route test
  for the full pass flow with a fake runner (create → next → tool → result → verdict,
  409 on a second pass, stop, interrupted).
- openai-agent-app: `scripts/checks/verify_scenario_runner.py` against a fake backend and a
  fake live socket (`SCENARIO_LIVE_URL`); then one manual pass against the real API.
- Dashboard: Vitest for the section; the existing regression scripts, one at a time.

## Team sync

HISTORY.md entry (new routes, tables, env vars, new Compose service, port 5070) and a
changelog line marked `admin: true`.
