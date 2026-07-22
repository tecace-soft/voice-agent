"""Cal.com scheduling — book an appointment for the caller.

Uses the Cal.com v2 REST API over urllib. Two gotchas learned by probing the
live API: (1) a normal User-Agent is required or Cloudflare blocks the request
with "error code: 1010"; (2) each endpoint pins its own `cal-api-version` date.
v1 is decommissioned.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from ..config import Config

_API_ROOT = "https://api.cal.com/v2"
_UA = "Mozilla/5.0 (compatible; voice-agent/0.1)"
# Per-endpoint API version dates (Cal.com requires the matching one).
_V_EVENT_TYPES = "2024-06-14"
_V_SLOTS = "2024-09-04"
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
        request = urllib.request.Request(f"{_API_ROOT}{path}", data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=self._cfg.request_timeout) as response:
                return json.load(response)
        except urllib.error.HTTPError as exc:
            detail = exc.read()[:300].decode("utf-8", "replace")
            raise CalError(f"Cal.com API error [{exc.code}] on {path}: {detail}") from exc

    # -- public API ------------------------------------------------------

    def me(self) -> dict[str, Any]:
        return self._call("/me")["data"]

    def event_types(self) -> list[dict[str, Any]]:
        """Bookable event types (id, title, slug, lengthInMinutes)."""
        return self._call("/event-types", version=_V_EVENT_TYPES)["data"]

    def slots(
        self, event_type_id: int, start: str, end: str, *, time_zone: str | None = None
    ) -> dict[str, Any]:
        """Available slots for an event type between two ISO datetimes.

        With `time_zone`, slot start times come back in that zone (offset form),
        which is what we read out to the caller.
        """
        params = {"eventTypeId": event_type_id, "start": start, "end": end}
        if time_zone:
            params["timeZone"] = time_zone
        return self._call(f"/slots?{urllib.parse.urlencode(params)}", version=_V_SLOTS).get("data", {})

    def create_booking(
        self,
        event_type_id: int,
        start: str,
        *,
        name: str,
        email: str,
        time_zone: str = "America/Los_Angeles",
    ) -> dict[str, Any]:
        """Book `event_type_id` at ISO `start` for the given attendee."""
        body = {
            "start": start,
            "eventTypeId": event_type_id,
            "attendee": {"name": name, "email": email, "timeZone": time_zone},
        }
        return self._call("/bookings", method="POST", version=_V_BOOKINGS, body=body)["data"]

    def cancel_booking(self, uid: str, *, reason: str = "") -> dict[str, Any]:
        """Cancel a booking by its uid (used to clean up test bookings)."""
        body = {"cancellationReason": reason} if reason else {}
        return self._call(
            f"/bookings/{uid}/cancel", method="POST", version=_V_BOOKINGS, body=body
        )["data"]
