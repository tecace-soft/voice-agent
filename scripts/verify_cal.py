"""Verify Cal.com scheduling access and list bookable event types.

    python scripts/verify_cal.py

Read-only: authenticates, prints the account, and lists event types with their
ids (you'll need an event type id to create bookings). Does not book anything.
"""

from __future__ import annotations

import sys

from voice_agent.config import Config, ConfigError
from voice_agent.tools.cal import CalClient, CalError


def main() -> int:
    try:
        cfg = Config.load()
    except ConfigError as exc:
        print(f"config: FAIL — {exc}")
        return 1

    try:
        client = CalClient(cfg)
        me = client.me()
        print(f"account: {me.get('name')!r} <{me.get('email')}> (id {me.get('id')})")
        types = client.event_types()
    except CalError as exc:
        print(f"cal: FAIL — {exc}")
        return 1

    print(f"event types: {len(types)}")
    for t in types:
        print(f"  id={t.get('id')}  {t.get('lengthInMinutes')}min  {t.get('title')!r}  (slug {t.get('slug')})")
    print("\nCal.com is reachable and authenticated.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
