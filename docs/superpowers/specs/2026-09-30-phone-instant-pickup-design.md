# Phone agent: instant pickup — design

Date: 2026-09-30 · App: `openai-agent-app` (GPT-Live bridge, inbound) · Status: approved design, not yet planned

## Problem

Production phone calls run on the GPT-Live bridge (`OPENAI_LIVE_MODEL` set). The agent feels slow
to pick up on the phone compared with the dashboard's in-app test call.

The dashboard hides its setup time: the browser plays a synthetic ringtone until `session.started`
(`tecace-voice-agent-dashboard/src/demos/hooks/useLiveCall.ts:296-302`). The phone does the
opposite — Twilio answers the moment `/incoming` returns TwiML, and the caller listens to silence
while the stream connects and the greeting is produced.

The pre-rendered greeting (`realtime/greeting_audio.py`) exists to remove GPT-Live's ~2.5s
cold-start to first word, but it likely misses on most real calls:

- The cache is an in-memory dict (`greeting_audio.py:44`); every restart/deploy empties it.
- Rendering starts at `/incoming` (TTS ~2s + μ-law conversion), which is usually later than the
  stream opening.
- The bridge checks `greeting_audio.ready()` once at stream start (`live_bridge.py:~490`); a render
  still in flight is ignored and the call falls back to the model greeting (2.5s + connect time,
  plus the 3s/4.5s retry/rescue path).
- Nothing logs hit/miss or a pickup timeline, so none of this is measured yet.

## Goal and success criteria

- A caller on a number with a published business hears ringing, then the greeting within ~0.5s of
  the answer — on the first call after a deploy as well as later ones.
- Every inbound call logs a pickup timeline that shows which greeting source was used.
- No new failure can drop or stall a call: every new step falls back to today's behaviour.

## Out of scope

- Rendering the greeting in the business's GPT-Live voice (`gleam`, `meridian`, …; the speech API
  has no such voices). The greeting stays in `OPENAI_VOICE` via TTS, so the voice seam between
  greeting and model remains. Possible follow-up.
- Opening the GPT-Live session during the ring hold.
- Per-turn latency, tool-lookup latency, audio reservoir tuning, the Realtime bridge.
- Any change to transcribe-backend or its contracts.

## Design

### 1. Pickup timeline (measure first)

A per-call record of monotonic timestamps, keyed by `CallSid`, started at `/incoming` and completed
by the bridge:

| Field | Set where |
|---|---|
| `incoming_at` | `/incoming` entry |
| `twiml_at` | just before `/incoming` returns |
| `hold_ms` | time `/incoming` spent waiting (section 4) |
| `greeting_source` | `memory` / `disk` / `waited` (render finished during a wait) / `miss` (model greets) / `none` (no business / returning leg) |
| `stream_start_at` | bridge, after `_await_start` |
| `greeting_first_frame_at` | `_play_greeting`, first frame sent |
| `model_first_audio_at` | existing "agent first spoke" point |

