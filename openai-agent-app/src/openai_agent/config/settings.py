"""Environment-backed configuration, validated once at load.

This app is an experimental alternative to the Retell voice agent: it runs the TecAce
lead-callback conversation on the OpenAI Realtime API, bridged to the phone network with
Twilio Media Streams. It reuses the SAME shared backend `/agent/*` tools the Retell agent
uses (check availability, book, callback, mark outcome) — it just owns the voice layer itself.

Nothing is required at import time, so the process starts even with a partial .env; the
entrypoints surface what's missing via `Config.missing()`.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

# src/openai_agent/config/settings.py -> project root is four levels up.
PROJECT_ROOT = Path(__file__).resolve().parents[3]

load_dotenv(PROJECT_ROOT / ".env")


class ConfigError(RuntimeError):
    """A required setting is missing or malformed."""


def _optional(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip() or default


@dataclass(frozen=True)
class Config:
    # ---- The media-stream server ----
    port: int
    # Public host Twilio's <Stream> connects back to (no scheme), e.g. an ngrok host:
    # "abc123.ngrok-free.app". The outbound TwiML builds wss://<host>/media-stream from it.
    public_host: str
    # ---- Shared backend tools (same service the Retell agent calls) ----
    backend_url: str
    agent_tools_secret: str  # sent as the x-agent-secret header
    # ---- OpenAI Realtime ----
    openai_api_key: str
    openai_model: str
    openai_voice: str
    # ---- Twilio (telephony) ----
    twilio_account_sid: str
    twilio_auth_token: str
    twilio_from_number: str
    # ---- Runtime ----
    timezone: str  # business timezone for spoken dates (matches the backend's SCHEDULE_TIMEZONE)
    request_timeout: float

    @classmethod
    def load(cls) -> Config:
        return cls(
            port=int(_optional("PORT", "5050")),
            public_host=_optional("PUBLIC_HOST").replace("https://", "").replace("wss://", "").rstrip("/"),
            backend_url=_optional("BACKEND_URL").rstrip("/"),
            agent_tools_secret=_optional("AGENT_TOOLS_SECRET"),
            openai_api_key=_optional("OPENAI_API_KEY"),
            # gpt-realtime-2.1 = higher capability (best alphanumeric read-back, interruptions,
            # latency); gpt-realtime-2.1-mini = cheaper, reasoning + tool use at the mini price.
            openai_model=_optional("OPENAI_MODEL", "gpt-realtime-2.1"),
            # gpt-realtime voices include natural ones like "marin" and "cedar"; "alloy" always works.
            openai_voice=_optional("OPENAI_VOICE", "alloy"),
            twilio_account_sid=_optional("TWILIO_ACCOUNT_SID"),
            twilio_auth_token=_optional("TWILIO_AUTH_TOKEN"),
            twilio_from_number=_optional("TWILIO_FROM_NUMBER") or _optional("TWILIO_PHONE_NUMBER"),
            timezone=_optional("TIMEZONE", "America/Los_Angeles"),
            request_timeout=float(_optional("REQUEST_TIMEOUT_SECONDS", "30")),
        )

    def missing_for_server(self) -> list[str]:
        """Settings the media-stream server needs to run a call."""
        gaps: list[str] = []
        if not self.openai_api_key:
            gaps.append("OPENAI_API_KEY")
        if not self.backend_url:
            gaps.append("BACKEND_URL")
        return gaps

    def missing_for_outbound(self) -> list[str]:
        """Settings needed to place an outbound call."""
        gaps: list[str] = []
        if not self.twilio_account_sid:
            gaps.append("TWILIO_ACCOUNT_SID")
        if not self.twilio_auth_token:
            gaps.append("TWILIO_AUTH_TOKEN")
        if not self.twilio_from_number:
            gaps.append("TWILIO_FROM_NUMBER")
        if not self.public_host:
            gaps.append("PUBLIC_HOST")
        return gaps
