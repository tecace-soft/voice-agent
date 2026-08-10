"""Transcribe a single .wav to text with the OpenAI Whisper API.

Each attachment is its own call — no batching, no shared context — so one voicemail's audio
never bleeds into another's transcript. The pipeline calls `transcribe` once per .wav.
"""

from __future__ import annotations

import io
import logging

from openai import OpenAI

from ..config import Config
from .email_source import WavAttachment

log = logging.getLogger(__name__)


class Transcriber:
    def __init__(self, cfg: Config) -> None:
        self._cfg = cfg
        # Lazily created so importing the module (or running with a partial .env) doesn't
        # require the key — it's only needed once we actually transcribe.
        self._client: OpenAI | None = None

    def _openai(self) -> OpenAI:
        if self._client is None:
            self._client = OpenAI(
                api_key=self._cfg.openai_api_key, timeout=self._cfg.request_timeout
            )
        return self._client

    def transcribe(self, attachment: WavAttachment) -> str:
        """Return the spoken text of one .wav. Raises on API failure so the pipeline can log
        the specific file and move on."""
        # The SDK reads the filename off the file-like object to set the multipart part name
        # and infer the format, so give the in-memory buffer a .wav name.
        buf = io.BytesIO(attachment.data)
        buf.name = attachment.filename or "voicemail.wav"
        result = self._openai().audio.transcriptions.create(
            model=self._cfg.whisper_model,
            file=buf,
        )
        text = (result.text or "").strip()
        log.info("transcribed %s (%d chars)", buf.name, len(text))
        return text
