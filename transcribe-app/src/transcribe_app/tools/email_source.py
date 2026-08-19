"""Read voicemail emails and pull their audio attachments (.wav, .mp3, and other formats) —
over plain IMAP so it works with any provider (Gmail for our testing, Outlook, Yahoo, a
corporate server): the connection details are just config.

We deliberately do NOT mutate the mailbox (no moving, deleting, or marking read). Idempotency
lives in a local state file keyed by Message-ID + attachment name (see pipeline.py), so a
customer's inbox is left exactly as we found it and re-running is safe.
"""

from __future__ import annotations

import email
import imaplib
import logging
import os
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from email.header import decode_header, make_header
from email.message import Message
from email.utils import parseaddr

from ..config import Config

log = logging.getLogger(__name__)

# What counts as a voicemail recording. Voicemail-to-email varies a lot by provider, so we accept
# ANY audio attachment — matched by a known audio extension OR an `audio/*` content-type (some
# providers send the file with a generic content-type like application/octet-stream, so the
# extension is the more reliable signal). The mapped value is the MIME type we hand to Gemini.
# Gemini natively supports wav/mp3/aiff/aac/ogg/flac; m4a/mp4/amr are passed as a best guess and
# may need conversion if Gemini rejects them.
_EXT_MIME = {
    ".wav": "audio/wav",
    ".mp3": "audio/mp3",
    ".mp": "audio/mp3",   # non-standard extension seen from some voicemail systems; assume mp3
    ".m4a": "audio/mp4",
    ".mp4": "audio/mp4",
    ".aac": "audio/aac",
    ".ogg": "audio/ogg",
    ".oga": "audio/ogg",
    ".flac": "audio/flac",
    ".aiff": "audio/aiff",
    ".aif": "audio/aiff",
    ".amr": "audio/amr",
}


@dataclass(frozen=True)
class AudioAttachment:
    filename: str
    data: bytes
    # The MIME type to hand to Gemini (derived from the extension, or the part's content-type).
    content_type: str


def audio_mime_for(filename: str, declared_type: str | None = None) -> str | None:
    """The Gemini MIME type for an audio file, or None if it doesn't look like audio. Prefers a
    known extension (maps to exactly what Gemini expects); falls back to a declared `audio/*`
    content-type."""
    ext = os.path.splitext(filename.lower())[1]
    if ext in _EXT_MIME:
        return _EXT_MIME[ext]
    ctype = (declared_type or "").lower()
    if ctype.startswith("audio/"):
        return ctype
    return None


@dataclass
class VoicemailEmail:
    message_id: str
    from_addr: str
    subject: str
    date: str
    attachments: list[AudioAttachment] = field(default_factory=list)


def _decode(value: str | None) -> str:
    """Decode an RFC 2047 encoded header (e.g. =?UTF-8?B?...?=) to plain text."""
    if not value:
        return ""
    try:
        return str(make_header(decode_header(value))).strip()
    except Exception:  # noqa: BLE001 — a malformed header must not abort the run
        return value.strip()


def _audio_attachments(msg: Message) -> list[AudioAttachment]:
    out: list[AudioAttachment] = []
    for part in msg.walk():
        if part.is_multipart():
            continue
        filename = _decode(part.get_filename())
        # An attachment is either an explicit attachment disposition or just a named part;
        # accept both as long as it looks like audio.
        if not filename and (part.get_content_disposition() or "") != "attachment":
            continue
        declared = part.get_content_type() or ""
        mime = audio_mime_for(filename, declared)
        if not mime:
            continue
        payload = part.get_payload(decode=True)
        if not payload:
            continue
        name = filename or "voicemail"
        # Log the declared content-type too, so an unexpected format (e.g. a bare .mp) is visible.
        log.info("audio attachment %s — declared %r, sending as %s", name, declared, mime)
        out.append(AudioAttachment(filename=name, data=payload, content_type=mime))
    return out


class EmailSource:
    """A minimal IMAP reader: connect, search for candidate messages, return the ones that
    carry an audio attachment. Provider-agnostic — driven entirely by Config."""

    def __init__(self, cfg: Config) -> None:
        self._cfg = cfg

    def fetch_voicemails(self) -> list[VoicemailEmail]:
        cfg = self._cfg
        conn = self._connect()
        try:
            conn.select(cfg.imap_mailbox, readonly=True)
            ids = self._search(conn)
            log.info("found %d candidate message(s) in %s", len(ids), cfg.imap_mailbox)
            voicemails: list[VoicemailEmail] = []
            for num in ids:
                vm = self._load(conn, num)
                if vm and vm.attachments:
                    voicemails.append(vm)
            log.info("%d message(s) carry an audio attachment", len(voicemails))
            return voicemails
        finally:
            try:
                conn.logout()
            except Exception:  # noqa: BLE001
                pass

    def _connect(self) -> imaplib.IMAP4:
        cfg = self._cfg
        if cfg.imap_ssl:
            conn: imaplib.IMAP4 = imaplib.IMAP4_SSL(cfg.imap_host, cfg.imap_port)
        else:
            conn = imaplib.IMAP4(cfg.imap_host, cfg.imap_port)
            conn.starttls()
        conn.login(cfg.imap_username, cfg.imap_password)
        return conn

    def _search(self, conn: imaplib.IMAP4) -> list[bytes]:
        """Build an IMAP search from the optional FROM/SUBJECT/date filters. IMAP can't filter
        by attachment, so the .wav check happens after fetch."""
        cfg = self._cfg
        criteria: list[str] = []
        if cfg.imap_since_days > 0:
            since = (datetime.now(timezone.utc) - timedelta(days=cfg.imap_since_days)).strftime(
                "%d-%b-%Y"
            )
            criteria += ["SINCE", since]
        if cfg.voicemail_from:
            criteria += ["FROM", f'"{cfg.voicemail_from}"']
        if cfg.voicemail_subject:
            criteria += ["SUBJECT", f'"{cfg.voicemail_subject}"']
        if not criteria:
            criteria = ["ALL"]
        typ, data = conn.search(None, *criteria)
        if typ != "OK" or not data or not data[0]:
            return []
        return data[0].split()

    def _load(self, conn: imaplib.IMAP4, num: bytes) -> VoicemailEmail | None:
        typ, data = conn.fetch(num, "(RFC822)")
        if typ != "OK" or not data or not isinstance(data[0], tuple):
            return None
        msg = email.message_from_bytes(data[0][1])
        message_id = _decode(msg.get("Message-ID")) or f"uid-{num.decode(errors='ignore')}"
        return VoicemailEmail(
            message_id=message_id,
            from_addr=parseaddr(_decode(msg.get("From")))[1],
            subject=_decode(msg.get("Subject")),
            date=_decode(msg.get("Date")),
            attachments=_audio_attachments(msg),
        )
