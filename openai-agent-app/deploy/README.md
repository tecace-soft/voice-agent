# Deploying openai-agent-app on the VPS (always-on)

Two long-running processes, both kept alive by systemd:

- **server** (`run_server.py`) — the media-stream WebSocket that bridges each call's audio between Twilio and OpenAI.
- **poller** (`run_poller.py`) — finds due leads in the backend and places outbound calls.

Twilio's Media Streams require a **secure WebSocket (wss://)**, so the server sits behind Caddy, which terminates TLS and auto-provisions a certificate.

```
Twilio  ──wss──▶  Caddy (443, TLS)  ──▶  uvicorn server (localhost:5050)  ──wss──▶  OpenAI Realtime
Poller  ──────────────────────────────▶  Twilio REST (place call)  +  backend /intake
```

## Prerequisites

- A public hostname for TLS. No domain needed — this uses the VPS IP in **sslip.io** form:
  `31-97-214-59.sslip.io` resolves to `31.97.214.59` automatically (Caddy certs it). If the VPS IP
  changes, update the host everywhere (dash-encode the new IP: `a-b-c-d.sslip.io`).
- **Ports 80 and 443 open** on the VPS firewall (Caddy needs 80 for the ACME challenge, 443 for traffic).
- Outbound from the VPS to `api.openai.com`, `api.twilio.com`, and the backend must be allowed (the VPS routing issue is resolved).
- The **backend deployed** with the `/agent/*` tools, including `/agent/mark-outcome`, and `purpose` live.
- A **paid Twilio account** with a voice-capable number (trial accounts can only call verified numbers).

## 1. Get the code + a virtualenv

```bash
# NOTE: the inbound-screening work lives on michael/inbound_call, NOT michael/open-ai.
# `git pull` on the wrong branch is a silent no-op — you get no error, just old code.
cd /root/voice-agent && git fetch && git checkout michael/inbound_call && git pull
git log --oneline -1        # confirm you have the commit you expect
cd openai-agent-app
python3 -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -e .        # installs deps and makes openai_agent importable
```

Sanity-check the imports:

```bash
.venv/bin/python -c "import openai_agent.telephony.server, openai_agent.telephony.poller; print('ok')"
```

## 2. Configure `.env`

```bash
cp .env.example .env
nano .env
```

Fill in: `OPENAI_API_KEY`, `BACKEND_URL`, `AGENT_TOOLS_SECRET` (must match the backend),
`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, and
`PUBLIC_HOST=31-97-214-59.sslip.io` (no scheme). Leave `PORT=5050`.

## 3. Caddy (TLS + WSS)

```bash
sudo apt install -y caddy      # if not already installed
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile   # already set to 31-97-214-59.sslip.io
sudo systemctl reload caddy
```

Verify TLS + reachability once the server is running (step 4):

```bash
curl https://31-97-214-59.sslip.io/health     # -> {"status":"ok"} (or your health payload)
```

## 4. systemd services

```bash
sudo cp deploy/openai-agent-server.service /etc/systemd/system/
sudo cp deploy/openai-agent-poller.service /etc/systemd/system/
# edit WorkingDirectory / ExecStart / User in each if your path differs from /root/voice-agent
sudo systemctl daemon-reload
sudo systemctl enable --now openai-agent-server
sudo systemctl enable --now openai-agent-poller
```

Watch them:

```bash
systemctl status openai-agent-server openai-agent-poller
journalctl -u openai-agent-server -f
journalctl -u openai-agent-poller -f
```

## 5. Verify end to end

- `curl https://31-97-214-59.sslip.io/health` succeeds over HTTPS.
- Add a test lead (your own verified number) to the backend as `status=new`.
- Watch the poller log pick it up and place the call; answer and confirm the agent talks, books, and marks outcomes.

## Updating after a code change

On this VPS the app runs as **Docker containers**, so a code change needs a REBUILD — not a
restart. `docker compose restart` and `--force-recreate` both reuse the existing image and will
silently run your old code; only `--build` picks up new source.

```bash
cd /root/voice-agent && git checkout michael/inbound_call && git pull
git log --oneline -1                              # confirm the commit

cd openai-agent-app
docker compose up -d --build server               # server only (poller stays off)
docker compose --profile poller up -d --build     # server AND poller (resumes outbound dialling)
```

Verify:

```bash
curl https://31-97-214-59.sslip.io/health
docker compose ps
docker compose logs -f server
```

The systemd form below is the non-Docker fallback only:

```bash
cd /root/voice-agent/openai-agent-app && git pull
.venv/bin/pip install -e .            # only if deps changed
sudo systemctl restart openai-agent-server openai-agent-poller
```

## Securing the public endpoints

