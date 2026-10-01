"""Audio for the scenario runner: the customer's lines as phone audio, and "is the agent talking?"."""

from __future__ import annotations

import asyncio
import base64

import httpx

from ..realtime.greeting_audio import SPEECH_URL, pcm24_to_ulaw8

FRAME_BYTES = 160  # 20 ms of 8 kHz μ-law, the frame Twilio sends and the live bridge forwards
FRAME_SECONDS = 0.02
SILENCE_FRAME = base64.b64encode(b"\xff" * FRAME_BYTES).decode("ascii")
# gpt-4o-mini-tts, roughly, per minute of speech produced. Only feeds the run's cost estimate.
TTS_PRICE_PER_MINUTE = 0.015

# Same rule as live_bridge._has_sound: a μ-law byte is "loud" at segment 3 or higher, and a chunk is
# sound when at least 2% of it is loud. Copied rather than imported so this package does not pull in
# the Twilio bridge.
_LOUD_BYTES = bytes(1 if ((0xFF ^ b) >> 4) & 7 >= 3 else 0 for b in range(256))


def has_sound(payload: str) -> bool:
    try:
        raw = base64.b64decode(payload)
    except (ValueError, TypeError):
        return False
    return bool(raw) and raw.translate(_LOUD_BYTES).count(1) * 50 >= len(raw)


def seconds(audio: bytes) -> float:
    return len(audio) / 8000


async def synthesize(api_key: str, model: str, voice: str, text: str) -> bytes:
    """One customer line as 8 kHz μ-law. Raises: a line we cannot voice is a run error."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            SPEECH_URL,
            headers={"Authorization": f"Bearer {api_key}"},
            json={"model": model, "voice": voice, "input": text, "response_format": "pcm"},
        )
    if resp.status_code != 200:
        raise RuntimeError(f"text-to-speech failed ({resp.status_code}): {resp.text[:200]}")
    return await asyncio.to_thread(pcm24_to_ulaw8, resp.content)
