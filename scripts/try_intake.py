"""Interactive intake test — type as if you were the caller.

    python scripts/try_intake.py             # questions from the Typeform form
    python scripts/try_intake.py --demo       # use the built-in demo questions
    python scripts/try_intake.py --no-hermes  # skip the Hermes closing sub-task
    python scripts/try_intake.py --voice       # speak each agent line via ElevenLabs
    python scripts/try_intake.py --book        # also book a Cal.com appointment

On completion the collected record is appended to Google Sheets (tracking). With
--book, it also books the first available Cal.com slot in the caller's chosen
timeframe (creates a real calendar event).

Commands:  :state  show captured record   :reset  start over   :quit
"""

from __future__ import annotations

import sys

from voice_agent.agent import Fulfillment, IntakeAgent, IntakeField, Scheduler
from voice_agent.agent.scheduler import attendee_name
from voice_agent.config import Config, ConfigError
from voice_agent.tools.cal import CalError
from voice_agent.tools.sheets import SheetsError
from voice_agent.tools.typeform import TypeformClient, TypeformError
from voice_agent.tools.voice import ElevenLabsVoice, VoiceError

# Cal.com event type to book (from `python scripts/verify_cal.py`).
CAL_EVENT_TYPE_ID = 6407082  # "Voice Agent Testing"
# How many times to re-offer slots if the caller's pick isn't understood.
MAX_SLOT_RETRIES = 2


def _timeframe_from(record: dict) -> str | None:
    """Find the caller's timeframe answer without hardcoding the field name."""
    for value in record.values():
        if isinstance(value, str) and any(
            w in value.lower() for w in ("today", "tomorrow", "week", "month")
        ):
            return value
    return None

# Fallback questions when Typeform is unavailable or the form has none yet.
DEMO_FIELDS = [
    IntakeField("full_name", "the caller's full name"),
    IntakeField("email", "an email address"),
    IntakeField("phone", "a phone number"),
    IntakeField("reason", "why they are getting in touch"),
]


def _load_fields(cfg: Config, use_demo: bool) -> list[IntakeField]:
    if use_demo:
        print("questions: built-in demo set")
        return DEMO_FIELDS
    try:
        fields = TypeformClient(cfg).fields()
        print(f"questions: {len(fields)} from Typeform form {cfg.typeform_form_id}")
        return fields
    except TypeformError as exc:
        print(f"questions: Typeform unavailable ({exc})")
        print("           falling back to the built-in demo set. Pass --demo to skip this.")
        return DEMO_FIELDS


def main(argv: list[str]) -> int:
    try:
        cfg = Config.load()
    except ConfigError as exc:
        print(f"config error: {exc}")
        return 1

    use_hermes = "--no-hermes" not in argv
    book = "--book" in argv
    speaker = _Speaker(cfg) if "--voice" in argv else None
    fields = _load_fields(cfg, use_demo="--demo" in argv)
    # Scheduling runs when Cal.com is configured (real form, not the demo set).
    scheduling = bool(cfg.cal_api_key) and "--demo" not in argv

    def new_agent() -> IntakeAgent:
        return IntakeAgent(
            cfg, fields, use_hermes_closing=use_hermes, emit_closing=not scheduling
        )

    agent = new_agent()
    print(
        f"intake test — Gemini {cfg.gemini_model}, Hermes closing "
        f"{'on' if use_hermes else 'off'}, voice {'on' if speaker else 'off'}, "
        f"scheduling {'on' if scheduling else 'off'}"
    )
    print("(:state, :reset, :quit)\n")

    def say(message: str) -> None:
        if not message:
            return
        print(f"agent> {message}")
        if speaker:
            speaker.speak(message)

    def ask() -> str:
        return input("\nyou  > ").strip()

    say(agent.greeting())

    while True:
        try:
            line = ask()
        except (EOFError, KeyboardInterrupt):
            print()
            return 0

        if line in {":quit", ":q"}:
            return 0
        if line == ":reset":
            agent = new_agent()
            print("(reset)")
            say(agent.greeting())
            continue
        if line == ":state":
            print(f"captured: {agent._captured}")
            continue
        if not line:
            continue

        result = agent.handle(line)
        print(f"       [captured: {result.record}]")
        say(result.agent_message)
        if result.done:
            print(f"\nfinal record: {result.record}")
            booked_at = ""
            if scheduling:
                booked_at = _run_scheduling(cfg, result.record, say, ask, book=book)
            _track(cfg, fields, result.record, booked_at)
            say(_goodbye(result.record, booked_at))
            return 0


def _run_scheduling(cfg: Config, record: dict, say, ask, *, book: bool) -> str:
    """Offer real Cal.com slots, let the caller pick, and (with --book) book it.

    Returns the chosen ISO start time (empty string if nothing was scheduled).
    """
    try:
        scheduler = Scheduler(cfg, CAL_EVENT_TYPE_ID)
        offer = scheduler.offer(_timeframe_from(record))
    except CalError as exc:
        print(f"schedule: FAILED to fetch slots — {exc}")
        return ""

    say(offer.message)
    if not offer.options:
        return ""

    chosen = None
    for attempt in range(MAX_SLOT_RETRIES + 1):
        try:
            reply = ask()
        except (EOFError, KeyboardInterrupt):
            return ""
        chosen = scheduler.interpret(reply, offer.options)
        if chosen:
            break
        if attempt < MAX_SLOT_RETRIES:
            say("Sorry, I didn't catch which time. " + offer.message)
    if not chosen:
        print("schedule: no slot selected")
        return ""

    friendly = Scheduler.friendly(chosen)
    if not book:
        print(f"schedule: would book {friendly} (skipped — pass --book to create it)")
        return chosen
    try:
        booking = scheduler.book(chosen, record)
        print(f"schedule: booked {friendly} (id {booking.get('uid', booking.get('id'))})")
        return chosen
    except (CalError, RuntimeError) as exc:
        print(f"schedule: booking FAILED — {exc}")
        return ""


def _track(cfg: Config, fields: list[IntakeField], record: dict, booked_at: str) -> None:
    try:
        Fulfillment(cfg, fields).track(record, booked_at=booked_at)
        print("track : appended to Google Sheets")
    except SheetsError as exc:
        print(f"track : FAILED — {exc}")


def _goodbye(record: dict, booked_at: str) -> str:
    first = attendee_name(record).split()[0]
    hi = f", {first}" if first != "Caller" else ""
    if booked_at:
        return f"You're all set{hi} — I've got you down for {Scheduler.friendly(booked_at)}. Goodbye!"
    return f"Thanks{hi}, we'll be in touch. Goodbye!"


class _Speaker:
    """Speaks each agent line aloud through the speakers — no file, no window."""

    def __init__(self, cfg: Config) -> None:
        self._voice = ElevenLabsVoice(cfg)

    def speak(self, text: str) -> None:
        try:
            self._voice.speak(text)  # plays inline, blocks until done
        except VoiceError as exc:
            print(f"       (voice error: {exc})")


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
