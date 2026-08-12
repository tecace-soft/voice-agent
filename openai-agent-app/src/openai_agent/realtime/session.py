"""Build the `session.update` payload that configures an OpenAI Realtime session.

Audio in and out are G.711 μ-law (`audio/pcmu`) — the codec Twilio Media Streams uses — so the
bridge forwards audio bytes straight through with no resampling. Turn-taking is server-side VAD,
so the model decides when the lead has finished and responds. Tools are the shared backend
functions from tools.py.
"""

from __future__ import annotations

from ..config import Config
from ..tools.agent_tools import TOOL_SCHEMAS


def build_session_update(cfg: Config, instructions: str) -> dict:
    return {
        "type": "session.update",
        "session": {
            "type": "realtime",
            "model": cfg.openai_model,
            "output_modalities": ["audio"],
            "audio": {
                "input": {
                    "format": {"type": "audio/pcmu"},
                    "turn_detection": {"type": "server_vad"},
                },
                "output": {
                    "format": {"type": "audio/pcmu"},
                    "voice": cfg.openai_voice,
                },
            },
            "instructions": instructions,
            "tools": TOOL_SCHEMAS,
            "tool_choice": "auto",
        },
    }
