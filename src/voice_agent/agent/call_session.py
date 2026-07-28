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
from ..tools.hermes import HermesTools
from .fulfillment import Fulfillment
from .intake import IntakeAgent, IntakeField
from .persona import smalltalk_reply
from .scheduler import (
    DEFAULT_TIMEZONE,
    Offer,
    Scheduler,
    attendee_name,
    desired_time_from,
    language_from,
    parse_time,
    phone_from,
    purpose_from,
    speech_locale,
    timeframe_from,
)

log = logging.getLogger(__name__)

MAX_SLOT_RETRIES = 2
# Rounds of time alternatives before falling back to emailing a scheduling link.
MAX_TIME_ALTERNATIVES = 2
# Lines spoken while the (slower) off-script answer is generated, so the caller
# hears a natural beat instead of silence. ~2-3s each to cover the think time;
# rotated to avoid repetition.
_FILLERS = [
    "Sure, let me look into that for you — one moment.",
    "That's a good question. Let me check on that for you.",
    "Let me pull that up for you, just a second.",
]

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
        self._hermes = HermesTools(cfg)   # generative brain (gpt-5.6), Gemini fallback
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
        self._summarized = False  # guard: post-call outputs (email/summary) run once
        self._time_attempts = 0        # rounds of time alternatives offered (State 3)
        self._proposed: set[str] = set()  # slots already proposed, so we don't repeat
        self._pending_think: tuple[str, str] = ()  # (caller_text, ask) for think()
        self._filler_i = -1            # rotates the "one moment…" filler lines
        # When the caller already answered the form (a post-submission callback),
        # skip intake and open with the full greeting (identity + intro + readiness).
        if prefilled:
            self._record = dict(prefilled)
            # State 1 is a two-beat identity check: ask for the lead first, then
            # introduce + pitch once they confirm. With no name to verify against,
            # skip straight to the intro.
            #   identity -> confirm -> purpose -> scheduling -> done
            self._state = "identity" if self._first_name() else "confirm"
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
            greeting = self._identity_ask()      # State 1, beat 1
        elif self._state == "confirm":
            greeting = self._intro()             # State 1, beat 2 (no name to verify)
        else:
            greeting = self._agent.greeting()
        return self.localize(greeting)

    def _first_name(self) -> str:
        name = attendee_name(self._record).split()[0]
        return "" if name == "Caller" else name

    def _identity_ask(self) -> str:
        """State 1, beat 1: reach the person before pitching (identity check first)."""
        return f"Hi, may I speak with {self._first_name()}?"

    def _intro(self) -> str:
        """State 1, beat 2: introduce Tess and ask for a minute.

        Reached once identity is confirmed (or immediately when there's no name to
        check against). Does NOT re-ask 'may I speak with…' — beat 1 did that.
        """
        agent = self._cfg.agent_name
        name = self._first_name()
        who = f" {name}" if name else ""
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
        if self._state == "purpose":
            return self._handle_purpose(caller_text)
        if self._state == "clarify_purpose":
            return self._handle_clarify_purpose(caller_text)
        if self._state == "callback":
            return self._handle_callback(caller_text)
        if self._state == "intake":
            return self._handle_intake(caller_text)
        if self._state == "scheduling":
            return self._handle_pick(caller_text)
        if self._state == "confirm_slot":
            return self._handle_confirm(caller_text)
        return Turn("", "hangup")

    # -- opening reply / callback phase ----------------------------------

    def _handle_identity(self, caller_text: str) -> Turn:
        """State 1, beat-1 reply: is this the right person? Then introduce + pitch."""
        label = self._identity_check(caller_text)
        if label == "wrong_person":
            self._state = "done"
            return Turn(
                "Oh, my apologies for the interruption — I may have the wrong number. "
                "Feel free to reach us anytime at tecace.com. Have a great day!",
                "hangup",
            )
        if label == "right_person":
            self._state = "confirm"
            return Turn(self._intro(), "listen")   # beat 2, now that we've reached them
        # off-script ("who's calling?", "what's this about?") — answer, then re-ask
        return self._converse(caller_text, f"May I speak with {self._first_name()}?")

    def _identity_check(self, caller_text: str) -> str:
        """Beat-1 reply: right_person | wrong_person | other."""
        name = self._first_name() or "the lead"
        prompt = (
            f'The agent called and asked "may I speak with {name}?".\n'
            f'The person replied: "{caller_text}".\n\n'
            "Pick the label:\n"
            "- right_person: this IS them or they're coming to the phone "
            '("speaking", "this is he/she", "that\'s me", "yes", "yeah this is them").\n'
            "- wrong_person: they are NOT that person / wrong number / that person "
            'isn\'t available ("no one here by that name", "wrong number", "he\'s not here").\n'
            '- other: a question ("who\'s calling?", "what\'s this about?"), small talk, '
            "or something you cannot interpret."
        )
        try:
            return self._gemini.classify(
                prompt, ["right_person", "wrong_person", "other"]
            )["label"]
        except Exception as exc:  # noqa: BLE001 — default to proceeding as the right person
            log.warning("identity check failed: %s", exc)
            return "right_person"

    def _handle_ready(self, caller_text: str) -> Turn:
        """First reply to the opening greeting: wrong person / ready / later / off-script."""
        answer = self._readiness(caller_text)
        if answer == "wrong_person":
            self._state = "done"
            return Turn(
                "Oh, my apologies for the interruption — I may have the wrong number. "
                "Feel free to reach us anytime at tecace.com. Have a great day!",
                "hangup",
            )
        if answer == "not_ready":
            self._state = "callback"
            return Turn(
                "No problem at all. When would be a good time for us to call you back "
                "to set up your appointment?",
                "listen",
            )
        if answer == "ready":
            return self._begin_purpose()
        # off-script (a question, small talk, just "hello") — answer, then re-ask
        return self._converse(caller_text, "Do you have a quick minute to set this up?")

    # -- purpose confirmation (State 2) ----------------------------------

    def _begin_purpose(self) -> Turn:
        """State 2: confirm the interest the lead gave on the form."""
        purpose = purpose_from(self._record)
        if not purpose:
            return self._begin_scheduling()   # nothing to confirm
        self._state = "purpose"
        return Turn(
            f"Just to make sure I have this right — you're interested in {purpose}, "
            "is that correct?",
            "listen",
        )

    def _handle_purpose(self, caller_text: str) -> Turn:
        purpose = purpose_from(self._record)
        prompt = (
            f'The agent asked the lead to confirm they\'re interested in "{purpose}".\n'
            f'The lead replied: "{caller_text}".\n\n'
            "Pick the label:\n"
            "- correct: they confirmed it's right (yes, correct, that's right).\n"
            "- different: they gave a DIFFERENT or additional description of what they "
            "actually want — there is real substance to note (e.g. \"no, we need X\").\n"
            "- rejected: they said it's NOT right / no, but did NOT say what they do "
            'want — a bare "no", "that\'s not it", "not really" (we must ask them).\n'
            "- other: a question, small talk, or something you cannot interpret."
        )
        try:
            label = self._gemini.classify(
                prompt, ["correct", "different", "rejected", "other"]
            )["label"]
        except Exception as exc:  # noqa: BLE001 — assume it's right and move on
            log.warning("purpose check failed: %s", exc)
            label = "correct"
        if label == "other":
            return self._converse(caller_text, f"You're interested in {purpose}, is that correct?")
        if label == "rejected":
            # They said the form's purpose is wrong but didn't say what they want.
            # Don't just log "no" — ask, and capture their real answer (State 2).
            self._state = "clarify_purpose"
            return Turn(
                "Oh, no problem — so I can pass the right details to our consultant, "
                "could you tell me a bit about what you're hoping to get help with?",
                "listen",
            )
        if label == "different":
            # They gave real details: log them to the record (so it reaches the sheet
            # + the post-call note), acknowledge, and move on. The end-of-call Hermes
            # summary distills it for the consultant — no model call on the hot path.
            self._absorb_purpose(caller_text)
            turn = self._begin_scheduling()
            return Turn(
                "Got it — I'll make sure our consultant knows that. " + turn.reply, turn.next
            )
        return self._begin_scheduling()  # correct

    def _handle_clarify_purpose(self, caller_text: str) -> Turn:
        """State 2 follow-up: the lead rejected the form's purpose and we asked what
        they actually want. Log their answer as the corrected purpose and move on to
        scheduling. (No extra classify on the hot path; `_begin_scheduling` already
        degrades gracefully if Cal.com is slow or unreachable.)"""
        self._absorb_purpose(caller_text, corrected=True)
        turn = self._begin_scheduling()
        return Turn(
            "Thanks — I'll make sure our consultant knows that. " + turn.reply, turn.next
        )

    def _absorb_purpose(self, caller_text: str, *, corrected: bool = False) -> None:
        """Log the lead's corrected/added interest to the record so it reaches the
        consultant notes (sheet + post-call summary). No summarizing here — the
        end-of-call Hermes summary does that from the full transcript. `corrected`
        marks a reply that REPLACES a purpose the lead rejected (vs. adds detail)."""
        detail = caller_text.strip()
        if not detail:
            return
        prior = self._record.get("purpose", "")
        if not prior:
            self._record["purpose"] = detail
        elif corrected:
            self._record["purpose"] = f"{prior} (lead corrected) -> {detail}"
        else:
            self._record["purpose"] = f"{prior} | added: {detail}"

    def _converse(self, caller_text: str, ask: str) -> Turn:
        """Field off-script talk. Speak a brief filler NOW ("one moment…") and defer
        the (slower) Hermes answer to think(), which the caller layer runs while the
        filler plays — so the caller hears a natural beat, not silence."""
        self._pending_think = (caller_text, ask)
        self._filler_i = (self._filler_i + 1) % len(_FILLERS)
        return Turn(_FILLERS[self._filler_i], "think")

    def think(self) -> Turn:
        """Generate the deferred off-script reply (Hermes, Gemini fallback). Runs
        during the filler playback, so its latency is masked."""
        caller_text, ask = self._pending_think or ("", "")
        reply = ""
        if self._cfg.use_hermes_brain:
            try:
                reply = smalltalk_reply(self._hermes, self._cfg.agent_name, caller_text, ask)
            except Exception as exc:  # noqa: BLE001 — fall back to Gemini
                log.warning("Hermes reply failed (%s); using Gemini", exc)
        if not reply:
            try:
                reply = smalltalk_reply(self._gemini, self._cfg.agent_name, caller_text, ask)
            except Exception as exc:  # noqa: BLE001 — last resort: a plain re-ask
                log.warning("conversational reply failed: %s", exc)
                reply = f"Sorry, I didn't quite catch that. {ask}"
        return Turn(self.localize(reply), "listen")

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
        """How the caller answered the opening: wrong_person | ready | not_ready | other."""
        name = self._first_name() or "the lead"
        prompt = (
            f'The agent called and asked for {name}, then asked "do you have a quick '
            f'minute to set up a call?".\n'
            f'The person replied: "{caller_text}".\n\n'
            "Pick the label:\n"
            "- wrong_person: they are NOT that person / wrong number / that person isn't "
            'available ("no one here by that name", "wrong number", "he\'s not here").\n'
            '- ready: they are willing to continue now ("yes", "speaking", "this is '
            'them", "sure", "okay", "I have a minute").\n'
            "- not_ready: it's them but a bad time; reach them later "
            '("not a good time", "I\'m busy", "call me back later").\n'
            "- other: anything else — just \"hello\", a question, a request (like asking "
            "for a human), small talk, or something you cannot interpret."
        )
        try:
            return self._gemini.classify(
                prompt, ["wrong_person", "ready", "not_ready", "other"]
            )["label"]
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
        # Entering State 3 makes several network calls (Cal.com openings, time parse,
        # availability). ANY failure must degrade gracefully — offer to email a
        # scheduling link — never crash the turn with "an error occurred".
        try:
            self._scheduler = Scheduler(self._cfg, self._event_type_id)
            # Fetch the timeframe's openings first — the fallback list, whether or not
            # the lead named a specific desired time.
            self._offer = self._scheduler.offer(timeframe_from(self._record))
        except Exception as exc:  # noqa: BLE001 — Cal/network failure -> graceful fallback
            log.warning("could not start scheduling: %s", exc)
            return self._finish(closing=self._scheduling_link_message())
        # State 3: if the lead gave a specific desired time on the form, confirm THAT
        # first rather than reading out a list.
        desired = self._desired_iso()
        if desired:
            return self._confirm_desired(desired)
        return self._offer_list()

    def _offer_list(self) -> Turn:
        """Read out a few openings and let the caller pick (no desired time given)."""
        if not self._offer.options:
            # No openings — the offer message already asks for another timeframe.
            return self._finish(closing=self._offer.message)
        self._state = "scheduling"
        return Turn(self._offer.message, "listen")

    def _desired_iso(self) -> str:
        raw = desired_time_from(self._record)
        if not raw:
            return ""
        try:
            return parse_time(self._gemini, raw, DEFAULT_TIMEZONE)
        except Exception as exc:  # noqa: BLE001 — a failed parse just skips the desired-time step
            log.warning("could not parse desired time %r: %s", raw, exc)
            return ""

    def _confirm_desired(self, desired_iso: str) -> Turn:
        """State 3: confirm the lead's desired time; propose the nearest if it's taken."""
        try:
            exact, nearest = self._scheduler.check_time(desired_iso)
        except Exception as exc:  # noqa: BLE001 — availability failure -> fall back to the list
            log.warning("desired-time check failed: %s", exc)
            exact = nearest = ""
        if exact:
            self._candidate = self._day = exact
            self._proposed.add(exact)
            self._state = "confirm_slot"
            return Turn(
                f"You mentioned {Scheduler.friendly(exact)} would work for you. I can "
                "confirm a 30-minute consultation call at that time — does that still work?",
                "listen",
            )
        if nearest:
            self._candidate = self._day = nearest
            self._proposed.add(nearest)
            self._state = "confirm_slot"
            return Turn(
                f"You mentioned {Scheduler.friendly(desired_iso)}, but that time isn't "
                f"open anymore. The closest I have is {Scheduler.friendly(nearest)} — "
                "would that work?",
                "listen",
            )
        return self._offer_list()   # nothing near the desired time — offer the list

    def _handle_pick(self, caller_text: str) -> Turn:
        decision = self._scheduler.decide(caller_text, self._offer.options)
        if decision.action == "pick":
            return self._acknowledge_booking(decision.slot)
        if decision.action == "request":
            self._requested = self._day = decision.requested
            self._state = "checking"
            return Turn("Sure, let me check if that time is available. One moment.", "check")
        if decision.action in ("decline", "others"):
            return self._offer_alternatives()
        # not a scheduling answer — likely a question or small talk
        self._slot_attempts += 1
        if self._slot_attempts <= MAX_SLOT_RETRIES:
            return self._converse(caller_text, self._offer.message)
        return self._finish(closing=self._scheduling_link_message())

    def check_availability(self) -> Turn:
        """Check a caller-requested time against Cal.com; propose it or the nearest
        opening. Called after the 'let me check' line, so there's no dead air."""
        try:
            exact, nearest = self._scheduler.check_time(self._requested)
        except Exception as exc:  # noqa: BLE001 — availability failure -> re-offer the list
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
        # "no" or "what else?" — offer a couple of alternatives (State 3 "No")
        if decision.action in ("decline", "others"):
            return self._offer_alternatives(exclude=(self._candidate,))
        # off-script — answer, then re-ask whether to book the proposed time
        return self._converse(
            caller_text, f"Should I book {Scheduler.friendly(self._candidate)}?"
        )

    def _offer_alternatives(self, exclude: tuple[str, ...] = ()) -> Turn:
        """State 3 'No' — propose up to 2 calendar alternatives; after a few tries,
        fall back to emailing a scheduling link."""
        self._proposed.update(exclude)
        self._time_attempts += 1
        if self._time_attempts > MAX_TIME_ALTERNATIVES:
            return self._finish(closing=self._scheduling_link_message())
        # Prefer other openings on the day in focus; else fall back to the timeframe list.
        if self._day:
            pool = self._scheduler.day_offer(self._day, exclude=tuple(self._proposed)).options
        else:
            pool = self._offer.options
        options = [o for o in pool if o not in self._proposed][:2]
        if not options:
            return self._finish(closing=self._scheduling_link_message())
        self._proposed.update(options)
        self._candidate = ""
        self._state = "scheduling"
        friendly = " or ".join(Scheduler.friendly(o) for o in options)
        self._offer = Offer(f"How about {friendly}?", options)
        return Turn(self._offer.message, "listen")

    def _scheduling_link_message(self) -> str:
        first = self._first_name()
        hi = f", {first}" if first else ""
        return (
            f"No problem{hi} — I'll have our team email you a scheduling link so you can "
            "pick the time that works best. Thanks so much, and have a great day!"
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
        # Saving to Sheets is a non-critical side effect — a failure here (auth,
        # network, quota, anything) must NEVER crash the call. Log and move on so
        # the caller still hears their confirmation.
        try:
            self._tracked_row = Fulfillment(self._cfg, self._fields).track(
                self._record, booked_at=self._booked_at
            )
        except Exception as exc:  # noqa: BLE001 — tracking must not break the call
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
                f"Thanks{hi}, we look forward to speaking with you — have a great day!"
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
