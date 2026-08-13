"""Place a test outbound call to try the realtime agent.

    python scripts/place_call.py +15551234567 --name "David Kim" \
        --purpose "AI adoption for our logistics operations" \
        --datetime 2026-08-15T14:00:00 --desired-time "Friday, August 15 at 2 PM" \
        --intake-id <uuid>

The server (run_server.py) must already be running and reachable at PUBLIC_HOST. --intake-id
should be a real lead id if you want booking/callback/mark-outcome to write back to the backend;
omit it to just exercise the conversation + availability lookups.
"""

from __future__ import annotations

import argparse
import sys

from openai_agent.config import Config
from openai_agent.telephony.outbound import place_call


def main() -> int:
    parser = argparse.ArgumentParser(description="Place a test call to the realtime agent.")
    parser.add_argument("to_number", help="Number to call, E.164 (e.g. +14255551234).")
    parser.add_argument("--name", default="", help="Lead name (spoken as {{lead_name}}).")
    parser.add_argument("--purpose", default="", help="What they reached out about.")
    parser.add_argument("--email", default="", help="Lead email on file.")
    parser.add_argument("--desired-time", default="", help="Requested time, spoken form.")
    parser.add_argument("--datetime", default="", help="Requested time, ISO 8601 (for tools).")
    parser.add_argument("--intake-id", default="", help="Backend intake id (enables write-back).")
    parser.add_argument(
        "--callback",
        action="store_true",
        help="Treat as a promised callback (agent skips the cold intro and gets to the point).",
    )
    args = parser.parse_args()

    cfg = Config.load()
    gaps = cfg.missing_for_outbound()
    if gaps:
        print("Missing settings needed to place a call: " + ", ".join(gaps))
        print("Fill these in .env (see .env.example) and re-run.")
        return 1

    lead = {
        "intake_id": args.intake_id,
        "lead_name": args.name,
        "purpose": args.purpose,
        "email": args.email,
        "desired_time": args.desired_time,
        "dateTime": args.datetime,
    }
    if args.callback:
        lead["is_callback"] = "yes"
    sid = place_call(cfg, to_number=args.to_number, lead=lead)
    print(f"Call placed: {sid}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
