"""External-service integrations, one module per service:
  email_source.py — read voicemail mail + pull audio attachments (IMAP, any provider)
  extractor.py    — audio -> transcript + structured fields (Google Gemini, one call)
  drive.py        — optionally upload the recording to Google Drive (user OAuth) for a download link
  sheets.py       — append a row (Google Sheets), incl. the audio + "Open email" links
"""

from .drive import DriveUploader
from .email_source import (
    AudioAttachment,
    EmailSource,
    VoicemailEmail,
    audio_mime_for,
    build_email_link,
)
from .extractor import Extractor, VoicemailInfo
from .sheets import HEADER, SheetWriter

__all__ = [
    "EmailSource",
    "VoicemailEmail",
    "AudioAttachment",
    "audio_mime_for",
    "build_email_link",
    "Extractor",
    "VoicemailInfo",
    "DriveUploader",
    "SheetWriter",
    "HEADER",
]
