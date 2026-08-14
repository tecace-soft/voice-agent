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
from .outbound import call_has_ended, fetch_call_result, is_machine, place_call

log = logging.getLogger(__name__)

# How many times to call a lead before giving up and marking it `unreachable`. One call only:
# if the person doesn't pick up (it goes to voicemail), the agent leaves a message and we stop.
MAX_CALL_ATTEMPTS = 1
# How long to hold a fresh lead after it came in, before placing the first call. Short for demo.
CALL_DELAY_SECONDS = 25
# A placed call is assumed finished after this long if the lead's status never changed (e.g. no
# answer or a voicemail) — a safety net so the single-call queue can't get stuck behind one call.
MAX_CALL_SECONDS = 300


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
        "language": str(intake.get("language", "")),
        "desired_time": _spoken_time(iso, tz) if iso else "",
        "dateTime": iso,
    }
    # A callbackAfter means we already reached this lead and they asked us to call back — so the
    # agent should skip the cold intro and get to the point. First attempts have no callbackAfter.
    if str(intake.get("callbackAfter", "") or ""):
        lead["is_callback"] = "yes"
    return lead, str(intake.get("phoneNumber", ""))


class LeadPoller:
    """Calls leads ONE AT A TIME, oldest to newest, so no `new` lead gets skipped.

    Each cycle: if a call is still in flight (the lead is still `new` and under the time cap), we
    wait. Otherwise we place ONE call to the oldest due lead we haven't tried yet this pass. Once
    every due lead has been tried, a fresh pass starts so unresolved leads are retried — up to
    MAX_CALL_ATTEMPTS, after which a lead is marked `unreachable` and leaves the queue.
    """

    def __init__(self, cfg: Config, *, interval: float = 10.0) -> None:
        self._cfg = cfg
        self._interval = interval
        self._client = BackendClient(cfg)
        # The call currently in flight: {"id": intake_id, "started": monotonic_ts}, or None.
        self._active: dict | None = None
        # Leads already dialed in the current pass (so we advance through the list instead of
        # re-dialing the oldest); cleared when a new pass begins.
        self._tried: set[str] = set()

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
        """Advance the queue by at most one call. Returns the number placed (0 or 1)."""
        intakes = self._client.new_intakes()  # status=new, oldest first
        new_ids = {str(i.get("id", "")) for i in intakes if i.get("id")}
        now = time.monotonic()

        # Drop any resolved leads (no longer `new`) from the current pass.
        self._tried &= new_ids

        # 1. A call is in flight — hold the queue until it's over. It ends when the lead leaves
        #    `new` (booked/declined/marked), when Twilio reports the call finished (no-answer, busy,
        #    completed…), or — as a last-resort backstop — when the time cap passes.
        if self._active:
            aid = self._active["id"]
            if aid not in new_ids:
                log.info("call for intake %s resolved; advancing queue", aid)
                self._active = None
            else:
                result = fetch_call_result(self._cfg, self._active.get("sid", ""))
                if result and call_has_ended(result["status"]):
                    if is_machine(result.get("answered_by")):
                        log.info("call for intake %s reached voicemail (%s); advancing queue",
                                 aid, result["answered_by"])
                    else:
                        log.info("call for intake %s ended (%s); advancing queue", aid, result["status"])
                    self._active = None
                elif now - self._active["started"] >= MAX_CALL_SECONDS:
                    log.info("call for intake %s assumed ended after %ds; advancing", aid, MAX_CALL_SECONDS)
                    self._active = None
                else:
                    return 0  # still on this call — one at a time

        # 2. Which leads are due right now, and which haven't been tried this pass?
        due = [i for i in intakes if self._call_due(i)]
        pending = [i for i in due if str(i.get("id", "")) not in self._tried]
        if not pending:
            if due:
                # Everyone due has had a turn — start a new pass so unresolved leads retry.
                self._tried.clear()
                pending = due
            else:
                return 0  # nothing due

        # 3. Place ONE call: the oldest pending lead we can actually dial.
        for intake in pending:  # already oldest-first
            intake_id = str(intake.get("id", ""))
            if not intake_id:
                continue
            self._tried.add(intake_id)  # counts as tried this pass, whatever happens next
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
                call_sid = place_call(self._cfg, to_number=phone, lead=lead)
            except Exception as exc:  # noqa: BLE001 — one bad dial shouldn't stall the queue
                log.warning("could not place call for %s: %s", phone, exc)
                continue
            self._active = {"id": intake_id, "started": now, "sid": call_sid}
            log.info("called %s (intake %s, attempt %d/%d)", phone, intake_id, attempts + 1, MAX_CALL_ATTEMPTS)
            try:
                self._client.record_attempt(intake_id)
            except BackendError as exc:
                log.warning("could not record attempt for %s: %s", intake_id, exc)
            return 1  # placed one; wait for it to resolve before the next
        return 0

    def run(self) -> None:
        log.info("lead poller started (one call at a time, oldest first; every %.0fs)", self._interval)
        while True:
            try:
                self.poll_once()
            except BackendError as exc:
                log.warning("poll error: %s", exc)
            except Exception as exc:  # noqa: BLE001
                log.warning("unexpected poll error: %s", exc)
            time.sleep(self._interval)
