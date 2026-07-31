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
import re
from dataclasses import dataclass

from ..config import Config
from ..tools.backend import BackendClient, BackendError
from ..tools.gemini import GeminiTools
from ..tools.hermes import HermesTools
from .intake import IntakeAgent, IntakeField
from .persona import smalltalk_reply
from .scheduler import (
    DEFAULT_TIMEZONE,
    Offer,
    Scheduler,
    attendee_name,
    desired_time_from,
    intake_id_from,
    language_from,
    parse_time,
    phone_from,
    purpose_from,
    speech_locale,
    timeframe_from,
)

# Backend leads carry the desired time as an ISO instant; detect that so we can skip a
# Gemini round-trip that would only re-parse it.
_ISO_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}")

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
    "inbound": "Hi, thanks for calling TecAce! I can help you set up a consultation with one of our consultants.",
    "outbound": "Hi, this is the scheduling assistant reaching out to get you booked in.",
}


@dataclass
class Turn:
    reply: str                 # what the agent should say next
    next: str = "listen"       # "listen" (await reply) | "finalize" (do slow work) | "hangup"

    @property
    def ended(self) -> bool:
        return self.next == "hangup"


def _format_phone(digits: str) -> str:
    """Format a run of digits as a stored phone number (E.164-ish)."""
    if len(digits) == 10:  # US local number, no country code
        return f"+1{digits}"
    return f"+{digits}"


def _spoken_phone(number: str) -> str:
    """Say a number digit-by-digit so TTS reads it clearly: '5 5 5, 1 2 3, 4 5 6 7'."""
    digits = re.sub(r"\D", "", number)
    core = digits[-10:] if len(digits) >= 10 else digits
    if len(core) == 10:
        return f"{' '.join(core[0:3])}, {' '.join(core[3:6])}, {' '.join(core[6:10])}"
    return " ".join(core)


def _spell_out(value: str) -> str:
    """Say a name/email letter-by-letter so a TTS mispronunciation can't hide an error:
    'David' -> 'D A V I D'; 'jo@x.com' -> 'J O at X dot C O M'."""
    out = []
    for ch in value:
        if ch == "@":
            out.append("at")
        elif ch == ".":
            out.append("dot")
        elif ch == "_":
            out.append("underscore")
        elif ch == "-":
            out.append("dash")
        elif ch == "+":
            out.append("plus")
        elif ch.isspace():
            out.append(",")  # a pause between words
        else:
            out.append(ch.upper())
    return " ".join(out)


