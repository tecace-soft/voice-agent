"""Interactive intake test — type as if you were the caller.

    python scripts/try_intake.py             # questions from the Typeform form
    python scripts/try_intake.py --demo       # use the built-in demo questions
    python scripts/try_intake.py --no-hermes  # skip the Hermes closing sub-task
    python scripts/try_intake.py --voice       # speak each agent line via ElevenLabs
    python scripts/try_intake.py --book        # actually create the Cal.com booking
    python scripts/try_intake.py --outbound    # simulate the agent CALLING the person

Drives the shared CallSession — the same conversation engine the phone pipeline
will use, for both inbound (person calls in) and outbound (agent calls out). On
completion the record is appended to Google Sheets; a slot is offered/chosen,
and with --book the booking is really created.

Commands:  :state  show captured record   :reset  start over   :quit
"""

from __future__ import annotations

import logging
import sys

from voice_agent.agent import CallSession, IntakeField
from voice_agent.config import Config, ConfigError
from voice_agent.tools.google_forms import GoogleFormsClient, GoogleFormsError
from voice_agent.tools.voice import ElevenLabsVoice, VoiceError

# Cal.com event type to book (from `python scripts/verify_cal.py`).
CAL_EVENT_TYPE_ID = 6407082  # "Voice Agent Testing"

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
        fields = GoogleFormsClient(cfg).fields()
        print(f"questions: {len(fields)} from Google Form {cfg.google_form_id}")
        return fields
    except GoogleFormsError as exc:
        print(f"questions: Google Forms unavailable ({exc})")
        print("           falling back to the built-in demo set. Pass --demo to skip this.")
        return DEMO_FIELDS


def _new_session(cfg: Config, fields: list[IntakeField], argv: list[str]) -> CallSession:
    return CallSession(
        cfg,
        fields,
        event_type_id=CAL_EVENT_TYPE_ID,
        direction="outbound" if "--outbound" in argv else "inbound",
        use_hermes_closing="--no-hermes" not in argv,
        create_bookings="--book" in argv,
    )


def main(argv: list[str]) -> int:
    # Surface CallSession's internal warnings (Sheets/Cal failures) to the console.
    logging.basicConfig(level=logging.WARNING, format="       (%(message)s)")
    try:
        cfg = Config.load()
    except ConfigError as exc:
        print(f"config error: {exc}")
        return 1

    speaker = _Speaker(cfg) if "--voice" in argv else None
    fields = _load_fields(cfg, use_demo="--demo" in argv)
    session = _new_session(cfg, fields, argv)
    print(
        f"intake test — {'OUTBOUND (agent calls out)' if '--outbound' in argv else 'INBOUND (person calls in)'}, "
        f"voice {'on' if speaker else 'off'}, "
        f"booking {'on' if '--book' in argv else 'off (dry run)'}"
    )
    print("(:state, :reset, :quit)\n")

    def say(message: str) -> None:
        if not message:
            return
        print(f"agent> {message}")
        if speaker:
            speaker.speak(message)

    say(session.start())

    while True:
        try:
            line = input("\nyou  > ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            return 0

        if line in {":quit", ":q"}:
            return 0
        if line == ":reset":
            session = _new_session(cfg, fields, argv)
            print("(reset)")
            say(session.start())
            continue
        if line == ":state":
            print(f"captured: {session.record}")
            continue
        if not line:
            continue

        turn = session.handle(line)
        print(f"       [captured: {session.record}]")
        say(turn.reply)
        # "check" (availability lookup) then "finalize" (booking) run their slow
        # work after the spoken acknowledgement, same as the phone flow.
        if turn.next == "check":
            turn = session.check_availability()
            say(turn.reply)
        if turn.next == "finalize":
            turn = session.finalize()
            say(turn.reply)
        if turn.ended:
            print(f"\nfinal record: {session.record}")
            if session.booked_at:
                verb = "booked" if "--book" in argv else "would book (dry run)"
                print(f"appointment: {verb} {session.booked_at}")
            if session.callback_at:
                print(f"callback scheduled: {session.callback_at} -> {session.phone}")
            return 0


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
