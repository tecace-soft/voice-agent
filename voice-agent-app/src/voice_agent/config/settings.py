"""Environment-backed configuration, validated once at startup."""

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


def _required(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise ConfigError(f"{name} is not set. Copy .env.example to .env and fill it in.")
    return value


def _optional(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip() or default


@dataclass(frozen=True)
class Config:
    port: int
    hermes_server_url: str
    hermes_api_path: str
    hermes_api_key: str
    hermes_username: str
    hermes_password: str
    hermes_auth_provider: str
    hermes_model: str
    gemini_api_key: str
    gemini_model: str
    use_hermes_brain: bool
    agent_name: str
    agent_org: str
    elevenlabs_api_key: str
    elevenlabs_voice_id: str
    elevenlabs_model_id: str
    backend_url: str
    cal_api_key: str
    cal_event_type_id: int
    twilio_account_sid: str
    twilio_auth_token: str
    twilio_phone_number: str
    deepgram_api_key: str
    public_base_url: str
    detect_voicemail: bool
    smtp_host: str
    smtp_port: int
    smtp_username: str
    smtp_password: str
    smtp_from: str
    notify_email: str
    request_timeout: float

    @property
    def hermes_api_base(self) -> str:
        """Full base the OpenAI-compatible client posts to."""
        return f"{self.hermes_server_url}{self.hermes_api_path}"

    @classmethod
    def load(cls) -> Config:
        # HERMES_BASE_URL is the pre-rename name, still accepted.
        server_url = _optional("HERMES_SERVER_URL") or _optional("HERMES_BASE_URL")
        if not server_url:
            raise ConfigError("HERMES_SERVER_URL is not set. See .env.example.")

        return cls(
            # The port this application listens on, not the Hermes port
            # (that one travels inside HERMES_SERVER_URL).
            port=int(_optional("PORT", "3000")),
            hermes_server_url=server_url.rstrip("/"),
            hermes_api_path="/" + _optional("HERMES_API_PATH", "api").strip("/"),
            # A self-hosted Hermes may have no auth, but the OpenAI client
            # refuses to construct without some api_key string.
            hermes_api_key=_optional("HERMES_API_KEY") or "no-auth",
            # Cookie-session login for the Hermes Agent web API.
            hermes_username=_optional("HERMES_USERNAME"),
            hermes_password=_optional("HERMES_PASSWORD"),
            hermes_auth_provider=_optional("HERMES_AUTH_PROVIDER", "basic"),
            hermes_model=_optional("HERMES_MODEL", "hermes-4"),
            gemini_api_key=_required("GEMINI_API_KEY"),
            gemini_model=_optional("GEMINI_MODEL", "gemini-2.5-flash-lite"),
            # Route the agent's generative replies through Hermes (its model, e.g.
            # gpt-5.6-sol), falling back to Gemini. Off -> Gemini only.
            use_hermes_brain=_optional("USE_HERMES_BRAIN", "true").lower()
            in ("1", "true", "yes", "on"),
            # The agent's spoken identity, used when it fields small talk / FAQs.
            agent_name=_optional("AGENT_NAME", "Tess"),
            agent_org=_optional("AGENT_ORG", "TecAce"),
            # ElevenLabs gives the agent its spoken voice (text-to-speech).
            elevenlabs_api_key=_required("ELEVENLABS_API_KEY"),
            elevenlabs_voice_id=_required("ELEVENLABS_VOICE_ID"),
            elevenlabs_model_id=_optional("ELEVENLABS_MODEL_ID", "eleven_flash_v2_5"),
            # The shared backend API (leads, scheduling, status) — the voice agent's
            # single source instead of Cal.com + Google Sheets. No trailing slash.
            backend_url=_optional("BACKEND_URL").rstrip("/"),
            # Cal.com — used ONLY to create the meeting (calendar invite + join link) when
            # a booking is confirmed; the backend still owns availability + the booking.
            cal_api_key=_optional("CAL_API_KEY"),
            cal_event_type_id=int(_optional("CAL_EVENT_TYPE_ID", "0")),
            # Telephony (Twilio phone line). Accept the short .env names first,
            # falling back to the TWILIO_-prefixed ones.
            twilio_account_sid=_optional("ACCOUNT_SID") or _optional("TWILIO_ACCOUNT_SID"),
            twilio_auth_token=_optional("TWILIO_AUTH_TOKEN"),
            twilio_phone_number=_optional("PHONE_NUMBER") or _optional("TWILIO_PHONE_NUMBER"),
            # Optional: streaming speech-to-text, only for the Pipecat upgrade path.
            deepgram_api_key=_optional("DEEPGRAM_API_KEY"),
            # Public https base (e.g. an ngrok URL) that Twilio can reach for
            # webhooks and audio; required for outbound calls.
            public_base_url=_optional("PUBLIC_BASE_URL").rstrip("/"),
            # Ask Twilio to detect voicemail on outbound calls (leaves a message).
            detect_voicemail=_optional("DETECT_VOICEMAIL", "true").lower()
            in ("1", "true", "yes", "on"),
            # SMTP for the post-call team email (CRM push). Optional — off if unset.
            smtp_host=_optional("SMTP_HOST"),
            smtp_port=int(_optional("SMTP_PORT", "587")),
            smtp_username=_optional("SMTP_USERNAME"),
            smtp_password=_optional("SMTP_PASSWORD"),
            smtp_from=_optional("SMTP_FROM") or _optional("SMTP_USERNAME"),
            notify_email=_optional("NOTIFY_EMAIL"),
            request_timeout=float(_optional("REQUEST_TIMEOUT_SECONDS", "60")),
        )
