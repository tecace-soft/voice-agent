"""Append one row per voicemail to a Google Sheet, using a service account.

A service account is the right fit for an unattended batch job: no browser login, no token to
refresh by hand. Create one in Google Cloud, download its JSON key (GOOGLE_CREDENTIALS_FILE),
and share the target sheet with the service account's email as an Editor. On the first run we
write a header row if the sheet is empty.
"""

from __future__ import annotations

import logging

from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build

from ..config import Config
from ..timefmt import timezone_label
from .google_auth import load_service_credentials

log = logging.getLogger(__name__)

_SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]

# Column order for every appended row — keep in sync with pipeline.build_row(). The first column's
# label gets the timezone appended (see _header), so nobody has to guess what "11:22" means.
HEADER = [
    "Received",
    "Caller name",
    "Caller ID",
    "Callback number",
    "Requested time",
    "Callback requested",
    "Summary",
    "Transcript",
    "Audio file",
    "Open email",
]


class SheetWriter:
    def __init__(self, cfg: Config) -> None:
        self._cfg = cfg
        self._service = None  # lazily built (googleapiclient Resource)
        self._header_checked = False

    def _credentials(self) -> Credentials:
        return load_service_credentials(self._cfg, _SCOPES)

    def _sheets(self):
        if self._service is None:
            creds = self._credentials()
            # cache_discovery=False avoids a noisy warning and a file-cache write we don't need.
            self._service = build("sheets", "v4", credentials=creds, cache_discovery=False)
        return self._service

    def tab_name(self) -> str:
        """The sheet/tab name from SHEET_RANGE ("Voicemails!A1" -> "Voicemails").

        Surrounding quotes are dropped: a tab whose name has a space has to be written
        `'Voicemail 2026'!A1` in the range, but the bare name is what the tab list holds.
        """
        rng = self._cfg.sheet_range
        tab = (rng.split("!", 1)[0] if "!" in rng else rng).strip()
        if len(tab) >= 2 and tab.startswith("'") and tab.endswith("'"):
            # Quoted form: drop the wrapper and undo A1 notation's doubled inner quotes, so a tab
            # really called "Bob's" comes back as Bob's rather than Bob''s.
            tab = tab[1:-1].replace("''", "'")
        return tab

    def _tab(self) -> str:
        """The tab name quoted for use in an A1 range.

        Always quoted, not just when the name has a space: quoting is harmless for a plain name
        and required for anything with a space or punctuation, so there is no case worth
        distinguishing. Internal single quotes double, per A1 notation.
        """
        return "'" + self.tab_name().replace("'", "''") + "'"

    def tabs(self) -> list[str]:
        """Every tab name in the spreadsheet, in sheet order."""
        meta = (
            self._sheets()
            .spreadsheets()
            .get(spreadsheetId=self._cfg.google_sheet_id, fields="sheets.properties.title")
            .execute()
        )
        return [s["properties"]["title"] for s in meta.get("sheets", [])]

    def _header(self) -> list[str]:
        """HEADER with the timezone named on the Received column, e.g. "Received (Pacific)"."""
        label = timezone_label(self._cfg.business_timezone)
        return [f"{HEADER[0]} ({label})", *HEADER[1:]]

    def _ensure_header(self) -> None:
        if self._header_checked:
            return
        self._header_checked = True
        tab = self._tab()
        values = (
            self._sheets()
            .spreadsheets()
            .values()
            .get(spreadsheetId=self._cfg.google_sheet_id, range=f"{tab}!A1:A1")
            .execute()
            .get("values", [])
        )
        if not values:
            self._sheets().spreadsheets().values().update(
                spreadsheetId=self._cfg.google_sheet_id,
                range=f"{tab}!A1",
                valueInputOption="USER_ENTERED",
                body={"values": [self._header()]},
            ).execute()
            log.info("wrote header row to %s", self.tab_name())

    def check(self) -> str:
        """Read-only reachability check: returns the spreadsheet's title. Confirms in one call
        that the credentials load, the service account can see the sheet (it's been shared),
        and GOOGLE_SHEET_ID is valid. Used by scripts/checks/verify_sheets.py."""
        meta = (
            self._sheets()
            .spreadsheets()
            .get(spreadsheetId=self._cfg.google_sheet_id, fields="properties.title")
            .execute()
        )
        return meta.get("properties", {}).get("title", "")

    def append_row(self, values: list[str]) -> None:
        """Append a single row under the configured range."""
        self._ensure_header()
        self._sheets().spreadsheets().values().append(
            spreadsheetId=self._cfg.google_sheet_id,
            range=self._cfg.sheet_range,
            valueInputOption="USER_ENTERED",
            insertDataOption="INSERT_ROWS",
            body={"values": [values]},
        ).execute()
