"""External-service integrations, one module per service:
  email_source.py — read voicemail mail + pull .wav attachments (IMAP, any provider)
  transcriber.py  — audio -> text (OpenAI Whisper)
  extractor.py    — text -> structured fields (Claude)
  sheets.py       — append a row (Google Sheets)
"""

from .email_source import EmailSource, VoicemailEmail, WavAttachment
from .extractor import Extractor, VoicemailInfo
from .sheets import HEADER, SheetWriter
from .transcriber import Transcriber

__all__ = [
    "EmailSource",
    "VoicemailEmail",
    "WavAttachment",
    "Transcriber",
    "Extractor",
    "VoicemailInfo",
    "SheetWriter",
    "HEADER",
]
