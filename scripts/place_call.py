"""Have the agent call someone (outbound).

    python scripts/place_call.py +15551234567

Requires the phone server to be running (scripts/run_phone.py) and reachable at
PUBLIC_BASE_URL, so Twilio can fetch the call's instructions.
"""

from __future__ import annotations

import sys

from voice_agent.config import Config, ConfigError
from voice_agent.telephony import place_call


def main(argv: list[str]) -> int:
    if not argv:
        print("usage: python scripts/place_call.py <phone-number-e164>  e.g. +15551234567")
        return 1
    try:
        cfg = Config.load()
    except ConfigError as exc:
        print(f"config error: {exc}")
        return 1

    to = argv[0]
    print(f"placing call: {cfg.twilio_phone_number} -> {to}")
    try:
        sid = place_call(cfg, to)
        print(f"call started (sid {sid}). The agent will speak when they answer.")
        return 0
    except Exception as exc:  # noqa: BLE001
        print(f"failed to place call: {exc}")
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
