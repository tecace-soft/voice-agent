"""Upload a voicemail's audio to Google Drive so it can be played from a link in the sheet.

Uses the same service account as the Sheets writer (just a different scope). Each file is placed
in the configured Drive folder (recommended) and — if GOOGLE_DRIVE_PUBLIC is on — given an
"anyone with the link can view" permission so the sheet's Listen link works without per-user
sharing. An upload failure returns an empty link rather than dropping the whole voicemail.
"""

from __future__ import annotations

import io
import logging

from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseUpload

from ..config import Config
from .google_auth import load_service_credentials

log = logging.getLogger(__name__)

# Full Drive scope so we can upload into a folder the account was granted access to (the narrower
# drive.file scope only covers files the app itself created, which blocks arbitrary parent folders).
_SCOPES = ["https://www.googleapis.com/auth/drive"]


class DriveUploader:
    def __init__(self, cfg: Config) -> None:
        self._cfg = cfg
        self._service = None  # lazily built (googleapiclient Resource)

    def _drive(self):
        if self._service is None:
            creds = load_service_credentials(self._cfg, _SCOPES)
            self._service = build("drive", "v3", credentials=creds, cache_discovery=False)
        return self._service

    def upload(self, filename: str, data: bytes, content_type: str) -> str:
        """Upload audio bytes and return a shareable link (webViewLink). Returns "" on failure so a
        Drive hiccup never costs us the sheet row."""
        try:
            body: dict = {"name": filename}
            if self._cfg.google_drive_folder_id:
                body["parents"] = [self._cfg.google_drive_folder_id]
            media = MediaIoBaseUpload(io.BytesIO(data), mimetype=content_type or "audio/mpeg", resumable=False)
            created = (
                self._drive()
                .files()
                .create(body=body, media_body=media, fields="id, webViewLink", supportsAllDrives=True)
                .execute()
            )
            file_id = created["id"]
            if self._cfg.google_drive_public:
                try:
                    self._drive().permissions().create(
                        fileId=file_id,
                        body={"type": "anyone", "role": "reader"},
                        supportsAllDrives=True,
                    ).execute()
                except Exception as exc:  # noqa: BLE001 — a permission hiccup shouldn't lose the row
                    log.warning("uploaded %s but could not set the public link: %s", filename, exc)
            link = created.get("webViewLink", "")
            log.info("uploaded %s to Drive (%s)", filename, link or file_id)
            return link
        except Exception as exc:  # noqa: BLE001 — Drive is best-effort; keep the row either way
            log.warning("could not upload %s to Drive: %s", filename, exc)
            return ""
