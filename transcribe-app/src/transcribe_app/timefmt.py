"""When a voicemail arrived, written the way a person reads it.

The sheet's "Received" column used to carry `datetime.now()` in UTC ISO form
(`2026-08-25T18:22:16+00:00`) — which is both hard to read and the wrong moment: it recorded when we
transcribed the voicemail, not when it came in. On a backfill that made every row show the same
timestamp. This uses the email's own `Date` header, converted to the business timezone.

The format is `YYYY-MM-DD HH:MM:SS` local time, deliberately: Google Sheets parses that as a real
datetime, so the column sorts and filters properly. A friendlier string like "Aug 25, 2026 11:22 AM
PDT" would land in the cell as text and sort alphabetically, which is worse than it looks.
"""

from __future__ import annotations

from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from zoneinfo import ZoneInfo

# Friendly names for the zones a customer is realistically in; anything else falls back to the IANA
# name, which is at least unambiguous.
_LABELS = {
    "America/Los_Angeles": "Pacific",
    "America/Denver": "Mountain",
    "America/Phoenix": "Arizona",
    "America/Chicago": "Central",
    "America/New_York": "Eastern",
    "UTC": "UTC",
}


def timezone_label(tz: str) -> str:
    """How the timezone reads in the sheet's header, e.g. "Pacific"."""
    return _LABELS.get(tz, tz)


def format_received(date_header: str, tz: str) -> str:
    """The email's Date header as local wall-clock time, e.g. "2026-08-25 11:22:16".

    Falls back to now() when the header is missing or unparseable — a row with a slightly wrong
    time is better than no row, and mail without a usable Date header is rare enough that failing
    the whole voicemail over it would be the worse trade.
    """
    try:
        received = parsedate_to_datetime(date_header)
    except (TypeError, ValueError):
        received = None

    if received is None:
        received = datetime.now(timezone.utc)
    elif received.tzinfo is None:
        # A Date header without an offset is rare but legal; read it as UTC rather than as whatever
        # the poller's own clock happens to be set to.
        received = received.replace(tzinfo=timezone.utc)

    return received.astimezone(ZoneInfo(tz)).strftime("%Y-%m-%d %H:%M:%S")
