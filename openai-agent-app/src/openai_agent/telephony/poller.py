"""Poll the backend for new leads and place a realtime call for each.

Mirrors the Retell poller's role (voice-agent-app/telephony/backend_poller.py): find leads that
are due, place the call, count the attempt, and retire a lead as `unreachable` once it's been
tried too many times — so we don't chase people who never answer. Booked/contacted/callback
leads leave the "new" queue on their own. The call itself is handled by the media-stream server
(run_server.py); this process only decides WHO to call and WHEN.
"""

from __future__ import annotations

import datetime
import logging
import time
from zoneinfo import ZoneInfo

from ..config import Config
from ..tools.backend import BackendClient, BackendError
from .outbound import place_call

log = logging.getLogger(__name__)

# How many times to call a lead before giving up and marking it `unreachable`.
MAX_CALL_ATTEMPTS = 3
# How long to hold a fresh lead after it came in, before placing the first call. Short for demo.
CALL_DELAY_SECONDS = 25


def _spoken_time(iso: str, tz: str) -> str:
    """An ISO instant as a spoken-friendly time in the business timezone, e.g.
    'Thursday, July 30 at 8 AM'."""
    try:
        dt = datetime.datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except ValueError:
        return iso
    if dt.tzinfo is not None:
        dt = dt.astimezone(ZoneInfo(tz))
    hour12 = dt.hour % 12 or 12
    ampm = "AM" if dt.hour < 12 else "PM"
    clock = f"{hour12} {ampm}" if dt.minute == 0 else f"{hour12}:{dt.minute:02d} {ampm}"
    return f"{dt.strftime('%A, %B')} {dt.day} at {clock}"


def lead_from_intake(intake: dict, tz: str) -> tuple[dict, str]:
    """Build the call's lead dict (Stream parameters) and the phone number from a backend intake."""
    iso = str(intake.get("scheduledAt", ""))
    lead = {
        "intake_id": str(intake.get("id", "")),
        "lead_name": str(intake.get("name", "")),
        "email": str(intake.get("email", "")),
        "purpose": str(intake.get("purpose", "")),
        "desired_time": _spoken_time(iso, tz) if iso else "",
        "dateTime": iso,
    }
    return lead, str(intake.get("phoneNumber", ""))


class LeadPoller:
    def __init__(self, cfg: Config, *, interval: float = 15.0) -> None:
        self._cfg = cfg
        self._interval = interval
        self._client = BackendClient(cfg)
        # intake_id -> the state signature we last called for; a lead re-armed with a new
        # callback time gets a fresh signature so its scheduled callback can re-fire.
        self._seen: dict[str, str] = {}

    @staticmethod
    def _signature(intake: dict) -> str:
        return str(intake.get("callbackAfter", "") or "")

    def _call_due(self, intake: dict) -> bool:
        """True once it's time to (re)call this lead — a requested callback time if set, else
        CALL_DELAY_SECONDS after the lead came in."""
        callback_after = str(intake.get("callbackAfter", "") or "")
        if callback_after:
            try:
                ts = datetime.datetime.fromisoformat(callback_after.replace("Z", "+00:00"))
            except ValueError:
                return True
            return datetime.datetime.now(datetime.timezone.utc) >= ts
        created = str(intake.get("createdAt", ""))
        if not created:
            return True
        try:
            ts = datetime.datetime.fromisoformat(created.replace("Z", "+00:00"))
        except ValueError:
            return True
        age = datetime.datetime.now(datetime.timezone.utc) - ts
        return age.total_seconds() >= CALL_DELAY_SECONDS

    def poll_once(self) -> int:
        """Check for due leads and place a call for each. Returns the number placed."""
        intakes = self._client.new_intakes()
        placed = 0
        for intake in intakes:
            intake_id = str(intake.get("id", ""))
            if not intake_id:
                continue
            signature = self._signature(intake)
            if self._seen.get(intake_id) == signature:
                continue
            if not self._call_due(intake):
                continue  # not yet due — re-check next poll (don't record)
            self._seen[intake_id] = signature

            lead, phone = lead_from_intake(intake, self._cfg.timezone)
            if not phone:
                log.warning("intake %s has no phone number; skipped", intake_id)
                continue

            attempts = int(intake.get("attempts", 0) or 0)
            if attempts >= MAX_CALL_ATTEMPTS:
                try:
                    self._client.set_status(intake_id, "unreachable")
                    log.info("intake %s unreachable after %d attempts; stopping", intake_id, attempts)
                except BackendError as exc:
                    log.warning("could not mark %s unreachable: %s", intake_id, exc)
                continue

            try:
                place_call(self._cfg, to_number=phone, lead=lead)
            except Exception as exc:  # noqa: BLE001 — one failed dial shouldn't stop the loop
                log.warning("could not place call for %s: %s", phone, exc)
                continue
            placed += 1
            log.info("called %s (intake %s, attempt %d/%d)", phone, intake_id, attempts + 1, MAX_CALL_ATTEMPTS)
            try:
                self._client.record_attempt(intake_id)
            except BackendError as exc:
                log.warning("could not record attempt for %s: %s", intake_id, exc)
        return placed

    def run(self) -> None:
        log.info("lead poller started (every %.0fs)", self._interval)
        while True:
            try:
                self.poll_once()
            except BackendError as exc:
                log.warning("poll error: %s", exc)
            except Exception as exc:  # noqa: BLE001
                log.warning("unexpected poll error: %s", exc)
            time.sleep(self._interval)
