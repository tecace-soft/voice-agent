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
    # ---- Webhook / stream authentication ----
    # Verify the X-Twilio-Signature on incoming webhooks. Default OFF so turning it on is a
    # deliberate, reversible step: the signature is computed over the URL as TWILIO built it, and
    # behind a reverse proxy a misconfigured PUBLIC_HOST rejects every real call. Switch it on,
    # place one test call, and leave it on.
    validate_twilio_signature: bool
    # A shared secret appended to the media-stream WebSocket path. Without one, anyone who can
    # reach the server can open a WebSocket and run up an OpenAI Realtime session on our key.
    # Blank = no secret required (the pre-existing behavior).
    stream_secret: str
    # ---- Inbound call screening (all optional; unset = outbound-only, exactly as before) ----
    # The colleague a booking request is warm-transferred to.
    human_number: str
    # The company's public main line. Used as the transfer's caller ID (so the handoff doesn't
    # reach the colleague as an unknown, spam-scored number) and as the fallback dial target when
    # the app itself is down. Falls back to twilio_from_number if unset.
    main_line: str
    business_name: str
    agent_name: str
    business_hours: str
    # Optional override for the spoken facts in the inbound prompt, so a different client can be
    # served without a code change.
    business_facts: str
    open_hour: int
    close_hour: int
    # Say "this call is recorded" in the inbound greeting. Default ON: the transcript IS persisted,
    # and Washington is a two-party-consent state. Turn off only on legal advice.
    disclose_recording: bool
    # ---- Runtime ----
    # How often the poller looks for leads that are due a call, in seconds.
    poll_interval: float
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
            validate_twilio_signature=_optional("VALIDATE_TWILIO_SIGNATURE", "false").lower()
            in ("1", "true", "yes", "on"),
            stream_secret=_optional("STREAM_SECRET"),
            human_number=_optional("HUMAN_TRANSFER_NUMBER"),
            main_line=_optional("MAIN_LINE_NUMBER"),
            business_name=_optional("BUSINESS_NAME", "TecAce"),
            agent_name=_optional("AGENT_NAME", "Tess"),
            business_hours=_optional("BUSINESS_HOURS", "Monday to Friday, 9 AM to 6 PM Pacific"),
            business_facts=_optional("BUSINESS_FACTS"),
            open_hour=int(_optional("BUSINESS_OPEN_HOUR", "9")),
            close_hour=int(_optional("BUSINESS_CLOSE_HOUR", "18")),
            disclose_recording=_optional("DISCLOSE_RECORDING", "true").lower()
            in ("1", "true", "yes", "on"),
            poll_interval=float(_optional("POLL_INTERVAL_SECONDS", "300")),
            timezone=_optional("TIMEZONE", "America/Los_Angeles"),
            request_timeout=float(_optional("REQUEST_TIMEOUT_SECONDS", "30")),
        )

    @property
    def stream_url(self) -> str:
        """The wss:// URL Twilio streams call audio to.

        Defined in ONE place because three separate callers build it — the outbound TwiML, the
        inbound /incoming webhook, and the post-transfer recovery TwiML. If the path secret and
        those three ever disagree, calls connect to a socket that immediately rejects them.
        """
        path = "/media-stream" + (f"/{self.stream_secret}" if self.stream_secret else "")
        return f"wss://{self.public_host}{path}"

    def insecure_endpoints(self) -> list[str]:
        """Public surfaces currently accepting unauthenticated traffic. Warned about at startup;
        never fatal, so an existing deployment keeps working after an upgrade."""
        gaps: list[str] = []
        if not self.validate_twilio_signature:
            gaps.append("VALIDATE_TWILIO_SIGNATURE (webhooks accept unsigned requests)")
        if not self.stream_secret:
            gaps.append("STREAM_SECRET (anyone reaching /media-stream can open a Realtime session)")
        return gaps

    def missing_for_server(self) -> list[str]:
        """Settings the media-stream server needs to run a call."""
        gaps: list[str] = []
        if not self.openai_api_key:
            gaps.append("OPENAI_API_KEY")
        if not self.backend_url:
            gaps.append("BACKEND_URL")
        return gaps

    def missing_for_inbound(self) -> list[str]:
        """Settings the inbound screening path needs on top of the server's own.

        Not fatal: without these the agent still answers and can still take a message — it just
        cannot warm-transfer a booking to a person, which is the whole point of screening. The
        entrypoint warns rather than refusing to start.
        """
        gaps: list[str] = []
        if not self.public_host:
            gaps.append("PUBLIC_HOST")
        if not self.human_number:
            gaps.append("HUMAN_TRANSFER_NUMBER")
        if not (self.main_line or self.twilio_from_number):
            gaps.append("MAIN_LINE_NUMBER")
        if not (self.twilio_account_sid and self.twilio_auth_token):
            gaps.append("TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN")
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
