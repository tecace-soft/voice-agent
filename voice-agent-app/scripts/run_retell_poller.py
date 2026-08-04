"""Run the outbound lead poller, placing calls via Retell (the new demo path).

    python scripts/run_retell_poller.py

Polls the backend for new leads and, after the pre-call delay, triggers a Retell outbound
call for each — passing the lead's details (name, email, purpose, requested time, intake id)
as dynamic variables so the Retell agent can confirm and book via the backend tools.

This replaces the old Twilio/CallSession outbound path (scripts/run_phone.py): Retell owns
the whole voice layer now, so this process only finds due leads and hands them off. The
per-lead attempt cap and pre-call delay still live in the poller. Requires RETELL_API_KEY,
RETELL_AGENT_ID, and a Retell-imported RETELL_FROM_NUMBER (or PHONE_NUMBER) in .env.
"""

from __future__ import annotations

import logging
import sys

from voice_agent.config import Config, ConfigError
from voice_agent.telephony.backend_poller import BackendIntakePoller
from voice_agent.telephony.retell import RetellError, make_retell_trigger


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    try:
        cfg = Config.load()
    except ConfigError as exc:
        print(f"config error: {exc}")
        return 1
    if not cfg.backend_url:
        print("BACKEND_URL is not set — the poller has no lead source.")
        return 1
    try:
        trigger = make_retell_trigger(cfg)
    except RetellError as exc:
        print(f"Retell is not configured: {exc}")
        return 1

    # Poll a little faster than the default so the ~1 minute pre-call delay is tight.
    poller = BackendIntakePoller(cfg, trigger, interval=15.0)
    print("Retell outbound poller running — new leads are called via Retell. Ctrl+C to stop.")
    try:
        poller.run()
    except KeyboardInterrupt:
        print()
        return 0


if __name__ == "__main__":
    sys.exit(main())
