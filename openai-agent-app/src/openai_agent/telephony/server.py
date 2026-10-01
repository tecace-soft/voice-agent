"""The call server: the WebSocket Twilio streams each call's audio to, plus the inbound webhooks.

OUTBOUND calls arrive with their TwiML built in outbound.py and passed inline to the Twilio API —
nothing is served over HTTP for those; the only endpoint they touch is /media-stream (and /amd).

INBOUND calls are the opposite: Twilio asks US what to do the moment the phone rings, so the
screening path is a small set of TwiML endpoints around the same bridge.

    caller dials the client's PUBLIC number
      -> their carrier forwards it to our Twilio DID
      -> POST /incoming            -> <Connect><Stream direction=inbound> -> the agent screens
      -> agent calls transfer_to_human
      -> the call is REDIRECTED (Twilio REST) to <Dial> the colleague
           -> POST /whisper        -> played to the COLLEAGUE only: who is calling and why, then
                                      the legs bridge automatically (no keypress, by design)
      -> POST /after-transfer      -> answered and finished? hang up.
                                      nobody there? put the caller BACK on the agent.

/incoming-fallback is Twilio's "primary handler fails" URL: if this app is down or erroring, the
client's callers still reach a human instead of a Twilio error tone. It is the reason putting an
agent in front of a live business number is safe to try.

AUTHENTICATION. These endpoints are on a public host, so they verify Twilio's request signature
(`X-Twilio-Signature`) when VALIDATE_TWILIO_SIGNATURE is on. Two deliberate carve-outs:

  * /incoming-fallback is NOT verified. It is the last line of defence, and its only action is
    dialling a number from config — nothing an attacker gains by triggering it. Verifying it would
    mean a misconfigured signature check rejects /incoming AND the fallback it falls back to,
    turning a recoverable error into a dead phone line.
  * /media-stream is a WebSocket, which carries no Twilio signature at all. It is protected by a
    shared secret in its path instead (STREAM_SECRET) — without which anyone who can reach the
    server can open an OpenAI Realtime session on our API key.
"""

from __future__ import annotations

import asyncio
import contextlib
import datetime
import hmac
import logging
import os
import time
from contextlib import asynccontextmanager
from urllib.parse import parse_qs

from fastapi import FastAPI, Request, Response, WebSocket
from twilio.http.http_client import TwilioHttpClient
from twilio.request_validator import RequestValidator
from twilio.rest import Client
from twilio.twiml.voice_response import Connect, Stream, VoiceResponse

from ..config import Config
from ..heartbeat import heartbeat_loop
from ..realtime import amd
from ..realtime.bridge import run_bridge
from ..realtime import greeting_audio
from ..realtime import pickup
from ..realtime.live_bridge import run_live_bridge
from ..tools.business_config import fetch_business_config
from . import transfer

# Logging is configured HERE, at import, rather than only in scripts/run_server.py — because the
# container's CMD runs `uvicorn openai_agent.telephony.server:app` directly and never executes that
# script. Without this, every log.info in the app is dropped on the floor (Python's fallback handler
# only emits WARNING and above), so a call could be answered, mis-handled or refused and leave no
# trace at all. That cost a long debugging session: the WebSocket showed [accepted] from uvicorn's
# own logger and nothing else, which looked like the bridge never ran.
#
# basicConfig is a no-op when a handler already exists, so launching via run_server.py — which calls
# it first — is unaffected.
logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)

log = logging.getLogger(__name__)

cfg = Config.load()

# Open /media-stream handlers, and the last error one died with, for the heartbeat's status.
_active_calls = 0
_last_call_error = ""
_last_call_error_at = ""


def _heartbeat_status() -> tuple[bool, str, dict]:
    metrics: dict = {"activeCalls": _active_calls}
    if _last_call_error:
        metrics["lastCallError"] = _last_call_error[:100]
        metrics["lastCallErrorAt"] = _last_call_error_at
    # No OPENAI_LIVE_MODEL is a valid engine choice (the Realtime bridge), so only a missing key
    # makes this process unable to answer a call.
    if not cfg.openai_api_key:
        return False, "OPENAI_API_KEY is not set", metrics
    return True, "", metrics


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    beat = asyncio.create_task(heartbeat_loop(cfg, "server", _heartbeat_status))
    # Render every number's greeting before anyone calls it — see _keep_greetings_warm.
    warmer = asyncio.create_task(_keep_greetings_warm())
    try:
        yield
    finally:
        warmer.cancel()
        beat.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await beat
        # Wait for the cancellation to land, so shutdown does not end with a "Task was destroyed
        # but it is pending" warning for the warm-up loop.
        with contextlib.suppress(asyncio.CancelledError):
            await warmer


