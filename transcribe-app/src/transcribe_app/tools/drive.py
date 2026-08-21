"""Upload a voicemail's audio to Google Drive so the sheet can link straight to the recording.

Authenticates AS A USER via OAuth (not the Sheets service account): on a personal @gmail.com a
service account has no storage quota and can't own uploaded files, so the recordings live in a
real user's Drive (their 15 GB) instead. The scope is drive.file — the app can only see and
manage files/folders it creates, which keeps the OAuth consent screen out of Google's restricted-
scope review.

Each upload returns a direct DOWNLOAD link. With DRIVE_PUBLIC on (the default) the file is given
an "anyone with the link can view" permission so that link opens for anyone from the sheet; with
it off the file stays private to the owner and anyone the folder is shared with. An upload failure
returns an empty link rather than dropping the whole voicemail — the sheet row is never lost to a
Drive hiccup.
"""

from __future__ import annotations

import io
import logging

from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseUpload

from ..config import Config
from .google_auth import load_user_credentials

log = logging.getLogger(__name__)

# Per-file scope: access is limited to files the app itself creates (including a folder it makes).
# This is a non-sensitive scope, so publishing the OAuth app to Production needs no Google review.
_SCOPES = ["https://www.googleapis.com/auth/drive.file"]


def download_link_for(file_id: str) -> str:
    """A stable direct-download URL for a Drive file id. Voicemails are small, so this downloads
    immediately (no large-file scan interstitial)."""
    return f"https://drive.google.com/uc?export=download&id={file_id}"


class DriveUploader:
    def __init__(self, cfg: Config) -> None:
        self._cfg = cfg
        self._service = None  # lazily built (googleapiclient Resource)

    def _drive(self):
        if self._service is None:
            creds = load_user_credentials(self._cfg, _SCOPES)
            # Mint the first access token up front so a bad/expired refresh token fails loudly here
            # rather than deep inside the first API call.
            creds.refresh(Request())
            self._service = build("drive", "v3", credentials=creds, cache_discovery=False)
        return self._service

    def upload(self, filename: str, data: bytes, content_type: str) -> str:
        """Upload audio bytes and return a direct download link. Returns "" on failure so a Drive
        problem never costs us the sheet row."""
        try:
            body: dict = {"name": filename}
            if self._cfg.google_drive_folder_id:
                body["parents"] = [self._cfg.google_drive_folder_id]
            media = MediaIoBaseUpload(
                io.BytesIO(data), mimetype=content_type or "audio/mpeg", resumable=False
            )
            created = (
                self._drive()
                .files()
                .create(body=body, media_body=media, fields="id")
                .execute()
            )
            file_id = created["id"]
            if self._cfg.google_drive_public:
                try:
                    self._drive().permissions().create(
                        fileId=file_id,
                        body={"type": "anyone", "role": "reader"},
                    ).execute()
                except Exception as exc:  # noqa: BLE001 — a permission hiccup shouldn't lose the row
                    log.warning("uploaded %s but could not set the public link: %s", filename, exc)
            link = download_link_for(file_id)
            log.info("uploaded %s to Drive (%s)", filename, file_id)
            return link
        except Exception as exc:  # noqa: BLE001 — Drive is best-effort; keep the row either way
            log.warning("could not upload %s to Drive: %s", filename, exc)
            return ""
