"""Hand a live inbound call off to a human — and get the caller back if nobody answers.

Why this can't reuse the hang-up path: `<Connect>` is TERMINAL TwiML. When the bridge finishes a
call it sends Twilio a "mark", waits for the echo, and closes the WebSocket — which ends the
`<Connect><Stream>` and drops the line. There is no way to end the stream and KEEP the call. So a
transfer has to come from outside the stream entirely: we redirect the live call with the Twilio
REST API (`calls(sid).update(twiml=...)`), which replaces the running `<Connect>` with a `<Dial>`.

The handoff is WARM but deliberately FRICTIONLESS — the caller should reach a person as fast as
possible, so nothing is asked of the colleague:

  1. `<Number url=...>` points at /whisper, whose TwiML is played to the COLLEAGUE only, before the
     two legs are bridged. They hear who is calling and why, and then the call connects on its own
     — no keypress. Keep that announcement SHORT: while it plays, the caller is sitting in silence
     waiting to be bridged.
  2. `<Dial action=...>` points at /after-transfer, which runs when the dial ends for ANY reason.
     On no-answer/busy/declined the caller is still on the line and still ours — we put them back
     on the agent (with `transfer_failed=yes`, so its rules switch to taking a message) instead of
     dropping them into silence.
  3. `callerId` is the company's own main line, not the caller's number, so the transfer doesn't
     land on the colleague's phone as an unknown, spam-scored number. The caller's identity is
     carried by the whisper instead.

KNOWN TRADE-OFF of dropping the keypress. If the colleague's phone rolls to voicemail, Twilio
counts the call as ANSWERED: the caller is bridged into a voicemail greeting believing they reached
a person, and `DialCallStatus` comes back `completed`, so the recovery below never fires. A keypress
used to prevent this (a voicemail box cannot press 1). The mitigation now is RING_SECONDS — give up
BEFORE the phone rolls over, so the leg ends as a no-answer and the caller comes back to the agent.
That is why the ring time is short and configurable: it must stay under the voicemail rollover of
whichever phone is on the other end.
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
# This is now load-bearing, not just a comfort setting: with no keypress to stop it, a phone that
# rolls to voicemail will SWALLOW the caller, so we must give up first. Most mobiles roll over
# around 20-25s, so the default is deliberately under that. Tune it per phone with
# TRANSFER_RING_SECONDS — longer if people miss calls, shorter if callers reach voicemail.
DEFAULT_RING_SECONDS = 15


def build_transfer_twiml(
    cfg: Config, *, reason: str, caller: str, human_number: str = "", dialled: str = "",
    caller_name: str = "",
) -> str:
    """The TwiML that replaces the live `<Connect><Stream>` with a whispered dial to a human.

    `human_number` is the CUSTOMER's — one agent answers for several businesses, and each has its
    own person to reach. The .env value remains only as a single-tenant default and as the last
    resort in server.py's fallback handler, which runs when this app is down and cannot look
    anything up.
    """
    response = VoiceResponse()
    query = urlencode({"reason": reason or "", "caller": caller or ""})
    dial = Dial(
        # The company's main line — NOT the caller's number. See the module docstring.
        caller_id=cfg.main_line or cfg.twilio_from_number,
        timeout=cfg.transfer_ring_seconds,
        # `dialled` rides along because the caller may come BACK to us. Without it the returning
        # leg cannot look up whose business this is, and the agent answers a caller it has already
        # been talking to as a stranger — "Hello, I'm an assistant" — which is worse than the failed
        # transfer it is apologising for.
        action=(
            f"https://{cfg.public_host}/after-transfer?"
            + urlencode({
                "caller": caller or "",
                "dialled": dialled or "",
                # So a returning caller is not asked their name and their business a second time.
                # Capped: this rides in a URL, and the agent only needs the gist to confirm it back.
                "caller_name": (caller_name or "")[:80],
                "reason": (reason or "")[:200],
            })
        ),
        method="POST",
    )
    dial.append(
        Number(
            human_number or cfg.human_number,
            url=f"https://{cfg.public_host}/whisper?{query}",
            method="POST",
        )
    )
    response.append(dial)
    return str(response)


def build_whisper_twiml(cfg: Config, *, reason: str, caller: str) -> str:
    """Played to the COLLEAGUE only, then the legs bridge automatically.

    Running off the end of this TwiML with no further verbs is what connects the two parties, so
    there is deliberately nothing after the announcement — no Gather, no keypress, no decision to
    make. Keep it to roughly one breath: the caller hears SILENCE for however long this takes.
    """
    response = VoiceResponse()
    response.say(
        f"Call from {_spoken_digits(caller)}. {reason or 'They would like to book something.'}",
        voice="Polly.Joanna",
    )
    return str(response)


def build_after_transfer_twiml(
    cfg: Config, *, dial_status: str, caller: str, dialled: str = "",
    caller_name: str = "", reason: str = "",
) -> str:
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
    # Same number that was dialled the first time, so the agent picks the business back up and
    # carries on as the same assistant the caller has been speaking to.
    stream.parameter(name="dialled", value=dialled or "")
    stream.parameter(name="transfer_failed", value="yes")
    stream.parameter(name="caller_name", value=caller_name or "")
    stream.parameter(name="known_request", value=reason or "")
    connect.append(stream)
    response.append(connect)
    return str(response)


async def redirect_to_human(
    cfg: Config, *, call_sid: str, reason: str, caller: str, human_number: str = "",
    dialled: str = "", caller_name: str = "",
) -> str:
    """Redirect the live call out of the media stream and into the whispered dial.

    Runs the blocking Twilio SDK call off the event loop so the audio relay isn't stalled while the
    REST request is in flight.

    Returns "ok", "call_gone" (the caller had already hung up — there is nobody left to apologise
    to), or "failed" (the redirect was refused for some other reason and the caller IS still on the
    line). The distinction matters: recovering in conversation is right for one and pointless for
    the other, and filing both as "nobody was available" misreports what happened.
    """
    if not call_sid:
        log.warning("transfer requested but no call SID is known for this call")
        return "failed"
    target = human_number or cfg.human_number
    if not target:
        log.warning("transfer requested but no number is configured for this business")
        return "failed"
    twiml = build_transfer_twiml(
        cfg, reason=reason, caller=caller, human_number=target, dialled=dialled,
        caller_name=caller_name,
    )

    def _update() -> None:
        Client(cfg.twilio_account_sid, cfg.twilio_auth_token).calls(call_sid).update(twiml=twiml)

    # Twilio's own view of the call, asked for only when the redirect fails. "Call is not
    # in-progress" is the same 400 whether the caller hung up, the leg never answered, or we are
    # holding the wrong SID — and those need completely different fixes.
    def _status() -> str:
        try:
            return Client(cfg.twilio_account_sid, cfg.twilio_auth_token).calls(call_sid).fetch().status or "?"
        except Exception as exc:  # noqa: BLE001 — diagnostics must not raise over a failed transfer
            return f"unreadable ({exc})"

    try:
        await asyncio.to_thread(_update)
    except Exception as exc:  # noqa: BLE001 — a failed transfer must not drop the call
        status = await asyncio.to_thread(_status)
        log.warning(
            "could not transfer call %s — Twilio says the call is %r: %s", call_sid, status, exc
        )
        return "call_gone" if status in ("completed", "canceled", "busy", "no-answer", "failed") else "failed"
    log.info("transferred call %s to %s (%s)", call_sid, target, reason)
    return "ok"


def _spoken_digits(number: str) -> str:
    """A phone number the whisper can read out clearly, digit by digit."""
    digits = "".join(ch for ch in number if ch.isdigit())
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    if len(digits) != 10:
        return "an unknown number"
    return " ".join(digits[:3]) + ", " + " ".join(digits[3:6]) + ", " + " ".join(digits[6:])


__all__ = [
    "DEFAULT_RING_SECONDS",
    "build_after_transfer_twiml",
    "build_transfer_twiml",
    "build_whisper_twiml",
    "redirect_to_human",
]
