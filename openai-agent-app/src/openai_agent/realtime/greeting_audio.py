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
import math
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


# A 63-tap windowed-sinc low-pass at 3.4 kHz, the top of the telephone band, built once at import.
#
# The first version of this file skipped the filter and simply averaged each group of three samples.
# Averaging is a filter, but a terrible one: it leaves most of what sits above 4 kHz, and everything
# above 4 kHz folds back down into the voice band when the rate drops to 8 kHz. Measured on a real
# rendered greeting that was 16 dB of signal to error — audible as a rasp, and reported on a live
# call as the agent sounding disjointed and pieced together.
def _lowpass_taps(count: int = 63, cutoff: float = 3400.0, rate: int = _PCM_RATE) -> list[float]:
    middle = (count - 1) / 2
    taps = []
    for i in range(count):
        n = i - middle
        # sinc, by hand (math.sinc does not exist), with a Hamming window to tame the ripple
        x = 2 * cutoff / rate * n
        sinc = 1.0 if n == 0 else math.sin(math.pi * x) / (math.pi * x)
        taps.append(sinc * (0.54 - 0.46 * math.cos(2 * math.pi * i / (count - 1))))
    total = sum(taps)
    return [t / total for t in taps]


_TAPS = _lowpass_taps()


def pcm24_to_ulaw8(pcm24: bytes) -> bytes:
    """24 kHz signed 16-bit PCM -> 8 kHz mu-law, the only audio Twilio's stream carries.

    Low-pass first, then take every third sample. Written out because Python removed audioop in
    3.13, and because the alternative — a naive average — measurably rasps.

    Costs a second or two of CPU for a greeting, so callers run it off the event loop: a phone call
    in progress must not stutter while this works.
    """
    count = len(pcm24) // 2
    if count < len(_TAPS):
        return b""
    samples = struct.unpack(f"<{count}h", pcm24[: count * 2])
    taps = _TAPS
    width = len(taps)
    out = bytearray()
    # Only the samples that survive decimation are filtered — the other two thirds are discarded
    # anyway, and computing them would triple the work for nothing.
    for centre in range(width // 2, count - width // 2, 3):
        acc = 0.0
        base = centre - width // 2
        for k in range(width):
            acc += samples[base + k] * taps[k]
        value = int(acc)
        out.append(linear_to_ulaw(max(-32768, min(32767, value))))
    return bytes(out)



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
        # ~0.3s of arithmetic for a greeting. On the event loop that is 0.3s of stutter for
        # every call in progress, so it goes to a thread.
        return await asyncio.to_thread(pcm24_to_ulaw8, resp.content)
    except Exception as exc:  # noqa: BLE001 — a greeting is never worth failing a call over
        log.warning("could not pre-render the greeting (%s) — the model will speak it", exc)
        return None


def warm(cfg: Config, text: str) -> None:
    """Start rendering a greeting we expect to need, and don't wait for it.

    Rendered on EVERY inbound call, not only where PRERENDERED_GREETING is on: the setting decides
    whether the caller hears this instead of the model, but the bridge also falls back to it when
    the model will not greet at all — and a rescue that has to wait two seconds for a speech request
    is not much of a rescue. One request per distinct greeting, cached for the life of the process.
    """
    if not text.strip():
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
    """The cached greeting audio, or None if it has not been rendered (yet, or at all)."""
    if not text.strip():
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
