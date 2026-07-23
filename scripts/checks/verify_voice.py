"""Prove the ElevenLabs key + voice id work by synthesizing a sample line.

    python scripts/checks/verify_voice.py

Validates the credentials, then writes a spoken sample to data/voice-sample.mp3
so you can play it back and hear the configured voice.
"""

from __future__ import annotations

import sys

from voice_agent.config import PROJECT_ROOT, Config, ConfigError
from voice_agent.tools.voice import ElevenLabsVoice, VoiceError

SAMPLE = "Hi, thanks for calling. To get started, can I take your full name?"


def main() -> int:
    try:
        cfg = Config.load()
    except ConfigError as exc:
        print(f"config: FAIL — {exc}")
        return 1
    print(f"config: ok — voice {cfg.elevenlabs_voice_id}, model {cfg.elevenlabs_model_id}")

    voice = ElevenLabsVoice(cfg)

    try:
        info = voice.voice_info()
        print(f"voice : ok — name={info['name']!r}, category={info['category']!r}")
    except VoiceError as exc:
        print(f"voice : FAIL — {exc}")
        return 1

    try:
        out = voice.save(SAMPLE, PROJECT_ROOT / "data" / "voice-sample.mp3")
        size_kb = out.stat().st_size / 1024
        print(f"tts   : ok — wrote {out} ({size_kb:.1f} KB). Play it to hear the agent.")
    except VoiceError as exc:
        print(f"tts   : FAIL — {exc}")
        return 1

    print("\nElevenLabs voice is working.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
