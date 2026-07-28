"""Outbound call queue — one call at a time, retried, so no one is missed.

Every outbound call goes through this single persisted queue: both first-contact
calls (a new Google Form submission) and ring-backs (a caller who asked us to
call later). A background worker processes it **one at a time** — place a call,
wait for it to finish, then the next — which is safe even on a Twilio trial
(1 concurrent call).

Reliability:
  - A call that fails to place, or ends busy / no-answer / failed / canceled, is
    retried with backoff (`RETRY_DELAYS`), up to `MAX_ATTEMPTS`.
  - An item is only dropped once it's delivered OR has exhausted its retries
    (the give-up is logged loudly), so submissions aren't silently lost.
  - Persisted to `data/outbound_queue.json`, so a restart never loses a pending
    call. An in-flight item is "leased" (its due time pushed out) before dialing,
    so a mid-call crash won't immediately re-dial the same person.

Twilio has no native call scheduling and (on trial) allows only one concurrent
call, which is why we run our own paced, retrying queue.
"""

from __future__ import annotations

import datetime
import json
import logging
import threading
import time
from pathlib import Path
from typing import Callable

from ..config import PROJECT_ROOT

log = logging.getLogger(__name__)

_PATH = PROJECT_ROOT / "data" / "outbound_queue.json"

# Twilio call statuses that mean "the call is still going — keep polling".
_PENDING_STATUS = {"queued", "initiated", "ringing", "in-progress"}
# Terminal statuses worth retrying (the person wasn't reached).
_RETRY_STATUS = {"busy", "no-answer", "failed", "canceled"}
# Anything else terminal (chiefly "completed", or our own "timeout") counts as
# delivered — we don't re-dial someone who actually connected.

MAX_ATTEMPTS = 3
RETRY_DELAYS = [300, 900, 1800]   # seconds before attempt 2, 3, … (5m, 15m, 30m)
LEASE_SECONDS = 1200              # hide an in-flight item this long (crash guard)
POLL_STATUS_EVERY = 6.0           # seconds between call-status checks
MAX_CALL_SECONDS = 900            # stop waiting on a single call after this


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


class OutboundQueue:
    def __init__(self, path: Path = _PATH) -> None:
        self._path = Path(path)
        self._lock = threading.Lock()
        self._items: list[dict] = self._load()

    # -- persistence -----------------------------------------------------

    def _load(self) -> list[dict]:
        try:
            return json.loads(self._path.read_text())
        except (FileNotFoundError, ValueError):
            return []

    def _save(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._path.write_text(json.dumps(self._items))

    # -- enqueue ---------------------------------------------------------

    def add(
        self,
        record: dict[str, str],
        phone: str,
        due_at: str | None = None,
        is_callback: bool = False,
    ) -> None:
        """Add a call. `due_at` (ISO) defaults to now; `is_callback` picks the greeting."""
        item = {
            "phone": phone,
            "record": record,
            "is_callback": is_callback,
            "due_at": due_at or _now().isoformat(),
            "attempts": 0,
        }
        with self._lock:
            self._items.append(item)
            self._save()
        log.info(
            "queued %s call to %s (due %s)",
            "callback" if is_callback else "first-contact", phone, item["due_at"],
        )

    def pending(self) -> int:
        with self._lock:
            return len(self._items)

    # -- worker ----------------------------------------------------------

    def run(
        self,
        place: Callable[[dict, str, bool], str],
        status: Callable[[str], str],
        interval: float = 10.0,
    ) -> None:
        """Process the queue one call at a time.

        place(record, phone, is_callback) -> call SID (raises on placement failure);
        status(sid) -> the call's current Twilio status string.
        """
        log.info("outbound queue started (one call at a time)")
        while True:
            item = self._lease_next()
            if item is None:
                time.sleep(interval)
                continue
            try:
                self._process(item, place, status)
            except Exception as exc:  # noqa: BLE001 — never let one call kill the worker
                log.warning("outbound worker error on %s: %s", item.get("phone"), exc)

    def _lease_next(self) -> dict | None:
        """Claim the earliest due item and push its due time out (crash guard)."""
        now = _now()
        with self._lock:
            due = [it for it in self._items if _is_due(it, now)]
            if not due:
                return None
            item = min(due, key=lambda it: it["due_at"])
            item["attempts"] += 1
            item["due_at"] = (now + datetime.timedelta(seconds=LEASE_SECONDS)).isoformat()
            self._save()
            return item

    def _process(
        self,
        item: dict,
        place: Callable[[dict, str, bool], str],
        status: Callable[[str], str],
    ) -> None:
        phone = item["phone"]
        try:
            sid = place(item["record"], phone, item["is_callback"])
        except Exception as exc:  # noqa: BLE001 — placement failed; retry it
            log.warning("could not place call to %s: %s", phone, exc)
            self._retry_or_drop(item, reason=f"placement error: {exc}")
            return

        outcome = self._await_completion(sid, status)
        log.info("call to %s ended: %s", phone, outcome)
        if outcome in _RETRY_STATUS:
            self._retry_or_drop(item, reason=outcome)
        else:
            self._remove(item)  # completed / timeout / unknown -> delivered

    def _await_completion(self, sid: str, status: Callable[[str], str]) -> str:
        waited = 0.0
        while waited < MAX_CALL_SECONDS:
            try:
                st = status(sid)
            except Exception as exc:  # noqa: BLE001 — transient; keep polling
                log.warning("status check failed for %s: %s", sid, exc)
                st = ""
            if st and st not in _PENDING_STATUS:
                return st
            time.sleep(POLL_STATUS_EVERY)
            waited += POLL_STATUS_EVERY
        return "timeout"

    # -- outcome handling ------------------------------------------------

    def _retry_or_drop(self, item: dict, reason: str) -> None:
        with self._lock:
            if item["attempts"] >= MAX_ATTEMPTS:
                self._items = [it for it in self._items if it is not item]
                self._save()
                log.warning(
                    "GAVE UP calling %s after %d attempts (last: %s)",
                    item["phone"], item["attempts"], reason,
                )
                return
            delay = RETRY_DELAYS[min(item["attempts"] - 1, len(RETRY_DELAYS) - 1)]
            item["due_at"] = (_now() + datetime.timedelta(seconds=delay)).isoformat()
            self._save()
            log.info(
                "will retry %s in %ds (attempt %d/%d, last: %s)",
                item["phone"], delay, item["attempts"], MAX_ATTEMPTS, reason,
            )

    def _remove(self, item: dict) -> None:
        with self._lock:
            self._items = [it for it in self._items if it is not item]
            self._save()


def _is_due(item: dict, now: datetime.datetime) -> bool:
    try:
        return datetime.datetime.fromisoformat(item["due_at"]) <= now
    except (ValueError, KeyError, TypeError):
        return True  # malformed due time -> treat as due so it isn't stuck forever
