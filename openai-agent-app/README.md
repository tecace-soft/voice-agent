# openai-agent-app

The TecAce lead-callback voice agent on the **OpenAI Realtime API + Twilio** — an experimental
alternative to the Retell implementation in [`voice-agent-app`](../voice-agent-app/). It owns the
voice layer itself (speech-to-speech, turn-taking, interruptions) and reuses the **same shared
backend `/agent/*` tools** the Retell agent uses, so the two can be compared head-to-head.

## How it works

```
poller / place_call ──▶ Twilio outbound call ──▶ <Connect><Stream> ──▶ /media-stream (this app)
                                                                              │
                                                    G.711 μ-law audio (both ways, no resampling)
                                                                              ▼
                                                              OpenAI Realtime API (gpt-realtime)
                                                                              │
                                              tool calls ──▶ shared backend /agent/* (book, etc.)
```

- **Telephony:** Twilio dials the lead and streams the call audio to this app over a WebSocket.
- **Voice + brain:** the OpenAI Realtime API (`gpt-realtime`) does STT, the conversation, TTS,
  and turn-taking in one model. Audio is G.711 μ-law on both sides, so bytes pass straight through.
- **The flow:** there's no node/edge graph — the whole TecAce flow is one instruction set
  ([`instructions.py`](src/openai_agent/instructions.py)), rendered per call with the lead's details.
- **Tools:** the model calls `check_availability`, `get_openings`, `book_appointment`,
  `schedule_callback`, `mark_outcome` — handlers POST to the shared backend, injecting the lead's
  `intake_id` from call context (not the model).

## Layout

Mirrors the other apps in this workspace (`config/` + `tools/` for external integrations + domain
packages). Dependency direction is `telephony → realtime → tools → config`.

```
openai-agent-app/
  src/openai_agent/
    config/settings.py       # env-backed Config
    tools/                   # backend integrations (one module per API surface)
      agent_tools.py         #   the agent's tool schemas + handlers → backend /agent/*
      backend.py             #   sync client the poller uses → backend /intake
    realtime/                # the OpenAI Realtime layer
      instructions.py        #   the TecAce flow as one prompt (+ per-call variable injection)
      session.py             #   builds the Realtime session.update (audio, VAD, voice, tools)
      bridge.py              #   Twilio ↔ OpenAI audio relay + tool calls + barge-in
    telephony/               # Twilio + orchestration
      server.py              #   FastAPI app: the /media-stream WebSocket (call audio)
      outbound.py            #   place a Twilio call, passing lead details as <Stream> params
      poller.py              #   finds due leads and places a call for each (attempt cap, callbacks)
  scripts/
    run_server.py            # run the media-stream server (handles call audio)
    run_poller.py            # run the lead poller (always-on: decides who to call and when)
    place_call.py            # place a single test outbound call by hand
  .env.example  requirements.txt  pyproject.toml
```

## Setup

```bash
cd openai-agent-app
python -m venv .venv && . .venv/Scripts/activate   # Windows; .venv/bin/activate on macOS/Linux
pip install -r requirements.txt
cp .env.example .env    # then fill it in
```

Fill in `.env`: `OPENAI_API_KEY`, `BACKEND_URL` + `AGENT_TOOLS_SECRET` (match the backend),
Twilio creds (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`), and `PUBLIC_HOST`.

## Running it

Two processes run together: the **server** handles each call's audio, the **poller** decides who
to call. Both need the public tunnel so Twilio can reach the server.

1. **Start the server** (handles call audio):
   ```bash
   python scripts/run_server.py
   ```
2. **Expose it publicly** (Twilio must reach the WebSocket) and set `PUBLIC_HOST`:
   ```bash
   ngrok http 5050          # then put the host (no scheme) in PUBLIC_HOST, e.g. abc123.ngrok-free.app
   ```
3. **Start the poller** (always-on: calls due leads from the backend):
   ```bash
   python scripts/run_poller.py
   ```

The poller mirrors the Retell poller: it reads `status=new` leads, holds a fresh lead briefly
(or until its requested callback time), places the call, counts the attempt, and marks a lead
`unreachable` after `MAX_CALL_ATTEMPTS`. Booked/contacted/callback leads leave the queue on their
own. For production, run both as services (e.g. systemd) so they stay up.

### One-off manual test call

To try a single call without the poller:
```bash
python scripts/place_call.py +14255551234 --name "David Kim" \
  --purpose "AI adoption for our logistics operations" \
  --desired-time "Friday, August 15 at 2 PM" --datetime 2026-08-15T14:00:00 \
  --intake-id <real-backend-intake-id>
```
Pass a real `--intake-id` to let booking/callback/mark-outcome write back; omit it to just
exercise the conversation and availability lookups. The server must be running.

## Notes

- **Nothing in `voice-agent-app` (the Retell path) is touched** — this is a parallel app that
  shares only the backend over HTTP. Run the two side by side to compare latency, interruptions,
  and instruction-following.
- **Lead answers first:** turn-taking is server-side VAD and no opening message is forced, so the
  agent responds to the lead's "hello" rather than talking first.
- **Two processes:** the server (call audio) and the poller (who to call) run independently — the
  poller places a Twilio call that connects the audio back to the server's `/media-stream`.
