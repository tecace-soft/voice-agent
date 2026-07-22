"""Interactive intake test — type as if you were the caller.

    python scripts/try_intake.py             # questions from the Typeform form
    python scripts/try_intake.py --demo       # use the built-in demo questions
    python scripts/try_intake.py --no-hermes  # skip the Hermes closing sub-task
    python scripts/try_intake.py --voice       # speak each agent line via ElevenLabs

Drives the real IntakeAgent: the questions come from your Typeform form, Gemini
extracts answers and phrases each question, and Hermes composes the closing
confirmation (with a template fallback). With --voice, every agent line is
spoken aloud.

Commands:  :state  show captured record   :reset  start over   :quit
"""

from __future__ import annotations

import sys

from voice_agent.agent import IntakeAgent, IntakeField
from voice_agent.config import Config, ConfigError
from voice_agent.tools.typeform import TypeformClient, TypeformError
from voice_agent.tools.voice import ElevenLabsVoice, VoiceError

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
    speaker = _Speaker(cfg) if "--voice" in argv else None
    fields = _load_fields(cfg, use_demo="--demo" in argv)
    agent = IntakeAgent(cfg, fields, use_hermes_closing=use_hermes)
    print(
        f"intake test — Gemini {cfg.gemini_model}, Hermes closing "
        f"{'on' if use_hermes else 'off'}, voice {'on' if speaker else 'off'}"
    )
    print("(:state, :reset, :quit)\n")

    def say(message: str) -> None:
        print(f"agent> {message}")
        if speaker:
            speaker.speak(message)

    say(agent.greeting())

    while True:
        try:
            line = input("\nyou  > ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            return 0

        if line in {":quit", ":q"}:
            return 0
        if line == ":reset":
            agent = IntakeAgent(cfg, fields, use_hermes_closing=use_hermes)
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
            print("(would save to the pending store here)")
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
