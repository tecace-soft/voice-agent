"""Cal.com — create the consultation meeting so the lead gets a calendar invite + link.

The BACKEND owns availability and the authoritative booking; Cal.com is used ONLY to
generate the actual meeting (Teams/Zoom/Meet, per the event type's config) and email the
invite + join link to the lead. So set the Cal.com event type's availability wide enough
that it never rejects a time the backend already approved. Uses the Cal.com v2 REST API
over urllib (no extra deps).

Gotchas from the live API: (1) a normal User-Agent is required or Cloudflare blocks the
request with "error code: 1010"; (2) the bookings endpoint pins its own cal-api-version.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any

from ..config import Config

_API_ROOT = "https://api.cal.com/v2"
_UA = "Mozilla/5.0 (compatible; voice-agent/0.1)"
_V_BOOKINGS = "2024-08-13"


class CalError(RuntimeError):
    """The Cal.com API rejected a request."""


class CalClient:
    def __init__(self, cfg: Config) -> None:
        if not cfg.cal_api_key:
            raise CalError("CAL_API_KEY is not set in .env.")
        self._cfg = cfg
        self._key = cfg.cal_api_key

    def _call(self, path: str, *, method: str = "GET", version: str | None = None,
              body: Any = None) -> Any:
        headers = {
            "User-Agent": _UA,
            "Accept": "application/json",
            "Authorization": f"Bearer {self._key}",
        }
        if version:
            headers["cal-api-version"] = version
        data = None
        if body is not None:
            data = json.dumps(body).encode()
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(
            f"{_API_ROOT}{path}", data=data, method=method, headers=headers
        )
        try:
            with urllib.request.urlopen(request, timeout=self._cfg.request_timeout) as response:
                return json.load(response)
        except urllib.error.HTTPError as exc:
            detail = exc.read()[:300].decode("utf-8", "replace")
            raise CalError(f"Cal.com API error [{exc.code}] on {path}: {detail}") from exc

    def create_booking(
        self,
        event_type_id: int,
        start: str,
        *,
        name: str,
        email: str,
        time_zone: str = "America/Los_Angeles",
    ) -> dict[str, Any]:
        """Create the meeting at ISO `start` for the attendee. Cal.com emails them the
        invite + meeting link. Returns the created booking (incl. any meeting URL)."""
        body = {
            "start": start,
            "eventTypeId": event_type_id,
            "attendee": {"name": name, "email": email, "timeZone": time_zone},
        }
        return self._call("/bookings", method="POST", version=_V_BOOKINGS, body=body)["data"]
