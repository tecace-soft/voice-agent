"""Backend API client — the shared service the agent uses for leads, scheduling,
and status, replacing Cal.com + Google Sheets.

Everything the agent needs from the server goes through here: read new leads,
check availability + nearest openings, book a chosen slot, and write back the
lead's status and the post-call summary. Plain urllib (no extra deps), same
style as the other tools. Base URL comes from BACKEND_URL in .env.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from ..config import Config


class BackendError(RuntimeError):
    """The backend API rejected a request or was unreachable."""

    def __init__(self, message: str, *, status: int = 0, code: str = "") -> None:
        super().__init__(message)
        self.status = status   # HTTP status (0 if the request never completed)
        self.code = code       # the backend's `status` field, e.g. "slot_taken"


class BackendClient:
    def __init__(self, cfg: Config) -> None:
        if not cfg.backend_url:
            raise BackendError("BACKEND_URL is not set in .env.")
        self._cfg = cfg
        self._base = cfg.backend_url.rstrip("/")

    def _call(self, path: str, *, method: str = "GET", body: Any = None) -> Any:
        headers = {"Accept": "application/json"}
        data = None
        if body is not None:
            data = json.dumps(body).encode()
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(
            f"{self._base}{path}", data=data, method=method, headers=headers
        )
        try:
            with urllib.request.urlopen(req, timeout=self._cfg.request_timeout) as resp:
                text = resp.read().decode("utf-8", "replace")
                return json.loads(text) if text else {}
        except urllib.error.HTTPError as exc:
            detail = exc.read()[:300].decode("utf-8", "replace")
            code = ""
            try:
                code = str(json.loads(detail).get("status", ""))
            except Exception:  # noqa: BLE001 — best-effort code extraction
                pass
            raise BackendError(
                f"backend API error [{exc.code}] on {path}: {detail}",
                status=exc.code,
                code=code,
            ) from exc
        except urllib.error.URLError as exc:
            raise BackendError(
                f"could not reach backend at {self._base}: {exc.reason}"
            ) from exc

    @staticmethod
    def _query(**params: Any) -> str:
        return urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})

    # -- leads -----------------------------------------------------------

    def new_intakes(self, limit: int = 50) -> list[dict[str, Any]]:
        """Leads awaiting a call (status = new). Oldest first, so the queue is FIFO."""
        data = self._call(f"/intake?{self._query(status='new', limit=limit)}")
        intakes = list(data.get("intakes", []))
        intakes.sort(key=lambda i: i.get("createdAt", ""))
        return intakes

    # -- scheduling ------------------------------------------------------

    def schedule_grid(self, from_date: str, to_date: str) -> dict[str, Any]:
        """The raw slot grid {timezone, slotMinutes, days:[{date, slots}]} for a date range."""
        return self._call(f"/schedule?{self._query(**{'from': from_date, 'to': to_date})}")

    def available_slots(self, from_date: str, to_date: str) -> list[str]:
        """ISO start times of every open slot in [from_date, to_date] (dates YYYY-MM-DD)."""
        grid = self.schedule_grid(from_date, to_date)
        starts: list[str] = []
        for day in grid.get("days", []):
            for slot in day.get("slots", []):
                if slot.get("available"):
                    starts.append(slot["start"])
        return starts

    def availability(self, date_time: str) -> dict[str, Any]:
        """Is a specific instant a free, bookable slot? -> {available, reason}."""
        return self._call(f"/schedule/availability?{self._query(dateTime=date_time)}")

    def suggestions(
        self, date_time: str, *, limit: int = 3, within_days: int = 14
    ) -> list[dict[str, Any]]:
        """Nearest available slots to a wanted time (closest first): [{start,end,date,...}]."""
        data = self._call(
            f"/schedule/suggestions?"
            f"{self._query(dateTime=date_time, limit=limit, withinDays=within_days)}"
        )
        return list(data.get("suggestions", []))

    # -- booking + status ------------------------------------------------

    def book(self, intake_id: str, date_time: str | None = None) -> dict[str, Any]:
        """Book a lead — at `date_time` (the slot chosen on the call) if given, else their
        form time. Raises BackendError on conflict (409) / past (422) / not found (404)."""
        body: dict[str, Any] = {"status": "booked"}
        if date_time:
            body["dateTime"] = date_time
        data = self._call(f"/intake/{intake_id}/status", method="PATCH", body=body)
        return data.get("intake", {})

    def record_attempt(self, intake_id: str) -> dict[str, Any]:
        """Count one more call attempt against a lead (atomic increment on the backend).
        Returns the updated intake — read `attempts` to decide when to give up."""
        data = self._call(f"/intake/{intake_id}/attempt", method="POST")
        return data.get("intake", {})

    def set_status(self, intake_id: str, status: str) -> dict[str, Any]:
        """Set a lead's status (contacted / unreachable / new)."""
        data = self._call(
            f"/intake/{intake_id}/status", method="PATCH", body={"status": status}
        )
        return data.get("intake", {})

    def set_notes(self, intake_id: str, notes: str) -> dict[str, Any]:
        """Attach the agent's post-call summary to a lead."""
        data = self._call(
            f"/intake/{intake_id}/notes", method="PATCH", body={"notes": notes}
        )
        return data.get("intake", {})
