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
import hashlib
import logging
import re
import threading
import urllib.parse
import urllib.request
import uuid
from collections import OrderedDict
from xml.sax.saxutils import escape

from flask import Flask, Response, request

from ..agent import CallSession, IntakeField, Scheduler
from ..agent.summary import summarize_call
from ..config import Config
from .outbound import OutboundQueue
from ..tools.backend import BackendClient
from ..tools.notify import EmailNotifier
from ..tools.voice import ElevenLabsVoice, VoiceError, _for_speech

# Twilio/Amazon Polly voices used when ElevenLabs is unavailable (e.g. out of
# credits) — a decent free fallback so testing never goes silent. Chosen to match
# the language of the (already-localized) text so Korean isn't read by an English
# voice. Extend _FALLBACK_VOICES for more languages.
# Max synthesized clips kept in memory (LRU). ~256 covers concurrent calls plus
# Twilio's fetch/retry window; frequently-spoken lines stay warm.
_MAX_CLIPS = 256
# Max pending callback records (form answers awaiting the call to connect). A
# safety bound in case a queued call never connects (the record is normally
# popped the instant the call is answered).
_MAX_PENDING = 512
_HANGUL = re.compile(r"[가-힣㄰-㆏ᄀ-ᇿ]")
_FALLBACK_VOICES = {
    "ko-KR": "Polly.Seoyeon",   # Korean
    "en-US": "Polly.Joanna",    # English (default)
}


def _fallback_say(text: str) -> str:
    """A Polly <Say> in a voice matched to the text's language."""
    lang = "ko-KR" if _HANGUL.search(text) else "en-US"
    return (
        f'<Say voice="{_FALLBACK_VOICES[lang]}" language="{lang}">'
        f"{escape(_for_speech(text))}</Say>"
    )

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
    # Questions asked of an inbound (non-prefilled) caller. Outbound calls to backend
    # leads arrive prefilled, so they skip intake entirely.
    return _DEMO_FIELDS


