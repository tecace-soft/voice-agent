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
    elevenlabs_api_key: str
    elevenlabs_voice_id: str
    elevenlabs_model_id: str
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
            # ElevenLabs gives the agent its spoken voice (text-to-speech).
            elevenlabs_api_key=_required("ELEVENLABS_API_KEY"),
            elevenlabs_voice_id=_required("ELEVENLABS_VOICE_ID"),
            elevenlabs_model_id=_optional("ELEVENLABS_MODEL_ID", "eleven_flash_v2_5"),
            request_timeout=float(_optional("REQUEST_TIMEOUT_SECONDS", "60")),
        )
