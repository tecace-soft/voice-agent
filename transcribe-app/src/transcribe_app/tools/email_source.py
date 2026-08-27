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
import re
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from email.header import decode_header, make_header
from email.message import Message
from email.utils import parseaddr
from urllib.parse import quote

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
    # The message's IMAP UID (stable within the mailbox) — used to build a webmail "Open email"
    # link for the ones (like Roundcube) that open a message by UID rather than Message-ID.
    uid: str = ""
    # Gmail only: the hex form of X-GM-MSGID, which is the message id in a Gmail web URL — lets the
    # "Open email" link open the message DIRECTLY instead of landing on a search result.
    gm_msgid: str = ""
    attachments: list[AudioAttachment] = field(default_factory=list)


def build_email_link(
    template: str, *, message_id: str, uid: str, mailbox: str, gm_msgid: str = ""
) -> str:
    """Fill an EMAIL_LINK_TEMPLATE for one message so the sheet can deep-link to it in webmail.
    Placeholders: {message_id} (angle brackets stripped, URL-encoded — for Gmail's rfc822msgid:
    search and most webmail); {uid}/{mailbox} (webmail that opens by IMAP UID, e.g. Roundcube);
    {gm_msgid} (Gmail only — opens the message directly). Empty template -> no link."""
    if not template:
        return ""
    mid = message_id.strip().lstrip("<").rstrip(">")
    try:
        return template.format(
            message_id=quote(mid, safe=""),
            uid=quote(uid, safe=""),
            mailbox=quote(mailbox, safe=""),
            gm_msgid=quote(gm_msgid, safe=""),
        )
    except (KeyError, IndexError, ValueError) as exc:
        log.warning("EMAIL_LINK_TEMPLATE could not be filled (%s): %s", exc, template)
        return ""


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


def _login(conn: imaplib.IMAP4, user: str, password: str) -> None:
    """Log in, tolerating a non-ASCII password (e.g. one containing a Korean character).

    This is plain IMAP LOGIN — basic auth. Gmail accepts it with an app password and Comcast with
    the account password (once third-party access is enabled), but Microsoft 365 and Outlook.com
    have retired basic auth for IMAP and need OAuth2, which would be a real piece of work rather
    than a config change.

    Two things trip up non-ASCII credentials: (1) imaplib encodes the LOGIN command with the
    connection's codec, which defaults to ASCII — the caller sets it to UTF-8 so the password can
    be sent at all; (2) the same character can be stored on the server in a different Unicode
    normalization form (NFC vs NFD) than the one we were handed, so equal-looking passwords differ
    byte-for-byte. We try the password as given, then NFC and NFD, until one authenticates. A
    failed LOGIN leaves the connection in the non-authenticated state, so retrying on it is safe.
    """
    candidates = [password]
    for form in ("NFC", "NFD"):
        norm = unicodedata.normalize(form, password)
        if norm not in candidates:
            candidates.append(norm)
    # Google shows an app password as four spaced groups ("abcd efgh ijkl mnop") and people paste it
    # that way. Tried last, never instead of the password as given, so a password that genuinely
    # contains a space is unaffected — this can only turn a failure into a success.
    unspaced = "".join(password.split())
    if unspaced and unspaced not in candidates:
        candidates.append(unspaced)
    last_exc: Exception | None = None
    for candidate in candidates:
        try:
            conn.login(user, candidate)
            return
        except imaplib.IMAP4.error as exc:
            last_exc = exc
    assert last_exc is not None  # candidates is never empty
    raise last_exc


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
            total = len(ids)
            log.info("found %d candidate message(s) in %s", total, cfg.imap_mailbox)
            voicemails: list[VoicemailEmail] = []
            for i, num in enumerate(ids, 1):
                vm = self._load(conn, num)
                if vm and vm.attachments:
                    voicemails.append(vm)
                # Heartbeat while downloading, so a large scan doesn't look frozen.
                if i % 20 == 0 or i == total:
                    log.info("scanned %d/%d message(s), %d with audio so far", i, total, len(voicemails))
            log.info("%d message(s) carry an audio attachment", len(voicemails))
            return voicemails
        finally:
            try:
                conn.logout()
            except Exception:  # noqa: BLE001
                pass

    def _connect(self) -> imaplib.IMAP4:
        cfg = self._cfg
        # A socket timeout so a stalled connection raises instead of hanging the run forever.
        log.info("connecting to %s:%d as %s ...", cfg.imap_host, cfg.imap_port, cfg.imap_username)
        if cfg.imap_ssl:
            conn: imaplib.IMAP4 = imaplib.IMAP4_SSL(
                cfg.imap_host, cfg.imap_port, timeout=cfg.request_timeout
            )
        else:
            conn = imaplib.IMAP4(cfg.imap_host, cfg.imap_port, timeout=cfg.request_timeout)
            conn.starttls()
        # imaplib encodes the LOGIN command with this codec; it defaults to ASCII, which raises on
        # a non-ASCII password (e.g. one containing Korean). UTF-8 lets such a password be sent at
        # all; the mail server (Dovecot/cPanel here) compares it as UTF-8. See _login for the
        # normalization handling that goes with this.
        conn._encoding = "utf-8"
        _login(conn, cfg.imap_username, cfg.imap_password)
        log.info("connected — scanning mailbox %s", cfg.imap_mailbox)
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
        # UID search/fetch (not sequence numbers) so each message carries a stable id we can put in
        # a webmail "Open email" link.
        typ, data = conn.uid("search", *criteria)
        if typ != "OK" or not data or not data[0]:
            return []
        return data[0].split()

    def _load(self, conn: imaplib.IMAP4, num: bytes) -> VoicemailEmail | None:
        # On Gmail, also pull X-GM-MSGID (a Gmail IMAP extension) so the "Open email" link can open
        # the message directly. Other servers don't support it, so only ask Gmail for it.
        is_gmail = "gmail" in self._cfg.imap_host.lower()
        items = "(RFC822 X-GM-MSGID)" if is_gmail else "(RFC822)"
        typ, data = conn.uid("fetch", num, items)
        if typ != "OK" or not data or not isinstance(data[0], tuple):
            return None
        msg = email.message_from_bytes(data[0][1])
        uid = num.decode(errors="ignore")
        gm_msgid = ""
        if is_gmail:
            m = re.search(rb"X-GM-MSGID (\d+)", data[0][0] or b"")
            if m:
                gm_msgid = format(int(m.group(1)), "x")  # hex = the id in the Gmail web URL
        message_id = _decode(msg.get("Message-ID")) or f"uid-{uid}"
        return VoicemailEmail(
            message_id=message_id,
            uid=uid,
            gm_msgid=gm_msgid,
            from_addr=parseaddr(_decode(msg.get("From")))[1],
            subject=_decode(msg.get("Subject")),
            date=_decode(msg.get("Date")),
            attachments=_audio_attachments(msg),
        )
