"""Place an outbound call via Twilio and hand its audio to our media-stream server.

The call's TwiML connects a <Stream> to wss://<public_host>/media-stream and passes the lead's
details as <Parameter> elements — the bridge reads them from Twilio's "start" event to render
the instructions and key the tools to this lead (the same details the Retell poller passes as
dynamic variables).
"""

from __future__ import annotations

import logging

from twilio.rest import Client
from twilio.twiml.voice_response import Connect, Stream, VoiceResponse

from ..config import Config

log = logging.getLogger(__name__)


def to_e164(number: str, default_country_code: str = "1") -> str:
    """Best-effort E.164 normalization — Twilio rejects anything else. A bare 10-digit US number
    gets +1; an already-`+`-prefixed number keeps its digits; blank passes through."""
    s = number.strip()
    if not s:
        return s
    if s.startswith("+"):
        return "+" + "".join(ch for ch in s[1:] if ch.isdigit())
    digits = "".join(ch for ch in s if ch.isdigit())
    if len(digits) == 10:
        return f"+{default_country_code}{digits}"
    if len(digits) == 11 and digits.startswith("1"):
        return f"+{digits}"
    return f"+{digits}" if digits else s


def build_twiml(public_host: str, lead: dict) -> str:
    """TwiML that streams the call to our server, passing the lead's details as parameters."""
    response = VoiceResponse()
    connect = Connect()
    stream = Stream(url=f"wss://{public_host}/media-stream")
    for key in ("intake_id", "lead_name", "purpose", "email", "desired_time", "dateTime", "is_callback"):
        value = lead.get(key)
        if value:
            stream.parameter(name=key, value=str(value))
    connect.append(stream)
    response.append(connect)
    return str(response)


def place_call(cfg: Config, *, to_number: str, lead: dict) -> str:
    """Dial `to_number` and connect it to the realtime agent. Returns the Twilio call SID."""
    twiml = build_twiml(cfg.public_host, lead)
    client = Client(cfg.twilio_account_sid, cfg.twilio_auth_token)
    dest = to_e164(to_number)
    call = client.calls.create(from_=to_e164(cfg.twilio_from_number), to=dest, twiml=twiml)
    log.info("placed call %s to %s (lead %r)", call.sid, dest, lead.get("lead_name"))
    return call.sid
