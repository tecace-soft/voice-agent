"""Poll the backend for new leads and place callbacks.

The backend replaces Google Forms as the lead source: the form-app writes a lead
(POST /intake, status "new"), and we ASK the backend for new leads every few
seconds (GET /intake?status=new) — an ordinary outbound call, no webhook needed.
For each new lead with a phone number, we call them to finish scheduling.

Each triggered lead's id is remembered in-memory so a lead isn't re-queued before
its call completes; the call flow then writes the lead's real outcome back to the
backend (contacted / booked / unreachable), which is the durable de-dup across
restarts.
"""

from __future__ import annotations

import logging
import time
from typing import Callable

from ..config import Config
from ..tools.backend import BackendClient, BackendError

log = logging.getLogger(__name__)


def record_from_intake(intake: dict) -> tuple[dict[str, str], str]:
    """Build the conversation `record` (and phone) from a backend intake.

    Keys are chosen so the scheduler's record helpers find them: `name`, `email`,
    `phone`, `purpose`, `language`, and `desired_time` (the ISO time the lead picked
    on the form). `_intake_id` lets the agent book / update this exact lead.
    """
    record = {
        "_intake_id": str(intake.get("id", "")),
        "name": str(intake.get("name", "")),
        "email": str(intake.get("email", "")),
        "phone": str(intake.get("phoneNumber", "")),
        "purpose": str(intake.get("purpose", "")),
        "language": str(intake.get("language", "")),
        "desired_time": str(intake.get("scheduledAt", "")),
    }
    return record, record["phone"]


class BackendIntakePoller:
    def __init__(
        self,
        cfg: Config,
        trigger: Callable[[dict[str, str], str], str],
        *,
        interval: float = 30.0,
    ) -> None:
        self._cfg = cfg
        self._trigger = trigger
        self._interval = interval
        self._client = BackendClient(cfg)
        self._seen: set[str] = set()

    def poll_once(self) -> int:
        """Check for new leads; call each new one back. Returns count placed."""
        intakes = self._client.new_intakes()
        placed = 0
        for intake in intakes:
            intake_id = str(intake.get("id", ""))
            if not intake_id or intake_id in self._seen:
                continue
            record, phone = record_from_intake(intake)
            if phone:
                try:
                    self._trigger(record, phone)   # enqueue; the queue paces + retries
                    placed += 1
                    log.info("queued call for %s (intake %s)", phone, intake_id)
                except Exception as exc:  # noqa: BLE001
                    log.warning("could not queue call for %s: %s", phone, exc)
            else:
                log.warning("intake %s has no phone number; skipped", intake_id)
            self._seen.add(intake_id)
        return placed

    def run(self) -> None:
        log.info("backend intake poller started (every %.0fs)", self._interval)
        while True:
            try:
                self.poll_once()
            except BackendError as exc:  # keep polling through transient backend errors
                log.warning("poll error: %s", exc)
            except Exception as exc:  # noqa: BLE001
                log.warning("unexpected poll error: %s", exc)
            time.sleep(self._interval)
