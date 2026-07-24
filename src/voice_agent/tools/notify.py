"""Email notifications — push post-call outputs to the team inbox (the CRM/email
side of the scenario's §4).

Plain `smtplib` over STARTTLS, configured via SMTP_* + NOTIFY_EMAIL in .env (works
with Gmail using an app password, or any provider). If SMTP isn't configured,
sending is a graceful no-op — the tracking sheet still has the record.
"""

from __future__ import annotations

import logging
import smtplib
import ssl
from email.message import EmailMessage

from ..config import Config

log = logging.getLogger(__name__)


class EmailNotifier:
    def __init__(self, cfg: Config) -> None:
        self._cfg = cfg

    @property
    def configured(self) -> bool:
        c = self._cfg
        return bool(c.smtp_host and c.smtp_username and c.smtp_password and c.notify_email)

    def send(self, subject: str, body: str) -> bool:
        """Send a plain-text email to NOTIFY_EMAIL. Returns True if sent."""
        if not self.configured:
            return False
        c = self._cfg
        msg = EmailMessage()
        msg["Subject"] = subject
        msg["From"] = c.smtp_from or c.smtp_username
        msg["To"] = c.notify_email
        msg.set_content(body)
        try:
            with smtplib.SMTP(c.smtp_host, c.smtp_port, timeout=c.request_timeout) as server:
                server.starttls(context=ssl.create_default_context())
                server.login(c.smtp_username, c.smtp_password)
                server.send_message(msg)
        except Exception as exc:  # noqa: BLE001 — never let email break the call flow
            log.warning("could not send post-call email: %s", exc)
            return False
        log.info("post-call email sent to %s", c.notify_email)
        return True
