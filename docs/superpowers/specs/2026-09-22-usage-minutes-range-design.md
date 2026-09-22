# Ranged usage totals for `GET /usage/minutes` — design

**Date:** 2026-09-22
**Project:** `transcribe-backend/`
**Asked for by:** the team integrating against the usage API (their request is quoted in "What was asked").

## Goal

Answer "how much call time did this business use between two instants?" — today the API can only
answer "this month" and "last month".

## What was asked

- `GET /usage/minutes?userId=<id>&from=<start>&to=<end>`, ISO 8601 with offset or `Z`.
- `from` inclusive, `to` exclusive, so back-to-back periods neither overlap nor leave a gap.
- A call belongs to the period containing its **start**; a call is never split across periods.
- New fields: `periodSeconds`, `periodCalls`, and `from`/`to` echoed back. Existing fields unchanged.
  (We answer with **`periodMinutes`** instead — see Decisions.)
- Say when a total stops changing, or return a flag.
- `400` (`invalid_range`) for a malformed timestamp or `from` after `to`; state any maximum range.
- Two API keys, staging and production.

## What the code can answer today (checked 2026-09-22)

- **`agent_call_minutes` is a running counter**, one row per business holding `current_month` /
  `previous_month` seconds, rolled over on write. There are no per-call rows and no start times, so
  an arbitrary range **cannot** be derived from it.
- **`inbound_calls` has per-call `started_at` and `duration_seconds`**, but only for inbound calls
  the agent records. The counter exists precisely because not every session has a row there —
  outbound calls in particular.
- **The agent's report** (`POST /usage/minutes`, `openai-agent-app/src/openai_agent/tools/business_config.py`)
  sends `durationSeconds` and `agentNumber` only: no start time, no call id. It is best-effort and
  fired once, right after the call ends.
- **API keys already exist** (`api_keys`, created by name in the dashboard, each reading every
  business or one named per request).

## Decisions

| Question | Decision |
| --- | --- |
| What counts in a range | **Every agent session** (inbound and outbound), matching what the monthly totals count. Needs a new per-session table; ranged totals start the day it ships |
| How the start time is known | **Both**: use `startedAt` when the agent sends it, otherwise derive `reported_at − durationSeconds`. No agent change needed to ship; the agent can improve it later, deployed independently |
| Duplicate reports | **Not handled** (2026-09-22). Attribution is by agent number, as today; a call id would only tell a retry apart from two same-length calls, and nothing retries — `post_call_minutes` sends once, fire-and-forget. Today's counter has the same exposure. If a retry is ever added, an optional `callId` plus a partial unique index is an additive migration |
| "Has it stopped changing?" | A **`settled`** boolean plus **`settleSeconds`** (the rule behind it). Not called `final` — that reads as "the final figure", which is `periodMinutes` |
| Settle window | **1 hour**, configurable by env |
| Maximum range | **366 days** |
| Staging vs production keys | **Two named keys on one backend**. No code change; documented |
| Unit of the period total | **Both `periodSeconds` and `periodMinutes`** (one decimal, via the same `toMinutes`), matching `currentSeconds`/`currentMinutes` in the same row. Minutes first asked for, then revised in the 2026-09-22 review: the seconds are already computed, the integrator asked for them, and having them removes any rounding caveat |

## 1. Data

