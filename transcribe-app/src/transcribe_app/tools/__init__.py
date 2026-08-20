"""External-service integrations, one module per service:
  email_source.py — read voicemail mail + pull audio attachments (IMAP, any provider)
  extractor.py    — audio -> transcript + structured fields (Google Gemini, one call)
  sheets.py       — append a row (Google Sheets), incl. the "Open email" link
"""

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
    "SheetWriter",
    "HEADER",
]