app = FastAPI(title="openai-agent-app media stream", lifespan=_lifespan)

# Which engine answers calls. Logged at startup because the answer lives in .env, and a container
# that was restarted instead of recreated silently keeps the old one.
if cfg.openai_live_model:
    log.info(
        "voice engine: GPT-Live (%s, backend %s)", cfg.openai_live_model, cfg.openai_live_backend_model
    )
else:
    log.info("voice engine: Realtime (%s)", cfg.openai_model)


def _xml(twiml: str) -> Response:
    return Response(content=twiml, media_type="application/xml")


# Returned when a request isn't signed by Twilio. 403 (not 200-with-empty-TwiML) is deliberate: on
# /incoming it makes Twilio fall through to the fallback handler, so a signature misconfiguration
# sends callers to a human instead of silently dropping them.
_FORBIDDEN = Response(content="forbidden", status_code=403, media_type="text/plain")


def _public_url(request: Request) -> str:
    """The URL as TWILIO built it, which is what the signature was computed over.

    We cannot use `request.url`: behind Traefik the app sees the proxied scheme and internal host,
    so hashing that fails on every genuine request. PUBLIC_HOST is the same value the Twilio
    console was configured with, so we rebuild from it — including the query string, which is part
    of the signed URL (it carries `reason`/`caller` on the whisper and transfer callbacks).
    """
    query = request.url.query
    return f"https://{cfg.public_host}{request.url.path}" + (f"?{query}" if query else "")


def _signed_by_twilio(request: Request, fields: dict) -> bool:
    """True if this request carries a valid Twilio signature (or checking is switched off)."""
    if not cfg.validate_twilio_signature:
        return True
    if not cfg.twilio_auth_token:
        log.warning("signature validation is on but TWILIO_AUTH_TOKEN is unset — rejecting")
        return False
    signature = request.headers.get("X-Twilio-Signature", "")
    if not signature:
        log.warning("unsigned request to %s — rejecting", request.url.path)
        return False
    ok = RequestValidator(cfg.twilio_auth_token).validate(_public_url(request), fields, signature)
    if not ok:
        # Nearly always PUBLIC_HOST disagreeing with the URL configured in the Twilio console,
        # rather than an actual forgery — so log what we hashed.
        log.warning("bad Twilio signature for %s (validated against %s)",
                    request.url.path, _public_url(request))
    return ok


async def _form(request: Request) -> dict:
    """Twilio posts application/x-www-form-urlencoded. Parse the raw body ourselves so we don't
    depend on python-multipart (which request.form() requires) — the same reason /amd does.

    `keep_blank_values=True` is NOT optional. Twilio sends a pile of empty-valued fields on every
    voice webhook (CallerCity, CallerName, FromZip, ForwardedFrom, ...), and its signature is
    computed over ALL of them. parse_qs drops blank values by default, so without this we hash a
    strict subset of what Twilio hashed, every real signature fails, and /incoming 403s — which
    Twilio then treats as a failure and falls through to the fallback handler. It reproduces only
    against real Twilio traffic, never against a hand-made test payload.
    """
    body = (await request.body()).decode("utf-8", "ignore")
    return {k: (v[0] if v else "") for k, v in parse_qs(body, keep_blank_values=True).items()}


@app.get("/health")
async def health() -> dict:
    return {"ok": not cfg.missing_for_server(), "missing": cfg.missing_for_server()}


def _warm_for_call(dialled: str) -> None:
    """Get everything the first second of the call needs, while Twilio is still connecting."""
    if not dialled:
        return

    async def run() -> None:
        business = await fetch_business_config(cfg, dialled)
        if business is None:
            return
        greeting_audio.warm(cfg, pickup.expected_opening(cfg, business))

    task = asyncio.create_task(run())
    _warming.add(task)
    task.add_done_callback(_warming.discard)


_warming: set[asyncio.Task] = set()

# How long a forwarded call may ring while we ask whether its business wants the accept press. Normally
# instant — the pickup hold or the warm-up has cached the answer — and it only ever delays ringing.
_ACCEPT_LOOKUP_SECONDS = 3.0


