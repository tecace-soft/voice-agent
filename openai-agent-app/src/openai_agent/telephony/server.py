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

import hmac
import logging
from urllib.parse import parse_qs

from fastapi import FastAPI, Request, Response, WebSocket
from twilio.request_validator import RequestValidator
from twilio.twiml.voice_response import Connect, Stream, VoiceResponse

from ..config import Config
from ..realtime import amd
from ..realtime.bridge import run_bridge
from . import transfer

log = logging.getLogger(__name__)

cfg = Config.load()
app = FastAPI(title="openai-agent-app media stream")


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
    response = VoiceResponse()
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
    connect.append(stream)
    response.append(connect)
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
    log.info("after-transfer: DialCallStatus=%s caller=%s", dial_status, caller)
    return _xml(transfer.build_after_transfer_twiml(cfg, dial_status=dial_status, caller=caller))


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
    await run_bridge(websocket, cfg)
