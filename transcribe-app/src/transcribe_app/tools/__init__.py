"""External-service integrations, one module per service:
  email_source.py — read voicemail mail + pull audio attachments (IMAP, any provider)
  extractor.py    — audio -> transcript + structured fields (Google Gemini, one call)
  local_store.py  — store the audio on this host + serve it (the zero-cost "Listen" link)
  drive.py        — alternative: upload the audio to Google Drive (needs Shared Drive / OAuth)
  sheets.py       — append a row (Google Sheets)
"""

from ..config import Config
from .drive import DriveUploader
from .email_source import AudioAttachment, EmailSource, VoicemailEmail, audio_mime_for
from .extractor import Extractor, VoicemailInfo
from .local_store import LocalAudioStore
from .sheets import HEADER, SheetWriter


def make_audio_store(cfg: Config):
    """The audio store selected by AUDIO_BACKEND. Both backends expose the same
    `upload(filename, data, content_type) -> url`, so the pipeline doesn't care which one it is."""
    if cfg.audio_backend == "drive":
        return DriveUploader(cfg)
    return LocalAudioStore(cfg)


__all__ = [
    "EmailSource",
    "VoicemailEmail",
    "AudioAttachment",
    "audio_mime_for",
    "Extractor",
    "VoicemailInfo",
    "LocalAudioStore",
    "DriveUploader",
    "make_audio_store",
    "SheetWriter",
    "HEADER",
]