async def _press_to_accept(dialled: str) -> bool:
    """Does this business's forwarding hold the call behind "press 1 to accept"?

    Set per business in the dashboard's Call forwarding guide. Only a carrier with answer confirmation
    on (some landlines) needs the press; on a mobile forward the caller is already connected and hears
    the tones in their ear. Anything we can't tell — no business, a slow or failed lookup — is "no":
    that call is answered neutrally anyway, and a stray beep is what this exists to stop.
    """
    try:
        business = await asyncio.wait_for(fetch_business_config(cfg, dialled), _ACCEPT_LOOKUP_SECONDS)
    except asyncio.TimeoutError:
        log.warning("forwarded call to %s: business lookup took over %.0fs — not pressing to accept",
                    dialled, _ACCEPT_LOOKUP_SECONDS)
        return False
    return bool(business and business.forward_accept_press)


async def _hold_for_pickup(dialled: str) -> str:
    """Keep the phone ringing until the greeting is ready — or PICKUP_HOLD_SECONDS, whichever is
    first. Returns what it found, for the pickup log.

    Twilio does not answer an inbound call until our TwiML arrives, so every moment spent here is
    ringing. Spent after answering, the same moment is an open line with nobody on it — which is
    what callers heard while the greeting rendered, and what the dashboard's test call hides behind
    its ringtone. With the greeting already rendered this is just the business lookup.
    """
    deadline = time.monotonic() + cfg.pickup_hold_seconds
    try:
        business = await asyncio.wait_for(fetch_business_config(cfg, dialled), cfg.pickup_hold_seconds)
    except asyncio.TimeoutError:
        _warm_for_call(dialled)  # the lookup was cancelled with the wait; start it again unwaited
        return "timeout"
    if business is None:
        return "none"
    text = pickup.expected_opening(cfg, business)
    greeting_audio.warm(cfg, text)
    _audio, source = await greeting_audio.await_ready(
        cfg, text, timeout=max(0.0, deadline - time.monotonic())
    )
    return source


def _our_numbers() -> list[str]:
    """Every number on the Twilio account: any of them may be assigned to a business. Blocking —
    the Twilio SDK is synchronous — so it runs on a thread, never on the call loop."""
    # A timeout, because a Twilio API call that hangs would otherwise hold this worker thread
    # forever — and the warm-up loop awaiting it would never run another pass.
    client = Client(cfg.twilio_account_sid, cfg.twilio_auth_token, http_client=TwilioHttpClient(timeout=10))
    return [n.phone_number for n in client.incoming_phone_numbers.list()]


async def _warm_all_greetings() -> tuple[int, int]:
    """One pass: render the opening line of every number that belongs to a business. Returns
    (greetings ready, numbers that failed).

    Each number is tried on its own: one business whose lookup or render breaks must not abort the
    pass — it would then abort every pass, and every number after it in the list would never be
    warmed.

    One render at a time: a startup with many numbers must not burst the speech API or stack
    conversion threads beside calls in progress. Already-rendered greetings cost a file read.
    """
    rendered = failed = 0
    for number in await asyncio.to_thread(_our_numbers):
        try:
            business = await fetch_business_config(cfg, number, quiet=True)
            if business is None:
                continue
            if await greeting_audio.render(cfg, pickup.expected_opening(cfg, business)):
                rendered += 1
        except Exception as exc:  # noqa: BLE001 — see the docstring: one number never stops the pass
            failed += 1
            log.warning("greeting warm-up failed for %s (%s)", number, exc)
    return rendered, failed


async def _keep_greetings_warm() -> None:
    """Why: /incoming renders the dialled number's greeting, but a render takes ~2s and the
    first call to a business after a deploy used to lose that race and greet through the model
    (~2.5s of an answered, silent line). Rendering ahead makes the first call as quick as the rest,
    and re-running picks up a greeting a business changed in the dashboard."""
    if not (cfg.openai_api_key and cfg.twilio_account_sid and cfg.twilio_auth_token
            and cfg.business_config_url and cfg.agent_config_key):
        log.info("greeting warm-up off — it needs OPENAI_API_KEY, Twilio credentials, "
                 "BUSINESS_CONFIG_URL and AGENT_CONFIG_KEY")
        return
    while True:
        try:
            ready, failed = await _warm_all_greetings()
            log.info("greeting warm-up: %d business greeting(s) ready, %d number(s) failed", ready, failed)
        except Exception as exc:  # noqa: BLE001 — a failed pass must never take the server down
            log.warning("greeting warm-up failed (%s) — trying again next pass", exc)
        if cfg.greeting_warm_interval <= 0:
            return
        await asyncio.sleep(cfg.greeting_warm_interval)


