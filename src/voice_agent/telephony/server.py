"""Twilio <-> CallSession bridge over plain webhooks (no Twilio SDK).

Turn-based phone calls using Twilio's built-in speech recognition:

  incoming call -> POST /voice/incoming  -> greet, then <Gather> the reply
  each reply    -> POST /voice/turn      -> CallSession.handle(), speak, gather
  end of call   -> <Play> goodbye + <Hangup>

The agent's lines are spoken in the ElevenLabs voice: we synthesize each line to
mp3, serve it from /audio/<id>, and hand Twilio a <Play> URL. Outbound calls are
placed with Twilio's REST API (`place_call`) pointing back at /voice/incoming.

State is kept in memory per Twilio CallSid — fine for a single-process dev/test
server; a multi-worker deployment would move it to a shared store.
"""

from __future__ import annotations

import base64
import logging
import re
import threading
import urllib.parse
import urllib.request
import uuid
from xml.sax.saxutils import escape

from flask import Flask, Response, request

from ..agent import CallSession, Fulfillment, IntakeField
from ..agent.summary import summarize_call
from ..config import Config
from .outbound import OutboundQueue
from ..tools.google_forms import GoogleFormsClient, GoogleFormsError
from ..tools.voice import ElevenLabsVoice, VoiceError

log = logging.getLogger(__name__)

# Seconds of silence before Twilio decides the caller finished. "auto" adapts;
# a fixed low value (e.g. "2") cuts dead-air but risks clipping a slow speaker.
SPEECH_TIMEOUT = "auto"

_DEMO_FIELDS = [
    IntakeField("full_name", "the caller's full name"),
    IntakeField("email", "an email address"),
    IntakeField("phone", "a phone number"),
    IntakeField("reason", "why they are getting in touch"),
]


def _load_fields(cfg: Config) -> list[IntakeField]:
    try:
        return GoogleFormsClient(cfg).fields()
    except GoogleFormsError as exc:
        log.warning("Google Forms unavailable (%s); using demo questions", exc)
        return _DEMO_FIELDS


