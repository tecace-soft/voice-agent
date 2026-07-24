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
from .persona import smalltalk_reply
from .scheduler import (
    DEFAULT_TIMEZONE,
    Scheduler,
    attendee_name,
    language_from,
    parse_time,
    phone_from,
    speech_locale,
    timeframe_from,
)

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
    reply: str                 # what the agent should say next
    next: str = "listen"       # "listen" (await reply) | "finalize" (do slow work) | "hangup"

    @property
    def ended(self) -> bool:
        return self.next == "hangup"


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
        callback: bool = False,
    ) -> None:
        self._cfg = cfg
        self._fields = fields
        self._event_type_id = event_type_id
        self._direction = direction
        self._create_bookings = create_bookings
        # True when this call is the agent ringing back at a time the caller
        # asked for earlier — changes the opening line (see start()).
        self._is_callback = callback
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
        self._chosen = ""       # slot the caller picked, booked during finalize()
        self._requested = ""    # a specific time the caller asked us to check
        self._candidate = ""    # a free slot we've proposed, awaiting yes/no
        self._day = ""          # the day currently in focus, for "other times that day"
        self._callback_at = ""  # if not ready now, when to call back instead
        self._transcript: list[str] = []  # spoken exchange, for the post-call summary
        self._tracked_row = 0   # sheet row this call was saved to (0 = not tracked)
        # When the caller already answered the form (a post-submission callback),
        # skip intake: check we've reached the right person, then confirm a time.
        if prefilled:
            self._record = dict(prefilled)
            self._state = "identity"    # identity -> confirm -> scheduling -> done
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
    def callback_at(self) -> str:
        """If the caller wasn't ready, the ISO time to call them back (else '')."""
        return self._callback_at

    @property
    def phone(self) -> str:
        """The caller's phone number, from the record."""
        return phone_from(self._record)

    @property
    def tracked_row(self) -> int:
        """Sheet row this call was saved to (0 if nothing was tracked)."""
        return self._tracked_row

    @property
    def transcript(self) -> str:
        """The spoken exchange so far, for the post-call summary."""
        return "\n".join(self._transcript)

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
        if self._state == "identity":
            name = self._first_name()
            greeting = (
                f"Hi, may I speak with {name}?" if name
                else "Hi, is this the person who reached out to TecAce about AI consulting?"
            )
        elif self._state == "confirm":
            greeting = self._intro()   # fallback if a session opens straight in confirm
        else:
            greeting = self._agent.greeting()
        return self.localize(greeting)

    def _first_name(self) -> str:
        name = attendee_name(self._record).split()[0]
        return "" if name == "Caller" else name

    def _intro(self) -> str:
        """Tess's introduction + the readiness ask (State 1, right person)."""
        name = self._first_name()
        who = f" {name}" if name else ""
        agent = self._cfg.agent_name
        if self._is_callback:
            return (
                f"Hi{who}, this is {agent}, TecAce's AI assistant, calling back at the "
                "time you requested. Do you have a quick minute to set up your "
                "consultation call?"
            )
        return (
            f"Hi{who}, this is {agent}, TecAce's AI assistant. You recently reached out "
            "to us about AI transformation consulting — do you have a quick minute to "
            "set up a call with one of our consultants?"
        )

    def handle(self, caller_text: str) -> Turn:
        """Advance the conversation by one caller turn (reply in the caller's language)."""
        turn = self._dispatch(caller_text)
        self._refresh_language()
        reply = self.localize(turn.reply)
        self._transcript.append(f"Caller: {caller_text}")
        if reply:
            self._transcript.append(f"Agent: {reply}")
        return Turn(reply, turn.next)

    def finalize(self) -> Turn:
        """Do the slow booking + save, then confirm. Called after the 'one moment'
        acknowledgement is spoken, so the caller isn't left in silence."""
        if self._chosen:
            if self._create_bookings:
                try:
                    self._scheduler.book(self._chosen, self._record)
                    self._booked_at = self._chosen
                except (CalError, RuntimeError) as exc:
                    log.warning("booking failed: %s", exc)
            else:
                self._booked_at = self._chosen  # intended slot, not actually booked
        self._track()
        self._state = "done"
        return Turn(self.localize(self._confirmation()), "hangup")

    def _dispatch(self, caller_text: str) -> Turn:
        if self._state == "identity":
            return self._handle_identity(caller_text)
        if self._state == "confirm":
            return self._handle_ready(caller_text)
        if self._state == "callback":
            return self._handle_callback(caller_text)
        if self._state == "intake":
            return self._handle_intake(caller_text)
        if self._state == "scheduling":
            return self._handle_pick(caller_text)
        if self._state == "confirm_slot":
            return self._handle_confirm(caller_text)
        return Turn("", "hangup")

    # -- readiness / callback phase --------------------------------------

    def _handle_identity(self, caller_text: str) -> Turn:
        """State 1: did we reach {lead_name}? Right person -> intro; wrong -> end."""
        name = self._first_name() or "the person we're trying to reach"
        prompt = (
            f'The agent asked to speak with {name}. The person answered: '
            f'"{caller_text}". Are they that person (or willing to speak), is it the '
            "WRONG person / not available, or did they say something off-topic?"
        )
        try:
            who = self._gemini.classify(
                prompt, ["right_person", "wrong_person", "other"]
            )["label"]
        except Exception as exc:  # noqa: BLE001 — assume we reached them
            log.warning("identity check failed: %s", exc)
            who = "right_person"
        if who == "wrong_person":
            self._state = "done"
            return Turn(
                "Oh, my apologies for the interruption. We'll reach out again another "
                "time. Have a great day!",
                "hangup",
            )
        if who == "other":
            ask = f"May I speak with {name}?" if self._first_name() else "May I confirm who I'm speaking with?"
            return self._converse(caller_text, ask)
        self._state = "confirm"      # reached them -> introduce + ask readiness
        return Turn(self._intro(), "listen")

    def _handle_ready(self, caller_text: str) -> Turn:
        """The opening 'are you ready to pick a time?' — proceed or arrange a callback."""
        readiness = self._readiness(caller_text)
        if readiness == "not_ready":
            self._state = "callback"
            return Turn(
                "No problem at all. When would be a good time for us to call you back "
                "to set up your appointment?",
                "listen",
            )
        if readiness == "ready":
            return self._begin_scheduling()
        # off-script (a question, small talk) — answer it, then re-ask
        return self._converse(caller_text, "Are you ready to pick an appointment time now?")

    def _converse(self, caller_text: str, ask: str) -> Turn:
        """Field off-script talk (a question, small talk, 'say that again'), then
        naturally re-ask `ask`. Keeps the agent human without leaving the task."""
        try:
            reply = smalltalk_reply(self._gemini, self._cfg.agent_name, caller_text, ask)
        except Exception as exc:  # noqa: BLE001 — fall back to a plain re-ask
            log.warning("conversational reply failed: %s", exc)
            reply = f"Sorry, I didn't quite catch that. {ask}"
        return Turn(reply, "listen")

    def _handle_callback(self, caller_text: str) -> Turn:
        when = parse_time(self._gemini, caller_text, DEFAULT_TIMEZONE)
        if not when:
            return self._converse(
                caller_text,
                "When would be a good time to call you back? For example, tomorrow at 2 PM.",
            )
        self._callback_at = when
        self._state = "done"
        return Turn(
            f"Perfect — we'll give you a call back on {Scheduler.friendly(when)}. "
            "Talk to you then. Goodbye!",
            "hangup",
        )

    def _readiness(self, caller_text: str) -> str:
        """'ready' | 'not_ready' | 'other' — how the caller answered 'have a minute?'."""
        prompt = (
            'The agent asked "Do you have a quick minute to set up a call?".\n'
            f'The caller replied: "{caller_text}".\n\n'
            "Pick the label:\n"
            '- ready: they agree or have time now ("yes", "sure", "okay", "go ahead", '
            '"I have a minute").\n'
            "- not_ready: they clearly cannot talk now and want to be reached later "
            '("not a good time", "I\'m busy", "call me back later", "try me tomorrow").\n'
            "- other: anything else — a question, a request (such as asking for a human), "
            "small talk, or something you cannot interpret."
        )
        try:
            return self._gemini.classify(prompt, ["ready", "not_ready", "other"])["label"]
        except Exception as exc:  # noqa: BLE001 — default to proceeding
            log.warning("readiness check failed: %s", exc)
            return "ready"

    def _refresh_language(self) -> None:
        """Once the caller answers the language question, switch to it."""
        if self._detect_language and self._record:
            self._language = language_from(self._record)

    # -- intake phase ----------------------------------------------------

    def _handle_intake(self, caller_text: str) -> Turn:
        result = self._agent.handle(caller_text)
        self._record = result.record
        if not result.done:
            return Turn(result.agent_message, "listen")
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
        return Turn(self._offer.message, "listen")

    def _handle_pick(self, caller_text: str) -> Turn:
        decision = self._scheduler.decide(caller_text, self._offer.options)
        if decision.action == "pick":
            return self._acknowledge_booking(decision.slot)
        if decision.action == "request":
            self._requested = self._day = decision.requested
            self._state = "checking"
            return Turn("Sure, let me check if that time is available. One moment.", "check")
        if decision.action == "others" and self._day:
            return self._offer_day()
        if decision.action in ("decline", "others"):
            return Turn("No problem. What day and time would you prefer?", "listen")
        # not a scheduling answer — likely a question or small talk
        self._slot_attempts += 1
        if self._slot_attempts <= MAX_SLOT_RETRIES:
            return self._converse(caller_text, self._offer.message)
        return self._finish()  # give up scheduling, still save the record

    def check_availability(self) -> Turn:
        """Check a caller-requested time against Cal.com; propose it or the nearest
        opening. Called after the 'let me check' line, so there's no dead air."""
        try:
            exact, nearest = self._scheduler.check_time(self._requested)
        except CalError as exc:
            log.warning("availability check failed: %s", exc)
            exact = nearest = ""
        if exact:
            self._candidate = exact
            self._state = "confirm_slot"
            return Turn(self.localize(
                f"Good news — {Scheduler.friendly(exact)} is available. "
                "Would you like me to book it?"), "listen")
        if nearest:
            self._candidate = nearest
            self._state = "confirm_slot"
            return Turn(self.localize(
                f"That time isn't open, but the closest I have is {Scheduler.friendly(nearest)}. "
                "Would that work?"), "listen")
        self._state = "scheduling"
        return Turn(self.localize(
            "I'm sorry, I don't have anything around then. " + self._offer.message), "listen")

    def _handle_confirm(self, caller_text: str) -> Turn:
        decision = self._scheduler.decide(caller_text, [self._candidate])
        if decision.action == "request":       # asked about yet another time
            self._requested = self._day = decision.requested
            self._state = "checking"
            return Turn("Let me check that one. One moment.", "check")
        if decision.action == "pick":          # yes — book the proposed slot
            return self._acknowledge_booking(self._candidate)
        # "no" or "what else that day?" — offer the day's other openings
        if decision.action in ("decline", "others"):
            return self._offer_day(exclude=(self._candidate,))
        # off-script — answer, then re-ask whether to book the proposed time
        return self._converse(
            caller_text, f"Should I book {Scheduler.friendly(self._candidate)}?"
        )

    def _offer_day(self, exclude: tuple[str, ...] = ()) -> Turn:
        """Offer the other free slots on the day in focus, or say there are none."""
        offer = self._scheduler.day_offer(self._day, exclude=exclude)
        if offer.options:
            self._offer = offer
            self._candidate = ""
            self._state = "scheduling"
            return Turn(offer.message, "listen")
        self._state = "scheduling"
        return Turn(
            f"I'm sorry, I don't have any other openings on {Scheduler.day_label(self._day)}. "
            "Would another day work?",
            "listen",
        )

    def _acknowledge_booking(self, slot: str) -> Turn:
        """Confirm the slot verbally now; the real booking happens in finalize()."""
        self._chosen = slot
        self._state = "booking"
        return Turn(
            f"Great — I'm setting up your appointment for {Scheduler.friendly(slot)} now. "
            "One moment, please.",
            "finalize",
        )

    # -- wrap up ---------------------------------------------------------

    def _finish(self, closing: str | None = None) -> Turn:
        self._track()
        self._state = "done"
        return Turn(closing or self._goodbye(), "hangup")

    def _track(self) -> None:
        try:
            self._tracked_row = Fulfillment(self._cfg, self._fields).track(
                self._record, booked_at=self._booked_at
            )
        except SheetsError as exc:
            log.warning("could not save record to Sheets: %s", exc)

    def _confirmation(self) -> str:
        """State 4 — spoken after the booking is created."""
        first = self._first_name()
        hi = f", {first}" if first else ""
        if self._booked_at:
            email = self._record.get("email", "")
            where = f" at {email}" if email else ""
            return (
                f"Great{hi} — you're all set for {Scheduler.friendly(self._booked_at)}. "
                f"You'll get a confirmation email{where} with the meeting link, and our "
                "consultant will review your inquiry before the call. "
                "We look forward to speaking with you!"
            )
        return (
            f"I'm sorry{hi}, I couldn't lock that in just now — our team will email you "
            "a scheduling link so you can pick a time. Thanks, and have a great day!"
        )

    def _goodbye(self) -> str:
        """State 6 — a polite close (used when scheduling didn't complete)."""
        first = self._first_name()
        hi = f", {first}" if first else ""
        return (
            f"No problem{hi} — our team will follow up with you by email. "
            "Feel free to reach us anytime at tecace.com. Have a great day!"
        )