@app.post("/incoming")
async def incoming(request: Request) -> Response:
    """A call rang the number. Hand its audio to the screening agent.

    NOTE the caller-ID caveat: on a FORWARDED call, `From` is normally the original caller with the
    forwarding number in `ForwardedFrom` — but some carriers put their own number in `From`
    instead. All four fields are logged precisely so the first real forwarded call settles which
    one this client's carrier does.
    """
    fields = await _form(request)
    if not _signed_by_twilio(request, fields):
        return _FORBIDDEN
    caller = fields.get("From", "")
    log.info(
        "incoming call: From=%s To=%s ForwardedFrom=%s CallerName=%s CallSid=%s",
        caller,
        fields.get("To", ""),
        fields.get("ForwardedFrom", ""),
        fields.get("CallerName", ""),
        fields.get("CallSid", ""),
    )
    call_sid = fields.get("CallSid", "")
    dialled = fields.get("To", "")
    pickup.note(call_sid, incoming_at=time.monotonic())
    # "Whose business is this?" and that business's rendered greeting, while the phone still rings
    # (see _hold_for_pickup). With the hold off, the lookup and render still start now, unwaited,
    # so they are ready as early as possible once the stream opens.
    # Only the GPT-Live bridge plays the pre-rendered greeting, and only with PRERENDERED_GREETING
    # on. On the Realtime engine, or with it off, nothing plays a rendered greeting first, so
    # holding the TwiML would only add ringing; those calls take the unwaited warm-up below, which
    # still keeps the rescue render and the config cache warm.
    if (cfg.pickup_hold_seconds > 0 and dialled
            and cfg.openai_live_model and cfg.prerendered_greeting):
        # Nothing the hold raises may become a 500: Twilio would send the caller to
        # /incoming-fallback on EVERY call while the lookup is broken. The hold only exists to make
        # pickup faster, so when it fails we answer without it.
        try:
            source = await _hold_for_pickup(dialled)
        except Exception as exc:  # noqa: BLE001 — a faster pickup is never worth failing the call
            log.warning("pickup hold failed (%s) — answering without it", exc)
            _warm_for_call(dialled)
            source = "error"
        pickup.note(call_sid, hold_source=source)
    else:
        _warm_for_call(dialled)

    response = VoiceResponse()

    # A forwarding carrier with answer confirmation on answers OUR leg first and plays "press 1 to
    # accept"; the real caller hears ringing until a digit arrives. Twilio generates that digit here,
    # as real DTMF, BEFORE the media stream starts — but only for a business that has said its
    # carrier does this. Every other forward (mobile carriers) is already connected, and the digits
    # would be loud tones in the caller's ear.
    #
    # We used to synthesise the tones ourselves and push them up the stream. They never registered:
    # our audio has to survive Twilio's outbound media path to reach the carrier's detector, and
    # evidently did not — the announcement kept repeating nine seconds after two presses. Twilio
    # generating the digits is both more reliable and simpler, and doing it before <Connect> means
    # the announcement is over before the agent is listening at all.
    forwarded_from = fields.get("ForwardedFrom", "")
    press = bool(forwarded_from) and await _press_to_accept(dialled)
    if press and cfg.forward_accept_twiml_digits:
        log.info("forwarded from %s — playing accept digits %r before connecting",
                 forwarded_from, cfg.forward_accept_twiml_digits)
        response.play(digits=cfg.forward_accept_twiml_digits)
    elif forwarded_from:
        log.info("forwarded from %s — no accept press (the business's carrier doesn't ask for one)",
                 forwarded_from)

    connect = Connect()
    stream = Stream(url=cfg.stream_url)
    # `direction` is what switches the bridge onto the inbound rule book; without it the bridge
    # treats a call as outbound, which is what keeps the existing path untouched.
    stream.parameter(name="direction", value="inbound")
    stream.parameter(name="caller", value=caller)
    # WHICH of our numbers was dialled. This is how the bridge knows whose business to answer for:
    # one agent serves several customers, and `To` is the only field Twilio always sets to the
    # number that actually rang. (ForwardedFrom would be the alternative, but carriers disagree
    # about it — see the docstring above.) It was previously logged and discarded.
    stream.parameter(name="dialled", value=fields.get("To", ""))
    stream.parameter(name="forwarded_from", value=fields.get("ForwardedFrom", ""))
    # The same decision for the bridge's in-band fallback press, so it never beeps a call the
    # business said needs no press.
    stream.parameter(name="accept_press", value="1" if press else "")
    connect.append(stream)
    response.append(connect)
    pickup.note(call_sid, twiml_at=time.monotonic())
    return _xml(str(response))


