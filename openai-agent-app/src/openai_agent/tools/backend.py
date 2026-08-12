"""Small synchronous backend client for the poller.

Reads new leads and writes call-attempt / status updates against the shared backend's regular
`/intake` API (not the `/agent/*` tools — those are called by the realtime agent during a call).
"""

from __future__ import annotations

from typing import Any

import httpx

from ..config import Config


class BackendError(RuntimeError):
    """The backend rejected a request or was unreachable."""


class BackendClient:
    def __init__(self, cfg: Config) -> None:
        if not cfg.backend_url:
            raise BackendError("BACKEND_URL is not set in .env.")
        self._base = cfg.backend_url.rstrip("/")
        self._client = httpx.Client(timeout=cfg.request_timeout)

    def new_intakes(self, limit: int = 50) -> list[dict[str, Any]]:
        """Leads awaiting a call (status = new), oldest first (FIFO)."""
        try:
            resp = self._client.get(
                f"{self._base}/intake", params={"status": "new", "limit": limit}
            )
            resp.raise_for_status()
        except httpx.HTTPError as exc:
            raise BackendError(f"could not fetch new leads: {exc}") from exc
        intakes = list(resp.json().get("intakes", []))
        intakes.sort(key=lambda i: i.get("createdAt", ""))
        return intakes

    def record_attempt(self, intake_id: str) -> None:
        """Count one more call attempt against a lead (atomic increment on the backend)."""
        try:
            self._client.post(f"{self._base}/intake/{intake_id}/attempt").raise_for_status()
        except httpx.HTTPError as exc:
            raise BackendError(f"could not record attempt: {exc}") from exc

    def set_status(self, intake_id: str, status: str) -> None:
        """Set a lead's status (e.g. 'unreachable' to stop calling)."""
        try:
            self._client.patch(
                f"{self._base}/intake/{intake_id}/status", json={"status": status}
            ).raise_for_status()
        except httpx.HTTPError as exc:
            raise BackendError(f"could not set status: {exc}") from exc
