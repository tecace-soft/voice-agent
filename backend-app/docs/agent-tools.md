# Agent tools (Retell custom functions)

The `/agent/*` endpoints are the tools the voice agent (Retell) calls **during a call** to
check availability, list openings, and book. They wrap the same scheduling + booking logic
the dashboard uses, but return compact, **speakable** JSON.

They're implemented in [`src/routes/agentTools.ts`](../src/routes/agentTools.ts) and mounted
in `app.ts`. Booking goes through the shared [`services/booking.ts`](../src/services/booking.ts)
(book + Cal.com invite), the same path the dashboard/PATCH route uses.

## Base URL

Production: `https://voice-agent-backend-cyan.vercel.app`
Local: `http://localhost:8000` (or `http://127.0.0.1:8000` on Windows)

## Auth

If `AGENT_TOOLS_SECRET` is set on the backend, every `/agent/*` request must include:

```
x-agent-secret: <the same value>
```

Configure this on each Retell function as a **custom header** (a static value, or a
`{{token}}` dynamic variable). Requests without a matching header get `401`. Leave the env
var blank in dev to run open. (Retell also signs every request with `X-Retell-Signature`
(HMAC-SHA256); we can additionally verify that later if desired.)

## Payload modes

Retell can POST in **standard** mode `{ name, call, args }` or **"args only"** mode (the
arguments at the top level). Both are handled — arguments are read from `args` if present,
else the top-level body. The caller's number is read from `call.from_number` when the agent
doesn't pass a `phone`.

Every tool **returns HTTP 200** with a JSON object containing a `message` (what the agent
can say) plus structured fields, so the agent can recover conversationally. Only auth
failures are non-2xx.

---

## `POST /agent/check-availability`

Is a specific time open? If not, returns the nearest alternatives.

**Args**
| field | type | notes |
|---|---|---|
| `dateTime` | string (ISO 8601) | the time to check; the agent resolves the spoken time to ISO |

**Response**
```jsonc
// available
{ "available": true, "when": "Tuesday, August 4 at 9:00 AM", "message": "Good news — … is available." }
// taken / past
{ "available": false, "when": "…", "reason": "taken|in_past|outside_business_hours|not_a_slot_boundary",
  "alternatives": ["…","…"], "message": "… isn't available. The closest openings I have are …" }
```

## `POST /agent/openings`

A few open slots on a given day.

**Args**
| field | type | notes |
|---|---|---|
| `date` | string (YYYY-MM-DD) | the day to list |

**Response**
```jsonc
{ "date": "2026-08-04", "openings": ["Tuesday, August 4 at 9:00 AM", "…"], "message": "I have …" }
```

## `POST /agent/book`

Books a slot. For an **inbound** caller (no `intakeId`) it creates the lead first; for an
**outbound** lead it books the existing record. Booking also creates the Cal.com meeting
(invite + join link).

**Args**
| field | type | notes |
|---|---|---|
| `dateTime` | string (ISO 8601) | the confirmed slot |
| `intakeId` | string (uuid) | **outbound**: the existing lead (pass via a dynamic variable) |
| `name` | string | **inbound**: required |
| `email` | string | **inbound**: required (the invite goes here) |
| `phone` | string | inbound: optional; falls back to `call.from_number` |
| `language` | string | optional; defaults to `English` |
| `purpose` | string | optional; defaults to `Consultation (inbound call)` |

**Response**
```jsonc
// booked
{ "booked": true, "when": "…", "intakeId": "…", "message": "You're all set for …. A confirmation … will be sent to …" }
// failed
{ "booked": false, "reason": "taken|in_past|not_found|missing_details", "message": "…" }
```

## `POST /agent/callback`

Schedules a **deferred callback**: the person answered but wants to be reached later. We
already have their number (we dialed it), so this just persists **when** to try again. It
stores `callback_after` on the lead and **resets `attempts` to 0** (they engaged — fresh
retry budget), keeping status `new` so the poller re-picks it and holds the call until that
time instead of using its default pre-call delay.

**Args**
| field | type | notes |
|---|---|---|
| `callbackInMinutes` | integer | **relative** callbacks ("in 10 minutes", "in an hour") — minutes from now; the backend computes `now + minutes` (accurate, since the agent can't know the current clock time). Preferred when present. |
| `callbackAfter` | string (ISO 8601, local) | **absolute** callbacks ("tomorrow at 2") — resolved to Pacific wall-clock. Used only if `callbackInMinutes` is absent. |
| `intakeId` | string (uuid) | the lead (pass via a dynamic variable; falls back to `call.retell_llm_dynamic_variables`) |

**Response**
```jsonc
// scheduled
{ "scheduled": true, "when": "Wednesday, August 6 at 5:00 PM", "message": "Got it — we'll reach back out around …" }
// failed (no id / unreadable time)
{ "scheduled": false, "message": "When would be a good time for us to call you back?" }
```

---

## `POST /retell/webhook` — post-call outcome + retries

Not a tool the agent calls — this is the **agent-level webhook** Retell POSTs to when a call
starts/ends/is analyzed (`{ event, call }`). It closes the loop on **outbound** calls so the
poller knows what happened, using `call.metadata.intake_id` (also read from the call's dynamic
variables) to find the lead:

- **Voicemail** (`voicemail_reached` / `machine_detected`) → send the lead a **follow-up email**
  (over SMTP, `services/notify.ts` → `email/client.ts`) and mark `contacted` — we don't keep
  re-dialing a voicemail box.
- **Didn't connect** (`dial_no_answer` / `dial_busy` / `dial_failed` / `error*`, or a "connected"
  call under ~15s) → **schedule a retry** by setting `callback_after` (which the poller honors),
  up to `RETELL_MAX_ATTEMPTS`, then mark the lead `unreachable`.
- **Reached, no booking** (a real conversation, they declined/hung up) → mark `contacted` so
  the poller stops calling.
- **Booked** (the `book` tool already set `booked`) or a **human callback** scheduled mid-call
  (future `callback_after`) → left as-is.
- `call_analyzed` → the AI's `call_summary` is stored on the lead's `notes` (shown in the dashboard).

Because `callback_after` only advances *after* a call ends, the poller can never double-dial a
call that's still active.

**Configure in Retell:** set the agent's **Webhook URL** to
`<base>/retell/webhook?secret=<AGENT_TOOLS_SECRET>` (the agent webhook can't send custom
headers, so the secret rides in the URL). Tune `RETELL_RETRY_DELAY_SECONDS` /
`RETELL_MAX_ATTEMPTS` on the backend (keep the latter in sync with the poller's
`MAX_CALL_ATTEMPTS`).

---

## Configuring the functions in Retell (Phase 2)

For each tool, add a Retell custom function with:
- **URL** = `<base>/agent/<tool>`, **Method** = `POST`
- **Header** `x-agent-secret` = your `AGENT_TOOLS_SECRET`
- **Parameters** matching the **Args** table above
- A short **description** so the LLM knows when to call it (e.g. *"Check if a specific date
  and time is available for a consultation. Pass dateTime as ISO 8601."*)

Give the agent the current date + timezone (via the prompt or a dynamic variable) so it can
resolve spoken times ("next Tuesday at 2") to ISO. For outbound calls, pass the lead's
`intakeId` as a dynamic variable so `book` updates the existing record.
