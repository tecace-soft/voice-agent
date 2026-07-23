"""CallSession — the whole conversation as a turn-by-turn engine.

Everything the caller experiences (ask the form questions, offer times, book,
say goodbye) lives here as a small state machine, decoupled from how the audio
arrives. A terminal loop, a phone call, or a test all drive it the same way:

    session = CallSession(cfg, fields)
    say(session.start())                 # agent speaks first
    while not turn.ended:
        turn = session.handle(caller_text)
        say(turn.reply)

This is the seam telephony plugs into: a Twilio/Deepgram pipeline feeds each
final transcript to `handle()` and speaks `turn.reply` back with ElevenLabs.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from ..config import Config
from ..tools.cal import CalError
from ..tools.gemini import GeminiTools
from ..tools.sheets import SheetsError
from .fulfillment import Fulfillment
from .intake import IntakeAgent, IntakeField
from .scheduler import Scheduler, attendee_name, language_from, speech_locale, timeframe_from

log = logging.getLogger(__name__)

MAX_SLOT_RETRIES = 2

# Cache translations of repeated lines (fixed prompts) across calls.
_LOCALIZE_CACHE: dict[tuple[str, str], str] = {}
_LOCALIZE_CACHE_MAX = 2000

# How the agent opens, depending on who placed the call.
OPENINGS = {
    "inbound": "Hi, thanks for calling.",
    "outbound": "Hi, this is the scheduling assistant reaching out to get you booked in.",
}


@dataclass
class Turn:
    reply: str          # what the agent should say next
    ended: bool         # True once the call should hang up


class CallSession:
    def __init__(
        self,
        cfg: Config,
        fields: list[IntakeField],
        *,
        event_type_id: int,
        direction: str = "inbound",
        opening: str | None = None,
        use_hermes_closing: bool = True,
        create_bookings: bool = True,
        prefilled: dict[str, str] | None = None,
        language: str | None = None,
    ) -> None:
        self._cfg = cfg
        self._fields = fields
        self._event_type_id = event_type_id
        self._direction = direction
        self._create_bookings = create_bookings
        self._gemini = GeminiTools(cfg)
        self._agent = IntakeAgent(
            cfg,
            fields,
            use_hermes_closing=use_hermes_closing,
            emit_closing=False,
            greeting_prefix=opening or OPENINGS.get(direction, OPENINGS["inbound"]),
        )
        # Scheduling runs only when Cal.com is configured.
        self._scheduling_enabled = bool(cfg.cal_api_key)
        self._scheduler: Scheduler | None = None
        self._offer = None
        self._slot_attempts = 0
        self._booked_at = ""
        # When the caller already answered the form (a post-submission callback),
        # skip intake and go straight to confirming a time.
        if prefilled:
            self._record = dict(prefilled)
            self._state = "confirm"     # confirm -> scheduling -> done
        else:
            self._record = {}
            self._state = "intake"      # intake -> scheduling -> done
        # Language: explicit wins; else read the form answer; else detect live as
        # the caller answers the language question (first field).
        if language is not None:
            self._language, self._detect_language = language, False
        elif prefilled:
            self._language, self._detect_language = language_from(prefilled), False
        else:
            self._language, self._detect_language = "English", True

    @property
    def record(self) -> dict[str, str]:
        return dict(self._record)

    @property
    def booked_at(self) -> str:
        """The chosen slot's ISO time, or '' if nothing was scheduled."""
        return self._booked_at

    @property
    def language(self) -> str:
        return self._language

    @property
    def speech_locale(self) -> str:
        """Twilio speech-recognition locale for the current language (e.g. ko-KR)."""
        return speech_locale(self._language)

    def localize(self, text: str) -> str:
        """Render an English agent line in the caller's language (no-op for English)."""
        if not text or self._language.lower().startswith("eng"):
            return text
        key = (self._language, text)
        if key in _LOCALIZE_CACHE:
            return _LOCALIZE_CACHE[key]
        try:
            out = self._gemini.translate(text, self._language)
        except Exception as exc:  # noqa: BLE001 — fall back to English rather than fail
            log.warning("translation failed (%s); speaking English", exc)
            return text
        if len(_LOCALIZE_CACHE) < _LOCALIZE_CACHE_MAX:
            _LOCALIZE_CACHE[key] = out
        return out

    def start(self) -> str:
        """The agent's opening line (it speaks first)."""
        if self._state == "confirm":
            name = attendee_name(self._record).split()[0]
            who = f" {name}" if name != "Caller" else ""
            greeting = (
                f"Hi{who}, thanks for filling out the form. I'd like to get your "
                "appointment booked — are you ready to pick a time?"
            )
        else:
            greeting = self._agent.greeting()
        return self.localize(greeting)

    def handle(self, caller_text: str) -> Turn:
        """Advance the conversation by one caller turn (reply in the caller's language)."""
        turn = self._dispatch(caller_text)
        self._refresh_language()
        return Turn(self.localize(turn.reply), turn.ended)

    def _dispatch(self, caller_text: str) -> Turn:
        if self._state == "confirm":
            return self._begin_scheduling()  # any reply moves us into scheduling
        if self._state == "intake":
            return self._handle_intake(caller_text)
        if self._state == "scheduling":
            return self._handle_pick(caller_text)
        return Turn("", True)

    def _refresh_language(self) -> None:
        """Once the caller answers the language question, switch to it."""
        if self._detect_language and self._record:
            self._language = language_from(self._record)

    # -- intake phase ----------------------------------------------------

    def _handle_intake(self, caller_text: str) -> Turn:
        result = self._agent.handle(caller_text)
        self._record = result.record
        if not result.done:
            return Turn(result.agent_message, False)
        if self._scheduling_enabled:
            return self._begin_scheduling()
        return self._finish()

    # -- scheduling phase ------------------------------------------------

    def _begin_scheduling(self) -> Turn:
        self._scheduler = Scheduler(self._cfg, self._event_type_id)
        try:
            self._offer = self._scheduler.offer(timeframe_from(self._record))
        except CalError as exc:
            log.warning("could not fetch slots: %s", exc)
            return self._finish()
        if not self._offer.options:
            # No openings — the offer message already asks for another timeframe.
            return self._finish(closing=self._offer.message)
        self._state = "scheduling"
        return Turn(self._offer.message, False)

    def _handle_pick(self, caller_text: str) -> Turn:
        chosen = self._scheduler.interpret(caller_text, self._offer.options)
        if not chosen:
            self._slot_attempts += 1
            if self._slot_attempts <= MAX_SLOT_RETRIES:
                return Turn("Sorry, I didn't catch which time. " + self._offer.message, False)
            return self._finish()  # give up scheduling, still save the record

        if self._create_bookings:
            try:
                self._scheduler.book(chosen, self._record)
                self._booked_at = chosen
            except (CalError, RuntimeError) as exc:
                log.warning("booking failed: %s", exc)
        else:
            self._booked_at = chosen  # intended slot, not actually booked
        return self._finish()

    # -- wrap up ---------------------------------------------------------

    def _finish(self, closing: str | None = None) -> Turn:
        self._track()
        self._state = "done"
        return Turn(closing or self._goodbye(), True)

    def _track(self) -> None:
        try:
            Fulfillment(self._cfg, self._fields).track(self._record, booked_at=self._booked_at)
        except SheetsError as exc:
            log.warning("could not save record to Sheets: %s", exc)

    def _goodbye(self) -> str:
        first = attendee_name(self._record).split()[0]
        hi = f", {first}" if first != "Caller" else ""
        if self._booked_at:
            return f"You're all set{hi} — I've got you down for {Scheduler.friendly(self._booked_at)}. Goodbye!"
        return f"Thanks{hi}, we'll be in touch. Goodbye!"
