"""Run the lead poller — finds due leads and places a realtime call for each.

    python scripts/run_poller.py

Keep this running alongside the media-stream server (run_server.py): the poller decides who to
call, the server handles the call audio. Requires BACKEND_URL plus the Twilio + PUBLIC_HOST
settings needed to place a call (see .env.example).
"""

from __future__ import annotations

import logging
import sys
import threading

import uvicorn

from openai_agent.config import Config
from openai_agent.telephony.notify_server import build_app
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

    # One call at a time, oldest to newest. The queue is driven by NOTIFICATIONS from the
    # backend; POLL_INTERVAL_SECONDS is only the safety net for a notification that never arrived.
    # Note the pacing: at most one call is placed per cycle, but a notification wakes the loop
    # immediately, so a backlog drains as fast as calls complete rather than one per interval.
    poller = LeadPoller(cfg, interval=cfg.poll_interval)

    # The poll loop is synchronous and blocking (it dials with the Twilio SDK), so it runs in its
    # own thread and the notification server owns the main thread. Daemon: the loop has no cleanup
    # to do, and this way Ctrl+C on the server ends the process rather than hanging on the thread.
    loop = threading.Thread(target=poller.run, name="lead-poll-loop", daemon=True)
    loop.start()

    print("Lead poller running - dialing one lead at a time, oldest first.")
    print(f"  notifications : POST http://0.0.0.0:{cfg.poller_port}/poller/lead-due")
    print(f"  safety poll   : every {cfg.poll_interval:.0f}s")
    print("Ctrl+C to stop.")
    if not cfg.agent_tools_secret:
        print("WARNING — AGENT_TOOLS_SECRET is unset: notifications will be REJECTED.")
    try:
        uvicorn.run(build_app(cfg, poller), host="0.0.0.0", port=cfg.poller_port, log_level="warning")
    except KeyboardInterrupt:
        print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
