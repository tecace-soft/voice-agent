"""Post-intake tracking: append the collected record to Google Sheets.

Kept separate from the conversation loop so the intake stays reliable even if
Sheets is misconfigured — the caller-facing part never depends on it. Scheduling
(Cal.com) lives in scheduler.py.
"""

from __future__ import annotations

import datetime
import logging

from ..config import Config
from ..tools.sheets import SheetsClient
from .intake import IntakeField

log = logging.getLogger(__name__)


class Fulfillment:
    def __init__(self, cfg: Config, fields: list[IntakeField]) -> None:
        self._cfg = cfg
        self._fields = fields

    def track(self, record: dict[str, str], *, booked_at: str = "") -> None:
        """Append the record as a row, creating a header if the tab is empty."""
        client = SheetsClient(self._cfg)
        columns = [f.name for f in self._fields]
        client.ensure_header(columns + ["booked_at", "recorded_at"])
        row = [record.get(c, "") for c in columns]
        row.append(booked_at)
        row.append(datetime.datetime.now().isoformat(timespec="seconds"))
        client.append_row(row)