The server exposes webhooks and a WebSocket on a public host. Two env settings close them (see
`.env.example`); neither is on by default, and `run_server.py` warns at startup about whichever is
still open.

```bash
# 1. a secret for the media-stream WebSocket (the more urgent of the two)
python3 -c "import secrets; print(secrets.token_urlsafe(32))"     # -> STREAM_SECRET=...

# 2. then, as a separate step, signature validation
VALIDATE_TWILIO_SIGNATURE=true
```

Both change the running configuration, so recreate the containers (a plain restart does not re-read
`env_file`). **Recreate BOTH services, not just the server:**

```bash
docker compose up -d --force-recreate server poller
```

This matters most for `STREAM_SECRET`. The poller is a separate container that builds the outbound
call's stream URL itself (`place_call` -> `build_twiml` -> `cfg.stream_url`). Recreate only the
server and the poller keeps dialing with the OLD, secret-less URL while the server now requires the
secret — so every OUTBOUND call would connect and be dropped immediately with a 1008 close. The
symptom is `rejected a media-stream connection with a missing or wrong path secret` in the server
log, once per outbound call.

After setting `STREAM_SECRET`, the stream URL becomes `wss://<host>/media-stream/<secret>`. Nothing
external needs updating — the app builds that URL itself in all three places it is used — but the
bare `/media-stream` path stops being accepted, so recreate **between** calls, not during one.

After turning on `VALIDATE_TWILIO_SIGNATURE`, place one test call immediately and watch for
`bad Twilio signature` in the logs: that means `PUBLIC_HOST` disagrees with the URL configured in
the Twilio console.

Note this one touches **outbound** too, via `/amd`: answering-machine detection is an outbound-only
callback, and it is signature-verified like the rest. If validation is misconfigured, outbound calls
still run but the agent stops leaving voicemails (the log shows `unsigned request to /amd` or
`bad Twilio signature for /amd` instead of `AMD: call=... answered_by=...`).

## Push notifications (the poller no longer polls on a drumbeat)

The poller used to ask the backend "anything new?" every few minutes forever. Every request woke
the Neon compute, so an idle night still billed a full night of compute for SELECTs that found
nothing. Now the backend tells the poller when a lead is due, riding on the database wake the
insert had to do anyway.

```
form submit            -> backend POST /intake      --(fire & forget)--> https://<host>/poller/lead-due
agent books a callback -> backend /agent/callback   --(with notBefore)-> same endpoint
```

Backend (Vercel):

```
AGENT_NOTIFY_URL=https://31-97-214-59.sslip.io/poller/lead-due
AGENT_TOOLS_SECRET=<the same secret the agent already uses>
```

VPS (`openai-agent-app/.env`):

```
POLL_INTERVAL_SECONDS=1800    # now only a SAFETY net, not the schedule
POLLER_PORT=5060
```

Leave `AGENT_NOTIFY_URL` blank and everything falls back to polling alone, exactly as before.

### It only saves money if Neon actually suspends

Push creates the idle gaps; **Neon's autosuspend is what monetizes them**. If autosuspend is longer
than the gaps the compute never suspends and this saves nothing. Set autosuspend well below
`POLL_INTERVAL_SECONDS` (60s is reasonable), and check the autoscaling **minimum** compute size
while you are there - this workload does not need more than 0.25 CU, and the minimum multiplies
every awake hour.

### The safety poll is not optional

A notification can be lost - the poller restarting, a deploy, a network blip. A lead nobody ever
calls is far worse than one called a bit late, so the periodic poll stays as the backstop. Both
sides fail toward "call the lead", never toward silence: a missing or unparseable `notBefore` is
treated as *due now* rather than dropped.

### Ingress

The poller now receives HTTP, so it has Traefik labels routing `/poller/*` to it on the same
hostname as the server, with an explicit `priority` (both routers match the same Host). Dialing
stays in the poller container on purpose: `place_call` uses the blocking Twilio SDK, and running it
on the server's event loop would stall live call audio.

Verify after deploy:

```bash
curl https://31-97-214-59.sslip.io/poller/health
curl -X POST https://31-97-214-59.sslip.io/poller/lead-due      -H "x-agent-secret: $AGENT_TOOLS_SECRET" -H 'Content-Type: application/json'      -d '{"intakeId":"smoke-test"}'
```

## Notes

- The poller reads leads and places calls continuously whenever it's running — stop it with
  `sudo systemctl stop openai-agent-poller` if you need calling to pause.
- Editing Retell prompts does **not** touch this app; this is a fully separate path (started on `michael/open-ai`, inbound work continues on `michael/inbound_call`).
- Costs run while the services are up: Realtime audio (~$0.30/min) + Twilio per-minute + the VPS.
