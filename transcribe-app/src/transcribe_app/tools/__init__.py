"""External-service integrations, one module per service:
  email_source.py — read voicemail mail + pull .wav attachments (IMAP, any provider)
  extractor.py    — audio -> transcript + structured fields (Google Gemini, one call)
  sheets.py       — append a row (Google Sheets)
"""

from .email_source import EmailSource, VoicemailEmail, WavAttachment
from .extractor import Extractor, VoicemailInfo
from .sheets import HEADER, SheetWriter

__all__ = [
    "EmailSource",
    "VoicemailEmail",
    "WavAttachment",
    "Extractor",
    "VoicemailInfo",
    "SheetWriter",
    "HEADER",
]
