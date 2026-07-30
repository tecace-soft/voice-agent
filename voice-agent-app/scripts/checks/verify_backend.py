"""Preflight the backend the voice agent depends on.

    python scripts/checks/verify_backend.py

Confirms BACKEND_URL is set + reachable, that leads can be read, and reports the
backend's schedule config (timezone + a sample opening) — so you can see it's on
the right business hours BEFORE running the phone server or placing a live call.
"""

from __future__ import annotations

import datetime
import sys
from zoneinfo import ZoneInfo

from voice_agent.config import Config, ConfigError
from voice_agent.tools.backend import BackendClient, BackendError


def _first_future_slot(grid: dict) -> str:
    now = datetime.datetime.now(datetime.timezone.utc)
    for day in grid.get("days", []):
        for slot in day.get("slots", []):
            start = slot.get("start", "")
            if slot.get("available") and start:
                try:
                    if datetime.datetime.fromisoformat(start) > now:
                        return start
                except ValueError:
                    continue
    return ""


def main() -> int:
    try:
        cfg = Config.load()
    except ConfigError as exc:
        print(f"config  : FAIL — {exc}")
        return 1
    if not cfg.backend_url:
        print("config  : FAIL — BACKEND_URL is not set in .env (the agent can't run without it).")
        return 1
    print(f"config  : ok — BACKEND_URL = {cfg.backend_url}")

    client = BackendClient(cfg)

    # Reachability + read access (leads) in one call.
    try:
        leads = client.new_intakes()
    except BackendError as exc:
        print(f"leads   : FAIL — {exc}")
        print("          (is the backend deployed and reachable? is Deployment Protection off?)")
        return 1
    print(f"leads   : ok — {len(leads)} lead(s) waiting (status=new)")

    # Schedule config — the key thing to eyeball before a live call.
    today = datetime.date.today()
    end = today + datetime.timedelta(days=10)
    try:
        grid = client.schedule_grid(today.isoformat(), end.isoformat())
    except BackendError as exc:
        print(f"schedule: FAIL — {exc}")
        return 1
    tz = str(grid.get("timezone", "?"))
    slot_min = grid.get("slotMinutes", "?")
    first = _first_future_slot(grid)
    when = "(no openings in the next 10 days)"
    if first:
        try:
            when = (
                datetime.datetime.fromisoformat(first)
                .astimezone(ZoneInfo(tz))
                .strftime("%A %b %d, %I:%M %p")
            )
        except Exception:  # noqa: BLE001
            when = first
    print(f"schedule: ok — timezone={tz}, slot={slot_min}min, next opening: {when}")
    if tz == "UTC":
        print(
            "          NOTE: timezone is UTC. For real business hours, set "
            "SCHEDULE_TIMEZONE=America/Los_Angeles (+ SCHEDULE_START/END) on the "
            "backend's Vercel project and redeploy."
        )

    print("\nBackend is reachable and configured — the agent can read leads and schedule.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
