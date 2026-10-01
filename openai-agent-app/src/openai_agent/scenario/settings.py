"""The scenario runner's settings, read from the same .env as the rest of the app."""

from __future__ import annotations

import os
from dataclasses import dataclass

from ..config import Config  # noqa: F401 — importing the config loads .env
from ..realtime.live_session import LIVE_URL


def _env(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip() or default


@dataclass(frozen=True)
class RunnerSettings:
    # Shared with transcribe-backend's SCENARIO_RUNNER_KEY; sent both ways as x-runner-key.
    key: str
    # SCENARIO_RUNNER_ENABLED=false refuses every pass: the kill switch.
    enabled: bool
    port: int
    # transcribe-backend, the same base the phone agent reads /business/config from.
    backend_url: str
    tts_model: str
    # The scripted customer's voice. Different from the receptionist's so a transcript is easy to follow.
    customer_voice: str
    # Overridable only so the offline check can point it at a fake.
    live_url: str

    @classmethod
    def load(cls) -> "RunnerSettings":
        return cls(
            key=_env("SCENARIO_RUNNER_KEY"),
            enabled=_env("SCENARIO_RUNNER_ENABLED", "true").lower() not in ("false", "0", "no", "off"),
            port=int(_env("SCENARIO_RUNNER_PORT", "5070")),
            backend_url=_env("BUSINESS_CONFIG_URL").rstrip("/"),
            tts_model=_env("SCENARIO_TTS_MODEL", "gpt-4o-mini-tts"),
            customer_voice=_env("SCENARIO_CUSTOMER_VOICE", "ash"),
            live_url=_env("SCENARIO_LIVE_URL", LIVE_URL),
        )

    def missing(self) -> list[str]:
        gaps: list[str] = []
        if not self.key:
            gaps.append("SCENARIO_RUNNER_KEY")
        if not self.backend_url:
            gaps.append("BUSINESS_CONFIG_URL")
        return gaps