@app.post("/incoming-fallback")
async def incoming_fallback(request: Request) -> Response:
    """Twilio's fallback handler: this app 5xx'd, timed out, or returned bad TwiML.

    Deliberately NOT signature-verified — see the module docstring.

    Do the dumbest reliable thing — ring a human — so an outage in the agent can never take the
    client's phone line down with it.
    """
    log.warning("incoming-fallback fired — serving the plain dial-a-human TwiML")
    response = VoiceResponse()
    target = cfg.human_number or cfg.main_line
    if target:
        response.dial(target, timeout=30)
    else:
        # Nothing configured to fall back TO. Say something human rather than dumping a Twilio
        # error tone on the caller.
        response.say(
            "Sorry, we can't take your call right now. Please try again shortly.",
            voice="Polly.Joanna",
        )
    return _xml(str(response))


@app.post("/whisper")
async def whisper(request: Request) -> Response:
    """Played to the COLLEAGUE only, before the two legs are bridged."""
    if not _signed_by_twilio(request, await _form(request)):
        return _FORBIDDEN
    reason = request.query_params.get("reason", "")
    caller = request.query_params.get("caller", "")
    return _xml(transfer.build_whisper_twiml(cfg, reason=reason, caller=caller))



@app.post("/after-transfer")
async def after_transfer(request: Request) -> Response:
    """The dial ended. Either they talked and it's over, or nobody answered and the caller is
    still holding — in which case they go back to the agent, which switches to taking a message."""
    fields = await _form(request)
    if not _signed_by_twilio(request, fields):
        return _FORBIDDEN
    dial_status = fields.get("DialCallStatus", "")
    caller = request.query_params.get("caller", "") or fields.get("From", "")
    dialled = request.query_params.get("dialled", "") or fields.get("To", "")
    log.info(
        "after-transfer: DialCallStatus=%s caller=%s dialled=%s", dial_status, caller, dialled
    )
    return _xml(
        transfer.build_after_transfer_twiml(
            cfg,
            dial_status=dial_status,
            caller=caller,
            dialled=dialled,
            # Handed back so the agent picks up where it left off instead of starting over.
            caller_name=request.query_params.get("caller_name", ""),
            reason=request.query_params.get("reason", ""),
        )
    )


@app.post("/amd")
async def amd_callback(request: Request) -> dict:
    """Twilio's async answering-machine-detection result lands here (it runs in the background so
    it never delays the call). We just log it; the poller reads the same result off the call to
    know when a call reached voicemail. Twilio only needs a 200 back."""
    try:
        # Twilio posts application/x-www-form-urlencoded. Parse the raw body ourselves so we don't
        # depend on python-multipart (which request.form() requires).
        body = (await request.body()).decode("utf-8", "ignore")
        fields = parse_qs(body, keep_blank_values=True)  # see _form: blanks are signed too
        # This is the only webhook that reaches into a call already in progress: a forged
        # AnsweredBy=machine would make the agent abandon a live human mid-sentence to leave a
        # voicemail. Verify before delivering it.
        if not _signed_by_twilio(request, {k: v[0] for k, v in fields.items() if v}):
            return {"ok": False}
        call_sid = (fields.get("CallSid") or [""])[0]
        answered_by = (fields.get("AnsweredBy") or [""])[0]
        log.info("AMD: call=%s answered_by=%s", call_sid, answered_by)
        # Hand the result to the live call so it can leave a voicemail if this is a machine.
        amd.deliver(call_sid, answered_by)
    except Exception as exc:  # noqa: BLE001 — never fail Twilio's callback
        log.warning("AMD callback parse error: %s", exc)
    return {"ok": True}


@app.websocket("/media-stream")
@app.websocket("/media-stream/{secret}")
async def media_stream(websocket: WebSocket, secret: str = "") -> None:
    """Call audio. Both paths are registered so an existing deployment keeps working until
    STREAM_SECRET is set; once it is, the bare path stops being accepted."""
    if cfg.stream_secret and not hmac.compare_digest(secret, cfg.stream_secret):
        # Rejected BEFORE accept(), so no OpenAI session is ever opened for this connection.
        log.warning("rejected a media-stream connection with a missing or wrong path secret")
        await websocket.close(code=1008)
        return
    global _active_calls, _last_call_error, _last_call_error_at
    _active_calls += 1
    try:
        # OPENAI_LIVE_MODEL set = GPT-Live; blank = the Realtime bridge, untouched.
        if cfg.openai_live_model:
            await run_live_bridge(websocket, cfg)
        else:
            await run_bridge(websocket, cfg)
    except Exception as exc:  # noqa: BLE001 — recorded for the heartbeat, then raised as before
        _last_call_error = f"{type(exc).__name__}: {exc}"
        _last_call_error_at = datetime.datetime.now(datetime.timezone.utc).isoformat()
        raise
    finally:
        _active_calls -= 1
