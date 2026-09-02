# openai-agent-app

The TecAce lead-callback voice agent on the **OpenAI Realtime API + Twilio** — an experimental
alternative to the Retell implementation in [`voice-agent-app`](../voice-agent-app/). It owns the
voice layer itself (speech-to-speech, turn-taking, interruptions) and reuses the **same shared
backend `/agent/*` tools** the Retell agent uses, so the two can be compared head-to-head.

It runs **two different agents against one bridge**: the outbound lead-callback agent, and an
inbound call-screening agent (see [Inbound call screening](#inbound-call-screening)) that answers a
client's main line, handles questions itself, and warm-transfers real booking requests to a person.

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
- **Direction picks the rules:** a `direction=inbound` stream parameter selects a different prompt
  AND a different tool set. Outbound is the default, so nothing without that parameter changes.
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
      instructions.py        #   OUTBOUND: the TecAce flow as one prompt (per-call injection)
      instructions_mini.py   #   OUTBOUND: the same flow, tuned for the mini model
      instructions_inbound.py #  INBOUND: the call-screening rule book (triage, not booking)
      session.py             #   builds the Realtime session.update (audio, VAD, voice, tools)
      bridge.py              #   Twilio ↔ OpenAI audio relay + tool calls + barge-in
    telephony/               # Twilio + orchestration
      server.py              #   FastAPI app: /media-stream + the inbound TwiML webhooks
      outbound.py            #   place a Twilio call, passing lead details as <Stream> params
      transfer.py            #   INBOUND: warm-transfer a live call to a human (+ recover it)
      poller.py              #   finds due leads and places a call for each (attempt cap, callbacks)
  scripts/
    checks/verify_faq.py    # FAQ/DEFERRALS name no company (run after editing faq.py)
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

## Inbound call screening

The client keeps their existing, publicly-known number — we do **not** port it. Their carrier
forwards it to a Twilio DID, which is reversible from the carrier portal in under a minute.

```
caller ──▶ client's public number ──▶ (carrier forward) ──▶ our Twilio DID
                                                                │
                                          POST /incoming ──▶ <Connect><Stream direction=inbound>
                                                                │
                                    the agent triages: answer it / take a message / hand it off
                                                                │
                                     transfer_to_human ──▶ REST redirect ──▶ <Dial> the colleague
                                                                │
                                     /whisper "call from 206…, press 1"  ──▶ bridged
                                     nobody answered? ──▶ /after-transfer ──▶ back to the agent
```

### Why the transfer works the way it does

`<Connect>` is **terminal TwiML** — ending the media stream ends the *call*. There is no way to
leave the stream and keep the caller, so a handoff can't reuse the hang-up path; it redirects the
live call over the Twilio REST API instead (`telephony/transfer.py`). The handoff is warm: the
colleague hears a whisper naming the caller and must press 1, which stops their voicemail from
"answering" the transfer, and a no-answer puts the caller **back on the agent** — now told the
transfer failed — instead of dropping them into silence.

### Twilio setup

On the DID, under **Voice Configuration**:

| Field | Value |
|---|---|
| A call comes in | Webhook · `https://<PUBLIC_HOST>/incoming` · **POST** |
| Primary handler fails | Webhook · `https://<PUBLIC_HOST>/incoming-fallback` · **POST** |

The fallback is not optional in spirit: if this app is down, it dials a human directly, so an
outage in the agent can never take the client's phone line down with it.

Then set `HUMAN_TRANSFER_NUMBER` and `MAIN_LINE_NUMBER` in `.env` (see `.env.example`).

### Securing the endpoints

These are public URLs, so two things guard them:

| Setting | Guards | Notes |
|---|---|---|
| `VALIDATE_TWILIO_SIGNATURE=true` | the five webhooks + `/amd` | verifies `X-Twilio-Signature` |
| `STREAM_SECRET=<random>` | `/media-stream` | a WebSocket carries no signature, so the secret rides in the path |

`STREAM_SECRET` is the more urgent of the two: without it anyone who can reach the server can open
a WebSocket and run an OpenAI Realtime session on your API key. `/amd` is the sharpest webhook —
it reaches into a call already in progress, so a forged `AnsweredBy=machine` would make the agent
abandon a live person mid-sentence to leave a voicemail.

**Turning signature validation on is a two-step change.** The signature is computed over the URL as
*Twilio* built it, and behind Traefik the app sees a proxied scheme and internal host — so we
rebuild the URL from `PUBLIC_HOST`. If that does not exactly match the URL in the Twilio console,
every genuine call is rejected. Set it to `true`, place one test call, confirm it connects, and only
then leave it on. A rejection is a `403`, which makes Twilio fall through to `/incoming-fallback`,
so even a misconfiguration sends callers to a human rather than dropping them.

`/incoming-fallback` is deliberately **not** verified, for that same reason: verifying the fallback
that a failed check falls back to would turn a recoverable error into a dead phone line.

### Before the first real call

Ring the forwarded number once and read the `incoming call:` log line. On a forwarded call `From`
is *usually* the original caller with the forwarding number in `ForwardedFrom` — but some carriers
put their own number in `From` instead, and which one this client's carrier does decides whether
caller ID is usable at all. All four fields are logged for exactly this.

## Notes

- **The outbound path is unchanged.** Every inbound behavior is gated on `direction=inbound`,
  which only the `/incoming` webhook sets — same discipline as the existing `is_mini` gating.
- **Nothing in `voice-agent-app` (the Retell path) is touched** — this is a parallel app that
  shares only the backend over HTTP. Run the two side by side to compare latency, interruptions,
  and instruction-following.
- **Lead answers first:** turn-taking is server-side VAD and no opening message is forced, so the
  agent responds to the lead's "hello" rather than talking first.
- **Two processes:** the server (call audio) and the poller (who to call) run independently — the
  poller places a Twilio call that connects the audio back to the server's `/media-stream`.
