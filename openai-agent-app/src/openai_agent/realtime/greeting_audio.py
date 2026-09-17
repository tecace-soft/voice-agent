"""The opening line, spoken before the model is ready to speak it.

WHY. Answering a call is the one moment where the agent already knows exactly what it is going to
say — the greeting is fixed text for a business — and it is also the one moment the caller has
nothing to do but listen to silence. Measured on real GPT-Live sessions, the model needs about 2.5
seconds from a cold session to its first audible word, and that is floor, not tuning: the same 2.5
seconds turned up with a two-line prompt, no tools and no backend attached.

So the greeting stops going through the model. It is synthesised once per business with the speech
API, in the SAME voice the live model uses, cached, and played to the caller the moment Twilio's
stream opens. The model is then told what the caller has already heard, and picks the conversation
up from the caller's first words — which is work the caller is not sitting in silence for.

WHAT IT COSTS. One speech request per distinct greeting (about 2 seconds, a fraction of a cent),
kept in memory for the life of the process. A cold cache is not a problem worth solving: the
warm-up starts at /incoming while Twilio is still setting up the stream, and a call that arrives
before it lands simply greets the old way.

TURNING IT OFF. PRERENDERED_GREETING=false, and every call greets through the model as before.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import logging
import struct

import httpx

from ..config import Config
from .dtmf import FRAME_MS, SAMPLE_RATE, linear_to_ulaw

log = logging.getLogger(__name__)

SPEECH_URL = "https://api.openai.com/v1/audio/speech"
# The speech API returns raw 16-bit mono PCM at this rate; Twilio wants 8 kHz μ-law.
_PCM_RATE = 24_000
_FRAME_BYTES = SAMPLE_RATE * FRAME_MS // 1000  # 160 bytes of μ-law = 20ms

# text -> μ-law 8k audio. Small by nature: one entry per business greeting this process has seen.
_cache: dict[str, bytes] = {}
_pending: dict[str, asyncio.Task] = {}


def _key(cfg: Config, text: str) -> str:
    return hashlib.sha256(f"{cfg.openai_voice}|{cfg.openai_tts_model}|{text}".encode()).hexdigest()


def pcm24_to_ulaw8(pcm24: bytes) -> bytes:
    """24 kHz signed 16-bit PCM -> 8 kHz mu-law, the only audio Twilio's stream carries.

    Written out rather than handed to audioop, which Python removed in 3.13. Three input samples
    become one output sample, AVERAGED rather than picked: dropping two of every three outright
    aliases high frequencies down into the voice band and adds an audible rasp.
    """
    count = len(pcm24) // 2
    samples = struct.unpack(f"<{count}h", pcm24[: count * 2])
    return bytes(
        linear_to_ulaw((samples[i] + samples[i + 1] + samples[i + 2]) // 3)
        for i in range(0, count - 2, 3)
    )



async def _synthesise(cfg: Config, text: str) -> bytes | None:
    """The greeting as μ-law, or None if the speech API would not give us one.

    Never raises: a greeting we could not pre-render just means the model speaks it, which is what
    it did before this existed.
    """
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(
                SPEECH_URL,
                headers={"Authorization": f"Bearer {cfg.openai_api_key}"},
                json={
                    "model": cfg.openai_tts_model,
                    "voice": cfg.openai_voice.lower(),
                    "input": text,
                    "response_format": "pcm",
                },
            )
        if resp.status_code != 200:
            log.warning("could not pre-render the greeting (%s) — the model will speak it: %s",
                        resp.status_code, resp.text[:200])
            return None
        return pcm24_to_ulaw8(resp.content)
    except Exception as exc:  # noqa: BLE001 — a greeting is never worth failing a call over
        log.warning("could not pre-render the greeting (%s) — the model will speak it", exc)
        return None


def warm(cfg: Config, text: str) -> None:
    """Start rendering a greeting we expect to need, and don't wait for it."""
    if not cfg.prerendered_greeting or not text.strip():
        return
    key = _key(cfg, text)
    if key in _cache or key in _pending:
        return

    async def run() -> None:
        audio = await _synthesise(cfg, text)
        if audio:
            _cache[key] = audio
            log.info("greeting pre-rendered (%.1fs of audio) and cached", len(audio) / SAMPLE_RATE)

    task = asyncio.create_task(run())
    _pending[key] = task
    task.add_done_callback(lambda _t, k=key: _pending.pop(k, None))


def ready(cfg: Config, text: str) -> bytes | None:
    """The cached greeting audio, or None — in which case the model greets, as it always did."""
    if not cfg.prerendered_greeting or not text.strip():
        return None
    return _cache.get(_key(cfg, text))


def frames(audio: bytes) -> list[str]:
    """μ-law audio as the 20ms base64 frames Twilio's media messages carry."""
    return [
        base64.b64encode(audio[i : i + _FRAME_BYTES].ljust(_FRAME_BYTES, b"\xff")).decode()
        for i in range(0, len(audio), _FRAME_BYTES)
    ]


ALREADY_GREETED = (
    "The call has just connected and the caller has ALREADY heard your opening line, spoken a "
    "moment ago in your own voice:\n\n  \"{greeting}\"\n\nDo not say it again, do not greet them a "
    "second time, and do not introduce yourself again. Listen for what they say, and carry the "
    "call on from there."
)


def already_greeted(greeting: str) -> str:
    return ALREADY_GREETED.format(greeting=greeting.strip())


__all__ = ["ALREADY_GREETED", "already_greeted", "frames", "pcm24_to_ulaw8", "ready", "warm"]