def create_app(cfg: Config | None = None) -> Flask:
    cfg = cfg or Config.load()
    app = Flask(__name__)
    fields = _load_fields(cfg)
    voice = ElevenLabsVoice(cfg)

    sessions: dict[str, CallSession] = {}
    # Synthesized audio, keyed by a hash of the text so identical lines (fillers,
    # re-prompts, repeated confirmations) are synthesized once — saves latency and
    # ElevenLabs credits. Bounded LRU so it never grows without limit.
    clips: OrderedDict[str, bytes] = OrderedDict()
    # token -> form answers awaiting a callback (popped when the call connects;
    # bounded in case a call never connects).
    pending: OrderedDict[str, dict[str, str]] = OrderedDict()
    thinking: dict[str, dict] = {}            # CallSid -> deferred off-script reply in flight
    outbound = OutboundQueue()                # all outbound calls, one at a time, retried
    notifier = EmailNotifier(cfg)             # post-call team email (CRM push)

    def base_url() -> str:
        return cfg.public_base_url or request.host_url.rstrip("/")

    def voice_clip(text: str) -> str | None:
        """Synthesize `text` to an audio clip and return its play URL, or None.

        Identical text reuses the cached clip (same hash key). Phone lines are
        8 kHz, so a small format + latency-opt is faster to generate and fetch.
        """
        clip_id = hashlib.sha1(text.encode("utf-8")).hexdigest()[:24]
        if clip_id in clips:
            clips.move_to_end(clip_id)   # mark most-recently used
            return f"{base_url()}/audio/{clip_id}.mp3"
        try:
            clips[clip_id] = voice.synthesize(
                text, output_format="mp3_22050_32", optimize_latency=3
            )
        except VoiceError as exc:
            log.warning("TTS failed (%s); falling back to Twilio voice", exc)
            return None
        while len(clips) > _MAX_CLIPS:
            clips.popitem(last=False)     # evict the oldest
        return f"{base_url()}/audio/{clip_id}.mp3"

    def speak(text: str) -> str:
        """TwiML to say `text` — <Play> the ElevenLabs clip, or a Polly <Say> fallback
        (used when ElevenLabs is unavailable, e.g. out of credits)."""
        url = voice_clip(text)
        if url:
            return f"<Play>{escape(url)}</Play>"
        return _fallback_say(text)

    def gather(prompt_twiml: str, locale: str = "en-US") -> Response:
        # Play the prompt FIRST, then listen. If the prompt is *inside* <Gather>,
        # the recognizer hears the agent's own audio over the phone line and
        # transcribes it as if the caller spoke — so the agent "answers itself" and
        # moves on without waiting. Playing first (no barge-in) fixes that.
        # phone_call + enhanced = better phone recognition; timeout = how long to
        # wait for the caller to start speaking after the prompt.
        xml = (
            '<?xml version="1.0" encoding="UTF-8"?>'
            "<Response>"
            f"{prompt_twiml}"
            '<Gather input="speech" action="/voice/turn" method="POST" '
            f'speechTimeout="{SPEECH_TIMEOUT}" speechModel="phone_call" enhanced="true" '
            f'actionOnEmptyResult="true" language="{locale}" timeout="7">'
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

    @app.errorhandler(Exception)
    def on_unhandled(exc: Exception):
        """Safety net: never let a caller hear Twilio's raw 'application error'. On any
        unhandled error in a voice webhook, say a graceful line and hang up; the
        exception is logged so we can fix the real cause."""
        log.exception("unhandled error on %s", request.path)
        if request.path.startswith("/voice/"):
            return hangup(speak(
                "I'm sorry, something went wrong on our end. Our team will follow up "
                "with you shortly. Goodbye!"
            ))
        return {"error": str(exc)}, 500

    def trigger_callback(record: dict[str, str], phone: str, is_callback: bool = False) -> str:
        """Stash the form answers and call the person. Returns the call SID.

        `is_callback` marks a ring-back from the queue (the caller asked us to
        call at this time) so the greeting differs from a first outreach.
        """
        token = uuid.uuid4().hex
        pending[token] = record
        while len(pending) > _MAX_PENDING:
            pending.popitem(last=False)   # drop the oldest un-connected record
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
        """Post-call outputs: Hermes summary -> sheet row, and a team email (CRM push).

        Runs in a background thread — the caller has already hung up. Fires on any real
        outcome (booked / callback / tracked); the email does NOT depend on the Sheets
        write succeeding.
        """
        if not (session.booked_at or session.callback_at or session.tracked_row):
            return
        if session._summarized:   # idempotent — never send the post-call email twice
            return
        session._summarized = True

        def work() -> None:
            try:
                text = summarize_call(
                    cfg, session.record,
                    booked_at=session.booked_at,
                    callback_at=session.callback_at,
                    transcript=session.transcript,
                )
                intake_id = session.record.get("_intake_id", "")
                if text and intake_id:   # attach the summary to the lead on the backend
                    try:
                        BackendClient(cfg).set_notes(intake_id, text)
                        log.info("wrote call summary to intake %s", intake_id)
                    except Exception as exc:  # noqa: BLE001
                        log.warning("could not write call summary: %s", exc)
                if notifier.configured:
                    subject, body = _post_call_email(
                        session.record, session.booked_at, session.callback_at, text
                    )
                    notifier.send(subject, body)
                elif session.booked_at:
                    log.info("post-call email skipped: SMTP not configured "
                             "(set SMTP_* + NOTIFY_EMAIL in .env)")
            except Exception as exc:  # noqa: BLE001 — background; log, never swallow silently
                log.warning("post-call outputs failed: %s", exc)

        threading.Thread(target=work, daemon=True).start()

    @app.post("/voice/incoming")
    def incoming():
        call_sid = request.values.get("CallSid", uuid.uuid4().hex)
        direction = request.values.get("direction", "inbound")
        token = request.values.get("token", "")
        is_callback = request.values.get("callback") == "1"
        prefilled = pending.pop(token, None) if token else None
        session = CallSession(
            cfg, fields,
            direction=direction, prefilled=prefilled, callback=is_callback,
        )
        sessions[call_sid] = session
        return gather(speak(session.start()), session.speech_locale)

    @app.post("/voice/amd")
    def amd():
        """Async answering-machine result. If a machine picked up, interrupt the live
        call and leave a short voicemail instead."""
        call_sid = request.values.get("CallSid", "")
        if not request.values.get("AnsweredBy", "").startswith("machine"):
            return ("", 204)   # human (or unknown) — the conversation continues
        session = sessions.pop(call_sid, None)
        name = session.record.get("full_name", "").split(" ")[0] if session else ""
        log.info("voicemail detected (async) on %s; leaving a message", call_sid)
        try:
            twiml = (
                '<?xml version="1.0" encoding="UTF-8"?>'
                f"<Response>{speak(_voicemail_message(cfg, name))}<Hangup/></Response>"
            )
            _update_call(cfg, call_sid, twiml)
        except Exception as exc:  # noqa: BLE001 — never let this break anything
            log.warning("could not leave voicemail on %s: %s", call_sid, exc)
        return ("", 204)

    @app.post("/voice/turn")
    def turn():
        call_sid = request.values.get("CallSid", "")
        session = sessions.get(call_sid)
        if session is None:  # unknown/expired call — restart cleanly
            session = CallSession(cfg, fields)
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
        if result.next == "think":
            # Say a brief filler now; generate the (slower) off-script reply in the
            # background WHILE it plays, so the caller doesn't hear silence.
            holder: dict = {}
            th = threading.Thread(target=lambda: holder.update(turn=session.think()), daemon=True)
            th.start()
            thinking[call_sid] = {"thread": th, "holder": holder}
            return play_then(speak(result.reply), "/voice/think")
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

    @app.route("/voice/think", methods=["POST", "GET"])
    def think():
        # The off-script reply was generated in the background during the filler.
        call_sid = request.values.get("CallSid", "")
        session = sessions.get(call_sid)
        if session is None:
            return hangup(speak("Thanks, we'll be in touch. Goodbye!"))
        entry = thinking.pop(call_sid, None)
        if entry:
            entry["thread"].join(timeout=cfg.request_timeout)   # usually already done
            turn = entry["holder"].get("turn")
        else:
            turn = session.think()   # fallback if the background task was lost
        if turn is None:   # generation still running or failed — keep the line alive
            turn = session.think()
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
        clips.move_to_end(clip_id)   # keep a clip that's still being fetched warm
        return Response(data, mimetype="audio/mpeg")

    @app.post("/voice/status")
    def call_status_cb():
        """Twilio call-status callback. Fires when a call ends (answered, no-answer,
        dropped, …); we clear its in-memory state so nothing leaks on a dropped call."""
        call_sid = request.values.get("CallSid", "")
        if call_sid:
            sessions.pop(call_sid, None)
            thinking.pop(call_sid, None)
        log.info("call %s ended (%s); cleaned up", call_sid, request.values.get("CallStatus", ""))
        return ("", 204)

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


def _post_call_email(
    record: dict[str, str], booked_at: str, callback_at: str, summary: str
) -> tuple[str, str]:
    """Compose the team notification (confirmed time, purpose, follow-ups, contact)."""
    name = record.get("full_name") or "Lead"
    if booked_at:
        outcome = f"Booked a consultation for {Scheduler.friendly(booked_at)}"
    elif callback_at:
        outcome = f"Requested a callback at {Scheduler.friendly(callback_at)}"
    else:
        outcome = "No appointment booked"
    subject = f"Lead call — {name}: {outcome}"
    body = "\n".join(
        [
            f"Lead:    {name}",
            f"Email:   {record.get('email', '')}",
            f"Phone:   {record.get('phone', '')}",
            f"Purpose: {record.get('purpose') or '(not given)'}",
            f"Wanted:  {record.get('desired_time', '')}",
            "",
            f"Outcome: {outcome}",
            "",
            "Notes / follow-ups for the consultant:",
            f"  {summary or '(no summary available)'}",
        ]
    )
    return subject, body


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
    fields = {
        "To": to,
        "From": cfg.twilio_phone_number,
        "Url": answer_url,
        # Notified when the call ends (any reason) so the server frees its state.
        "StatusCallback": f"{cfg.public_base_url}/voice/status",
        "StatusCallbackEvent": "completed",
        "StatusCallbackMethod": "POST",
    }
    if cfg.detect_voicemail:
        # ASYNC detection: the call connects and the agent speaks IMMEDIATELY, while
        # Twilio classifies human-vs-machine in parallel and posts the result to
        # /voice/amd. (Synchronous detection would hold the line for several seconds
        # before we could say anything — the cause of the "long delay before speaking".)
        fields["MachineDetection"] = "DetectMessageEnd"
        fields["AsyncAmd"] = "true"
        fields["AsyncAmdStatusCallback"] = f"{cfg.public_base_url}/voice/amd"
        fields["AsyncAmdStatusCallbackMethod"] = "POST"
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


def _update_call(cfg: Config, call_sid: str, twiml: str) -> None:
    """Redirect an in-progress Twilio call to new TwiML (used to leave a voicemail)."""
    api = f"https://api.twilio.com/2010-04-01/Accounts/{cfg.twilio_account_sid}/Calls/{call_sid}.json"
    auth = base64.b64encode(f"{cfg.twilio_account_sid}:{cfg.twilio_auth_token}".encode()).decode()
    data = urllib.parse.urlencode({"Twiml": twiml}).encode()
    req = urllib.request.Request(
        api, data=data, headers={"Authorization": f"Basic {auth}"}, method="POST"
    )
    urllib.request.urlopen(req, timeout=cfg.request_timeout).close()
