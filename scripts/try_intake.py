"""Interactive intake test — type as if you were the caller.

    python scripts/try_intake.py
    python scripts/try_intake.py --no-hermes   # skip the Hermes closing sub-task

Drives the real IntakeAgent: Gemini extracts fields and phrases questions each
turn; Hermes composes the closing confirmation (with a template fallback).

Commands:  :state  show captured record   :reset  start over   :quit
"""

from __future__ import annotations

import sys

from voice_agent.agent import IntakeAgent, IntakeField
from voice_agent.config import Config, ConfigError

FIELDS = [
    IntakeField("full_name", "the caller's full name"),
    IntakeField("email", "an email address"),
    IntakeField("phone", "a phone number"),
    IntakeField("reason", "why they are getting in touch"),
]


def main(argv: list[str]) -> int:
    try:
        cfg = Config.load()
    except ConfigError as exc:
        print(f"config error: {exc}")
        return 1

    use_hermes = "--no-hermes" not in argv
    agent = IntakeAgent(cfg, FIELDS, use_hermes_closing=use_hermes)
    print(f"intake test — Gemini {cfg.gemini_model}, Hermes closing {'on' if use_hermes else 'off'}")
    print("(:state, :reset, :quit)\n")
    print(f"agent> {agent.greeting()}")

    while True:
        try:
            line = input("\nyou  > ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            return 0

        if line in {":quit", ":q"}:
            return 0
        if line == ":reset":
            agent = IntakeAgent(cfg, FIELDS, use_hermes_closing=use_hermes)
            print("(reset)")
            print(f"agent> {agent.greeting()}")
            continue
        if line == ":state":
            print(f"captured: {agent._captured}")
            continue
        if not line:
            continue

        result = agent.handle(line)
        print(f"       [captured: {result.record}]")
        print(f"agent> {result.agent_message}")
        if result.done:
            print(f"\nfinal record: {result.record}")
            print("(would save to the pending store here)")
            return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
