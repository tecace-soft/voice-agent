"""Point the Twilio number's Voice webhook at this app so it handles INBOUND calls.

    python scripts/setup_inbound_webhook.py

Reads ACCOUNT_SID / AUTH_TOKEN / PHONE_NUMBER + PUBLIC_BASE_URL from .env and sets the
number's Voice webhook to <PUBLIC_BASE_URL>/voice/incoming (and its call status callback
to /voice/status). Run this once from the box that serves the agent — and again any time
PUBLIC_BASE_URL changes. Idempotent and safe to re-run.
"""

from __future__ import annotations

import sys

from voice_agent.config import Config, ConfigError
from voice_agent.telephony import configure_inbound_webhook


def main() -> int:
    try:
        cfg = Config.load()
    except ConfigError as exc:
        print(f"config error: {exc}")
        return 1

    print(f"configuring inbound webhook for {cfg.twilio_phone_number} …")
    try:
        info = configure_inbound_webhook(cfg)
    except Exception as exc:  # noqa: BLE001
        print(f"failed: {exc}")
        return 1

    print("done — inbound calls will now reach the agent:")
    print(f"  number:          {info['phoneNumber']} ({info['sid']})")
    print(f"  Voice webhook:   {info['voiceUrl']}")
    print(f"  status callback: {info['statusCallback']}")
    print("\nMake sure the phone server (scripts/run_phone.py) is running and reachable")
    print("at PUBLIC_BASE_URL, then call the number to test.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
