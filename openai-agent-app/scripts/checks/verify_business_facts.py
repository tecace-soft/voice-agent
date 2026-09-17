"""What does the agent actually know about a business? Ask the dashboard, as a call would.

    python scripts/checks/verify_business_facts.py +14255988987

Run this when a caller says the agent didn't know something — an address, the hours, a price. It
performs the SAME lookup a real call performs, then says whether the answer is in the facts the
agent is given. The agent can only state what is in that list: when a caller asks where the
business is and the facts hold nothing but a city, the agent gives the city, because there is
nothing else to give. That is not the agent refusing; that is the profile.

Needs BUSINESS_CONFIG_URL and AGENT_CONFIG_KEY, so run it where the agent runs:

    docker compose exec server python scripts/checks/verify_business_facts.py +14255988987

Nothing is written and no call is placed. With no number, the agent's own outbound number is used.
"""

from __future__ import annotations

import asyncio
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from openai_agent.config import Config  # noqa: E402
from openai_agent.tools.business_config import fetch_business_config  # noqa: E402

# A street line as a business writes one: a number, then words, ending in a street-type word. Loose
# on purpose — this only decides whether to print a warning, never what the agent may say.
STREET = re.compile(
    r"\b\d{1,6}\s+[\w.'-]+(?:\s+[\w.'-]+){0,5}\s+"
    r"(street|st|avenue|ave|road|rd|drive|dr|way|place|pl|boulevard|blvd|lane|ln|court|ct|"
    r"parkway|pkwy|circle|cir|highway|hwy|suite|ste|unit|floor|building)\b",
    re.IGNORECASE,
)
LOCATION_WORD = re.compile(r"\b(located|location|address|find us|visit us|headquarter)", re.IGNORECASE)


async def main() -> int:
    cfg = Config.load()
    number = (sys.argv[1] if len(sys.argv) > 1 else cfg.twilio_from_number or "").strip()

    if not cfg.business_config_url or not cfg.agent_config_key:
        print("Not configured: BUSINESS_CONFIG_URL and AGENT_CONFIG_KEY must both be set.")
        print("Run this where the agent runs — docker compose exec server python "
              "scripts/checks/verify_business_facts.py <number>")
        return 2
    if not number:
        print("No number given, and TWILIO_FROM_NUMBER is empty.")
        print("Usage: python scripts/checks/verify_business_facts.py +14255988987")
        return 2

    business = await fetch_business_config(cfg, number)
    if business is None:
        print(f"{number}: no business — the lookup failed or the number is unassigned.")
        print("A call to it is answered neutrally: the agent states nothing about any company.")
        print("Check the number under Agent numbers in the dashboard, and that this host can reach "
              f"{cfg.business_config_url}.")
        return 1

    facts = [line.strip(" -\t") for line in business.facts.splitlines() if line.strip()]
    print(f"{number} -> {business.business_name or '(no business name)'} "
          f"({business.user_name} <{business.user_email}>)")
    print(f"  hours:    {business.hours_text or '(none on file)'}")
    print(f"  website:  {business.website or '(none on file)'}")
    print(f"  transfer: {business.transfer_number or '(none — the agent will not offer a transfer)'}")
    print(f"  facts on file: {len(facts)}")

    if not facts:
        print("\n  NO FACTS ON FILE. The agent will say it doesn't know anything about this "
              "business — not its address, hours, services or prices — and offer to take a message.")
        print("  Fix: Business profile in the dashboard, describe the business, save.")
        return 1

    with_street = [f for f in facts if STREET.search(f)]
    location = [f for f in facts if LOCATION_WORD.search(f) or STREET.search(f)]
    print("\n  Location the agent can give:")
    for fact in location or ["(nothing in the facts mentions where the business is)"]:
        print(f"    - {fact}")

    if with_street:
        print("\n  A FULL STREET ADDRESS IS ON FILE, so the agent will read it out when asked.")
        print("  If a caller was told only a city, check that the call really went to this number.")
        return 0

    print("\n  NO STREET ADDRESS IN THE FACTS. Asked where the business is, the agent can only give "
          "what is above (usually the city) and offer to have someone send the address.")
    print("  Fix: add the full street address to the description in Business profile and save — "
          "for example \"Our office is at 3815 196th Street Southwest, Suite 160, Lynnwood, "
          "Washington.\" Saving re-reads the description, and the next call has it.")
    return 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