def create_app(cfg: Config | None = None) -> Flask:
    cfg = cfg or Config.load()
    app = Flask(__name__)
    fields = _load_fields(cfg)
    voice = ElevenLabsVoice(cfg)

    sessions: dict[str, CallSession] = {}
    clips: dict[str, bytes] = {}
    pending: dict[str, dict[str, str]] = {}   # token -> form answers awaiting a callback
    outbound = OutboundQueue()                # all outbound calls, one at a time, retried

    def base_url() -> str:
        return cfg.public_base_url or request.host_url.rstrip("/")

    def voice_clip(text: str) -> str | None:
        """Synthesize `text` to an audio clip and return its play URL, or None."""
        try:
            clip_id = uuid.uuid4().hex
            # Phone lines are 8 kHz, so a small format + latency-opt is faster to
            # generate and for Twilio to fetch, with no audible loss.
            clips[clip_id] = voice.synthesize(
                text, output_format="mp3_22050_32", optimize_latency=3
            )
            return f"{base_url()}/audio/{clip_id}.mp3"
        except VoiceError as exc:
            log.warning("TTS failed (%s); falling back to Twilio voice", exc)
            return None

    def speak(text: str) -> str:
        """TwiML to say `text` — <Play> the ElevenLabs clip, or <Say> as fallback."""
        url = voice_clip(text)
        if url:
            return f"<Play>{escape(url)}</Play>"
        return f"<Say>{escape(text)}</Say>"

    def gather(prompt_twiml: str, locale: str = "en-US") -> Response:
        # phone_call + enhanced = better phone recognition (fewer retries); the
        # caller can barge in over the prompt (Gather listens during <Play>).
        xml = (
            '<?xml version="1.0" encoding="UTF-8"?>'
            "<Response>"
            '<Gather input="speech" action="/voice/turn" method="POST" '
            f'speechTimeout="{SPEECH_TIMEOUT}" speechModel="phone_call" enhanced="true" '
            f'actionOnEmptyResult="true" language="{locale}">'
            f"{prompt_twiml}"
            "</Gather>"
            # If Gather returns without posting (rare), keep the line open.
            "<Redirect>/voice/turn</Redirect>"
            "</Response>"
        )
        return Response(xml, mimetype="text/xml")

    def hangup(prompt_twiml: str) -> Response:
        xml = (
            '<?xml version="1.0" encoding="UTF-8"?>'
            f"<Response>{prompt_twiml}<Hangup/></Response>"
        )
        return Response(xml, mimetype="text/xml")

    def play_then(prompt_twiml: str, target: str) -> Response:
        """Speak a line, then fetch `target` — the slow work happens during playback."""
        xml = (
            '<?xml version="1.0" encoding="UTF-8"?>'
            f"<Response>{prompt_twiml}<Redirect>{target}</Redirect></Response>"
        )
        return Response(xml, mimetype="text/xml")

    def trigger_callback(record: dict[str, str], phone: str, is_callback: bool = False) -> str:
        """Stash the form answers and call the person. Returns the call SID.

        `is_callback` marks a ring-back from the queue (the caller asked us to
        call at this time) so the greeting differs from a first outreach.
        """
        token = uuid.uuid4().hex
        pending[token] = record
        extra = {"token": token}
        if is_callback:
            extra["callback"] = "1"
        try:
            sid = place_call(cfg, phone, extra_params=extra)
            log.info("%s placed to %s (sid %s)", "callback" if is_callback else "call", phone, sid)
            return sid
        except Exception:
            pending.pop(token, None)
            raise

    # Exposed so the Google Forms poller can enqueue, and run_phone can start the
    # queue worker (which places calls via trigger_callback).
    app.trigger_callback = trigger_callback   # type: ignore[attr-defined]
    app.outbound_queue = outbound             # type: ignore[attr-defined]

    def summarize_async(session: CallSession) -> None:
        """Have Hermes summarize the finished call and write it to the sheet row.

        Runs in a background thread — the caller has already hung up, so Hermes's
        latency never touches the conversation. No-op if nothing was tracked.
        """
        if not session.tracked_row:
            return

        def work() -> None:
            text = summarize_call(
                cfg, session.record,
                booked_at=session.booked_at,
                callback_at=session.callback_at,
                transcript=session.transcript,
            )
            if not text:
                return
            try:
                Fulfillment(cfg, fields).note(session.tracked_row, text)
                log.info("wrote Hermes call summary to row %d", session.tracked_row)
            except Exception as exc:  # noqa: BLE001
                log.warning("could not write call summary: %s", exc)

        threading.Thread(target=work, daemon=True).start()

    @app.post("/voice/incoming")
    def incoming():
        call_sid = request.values.get("CallSid", uuid.uuid4().hex)
        direction = request.values.get("direction", "inbound")
        token = request.values.get("token", "")
        is_callback = request.values.get("callback") == "1"
        prefilled = pending.pop(token, None) if token else None
        # Voicemail (Twilio AMD): leave a short message instead of the live flow.
        if request.values.get("AnsweredBy", "").startswith("machine"):
            name = (prefilled or {}).get("full_name", "").split(" ")[0]
            log.info("voicemail detected on %s; leaving a message", call_sid)
            return hangup(speak(_voicemail_message(cfg, name)))
        session = CallSession(
            cfg, fields, event_type_id=cfg.cal_event_type_id,
            direction=direction, prefilled=prefilled, callback=is_callback,
        )
        sessions[call_sid] = session
        return gather(speak(session.start()), session.speech_locale)

    @app.post("/voice/turn")
    def turn():
        call_sid = request.values.get("CallSid", "")
        session = sessions.get(call_sid)
        if session is None:  # unknown/expired call — restart cleanly
            session = CallSession(cfg, fields, event_type_id=cfg.cal_event_type_id)
            sessions[call_sid] = session
            return gather(speak(session.start()), session.speech_locale)

        said = request.values.get("SpeechResult", "").strip()
        if not said:
            reprompt = session.localize("Sorry, I didn't catch that. Could you say it again?")
            return gather(speak(reprompt), session.speech_locale)

        result = session.handle(said)
        if result.next == "check":
            # Say "let me check…" now; query availability while it plays.
            return play_then(speak(result.reply), "/voice/check")
        if result.next == "finalize":
            # Say "one moment…" now; book + save while it plays, then confirm.
            return play_then(speak(result.reply), "/voice/finalize")
        if result.ended:
            if session.callback_at and session.phone:
                outbound.add(
                    session.record, session.phone,
                    due_at=session.callback_at, is_callback=True,
                )
            summarize_async(session)   # Hermes notes, in the background
            sessions.pop(call_sid, None)
            return hangup(speak(result.reply))
        return gather(speak(result.reply), session.speech_locale)

    @app.route("/voice/check", methods=["POST", "GET"])
    def check():
        call_sid = request.values.get("CallSid", "")
        session = sessions.get(call_sid)
        if session is None:
            return hangup(speak("Thanks, we'll be in touch. Goodbye!"))
        turn = session.check_availability()   # the Cal.com availability lookup
        return gather(speak(turn.reply), session.speech_locale)

    @app.route("/voice/finalize", methods=["POST", "GET"])
    def finalize():
        call_sid = request.values.get("CallSid", "")
        session = sessions.pop(call_sid, None)
        if session is None:
            return hangup(speak("Thanks, we'll be in touch. Goodbye!"))
        turn = session.finalize()   # the actual Cal.com booking + Sheets save
        summarize_async(session)    # Hermes notes, in the background
        return hangup(speak(turn.reply))

    @app.get("/audio/<clip_id>.mp3")
    def audio(clip_id: str):
        data = clips.get(clip_id)
        if data is None:
            return Response(status=404)
        return Response(data, mimetype="audio/mpeg")

    @app.post("/call")
    def call_out():
        to = request.values.get("to", "").strip()
        if not to:
            return {"error": "provide a 'to' phone number"}, 400
        try:
            sid = place_call(cfg, to)
            return {"status": "calling", "to": to, "call_sid": sid}
        except Exception as exc:  # noqa: BLE001 — report any placement failure
            return {"error": str(exc)}, 502

    @app.get("/health")
    def health():
        return {"status": "ok", "questions": len(fields), "phone": cfg.twilio_phone_number}

    return app


