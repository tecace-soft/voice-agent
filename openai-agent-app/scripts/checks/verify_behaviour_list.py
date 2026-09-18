"""Does the dashboard's "on every call, as standard" list still match what the agent is told?

    python scripts/checks/verify_behaviour_list.py

The dashboard shows customers a plain-language list of what the assistant does before they add any
instructions of their own. That list lives in transcribe-backend (routes/behaviourDefaults.ts) and
the behaviour itself lives here, in the inbound prompt — two files that could drift apart silently,
leaving customers reading a promise the agent no longer keeps.

This fails when they do: every line in the list must still correspond to something the prompt
actually says, and a line added to the list without a rule behind it fails too.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))

from openai_agent.realtime.instructions_inbound import build_instructions  # noqa: E402

DEFAULTS_TS = ROOT.parent / "transcribe-backend" / "src" / "routes" / "behaviourDefaults.ts"

# Each promise on the dashboard, and the words in the prompt that keep it. Matched case-insensitively
# against the rendered inbound instructions; every phrase listed must be present.
PROMISES: list[tuple[str, list[str]]] = [
    ("Answers as your receptionist, using only the business details you saved",
     ["receptionist", "comes from the facts", "never speculate"]),
    ("Asks which you mean when a question has more than one answer",
     ["Ask before you answer", "ask ONE short question"]),
    ("Says it doesn't know rather than inventing an answer, and offers a person instead",
     ["you do not know the answer", "OFFERING A PERSON"]),
    ("Asks before putting anyone through, and only transfers when they say yes",
     ["ASK FIRST, ALWAYS", "Wait for their answer"]),
    ("Never says anything is booked, held or confirmed, and never promises what your team will do",
     ["NEVER say or imply that anything is booked", "NEVER promise what a person will do"]),
    ("Takes a message using the number they are calling from",
     ["You ALREADY HAVE their number", "Do not ask for a phone number"]),
    ("Gives your address, hours and prices whenever a caller asks for them",
     ["Sharing the business's address is always allowed"]),
    ("Tells callers it is an AI assistant the moment anyone asks",
     ["you are an AI assistant answering the phone", "NEVER claim to be human"]),
    ("Lets the caller finish, and does not rush to end the call",
     ["Let them finish", "never rush to wrap up"]),
]

failures = 0


def check(name: str, ok: bool, detail: str = "") -> None:
    global failures
    print(("  ok  " if ok else "  FAIL ") + name + ("" if ok else f"   -- {detail}"))
    if not ok:
        failures += 1


def main() -> int:
    prompt = build_instructions(
        caller="+12065550100", business_name="Olympus Spa", agent_name="Tess",
        business_facts="- A day pass is 58 dollars.", default_facts=False,
    ).lower()

    listed = re.findall(r"does:\s*\n?\s*\"([^\"]+)\"", DEFAULTS_TS.read_text(encoding="utf-8"))
    check(f"read the dashboard's list ({len(listed)} lines)", bool(listed), str(DEFAULTS_TS))

    for promise, phrases in PROMISES:
        missing = [p for p in phrases if p.lower() not in prompt]
        check(f"the prompt still backs: {promise}", not missing, f"missing from the prompt: {missing}")

    unchecked = [line for line in listed if line not in dict(PROMISES)]
    check("every line shown to customers is checked here", not unchecked,
          f"add these to PROMISES with the prompt text that backs them: {unchecked}")
    stale = [promise for promise, _ in PROMISES if promise not in listed]
    check("nothing is checked that the dashboard no longer shows", not stale,
          f"no longer in behaviourDefaults.ts: {stale}")

    print(f"\nbehaviour list: {'ok' if not failures else f'{failures} FAILED'}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
