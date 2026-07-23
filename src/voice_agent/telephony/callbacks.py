"""A small queue of scheduled callbacks — call someone back at a future time.

When a caller says they're not ready to schedule, they give a better time; we
store it here and a background thread places the call when it's due. Persisted to
disk so a restart doesn't drop pending callbacks. Twilio has no native
future-call scheduling, so we do it ourselves.
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

_PATH = PROJECT_ROOT / "data" / "callbacks.json"


class CallbackQueue:
    def __init__(self, path: Path = _PATH) -> None:
        self._path = Path(path)
        self._lock = threading.Lock()
        self._items = self._load()

    def _load(self) -> list[dict]:
        try:
            return json.loads(self._path.read_text())
        except (FileNotFoundError, ValueError):
            return []

    def _save(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._path.write_text(json.dumps(self._items))

    def add(self, record: dict[str, str], phone: str, due_at: str) -> None:
        with self._lock:
            self._items.append({"due_at": due_at, "phone": phone, "record": record})
            self._save()
        log.info("callback scheduled for %s at %s", phone, due_at)

    def run(self, trigger: Callable[..., str], interval: float = 30.0) -> None:
        """Poll for due callbacks and place them via `trigger(record, phone)`."""
        log.info("callback queue started (every %.0fs)", interval)
        while True:
            try:
                self._fire_due(trigger)
            except Exception as exc:  # noqa: BLE001 — keep the loop alive
                log.warning("callback loop error: %s", exc)
            time.sleep(interval)

    def _fire_due(self, trigger: Callable[..., str]) -> None:
        now = datetime.datetime.now(datetime.timezone.utc)
        with self._lock:
            due = [item for item in self._items if _is_due(item, now)]
            if not due:
                return
            self._items = [item for item in self._items if item not in due]
            self._save()
        for item in due:
            try:
                trigger(item["record"], item["phone"], is_callback=True)
                log.info("callback placed to %s", item["phone"])
            except Exception as exc:  # noqa: BLE001
                log.warning("callback to %s failed: %s", item.get("phone"), exc)


def _is_due(item: dict, now: datetime.datetime) -> bool:
    try:
        return datetime.datetime.fromisoformat(item["due_at"]) <= now
    except (ValueError, KeyError, TypeError):
        return False
