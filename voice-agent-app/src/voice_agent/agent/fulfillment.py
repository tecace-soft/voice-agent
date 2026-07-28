"""Post-intake tracking: append the collected record to Google Sheets.

Kept separate from the conversation loop so the intake stays reliable even if
Sheets is misconfigured — the caller-facing part never depends on it. Scheduling
(Cal.com) lives in scheduler.py; the Hermes-written call summary lives in
summary.py and is attached to the row afterwards via `note()`.
"""

from __future__ import annotations

import datetime
import logging
import re

from ..config import Config
from ..tools.sheets import SheetsClient
from .intake import IntakeField

log = logging.getLogger(__name__)

# Extra columns appended after the question columns, in order.
_EXTRA_COLUMNS = ["booked_at", "recorded_at", "summary"]


class Fulfillment:
    def __init__(self, cfg: Config, fields: list[IntakeField]) -> None:
        self._cfg = cfg
        self._fields = fields

    def track(self, record: dict[str, str], *, booked_at: str = "") -> int:
        """Append the record as a row (blank summary); returns the row number.

        The summary is filled in later by `note()` once Hermes has written it —
        the caller has hung up by then, so its latency doesn't matter.
        """
        client = SheetsClient(self._cfg)
        columns = [f.name for f in self._fields]
        client.ensure_header(columns + _EXTRA_COLUMNS)
        row = [record.get(c, "") for c in columns]
        row.append(booked_at)
        row.append(datetime.datetime.now().isoformat(timespec="seconds"))
        return _appended_row(client.append_row(row))

    def note(self, row: int, text: str) -> None:
        """Write the post-call summary into the `summary` column of `row`."""
        if not (row and text):
            return
        # summary is the last of the extra columns -> after the question columns.
        col = _col_letter(len(self._fields) + len(_EXTRA_COLUMNS))
        SheetsClient(self._cfg).update_cell(f"Sheet1!{col}{row}", text)


def _appended_row(append_response: dict) -> int:
    """Row number the append landed on, from the API's updatedRange, else 0."""
    rng = (append_response.get("updates") or {}).get("updatedRange", "")
    match = re.search(r"!\D+(\d+)", rng)
    return int(match.group(1)) if match else 0


def _col_letter(n: int) -> str:
    """1-based column number -> A1 letter (1->A, 27->AA)."""
    letters = ""
    while n > 0:
        n, remainder = divmod(n - 1, 26)
        letters = chr(65 + remainder) + letters
    return letters