New append-only table, `agent_call_sessions`:

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `UUID PK` | |
| `owner_key` | `TEXT NOT NULL` | account id, or `unassigned` — same key the counter uses |
| `user_id` | `UUID NULL REFERENCES users(id) ON DELETE CASCADE` | null for the unassigned bucket |
| `seconds` | `INTEGER NOT NULL` | `CHECK (seconds >= 0 AND seconds <= 86400)`, as the ingest already caps |
| `started_at` | `TIMESTAMPTZ NOT NULL` | reported or derived; the field every range is measured by |
| `reported_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | when the agent's report arrived |

Index: `(owner_key, started_at)` for the range query.

Attribution matches the counter exactly: the agent's number resolves through `agent_numbers` to the
owning account at write time, or the unassigned bucket. Fixing the owner at write time means
reassigning a number later doesn't rewrite history — the same rule the counter already follows.

One row per call. At any plausible call volume this table stays small and the range query is an
index scan.

## 2. Write path

`POST /usage/minutes` keeps its current behaviour — the monthly counter is updated exactly as now,
and its response is unchanged — and additionally inserts a session row **in the same transaction**,
so the counter and the sessions can never disagree about a call.

One optional body field is accepted:

- `startedAt` — ISO 8601 with offset or `Z`. When absent, the backend derives
  `reported_at − durationSeconds`, which is accurate to the round-trip because the report is sent as
  the call ends. A `startedAt` in the future, or more than 24 h in the past, is ignored in favour of
  the derived value: a wrong clock on the agent host must not move usage into another month.

Duplicate reports are not guarded against, deliberately (see Decisions). A report counts once per
request, in the counter and the sessions alike — the behaviour the counter has today.

## 3. Read API

`GET /usage/minutes?userId=<id>&from=<iso>&to=<iso>`

- **Without `from`/`to`:** byte-for-byte the response callers get today.
- **With both:** each business row gains `periodSeconds`, `periodMinutes` (one decimal, rounded once
  over the summed seconds) and `periodCalls`; the response gains `from`, `to`, `settled`,
  `settleSeconds` and `coverageFrom`.
- **A ranged month will not always equal that month's monthly total, by design.** The counters bucket
  a call by when it was *reported* (call end) and ranges by when it *started*, so a call across
  midnight on the last of the month lands in different periods in the two views; and the monthly
  fields are calendar months in the business timezone while a range is absolute instants. Both are
  documented for the integrator.
- **What `settled` promises.** It assumes no call runs longer than `settleSeconds`. The ingest accepts
  up to 24 hours, so an unusually long call that started before `to` can still arrive after a period
  reads settled. Stated in the code above `isSettled` and in the integrator's doc.
- `from` inclusive, `to` exclusive, measured by `started_at`. A call counts wholly in the period
  containing its start.
- `settled` is `true` once `now ≥ to + settleSeconds`; `settleSeconds` defaults to `3600` and is set
  by `USAGE_SETTLE_SECONDS`. Before that, a call that started before `to` may still be running and
  therefore not yet reported, so the total can still rise.
- `coverageFrom` is the earliest `started_at` on record (null when there are none). Ranged totals
  only cover sessions recorded since this ships; a consumer asking about an earlier period sees why,
  rather than a silent zero.
- Authorisation is unchanged: an API key reads every business or the one it names; a customer reads
  their own; an admin reads any or all. A named business with no sessions reads as zeros, matching
  today's behaviour for a business with no minutes.

Example:

```json
{
  "timezone": "America/Los_Angeles",
  "from": "2026-08-15T07:00:00.000Z",
  "to": "2026-09-15T07:00:00.000Z",
  "settled": true,
  "settleSeconds": 3600,
  "coverageFrom": "2026-09-22T18:04:11.000Z",
  "minutes": [
    {
      "userId": "…", "email": "…", "name": "…", "businessName": "…",
      "currentMonth": "2026-09", "currentSeconds": 3600, "currentMinutes": 60,
      "previousMonth": "2026-08", "previousSeconds": 1821, "previousMinutes": 30.4,
      "updatedAt": "…",
      "periodSeconds": 5424, "periodMinutes": 90.4, "periodCalls": 37
    }
  ]
}
```

## 4. Errors

All `400`, shaped like the API's existing errors (`{ "error": …, "message": … }`):

- `invalid_range` — a malformed timestamp, only one of `from`/`to` given, or `from` at or after `to`
  (an empty window is a caller bug, not an empty answer).
- `range_too_long` — more than **366 days**, so a yearly report is fine and a runaway query is not.

`404 business_not_found` for an unknown `userId` is unchanged.

## 5. API keys

No code change. Create two keys on the dashboard's API keys page, named `staging` and `production`:
separate secrets, revocable independently, each showing when it was last used. Both read the same
live data — a staging key sees real customer numbers, which is worth knowing before it is handed to
a staging system.

## 6. Documentation

`docs/usage-api.md` (the file handed to other teams) gains: that the period total is reported in
minutes (`periodMinutes`) rather than the seconds they asked for, and the rounding caveat; the two query parameters and their
semantics, the response fields, the settle rule and what `settled` means, `coverageFrom` and why a
pre-coverage range reads as zero, both error codes, the 366-day maximum, and the two-key guidance.

## 7. Testing

Following the existing `bun test` style (`src/auth/auth.test.ts`, `src/db/callMinutes.test.ts`),
with `mock.module` standing in for the database where needed:

- **Pure helpers:** parsing and validating a range (offsets, `Z`, malformed, reversed, equal,
  over-long); the settle rule around the boundary; derived start times, including the ignored
  future/too-old `startedAt`.
- **Write path:** a session row and the counter move together, in one transaction; a report with a
  `startedAt` uses it, one without derives it, and a nonsense one falls back to derived.
- **Read path:** `from`/`to` absent leaves the response identical to today's; a call starting exactly
  at `from` counts and one starting exactly at `to` does not; back-to-back ranges sum to the whole;
  each caller kind (API key, customer, admin) sees the right businesses; both error codes.

## 8. Rollout

1. Ship the backend. Ranged totals begin accumulating; `coverageFrom` tells consumers when from.
2. Hand over the two API keys and the updated `docs/usage-api.md`.
3. Optional, later and independent: teach the agent to send `startedAt`
   (`post_call_minutes` in `openai-agent-app`), which makes a delayed report land in the right
   period. Nothing waits on it.

## Out of scope

- Backfilling ranges from before this ships — the per-call data doesn't exist. Monthly totals for
  earlier periods remain available and unchanged.
- Per-key data scoping (a staging key that can't see real customers). If that's wanted, it's its own
  piece of work.
- Any change to the dashboard UI. These fields are for the integrating system.
