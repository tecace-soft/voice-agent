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
import urllib.parse
import urllib.request
import uuid
from xml.sax.saxutils import escape

from flask import Flask, Response, request

from ..agent import CallSession, IntakeField
from ..config import Config
from ..tools.typeform import (
    TypeformClient,
    TypeformError,
    record_from_webhook,
    verify_webhook_signature,
)
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
        return TypeformClient(cfg).fields()
    except TypeformError as exc:
        log.warning("Typeform unavailable (%s); using demo questions", exc)
        return _DEMO_FIELDS


def create_app(cfg: Config | None = None) -> Flask:
    cfg = cfg or Config.load()
    app = Flask(__name__)
    fields = _load_fields(cfg)
    voice = ElevenLabsVoice(cfg)

    sessions: dict[str, CallSession] = {}
    clips: dict[str, bytes] = {}
    pending: dict[str, dict[str, str]] = {}   # token -> form answers awaiting a callback

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

    def trigger_callback(record: dict[str, str], phone: str) -> str:
        """Stash the form answers and call the person back. Returns the call SID."""
        token = uuid.uuid4().hex
        pending[token] = record
        try:
            sid = place_call(cfg, phone, extra_params={"token": token})
            log.info("callback placed to %s (sid %s)", phone, sid)
            return sid
        except Exception:
            pending.pop(token, None)
            raise

    # Exposed so the Typeform poller (same process) can place callbacks too.
    app.trigger_callback = trigger_callback  # type: ignore[attr-defined]

    @app.post("/typeform/webhook")
    def typeform_webhook():
        body = request.get_data()
        if not verify_webhook_signature(
            cfg.typeform_webhook_secret, body, request.headers.get("Typeform-Signature")
        ):
            return Response("bad signature", status=403)
        record, phone = record_from_webhook(
            (request.get_json(force=True, silent=True) or {}).get("form_response", {})
        )
        if not phone:
            log.warning("form submission has no phone number; cannot call back")
            return {"status": "no phone number in submission"}, 200
        try:
            sid = trigger_callback(record, phone)
            return {"status": "calling", "to": phone, "call_sid": sid}, 200
        except Exception as exc:  # noqa: BLE001 — ack Typeform so it doesn't retry-storm
            log.warning("could not place callback: %s", exc)
            return {"status": f"call failed: {exc}"}, 200

    @app.post("/voice/incoming")
    def incoming():
        call_sid = request.values.get("CallSid", uuid.uuid4().hex)
        direction = request.values.get("direction", "inbound")
        token = request.values.get("token", "")
        prefilled = pending.pop(token, None) if token else None
        session = CallSession(
            cfg, fields, event_type_id=cfg.cal_event_type_id,
            direction=direction, prefilled=prefilled,
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


def place_call(cfg: Config, to_number: str, *, extra_params: dict[str, str] | None = None) -> str:
    """Place an outbound call via Twilio's REST API. Returns the call SID."""
    if not (cfg.twilio_account_sid and cfg.twilio_auth_token and cfg.twilio_phone_number):
        raise RuntimeError("Twilio credentials are not configured in .env")
    if not cfg.public_base_url:
        raise RuntimeError("PUBLIC_BASE_URL must be set so Twilio can reach the server")

    params = {"direction": "outbound", **(extra_params or {})}
    answer_url = f"{cfg.public_base_url}/voice/incoming?{urllib.parse.urlencode(params)}"
    form = urllib.parse.urlencode(
        {"To": to_number, "From": cfg.twilio_phone_number, "Url": answer_url}
    ).encode()
    api = f"https://api.twilio.com/2010-04-01/Accounts/{cfg.twilio_account_sid}/Calls.json"
    auth = base64.b64encode(f"{cfg.twilio_account_sid}:{cfg.twilio_auth_token}".encode()).decode()
    req = urllib.request.Request(
        api, data=form, headers={"Authorization": f"Basic {auth}"}, method="POST"
    )
    import json

    with urllib.request.urlopen(req, timeout=cfg.request_timeout) as resp:
        return json.load(resp).get("sid", "")
