"""Environment-backed configuration, validated once at load.

The pipeline reads voicemail emails over generic IMAP (so it works with any provider —
Outlook.com for our testing, Gmail, Yahoo, a corporate mail server — by pointing it at the
right host), then transcribes and extracts each .wav with Google Gemini in a single call, and
appends a row to a Google Sheet.

Nothing is required at import time, so the process starts even on a machine with a minimal
.env; missing pieces are reported by `Config.missing()` and surfaced by the entrypoint.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

# src/transcribe_app/config/settings.py -> project root is four levels up.
PROJECT_ROOT = Path(__file__).resolve().parents[3]

load_dotenv(PROJECT_ROOT / ".env")


class ConfigError(RuntimeError):
    """A required setting is missing or malformed."""


def _optional(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip() or default


def _bool(name: str, default: bool) -> bool:
    raw = _optional(name).lower()
    if raw in ("1", "true", "yes", "on"):
        return True
    if raw in ("0", "false", "no", "off"):
        return False
    return default


# Common IMAP endpoints so a customer can set IMAP_PROVIDER=outlook instead of hunting for the
# host. An explicit IMAP_HOST always wins. host is (host, port, ssl); ssl=True means implicit
# TLS on 993 (the usual case).
IMAP_PROVIDERS: dict[str, tuple[str, int, bool]] = {
    "outlook": ("outlook.office365.com", 993, True),
    "office365": ("outlook.office365.com", 993, True),
    "hotmail": ("outlook.office365.com", 993, True),
    "gmail": ("imap.gmail.com", 993, True),
    "yahoo": ("imap.mail.yahoo.com", 993, True),
    "icloud": ("imap.mail.me.com", 993, True),
    "aol": ("imap.aol.com", 993, True),
    "zoho": ("imap.zoho.com", 993, True),
    # Comcast/Xfinity residential and Comcast Business (classic comcastbiz mail — NOT the
    # Microsoft-365-hosted variant, which needs OAuth2 like Outlook does).
    "comcast": ("imap.comcast.net", 993, True),
    "xfinity": ("imap.comcast.net", 993, True),
    "comcastbiz": ("imap.comcastbiz.net", 993, True),
    "comcastbusiness": ("imap.comcastbiz.net", 993, True),
}


@dataclass(frozen=True)
class Config:
    # ---- IMAP (any provider) ----
    imap_host: str
    imap_port: int
    imap_ssl: bool
    imap_username: str
    imap_password: str
    imap_mailbox: str
    # Only mail newer than this many days is scanned (0 = no date limit).
    imap_since_days: int
    # Optional filters to pick voicemail mail out of the mailbox. Empty = accept any message
    # that carries a .wav attachment.
    voicemail_from: str
    voicemail_subject: str
    # ---- Transcription + extraction (Google Gemini, one multimodal call) ----
    # A Gemini Developer API key (AI Studio) — distinct from the Google Sheets service account
    # below, which uses its own private-key credentials.
    gemini_api_key: str
    extract_model: str
    # ---- Destination (Google Sheets) ----
    # The service-account key can be supplied three ways (checked in this order):
    #   1. google_private_key + google_client_email — just the two values (no file, no full JSON)
    #   2. google_credentials_json — the full JSON content inline
    #   3. google_credentials_file — a path to the downloaded key file
    # A service account only needs its private key + email (the token endpoint is a constant),
    # so option 1 is the leanest.
    google_credentials_file: str
    google_credentials_json: str
    google_client_email: str
    google_private_key: str
    google_sheet_id: str
    # A1 range whose sheet/tab we append under, e.g. "Voicemails!A1".
    sheet_range: str
    # ---- Voicemail audio storage (so the sheet can link to a playable recording) ----
    # Which backend stores the audio: "local" (write on this host and serve it — zero extra cost,
    # the default) or "drive" (Google Drive — needs a Shared Drive or OAuth, since a plain service
    # account has no Drive storage).
    audio_backend: str
    # For AUDIO_BACKEND=local: the directory to write audio into, and the public URL prefix that
    # same directory is served at (e.g. https://voicemails.example.com). A web server (Traefik/
    # nginx/caddy on the VPS) serves the directory; the sheet links to <AUDIO_BASE_URL>/<file>.
    audio_storage_dir: str
    audio_base_url: str
    # For AUDIO_BACKEND=drive: optional Drive folder id (empty = the account's Drive root)...
    google_drive_folder_id: str
    # ...and whether to set an "anyone with the link can view" permission on each upload.
    google_drive_public: bool
    # ---- Runtime ----
    # Where we remember which (message, attachment) pairs are already done, so re-runs are
    # idempotent without mutating the mailbox.
    state_file: str
    request_timeout: float

    @classmethod
    def load(cls) -> Config:
        provider = _optional("IMAP_PROVIDER").lower()
        preset = IMAP_PROVIDERS.get(provider)
        host = _optional("IMAP_HOST") or (preset[0] if preset else "")
        port = int(_optional("IMAP_PORT", str(preset[1] if preset else 993)))
        ssl_default = preset[2] if preset else True
        return cls(
            imap_host=host,
            imap_port=port,
            imap_ssl=_bool("IMAP_SSL", ssl_default),
            imap_username=_optional("IMAP_USERNAME"),
            imap_password=_optional("IMAP_PASSWORD"),
            imap_mailbox=_optional("IMAP_MAILBOX", "INBOX"),
            imap_since_days=int(_optional("IMAP_SINCE_DAYS", "7")),
            voicemail_from=_optional("VOICEMAIL_FROM"),
            voicemail_subject=_optional("VOICEMAIL_SUBJECT"),
            gemini_api_key=_optional("GEMINI_API_KEY"),
            extract_model=_optional("EXTRACT_MODEL", "gemini-2.5-flash-lite"),
            google_credentials_file=_optional("GOOGLE_CREDENTIALS_FILE")
            or str(PROJECT_ROOT / "service-account.json"),
            google_credentials_json=_optional("GOOGLE_CREDENTIALS_JSON"),
            google_client_email=_optional("GOOGLE_CLIENT_EMAIL"),
            # Env vars can't hold real newlines, so a pasted private key arrives with literal
            # "\n" sequences — turn them back into newlines for the PEM to parse.
            google_private_key=_optional("GOOGLE_PRIVATE_KEY").replace("\\n", "\n"),
            google_sheet_id=_optional("GOOGLE_SHEET_ID"),
            sheet_range=_optional("SHEET_RANGE", "Voicemails!A1"),
            audio_backend=_optional("AUDIO_BACKEND", "local").lower(),
            audio_storage_dir=_optional("AUDIO_STORAGE_DIR") or str(PROJECT_ROOT / "voicemail-audio"),
            audio_base_url=_optional("AUDIO_BASE_URL"),
            google_drive_folder_id=_optional("GOOGLE_DRIVE_FOLDER_ID"),
            google_drive_public=_bool("GOOGLE_DRIVE_PUBLIC", True),
            state_file=_optional("STATE_FILE") or str(PROJECT_ROOT / ".processed.json"),
            request_timeout=float(_optional("REQUEST_TIMEOUT_SECONDS", "60")),
        )

    def missing(self) -> list[str]:
        """Names of settings the pipeline genuinely needs but doesn't have. The entrypoint
        prints these and stops rather than failing deep in a mail/API call."""
        gaps: list[str] = []
        if not self.imap_host:
            gaps.append("IMAP_HOST (or IMAP_PROVIDER)")
        if not self.imap_username:
            gaps.append("IMAP_USERNAME")
        if not self.imap_password:
            gaps.append("IMAP_PASSWORD")
        if not self.gemini_api_key:
            gaps.append("GEMINI_API_KEY")
        if not self.google_sheet_id:
            gaps.append("GOOGLE_SHEET_ID")
        # A service-account key must be provided one of the three ways.
        has_key = (
            (self.google_private_key and self.google_client_email)
            or self.google_credentials_json
            or Path(self.google_credentials_file).is_file()
        )
        if not has_key:
            gaps.append(
                "a service-account key — GOOGLE_PRIVATE_KEY + GOOGLE_CLIENT_EMAIL, "
                "or GOOGLE_CREDENTIALS_JSON, or a key file at "
                f"{self.google_credentials_file}"
            )
        return gaps
