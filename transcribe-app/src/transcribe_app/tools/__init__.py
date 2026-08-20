"""External-service integrations, one module per service:
  email_source.py — read voicemail mail + pull audio attachments (IMAP, any provider)
  extractor.py    — audio -> transcript + structured fields (Google Gemini, one call)
  drive.py        — upload the audio to Google Drive for a "Listen" link
  sheets.py       — append a row (Google Sheets)
"""

from .drive import DriveUploader
from .email_source import AudioAttachment, EmailSource, VoicemailEmail, audio_mime_for
from .extractor import Extractor, VoicemailInfo
from .sheets import HEADER, SheetWriter

__all__ = [
    "EmailSource",
    "VoicemailEmail",
    "AudioAttachment",
    "audio_mime_for",
    "Extractor",
    "VoicemailInfo",
    "DriveUploader",
    "SheetWriter",
    "HEADER",
]
