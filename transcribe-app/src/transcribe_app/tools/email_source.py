"""Read voicemail emails and pull their .wav attachments — over plain IMAP so it works with
any provider (Outlook.com for our testing, Gmail, Yahoo, a corporate server): the connection
details are just config.

We deliberately do NOT mutate the mailbox (no moving, deleting, or marking read). Idempotency
lives in a local state file keyed by Message-ID + attachment name (see pipeline.py), so a
customer's inbox is left exactly as we found it and re-running is safe.
"""

from __future__ import annotations

import email
import imaplib
import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from email.header import decode_header, make_header
from email.message import Message
from email.utils import parseaddr

from ..config import Config

log = logging.getLogger(__name__)

# What counts as a voicemail recording. Providers label .wav inconsistently, so match on the
# MIME type OR the filename extension.
_WAV_CONTENT_TYPES = {"audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave"}
_WAV_EXTENSIONS = (".wav",)


@dataclass(frozen=True)
class WavAttachment:
    filename: str
    data: bytes


@dataclass
class VoicemailEmail:
    message_id: str
    from_addr: str
    subject: str
    date: str
    attachments: list[WavAttachment] = field(default_factory=list)


def _decode(value: str | None) -> str:
    """Decode an RFC 2047 encoded header (e.g. =?UTF-8?B?...?=) to plain text."""
    if not value:
        return ""
    try:
        return str(make_header(decode_header(value))).strip()
    except Exception:  # noqa: BLE001 — a malformed header must not abort the run
        return value.strip()


def _is_wav(part: Message, filename: str) -> bool:
    ctype = (part.get_content_type() or "").lower()
    if ctype in _WAV_CONTENT_TYPES:
        return True
    return filename.lower().endswith(_WAV_EXTENSIONS)


def _wav_attachments(msg: Message) -> list[WavAttachment]:
    out: list[WavAttachment] = []
    for part in msg.walk():
        if part.is_multipart():
            continue
        filename = _decode(part.get_filename())
        # An attachment is either an explicit attachment disposition or just a named part;
        # accept both as long as it looks like a .wav.
        if not filename and (part.get_content_disposition() or "") != "attachment":
            continue
        if not _is_wav(part, filename):
            continue
        payload = part.get_payload(decode=True)
        if not payload:
            continue
        out.append(WavAttachment(filename=filename or "voicemail.wav", data=payload))
    return out


class EmailSource:
    """A minimal IMAP reader: connect, search for candidate messages, return the ones that
    carry .wav attachments. Provider-agnostic — driven entirely by Config."""

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
            log.info("%d message(s) carry a .wav attachment", len(voicemails))
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
            attachments=_wav_attachments(msg),
        )
