"""Poll Google Forms for new submissions and place callbacks.

The alternative to a push webhook: instead of the form POSTing to us (Google
Forms only pushes via Pub/Sub watches, which need extra infrastructure), we ASK
the Forms API for new responses every few seconds — an ordinary outbound call,
so no HTTPS/tunnel is needed. For each new submission with a phone number, we
call the person back to finish scheduling.

Processed submissions are remembered on disk so a restart doesn't re-call people.
"""

from __future__ import annotations

import json
import logging
import time
from pathlib import Path
from typing import Callable

from ..config import PROJECT_ROOT, Config
from ..tools.google_forms import GoogleFormsClient, record_from_response

log = logging.getLogger(__name__)

_STATE_PATH = PROJECT_ROOT / "data" / "forms_poll.json"
_MAX_REMEMBERED = 1000


class GoogleFormsPoller:
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
        self._client = GoogleFormsClient(cfg)
        self._defs = self._client.question_defs()
        self._since: str | None = None
        self._seen: list[str] = []
        self._load_state()

    # -- state -----------------------------------------------------------

    def _load_state(self) -> None:
        try:
            data = json.loads(_STATE_PATH.read_text())
            self._since = data.get("since")
            self._seen = list(data.get("seen", []))
        except (FileNotFoundError, ValueError):
            pass

    def _save_state(self) -> None:
        _STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
        _STATE_PATH.write_text(
            json.dumps({"since": self._since, "seen": self._seen[-_MAX_REMEMBERED:]})
        )

    # -- polling ---------------------------------------------------------

    def poll_once(self) -> int:
        """Check for new submissions; call each new one back. Returns count placed."""
        items = self._client.responses(since=self._since)
        placed = 0
        for item in sorted(items, key=lambda x: x.get("lastSubmittedTime", "")):
            rid = item.get("responseId", "")
            if not rid or rid in self._seen:
                continue
            record, phone = record_from_response(item, self._defs)
            if phone:
                try:
                    self._trigger(record, phone)
                    placed += 1
                    log.info("callback triggered for %s", phone)
                except Exception as exc:  # noqa: BLE001
                    log.warning("callback failed for %s: %s", phone, exc)
            else:
                log.warning("submission %s has no phone number; skipped", rid)
            self._seen.append(rid)
            self._since = item.get("lastSubmittedTime") or self._since
        if placed or items:
            self._save_state()
        return placed

    def run(self) -> None:
        log.info("Google Forms poller started (every %.0fs)", self._interval)
        while True:
            try:
                self.poll_once()
            except Exception as exc:  # noqa: BLE001 — keep polling through transient errors
                log.warning("poll error: %s", exc)
            time.sleep(self._interval)
