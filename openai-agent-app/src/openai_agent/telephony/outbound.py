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
    for key in (
        "intake_id", "lead_name", "purpose", "email",
        "requested_date", "requested_date_iso",
        "desired_time", "dateTime", "is_callback",
    ):
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
    call = client.calls.create(
        from_=to_e164(cfg.twilio_from_number),
        to=dest,
        twiml=twiml,
        # Answering-machine detection in the BACKGROUND (async): the call connects immediately so
        # a real person isn't kept waiting, and Twilio reports human/machine once it decides. The
        # result posts to /amd (which tells the live call to leave a voicemail) and is also
        # readable off the call (see fetch_call_result). "DetectMessageEnd" waits for the greeting
        # to finish / beep, so the agent's message lands after the beep rather than over it.
        machine_detection="DetectMessageEnd",
        async_amd="true",
        async_amd_status_callback=f"https://{cfg.public_host}/amd",
        async_amd_status_callback_method="POST",
    )
    log.info("placed call %s to %s (lead %r)", call.sid, dest, lead.get("lead_name"))
    return call.sid


# Twilio call statuses that mean the call is over (vs. queued / ringing / in-progress).
_TERMINAL_STATUSES = frozenset({"completed", "busy", "no-answer", "failed", "canceled"})


def fetch_call_result(cfg: Config, call_sid: str) -> dict | None:
    """Fetch a call's current Twilio status and answering-machine-detection result. Returns
    {"status": ..., "answered_by": ...} (answered_by is None until AMD completes), or None if it
    can't be fetched. Lets the poller detect a finished call — and whether it hit voicemail —
    immediately, instead of waiting the safety cap."""
    if not call_sid:
        return None
    try:
        client = Client(cfg.twilio_account_sid, cfg.twilio_auth_token)
        call = client.calls(call_sid).fetch()
        return {"status": call.status, "answered_by": call.answered_by}
    except Exception as exc:  # noqa: BLE001 — a status hiccup shouldn't disturb the poll loop
        log.warning("could not fetch call %s: %s", call_sid, exc)
        return None


def call_has_ended(status: str | None) -> bool:
    """True when a Twilio call status is terminal (the call is over)."""
    return status in _TERMINAL_STATUSES


def is_machine(answered_by: str | None) -> bool:
    """True if AMD decided a machine/voicemail answered (answered_by like 'machine_start',
    'machine_end_beep', 'fax')."""
    return bool(answered_by) and (answered_by.startswith("machine") or answered_by == "fax")
