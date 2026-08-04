"""Environment-backed configuration, validated once at startup.

The voice layer is Retell now (it owns telephony, STT, TTS, turn-taking, and the LLM), so
this app only needs the backend it reads leads from, the Retell credentials to place calls,
and optional SMTP for the post-call email. All settings are optional — nothing is required
at load time, so the process starts even on a machine with a minimal .env.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

# src/voice_agent/config/settings.py -> project root is four levels up.
PROJECT_ROOT = Path(__file__).resolve().parents[3]

load_dotenv(PROJECT_ROOT / ".env")


class ConfigError(RuntimeError):
    """A required setting is missing or malformed."""


def _optional(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip() or default


@dataclass(frozen=True)
class Config:
    port: int
    agent_name: str
    agent_org: str
    # The shared backend API (leads, scheduling, status) the poller reads from.
    backend_url: str
    # Retell — the voice agent that places the outbound calls.
    retell_api_key: str
    retell_agent_id: str
    retell_from_number: str
    # SMTP for the optional post-call team email (off if unset).
    smtp_host: str
    smtp_port: int
    smtp_username: str
    smtp_password: str
    smtp_from: str
    notify_email: str
    request_timeout: float

    @classmethod
    def load(cls) -> Config:
        return cls(
            port=int(_optional("PORT", "3000")),
            agent_name=_optional("AGENT_NAME", "Tess"),
            agent_org=_optional("AGENT_ORG", "TecAce"),
            backend_url=_optional("BACKEND_URL").rstrip("/"),
            # from_number is the number imported into / bought from Retell; defaults to
            # PHONE_NUMBER since it may be the same line.
            retell_api_key=_optional("RETELL_API_KEY"),
            retell_agent_id=_optional("RETELL_AGENT_ID"),
            retell_from_number=_optional("RETELL_FROM_NUMBER")
            or _optional("PHONE_NUMBER")
            or _optional("TWILIO_PHONE_NUMBER"),
            smtp_host=_optional("SMTP_HOST"),
            smtp_port=int(_optional("SMTP_PORT", "587")),
            smtp_username=_optional("SMTP_USERNAME"),
            smtp_password=_optional("SMTP_PASSWORD"),
            smtp_from=_optional("SMTP_FROM") or _optional("SMTP_USERNAME"),
            notify_email=_optional("NOTIFY_EMAIL"),
            request_timeout=float(_optional("REQUEST_TIMEOUT_SECONDS", "60")),
        )
