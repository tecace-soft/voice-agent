"""Poll the backend for new leads and place callbacks.

The backend replaces Google Forms as the lead source: the form-app writes a lead
(POST /intake, status "new"), and we ASK the backend for new leads every few
seconds (GET /intake?status=new) — an ordinary outbound call, no webhook needed.
For each new lead with a phone number, we call them to finish scheduling — after a short
pre-call delay (CALL_DELAY_SECONDS) measured from when the request came in.

Each triggered lead's id is remembered in-memory so a lead isn't re-queued before
its call completes; the call flow then writes the lead's real outcome back to the
backend (contacted / booked / unreachable), which is the durable de-dup across
restarts.

Leads who never answer stay "new", so without a bound the poller would re-call them
forever (every restart re-picks them). To stop that, each placed call is counted on
the backend (POST /intake/:id/attempt); once a lead reaches MAX_CALL_ATTEMPTS we
mark it `unreachable` — it leaves the "new" queue and the calls stop. Booked/contacted
leads leave "new" on their own, so only genuinely-unreachable leads hit the cap.
"""

from __future__ import annotations

import datetime
import logging
import time
from typing import Callable

from ..config import Config
from ..tools.backend import BackendClient, BackendError

log = logging.getLogger(__name__)

# How many times to call a lead before giving up and marking it `unreachable`.
# Hardcoded for now; revisit if we want this configurable later.
MAX_CALL_ATTEMPTS = 3

# How long to wait after a booking request before placing the call. Kept very short while
# testing the demo so we're not waiting around — with the 15s poll interval a fresh lead is
# called on the next poll or two (~20-30s), rather than a full minute.
CALL_DELAY_SECONDS = 25


def record_from_intake(intake: dict) -> tuple[dict[str, str], str]:
    """Build the conversation `record` (and phone) from a backend intake.

    Keys are chosen so the scheduler's record helpers find them: `name`, `email`,
    `phone` and `desired_time` (the ISO time the lead picked on the form).
    `_intake_id` lets the agent book / update this exact lead.
    """
    record = {
        "_intake_id": str(intake.get("id", "")),
        "name": str(intake.get("name", "")),
        "email": str(intake.get("email", "")),
        "phone": str(intake.get("phoneNumber", "")),
        "purpose": str(intake.get("purpose", "")),
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
        # intake_id -> the "signature" of the state we last placed a call for. A lead whose
        # signature is unchanged is skipped; a lead that has since been given a NEW requested
        # callback time gets a fresh signature, so its scheduled callback can re-fire.
        self._seen: dict[str, str] = {}

    @staticmethod
    def _signature(intake: dict) -> str:
        """What makes this lead re-callable. Empty for a first contact; the requested
        callback time once one is set, so scheduling a callback re-arms the lead."""
        return str(intake.get("callbackAfter", "") or "")

    def _call_due(self, intake: dict) -> bool:
        """True once it's time to (re)call this lead.

        If a callback time was requested on a prior call, hold until that instant. Otherwise
        hold a fresh lead for CALL_DELAY_SECONDS after the request came in.
        """
        callback_after = str(intake.get("callbackAfter", "") or "")
        if callback_after:
            try:
                ts = datetime.datetime.fromisoformat(callback_after.replace("Z", "+00:00"))
            except ValueError:
                return True  # unparseable — don't hold it back
            return datetime.datetime.now(datetime.timezone.utc) >= ts
        created = str(intake.get("createdAt", ""))
        if not created:
            return True  # no timestamp — don't hold it back
        try:
            ts = datetime.datetime.fromisoformat(created.replace("Z", "+00:00"))
        except ValueError:
            return True
        age = datetime.datetime.now(datetime.timezone.utc) - ts
        return age.total_seconds() >= CALL_DELAY_SECONDS

    def poll_once(self) -> int:
        """Check for new leads; call each new one back. Returns count placed.

        A lead that has already been called `MAX_CALL_ATTEMPTS` times is marked
        `unreachable` instead of called again, so we stop chasing people who never
        answer (the `attempts` count is persisted on the backend, so the cap holds
        across restarts too).
        """
        intakes = self._client.new_intakes()
        placed = 0
        for intake in intakes:
            intake_id = str(intake.get("id", ""))
            if not intake_id:
                continue
            signature = self._signature(intake)
            # Skip a lead we've already handled in this exact state. A scheduled callback
            # changes the signature, so it isn't treated as already-handled.
            if self._seen.get(intake_id) == signature:
                continue
            # Hold until the lead is due (pre-call delay, or a requested callback time). Skip
            # WITHOUT recording it so it's re-checked on the next poll and called once due.
            if not self._call_due(intake):
                continue
            # Handled this run either way (call, skip, or retire) — record the state we acted on.
            self._seen[intake_id] = signature

            record, phone = record_from_intake(intake)
            if not phone:
                log.warning("intake %s has no phone number; skipped", intake_id)
                continue

            attempts = int(intake.get("attempts", 0) or 0)
            if attempts >= MAX_CALL_ATTEMPTS:
                # Out of retries — retire the lead so it drops out of the "new" queue.
                try:
                    self._client.set_status(intake_id, "unreachable")
                    log.info(
                        "intake %s unreachable after %d attempts; no longer calling",
                        intake_id,
                        attempts,
                    )
                except BackendError as exc:
                    log.warning("could not mark %s unreachable: %s", intake_id, exc)
                continue

            try:
                self._trigger(record, phone)   # enqueue; the queue paces + retries
            except Exception as exc:  # noqa: BLE001
                log.warning("could not queue call for %s: %s", phone, exc)
                continue
            placed += 1
            log.info(
                "queued call for %s (intake %s, attempt %d/%d)",
                phone,
                intake_id,
                attempts + 1,
                MAX_CALL_ATTEMPTS,
            )
            # Count this attempt (best-effort — a counter hiccup shouldn't block the call).
            try:
                self._client.record_attempt(intake_id)
            except BackendError as exc:
                log.warning("could not record attempt for %s: %s", intake_id, exc)
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
