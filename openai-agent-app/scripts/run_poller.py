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

    # One call at a time, oldest to newest, checking every 5 minutes by default
    # (POLL_INTERVAL_SECONDS). Note the interval also paces the QUEUE: at most one call is placed
    # per cycle, so a backlog of N leads takes at least N intervals to work through — at the
    # 5-minute default, ten queued leads take the best part of an hour. Lower it if leads ever
    # arrive faster than that.
    poller = LeadPoller(cfg, interval=cfg.poll_interval)
    print(
        f"Lead poller running — leads are called one at a time, oldest first, "
        f"checked every {cfg.poll_interval:.0f}s. Ctrl+C to stop."
    )
    try:
        poller.run()
    except KeyboardInterrupt:
        print()
        return 0


if __name__ == "__main__":
    sys.exit(main())