At call end the bridge logs one line, e.g.
`pickup: source=disk hold=180ms twiml→stream=640ms stream→greeting=12ms model_first_audio=3.1s`.
The `/incoming` half lives in a small module-level dict in `server.py` (entries dropped when the
bridge reads them, and pruned after 60s so an unanswered call can't leak). Logs only.

### 2. Persistent greeting cache (`realtime/greeting_audio.py`)

- Keep the in-memory dict as the first layer; add a disk layer at `GREETING_CACHE_DIR`
  (default `/data/greetings`), one file per key: `<sha256>.ulaw`. Key unchanged:
  `voice | tts_model | text`.
- `ready()` checks memory, then disk (loading into memory on a disk hit). Writes go to a temp file
  then `os.replace`, so a crash never leaves a half file. An unwritable or missing directory logs
  once and degrades to memory-only.
- New `async await_ready(cfg, text, timeout) -> (bytes | None, source)`: returns immediately on a
  memory/disk hit; if a render for that key is pending, waits for it up to `timeout`; otherwise
  `None, "miss"`. Never raises.
- `warm()` unchanged in behaviour (dedup by key, fire-and-forget) but skips work on a disk hit.
- No eviction: one small file per distinct greeting (~100–200 KB).

### 3. Warm-up before calls arrive (`telephony/server.py`)

- On startup, and every `GREETING_WARM_INTERVAL` (default 600s): list the account's Twilio incoming
  phone numbers (Twilio SDK is blocking → `asyncio.to_thread`), fetch `/business/config` for each
  (existing `fetch_business_config`, which also fills its 60s cache), and `warm()` each opening
  line — the same text `_warm_for_call` computes today (factor that computation into one helper
  used by both).
- Renders are serialised (one at a time) so a boot with many numbers doesn't burst the speech API
  or stack DSP threads.
- Skipped entirely when Twilio credentials or `BUSINESS_CONFIG_URL` are missing; any error is
  logged and the loop continues next interval.
- The periodic pass also picks up greeting/profile changes published in the dashboard.

### 4. Hold the ring in `/incoming`

- `/incoming` awaits the business lookup and then `await_ready` for the opening line, with the
  whole wait bounded by `PICKUP_HOLD_SECONDS` (default `3.0`; `0` disables the hold and restores
  today's behaviour). The TwiML is identical; only its timing changes.
- While the webhook is pending the caller hears ringing. Warm cache: the wait is the config lookup
  (usually served from the 60s cache after the warm-up pass).
- Signature check, logging and the forwarded-call `<Play digits>` path are unchanged; the hold runs
  after the signature check.
- Twilio's webhook timeout is 15s; the cap keeps us far inside it.
- ⚠ Assumption to verify on the first real call: for an inbound call, Twilio plays ringback to the
  caller until it receives TwiML. The timeline (`hold_ms` vs. what the caller heard) confirms it.

### 5. Bridge (`realtime/live_bridge.py`)

- Replace the one-shot `greeting_audio.ready()` (both the composed and legacy branches) with
  `await_ready(..., timeout=GREETING_LATE_WAIT)` (constant, 0.5s) for the rare render that lands
  just after the stream opens. Behaviour otherwise unchanged: a hit plays the greeting and sends
  `already_greeted`; a miss sends `_GREET_NOW` as today.
- Record `stream_start_at`, `greeting_source`, `greeting_first_frame_at`, and log the pickup line
  at call end.

## Configuration

| Env var | Default | Meaning |
|---|---|---|
| `PICKUP_HOLD_SECONDS` | `3.0` | Max time `/incoming` waits before answering; `0` = off |
| `GREETING_CACHE_DIR` | `/data/greetings` | Disk cache for rendered greetings |
| `GREETING_WARM_INTERVAL` | `600` | Seconds between warm-up passes; `0` = startup only |

`docker-compose.yml`: a named volume mounted at `/data/greetings` on the `server` service.
`.env.example` and the README gain the three variables.

## Failure behaviour

| Failure | Result |
|---|---|
| Disk cache unwritable/missing | Memory-only cache (today) |
| Twilio number list / config fetch fails in warm-up | Logged; next interval retries; `/incoming` still warms |
| Render slower than the hold | Answer at the cap; bridge waits ≤0.5s more; else model greets (today) |
| `PICKUP_HOLD_SECONDS=0` | Today's `/incoming` timing |
| No business for the number | Neutral greeting path as today (`NEUTRAL_GREETING` is warmed too) |

## Testing

- Offline, new `scripts/checks/verify_greeting_cache.py` (same style as the other checks; no
  network): disk round trip and atomic write; key changes with voice/text; `await_ready` returns a
  pending render that finishes inside the timeout and gives up on one that doesn't; memory-only
  fallback on an unwritable dir; `/incoming` returns within the cap when the render is artificially
  slow (FastAPI test client, monkeypatched renderer and config fetch).
- Live: after deploy, one call to a published number on a freshly started container and one a
  minute later; read both pickup lines. Expected: `source=disk` or `memory`, greeting frame within
  ~50ms of stream start.

## Sync

- HISTORY.md entry (openai-agent-app): new env vars; ⚠ deploy must mount the greeting volume.
- No transcribe-backend / dashboard changes; no changelog entry unless the team treats faster
  pickup as user-visible (then an `improved` line in that day's entry).
