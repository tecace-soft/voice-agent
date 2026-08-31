"""Hand a live inbound call off to a human — and get the caller back if nobody answers.

Why this can't reuse the hang-up path: `<Connect>` is TERMINAL TwiML. When the bridge finishes a
call it sends Twilio a "mark", waits for the echo, and closes the WebSocket — which ends the
`<Connect><Stream>` and drops the line. There is no way to end the stream and KEEP the call. So a
transfer has to come from outside the stream entirely: we redirect the live call with the Twilio
REST API (`calls(sid).update(twiml=...)`), which replaces the running `<Connect>` with a `<Dial>`.

The handoff is deliberately WARM, in three parts:

  1. `<Number url=...>` points at /whisper, whose TwiML is played to the COLLEAGUE only, before the
     two legs are bridged. They hear who is calling and why, and press 1 to accept. Without that
     keypress the colleague's own voicemail would happily "answer" the transfer and swallow the
     caller.
  2. `<Dial action=...>` points at /after-transfer, which runs when the dial ends for ANY reason.
     On no-answer/busy/declined the caller is still on the line and still ours — we put them back
     on the agent (with `transfer_failed=yes`, so its rules switch to taking a message) instead of
     dropping them into silence.
  3. `callerId` is the company's own main line, not the caller's number, so the transfer doesn't
     land on the colleague's phone as an unknown, spam-scored number. The caller's identity is
     carried by the whisper instead.
"""

from __future__ import annotations

import asyncio
import logging
from urllib.parse import urlencode

from twilio.rest import Client
from twilio.twiml.voice_response import Connect, Dial, Number, Stream, VoiceResponse

from ..config import Config

log = logging.getLogger(__name__)

# How long the colleague's phone rings before we give up and hand the caller back to the agent.
# Long enough to reach a phone in a pocket, short enough that the caller doesn't feel abandoned.
RING_SECONDS = 20


def build_transfer_twiml(cfg: Config, *, reason: str, caller: str) -> str:
    """The TwiML that replaces the live `<Connect><Stream>` with a whispered dial to a human."""
    response = VoiceResponse()
    query = urlencode({"reason": reason or "", "caller": caller or ""})
    dial = Dial(
        # The company's main line — NOT the caller's number. See the module docstring.
        caller_id=cfg.main_line or cfg.twilio_from_number,
        timeout=RING_SECONDS,
        action=f"https://{cfg.public_host}/after-transfer?{urlencode({'caller': caller or ''})}",
        method="POST",
    )
    dial.append(
        Number(
            cfg.human_number,
            url=f"https://{cfg.public_host}/whisper?{query}",
            method="POST",
        )
    )
    response.append(dial)
    return str(response)


def build_whisper_twiml(cfg: Config, *, reason: str, caller: str) -> str:
    """Played to the COLLEAGUE only, before the legs bridge. They press 1 to accept.

    Falling off the end of the `<Gather>` (no keypress — a voicemail box, or a phone nobody picked
    up properly) hits the `<Hangup/>`, which ends this leg and sends the caller to /after-transfer.
    """
    response = VoiceResponse()
    spoken_caller = _spoken_digits(caller)
    gather = response.gather(num_digits=1, timeout=8, action=f"https://{cfg.public_host}/whisper-accept", method="POST")
    gather.say(
        f"Call from {spoken_caller}. {reason or 'They would like to book something.'} "
        "Press 1 to take the call.",
        voice="Polly.Joanna",
    )
    # No keypress: drop this leg so the caller falls through to /after-transfer and gets the agent
    # back, rather than being connected to a voicemail box that answered on the colleague's behalf.
    response.hangup()
    return str(response)


def build_whisper_accept_twiml(digits: str) -> str:
    """Empty TwiML bridges the two legs; anything else drops the colleague's leg."""
    response = VoiceResponse()
    if digits.strip() != "1":
        response.hangup()
    return str(response)


def build_after_transfer_twiml(cfg: Config, *, dial_status: str, caller: str) -> str:
    """Runs when the dial ends, for any reason.

    `completed` means the two of them talked and it is over — hang up. Anything else (no-answer,
    busy, failed, or the colleague never pressed 1) means the caller never reached a human and is
    still holding, so put them back on the agent with `transfer_failed=yes`.
    """
    response = VoiceResponse()
    if dial_status == "completed":
        response.hangup()
        return str(response)
    connect = Connect()
    stream = Stream(url=cfg.stream_url)
    stream.parameter(name="direction", value="inbound")
    stream.parameter(name="caller", value=caller or "")
    stream.parameter(name="transfer_failed", value="yes")
    connect.append(stream)
    response.append(connect)
    return str(response)


async def redirect_to_human(cfg: Config, *, call_sid: str, reason: str, caller: str) -> bool:
    """Redirect the live call out of the media stream and into the whispered dial.

    Runs the blocking Twilio SDK call off the event loop so the audio relay isn't stalled while the
    REST request is in flight. Returns False if the redirect could not be issued, so the caller can
    be told something honest instead of sitting in silence.
    """
    if not call_sid:
        log.warning("transfer requested but no call SID is known for this call")
        return False
    if not cfg.human_number:
        log.warning("transfer requested but HUMAN_TRANSFER_NUMBER is not configured")
        return False
    twiml = build_transfer_twiml(cfg, reason=reason, caller=caller)

    def _update() -> None:
        Client(cfg.twilio_account_sid, cfg.twilio_auth_token).calls(call_sid).update(twiml=twiml)

    try:
        await asyncio.to_thread(_update)
    except Exception as exc:  # noqa: BLE001 — a failed transfer must not drop the call
        log.warning("could not transfer call %s: %s", call_sid, exc)
        return False
    log.info("transferred call %s to %s (%s)", call_sid, cfg.human_number, reason)
    return True


def _spoken_digits(number: str) -> str:
    """A phone number the whisper can read out clearly, digit by digit."""
    digits = "".join(ch for ch in number if ch.isdigit())
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    if len(digits) != 10:
        return "an unknown number"
    return " ".join(digits[:3]) + ", " + " ".join(digits[3:6]) + ", " + " ".join(digits[6:])


__all__ = [
    "RING_SECONDS",
    "build_after_transfer_twiml",
    "build_transfer_twiml",
    "build_whisper_accept_twiml",
    "build_whisper_twiml",
    "redirect_to_human",
]
