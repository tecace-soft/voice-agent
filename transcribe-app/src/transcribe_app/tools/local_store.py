"""Store voicemail audio on this host and return a public URL the sheet can link to.

The zero-extra-cost option: the audio is written to a directory that a web server (the Traefik/
static-file setup already running on the VPS) serves at AUDIO_BASE_URL. Each file gets an
unguessable random name so the URL acts as a capability link — the recording isn't discoverable by
guessing the caller's number or date. Same `upload(...)` signature as DriveUploader, so the two are
interchangeable behind the pipeline.
"""

from __future__ import annotations

import logging
import os
import secrets
from pathlib import Path

from ..config import Config

log = logging.getLogger(__name__)


class LocalAudioStore:
    def __init__(self, cfg: Config) -> None:
        self._dir = Path(cfg.audio_storage_dir)
        self._base = cfg.audio_base_url.rstrip("/")

    def upload(self, filename: str, data: bytes, content_type: str) -> str:
        """Write the audio to the storage dir under an unguessable name; return its public URL
        (empty if no base URL is configured, or on failure — the row is still written either way)."""
        try:
            self._dir.mkdir(parents=True, exist_ok=True)
            # Keep the original extension so the browser knows how to play it; randomize the rest.
            ext = os.path.splitext(filename)[1].lower() or ".mp3"
            name = f"{secrets.token_urlsafe(16)}{ext}"
            (self._dir / name).write_bytes(data)
            url = f"{self._base}/{name}" if self._base else ""
            log.info("stored %s -> %s", filename, url or str(self._dir / name))
            return url
        except Exception as exc:  # noqa: BLE001 — storage is best-effort; keep the row either way
            log.warning("could not store %s locally: %s", filename, exc)
            return ""
