"""Run the lead poller — finds due leads and places a realtime call for each.

    python scripts/run_poller.py

Keep this running alongside the media-stream server (run_server.py): the poller decides who to
call, the server handles the call audio. Requires BACKEND_URL plus the Twilio + PUBLIC_HOST
settings needed to place a call (see .env.example).
"""

from __future__ import annotations

import logging
import sys

from openai_agent.config import Config
from openai_agent.telephony.poller import LeadPoller


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    cfg = Config.load()
    if not cfg.backend_url:
        print("BACKEND_URL is not set — the poller has no lead source.")
        return 1
    gaps = cfg.missing_for_outbound()
    if gaps:
        print("Missing settings needed to place calls: " + ", ".join(gaps))
        print("Fill these in .env (see .env.example) and re-run.")
        return 1

    # Poll a little faster than the pre-call delay so a fresh lead is called within ~20-30s.
    poller = LeadPoller(cfg, interval=15.0)
    print("Lead poller running — due leads are called via the OpenAI realtime agent. Ctrl+C to stop.")
    try:
        poller.run()
    except KeyboardInterrupt:
        print()
        return 0


if __name__ == "__main__":
    sys.exit(main())
