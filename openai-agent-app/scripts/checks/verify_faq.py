"""Check the shared knowledge blocks carry no single company's details.

    python scripts/checks/verify_faq.py

faq.py's own docstring has always promised this test; it did not exist. It matters more now than
when that line was written: one agent answers for several customers, and FACTS is replaced per call
while FAQ and DEFERRALS are not. Anything company-specific that drifts into those two is spoken to
every customer's callers, and the person who put it there would never see it happen.

Run it after editing faq.py.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from openai_agent.realtime.faq import DEFERRALS, FACTS, FAQ, build_knowledge  # noqa: E402

# Specifics that belong in FACTS and nowhere else. Drawn from the TecAce facts themselves, since
# that is the copy most likely to be pasted into the shared blocks by accident.
COMPANY_SPECIFICS = [
    "TecAce", "Bellevue", "Seoul", "Samsung", "UnitedHealthcare", "Nike", "Anthropic",
    "CCAF", "tecace.com", "AX Pro", "Claude Enterprise", "2000",
]


def main() -> int:
    failures: list[str] = []

    shared = DEFERRALS + "\n" + "\n".join(q + " " + a for q, a in FAQ)
    for term in COMPANY_SPECIFICS:
        if re.search(rf"\b{re.escape(term)}\b", shared, re.IGNORECASE):
            failures.append(
                f"{term!r} appears in the FAQ or DEFERRALS. Those are shared by every customer — "
                f"move it into FACTS, which is replaced per call."
            )

    # A customer's own facts must fully replace TecAce's, not sit alongside them.
    swapped = build_knowledge("- Acme Dental is a family dental practice in Tacoma, Washington.")
    if "Acme Dental" not in swapped:
        failures.append("build_knowledge did not include the customer's facts.")
    for term in COMPANY_SPECIFICS:
        if re.search(rf"\b{re.escape(term)}\b", swapped, re.IGNORECASE):
            failures.append(f"{term!r} survived into a customer's knowledge block.")

    # The pricing rule has two halves, and losing either one is a real failure: without the first
    # the agent invents numbers, without the second it refuses to read a price a customer published.
    lowered = DEFERRALS.lower()
    if "inventing a price" not in lowered:
        failures.append("DEFERRALS no longer forbids inventing a price.")
    if "in the facts" not in lowered:
        failures.append("DEFERRALS no longer permits stating a price that IS in the facts.")

    # And the defaults must still be the defaults.
    if "TecAce" not in FACTS:
        failures.append("FACTS no longer contains the fallback company — check it wasn't emptied.")

    for problem in failures:
        print(f"  FAIL  {problem}")
    if failures:
        print(f"\nfaq: {len(failures)} problem(s).")
        return 1

    print("  ok  FAQ and DEFERRALS name no company")
    print("  ok  a customer's facts fully replace the defaults")
    print("  ok  pricing rule keeps both halves (state what's stated, never invent)")
    print("\nfaq: ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