def _e164(raw: str, default_country: str = "1") -> str:
    """Best-effort E.164 (+countrycode…) so Twilio accepts the number.

    A Google Forms text field yields whatever was typed ("(425) 478-7534",
    "4254787534"); Twilio needs "+14254787534". A US 10-digit number gets +1;
    an 11-digit 1xxxxxxxxxx or an already-+ number is respected.
    """
    raw = raw.strip()
    keep_plus = raw.startswith("+")
    digits = re.sub(r"\D", "", raw)
    if not digits:
        return raw
    if keep_plus:
        return "+" + digits
    if len(digits) == 10:
        return "+" + default_country + digits
    return "+" + digits  # 11+ digits: assume it already carries a country code


def _voicemail_message(cfg: Config, name: str) -> str:
    """Short message left when a call goes to voicemail (Twilio AMD)."""
    who = f" {name}" if name else ""
    return (
        f"Hi{who}, this is {cfg.agent_name}, TecAce's AI assistant. We received your "
        "inquiry about AI transformation consulting and would love to set up a quick "
        "call with one of our consultants. We'll follow up by email as well. "
        "Thanks, and talk soon!"
    )


def place_call(cfg: Config, to_number: str, *, extra_params: dict[str, str] | None = None) -> str:
    """Place an outbound call via Twilio's REST API. Returns the call SID."""
    if not (cfg.twilio_account_sid and cfg.twilio_auth_token and cfg.twilio_phone_number):
        raise RuntimeError("Twilio credentials are not configured in .env")
    if not cfg.public_base_url:
        raise RuntimeError("PUBLIC_BASE_URL must be set so Twilio can reach the server")

    to = _e164(to_number)
    params = {"direction": "outbound", **(extra_params or {})}
    answer_url = f"{cfg.public_base_url}/voice/incoming?{urllib.parse.urlencode(params)}"
    fields = {"To": to, "From": cfg.twilio_phone_number, "Url": answer_url}
    if cfg.detect_voicemail:
        # Twilio waits for the greeting to end, then calls Url with AnsweredBy set,
        # so we can leave a message when a machine picks up.
        fields["MachineDetection"] = "DetectMessageEnd"
    form = urllib.parse.urlencode(fields).encode()
    api = f"https://api.twilio.com/2010-04-01/Accounts/{cfg.twilio_account_sid}/Calls.json"
    auth = base64.b64encode(f"{cfg.twilio_account_sid}:{cfg.twilio_auth_token}".encode()).decode()
    req = urllib.request.Request(
        api, data=form, headers={"Authorization": f"Basic {auth}"}, method="POST"
    )
    import json

    with urllib.request.urlopen(req, timeout=cfg.request_timeout) as resp:
        return json.load(resp).get("sid", "")


def call_status(cfg: Config, sid: str) -> str:
    """The Twilio status of a call: queued/ringing/in-progress/completed/busy/…"""
    import json

    api = f"https://api.twilio.com/2010-04-01/Accounts/{cfg.twilio_account_sid}/Calls/{sid}.json"
    auth = base64.b64encode(f"{cfg.twilio_account_sid}:{cfg.twilio_auth_token}".encode()).decode()
    req = urllib.request.Request(api, headers={"Authorization": f"Basic {auth}"})
    with urllib.request.urlopen(req, timeout=cfg.request_timeout) as resp:
        return json.load(resp).get("status", "")