class CallSession:
    def __init__(
        self,
        cfg: Config,
        fields: list[IntakeField],
        *,
        direction: str = "inbound",
        opening: str | None = None,
        use_hermes_closing: bool = True,
        create_bookings: bool = True,
        prefilled: dict[str, str] | None = None,
        language: str | None = None,
        callback: bool = False,
        caller_phone: str = "",
    ) -> None:
        self._cfg = cfg
        self._fields = fields
        self._direction = direction
        self._create_bookings = create_bookings
        # An inbound caller's own number (from Twilio's `From`); folded into the record
        # when scheduling begins, since we don't ask an inbound caller for their phone.
        self._caller_phone = caller_phone
        # True when this call is the agent ringing back at a time the caller
        # asked for earlier — changes the opening line (see start()).
        self._is_callback = callback
        self._gemini = GeminiTools(cfg)
        self._hermes = HermesTools(cfg)   # generative brain (gpt-5.6), Gemini fallback
        self._opening = opening or OPENINGS.get(direction, OPENINGS["inbound"])
        self._agent = IntakeAgent(
            cfg,
            fields,
            use_hermes_closing=use_hermes_closing,
            emit_closing=False,
            greeting_prefix=self._opening,
        )
        # Scheduling runs only when the backend is configured.
        self._scheduling_enabled = bool(cfg.backend_url)
        self._scheduler: Scheduler | None = None
        self._offer = None
        self._slot_attempts = 0
        # Inbound contact-number confirmation: whether we've asked for a number, and how
        # many times we've tried to read one back.
        self._awaiting_number = False
        self._phone_attempts = 0
        # Inbound spelled-capture: the field being captured (full_name/email) and the
        # parsed value awaiting the caller's spelled-back confirmation.
        self._cap_field = ""
        self._pending_value = ""
        self._booked_at = ""
        self._chosen = ""       # slot the caller picked, booked during finalize()
        self._requested = ""    # a specific time the caller asked us to check
        self._candidate = ""    # a free slot we've proposed, awaiting yes/no
        self._day = ""          # the day currently in focus, for "other times that day"
        self._callback_at = ""  # if not ready now, when to call back instead
        self._transcript: list[str] = []  # spoken exchange, for the post-call summary
        self._tracked = False   # whether the call's outcome was written to the backend
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
            # Inbound: the caller books themselves. Capture name + email by spelling +
            # confirmation, confirm the contact number, then the day/time.
            #   full_name -> email -> phone_check -> ask_time -> scheduling -> done
            self._cap_field = "full_name"
            self._state = "capturing"
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
        """1 if the call's outcome was recorded on the backend, else 0. (Kept as an int
        named `tracked_row` so the server's 'did we record anything?' check is unchanged.)"""
        return 1 if self._tracked else 0

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
        elif self._state == "capturing":
            greeting = f"{self._opening} {self._ask_field(self._cap_field)}"  # inbound
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
                    # Passing the language lets the scheduler create a lead for an inbound
                    # caller (who has no pre-existing intake) with the right language.
                    self._scheduler.book(self._chosen, self._record, language=self._language)
                    self._booked_at = self._chosen
                except (BackendError, RuntimeError) as exc:
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
        if self._state == "capturing":
            return self._handle_capture(caller_text)
        if self._state == "confirming":
            return self._handle_confirm_capture(caller_text)
        if self._state == "phone_check":
            return self._handle_phone_check(caller_text)
        if self._state == "ask_time":
            return self._handle_ask_time(caller_text)
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
            return self._begin_phone_check()
        return self._finish()

    # -- spelled capture: name + email (inbound) -------------------------
    # Phone speech-to-text mangles names/emails, so we let the caller SPELL them (incl.
    # "D as in dog" phonetics), reconstruct the value with the LLM, and read it back
    # LETTER BY LETTER for confirmation — so a TTS mispronunciation can never hide an error.

    def _ask_field(self, field: str) -> str:
        if field == "email":
            return (
                "What's the best email to send your confirmation to? Feel free to spell it "
                "out — you can say \"at\" and \"dot\", like \"j-o-h-n at gmail dot com\"."
            )
        return (
            "Who am I speaking with? You can spell your name out if it helps — "
            "for example, \"D as in dog, A as in apple\"."
        )

    def _handle_capture(self, caller_text: str) -> Turn:
        value = self._parse_field(self._cap_field, caller_text)
        if not value:
            return Turn(self.localize(
                "Sorry, I didn't quite catch that. Could you say it again, spelling it out "
                "letter by letter?"
            ), "listen")
        self._pending_value = value
        self._state = "confirming"
        return Turn(self.localize(self._readback(self._cap_field, value)), "listen")

    def _handle_confirm_capture(self, caller_text: str) -> Turn:
        label = self._yes_no(caller_text)
        if label == "yes":
            self._record[self._cap_field] = self._pending_value
            return self._advance_capture()
        if label == "no":
            # They often give the correction in the same breath ("no, it's D-A-V-E").
            retry = self._parse_field(self._cap_field, caller_text)
            if retry and retry != self._pending_value:
                self._pending_value = retry
                return Turn(self.localize(self._readback(self._cap_field, retry)), "listen")
            self._state = "capturing"
            return Turn(self.localize(
                f"No problem — let's try that again. {self._ask_field(self._cap_field)}"
            ), "listen")
        # off-script (a question / small talk) — answer, then re-ask the confirmation
        return self._converse(caller_text, self._readback(self._cap_field, self._pending_value))

    def _advance_capture(self) -> Turn:
        if self._cap_field == "full_name":
            self._cap_field = "email"
            self._state = "capturing"
            return Turn(self.localize(self._ask_field("email")), "listen")
        # name + email done -> confirm the contact number next
        return self._begin_phone_check()

    def _parse_field(self, field: str, caller_text: str) -> str:
        """Reconstruct a spelled/phonetic name or email into its exact value ('' if none)."""
        if field == "email":
            system = (
                "The caller is giving their email address over the phone. They may spell it "
                "out, use phonetics ('m as in mary'), and say 'at' and 'dot'. Reconstruct "
                "the exact email address. Output ONLY the email in lowercase, or the single "
                "word none if there is no email."
            )
        else:
            system = (
                "The caller is giving their name over the phone. They may spell it out or "
                "use phonetics ('D as in dog, A as in apple'). Reconstruct the exact name "
                "they intend, properly capitalized. Output ONLY the name, or the single "
                "word none if there is no name."
            )
        try:
            raw = self._gemini.generate(system, caller_text, temperature=0).strip().strip('"').strip()
        except Exception as exc:  # noqa: BLE001
            log.warning("field parse failed (%s): %s", field, exc)
            return ""
        if not raw or raw.lower() == "none":
            return ""
        if field == "email" and "@" not in raw:
            return ""
        return raw

    def _readback(self, field: str, value: str) -> str:
        label = "email" if field == "email" else "name"
        return (
            f"Let me make sure I have your {label} right — {_spell_out(value)}. "
            "Did I get that right?"
        )

    def _yes_no(self, caller_text: str) -> str:
        """yes | no | other — did the caller confirm the read-back value?"""
        prompt = (
            "The agent read a value back to the caller (spelled out) and asked if it's correct.\n"
            f'The caller replied: "{caller_text}".\n\n'
            "Pick the label:\n"
            "- yes: they confirmed it's correct (yes, that's right, correct, yep, perfect).\n"
            "- no: it's wrong or they're correcting it (no, that's not right, it's actually ...).\n"
            "- other: a question, small talk, or something you cannot interpret."
        )
        try:
            return self._gemini.classify(prompt, ["yes", "no", "other"])["label"]
        except Exception as exc:  # noqa: BLE001 — re-confirm rather than save a wrong value
            log.warning("confirmation check failed: %s", exc)
            return "other"

    # -- contact-number confirmation (inbound) ---------------------------

    def _begin_phone_check(self) -> Turn:
        """Confirm the number we captured from caller ID is a good contact number — or ask
        for one if caller ID didn't give us a number. Inbound only; outbound leads already
        carry a number from the form, so they never reach this step."""
        self._state = "phone_check"
        self._awaiting_number = False
        self._phone_attempts = 0
        if self._caller_phone:
            return Turn(self.localize(
                f"And I have the number you're calling from as {_spoken_phone(self._caller_phone)}. "
                "Is that a good number to reach you at, or would you like to give a different one?"
            ), "listen")
        self._awaiting_number = True
        return Turn(self.localize("And what's the best phone number to reach you at?"), "listen")

    def _handle_phone_check(self, caller_text: str) -> Turn:
        # We've explicitly asked for a number — read one out of the reply.
        if self._awaiting_number:
            number = self._extract_phone(caller_text)
            if number:
                self._record["phone"] = number
                return self._begin_ask_time()
            self._phone_attempts += 1
            if self._phone_attempts >= 2:
                return self._begin_ask_time()  # stop asking; use whatever we have
            return Turn(self.localize(
                "Sorry, I didn't catch that. Could you say the phone number again, "
                "including the area code?"
            ), "listen")
        # Confirming the caller-ID number: keep it, or switch to a different one?
        label = self._phone_choice(caller_text)
        if label == "keep":
            self._record["phone"] = self._caller_phone
            return self._begin_ask_time()
        if label == "change":
            number = self._extract_phone(caller_text)  # maybe they gave the number already
            if number:
                self._record["phone"] = number
                return self._begin_ask_time()
            self._awaiting_number = True
            return Turn(self.localize("Sure — what's the best number to reach you at?"), "listen")
        # off-script (a question / small talk) — answer, then re-ask
        return self._converse(
            caller_text,
            "Is the number you're calling from okay to reach you at, "
            "or would you like to give a different one?",
        )

    # -- ask for the appointment day/time (inbound) ----------------------

    def _begin_ask_time(self) -> Turn:
        self._state = "ask_time"
        return Turn(self.localize(
            "Now, what day and time would you like for your appointment?"
        ), "listen")

    def _handle_ask_time(self, caller_text: str) -> Turn:
        when = parse_time(self._gemini, caller_text, DEFAULT_TIMEZONE)
        if not when:
            return self._converse(
                caller_text,
                "What day and time works best for you? For example, next Tuesday at 2 PM.",
            )
        # Stash it as the desired time; _begin_scheduling reads it back + confirms the slot.
        self._record["desired_time"] = when
        return self._begin_scheduling()

    def _phone_choice(self, caller_text: str) -> str:
        """keep | change | other — does the caller want to keep the caller-ID number?"""
        prompt = (
            "The agent asked whether the number the caller is calling from is a good number "
            "to reach them at, or if they'd like to give a different one.\n"
            f'The caller replied: "{caller_text}".\n\n'
            "Pick the label:\n"
            "- keep: the current number is fine (yes, that's fine, that works, use that one).\n"
            "- change: they want a DIFFERENT number (no, use another, call me on ..., "
            "my cell is ..., a different one).\n"
            "- other: a question, small talk, or something you cannot interpret."
        )
        try:
            return self._gemini.classify(prompt, ["keep", "change", "other"])["label"]
        except Exception as exc:  # noqa: BLE001 — default to keeping the number we have
            log.warning("phone choice check failed: %s", exc)
            return "keep"

    def _extract_phone(self, caller_text: str) -> str:
        """Pull a phone number out of the caller's words, formatted, or '' if none."""
        # Digits spoken plainly ("use 555 123 4567").
        match = re.search(r"\+?\d[\d\s\-().]{6,}\d", caller_text)
        if match:
            digits = re.sub(r"\D", "", match.group(0))
            if len(digits) >= 7:
                return _format_phone(digits)
        # Spoken as words ("five five five ...") — let Gemini pull the digits.
        try:
            raw = self._gemini.generate(
                "The caller said a phone number. Output ONLY its digits (with country or "
                "area code if given), or the word none if there is no phone number.",
                caller_text, temperature=0,
            ).strip()
        except Exception as exc:  # noqa: BLE001
            log.warning("phone extraction failed: %s", exc)
            return ""
        digits = re.sub(r"\D", "", raw)
        return _format_phone(digits) if len(digits) >= 7 else ""

    # -- scheduling phase ------------------------------------------------

    def _begin_scheduling(self) -> Turn:
        # Fold in the inbound caller's own number (we didn't ask for it) so the lead we
        # create at booking has a phone. No-op for outbound (record already has one).
        if self._caller_phone and "phone" not in self._record:
            self._record["phone"] = self._caller_phone
        # Entering State 3 makes several network calls (Cal.com openings, time parse,
        # availability). ANY failure must degrade gracefully — offer to email a
        # scheduling link — never crash the turn with "an error occurred".
        try:
            self._scheduler = Scheduler(self._cfg)
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
        # A backend lead's desired time is already an ISO instant — use it directly.
        if _ISO_RE.match(raw.strip()):
            return raw.strip()
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
        # Record the call's outcome on the backend. Booking already set 'booked' (via the
        # scheduler), so here we only mark a reached-but-not-booked lead 'contacted'.
        # A failure here (network, anything) must NEVER crash the call — log and move on
        # so the caller still hears their confirmation.
        intake_id = intake_id_from(self._record)
        if not intake_id or not self._cfg.backend_url:
            return
        self._tracked = True
        if self._booked_at:
            return   # already 'booked' by the scheduler — don't re-touch the booking
        try:
            BackendClient(self._cfg).set_status(intake_id, "contacted")
        except Exception as exc:  # noqa: BLE001 — tracking must not break the call
            log.warning("could not update lead status on the backend: %s", exc)

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
