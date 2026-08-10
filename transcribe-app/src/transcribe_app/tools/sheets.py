"""Append one row per voicemail to a Google Sheet, using a service account.

A service account is the right fit for an unattended batch job: no browser login, no token to
refresh by hand. Create one in Google Cloud, download its JSON key (GOOGLE_CREDENTIALS_FILE),
and share the target sheet with the service account's email as an Editor. On the first run we
write a header row if the sheet is empty.
"""

from __future__ import annotations

import json
import logging

from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build

from ..config import Config

log = logging.getLogger(__name__)

_SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]
# The OAuth2 token endpoint is the same for every service account, so we can supply it when
# building credentials from just a private key + email (rather than a full JSON file).
_TOKEN_URI = "https://oauth2.googleapis.com/token"

# Column order for every appended row — keep in sync with pipeline.build_row().
HEADER = [
    "Received",
    "From",
    "Caller name",
    "Phone",
    "Email",
    "Requested time",
    "Callback requested",
    "Summary",
    "Transcript",
    "Audio file",
]


class SheetWriter:
    def __init__(self, cfg: Config) -> None:
        self._cfg = cfg
        self._service = None  # lazily built (googleapiclient Resource)
        self._header_checked = False

    def _credentials(self) -> Credentials:
        cfg = self._cfg
        # 1. Leanest: just the private key + email (token endpoint is a constant).
        if cfg.google_private_key and cfg.google_client_email:
            return Credentials.from_service_account_info(
                {
                    "client_email": cfg.google_client_email,
                    "private_key": cfg.google_private_key,
                    "token_uri": _TOKEN_URI,
                },
                scopes=_SCOPES,
            )
        # 2. Full JSON inline.
        if cfg.google_credentials_json:
            return Credentials.from_service_account_info(
                json.loads(cfg.google_credentials_json), scopes=_SCOPES
            )
        # 3. JSON key file on disk.
        return Credentials.from_service_account_file(cfg.google_credentials_file, scopes=_SCOPES)

    def _sheets(self):
        if self._service is None:
            creds = self._credentials()
            # cache_discovery=False avoids a noisy warning and a file-cache write we don't need.
            self._service = build("sheets", "v4", credentials=creds, cache_discovery=False)
        return self._service

    def _tab(self) -> str:
        """The sheet/tab name from SHEET_RANGE ("Voicemails!A1" -> "Voicemails")."""
        rng = self._cfg.sheet_range
        return rng.split("!", 1)[0] if "!" in rng else rng

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
                body={"values": [HEADER]},
            ).execute()
            log.info("wrote header row to %s", tab)

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
