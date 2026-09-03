"""Generate a DTMF keypress as G.711 μ-law, for sending down a Twilio media stream.

Why this exists: a carrier forwarding a landline to us can have ANSWER CONFIRMATION switched on —
it answers our leg, plays "this is a forwarded call, press 1 to accept, or hang up to ignore", and
only bridges the real caller once a digit arrives. An always-on agent never presses anything, so the
carrier gives up and the caller hears ringing until they do. Pressing the digit for it is the fix.

It has to be audio. The call is a `<Connect><Stream>`, and TwiML's `<Play digits>` would mean
redirecting the call, which tears the stream down — the very thing we are in the middle of.

μ-law is encoded by hand rather than with `audioop`: that module is deprecated and was removed in
Python 3.13, and this image will be bumped one day. The algorithm is fixed by G.711 and fits in a
dozen lines, so carrying it is cheaper than carrying the removal risk.
"""

from __future__ import annotations

import base64
import math

SAMPLE_RATE = 8000  # Twilio media streams are 8 kHz μ-law, both directions
FRAME_MS = 20  # one Twilio media frame
FRAME_SAMPLES = SAMPLE_RATE * FRAME_MS // 1000  # 160

# Standard DTMF pairs (low Hz, high Hz).
_TONES: dict[str, tuple[int, int]] = {
    "1": (697, 1209), "2": (697, 1336), "3": (697, 1477), "A": (697, 1633),
    "4": (770, 1209), "5": (770, 1336), "6": (770, 1477), "B": (770, 1633),
    "7": (852, 1209), "8": (852, 1336), "9": (852, 1477), "C": (852, 1633),
    "*": (941, 1209), "0": (941, 1336), "#": (941, 1477), "D": (941, 1633),
}

_BIAS = 0x84
_CLIP = 32635


def linear_to_ulaw(sample: int) -> int:
    """One 16-bit signed PCM sample to one μ-law byte (G.711)."""
    sign = 0x80 if sample < 0 else 0x00
    if sample < 0:
        sample = -sample
    if sample > _CLIP:
        sample = _CLIP
    sample += _BIAS

    exponent = 7
    mask = 0x4000
    while exponent > 0 and not (sample & mask):
        exponent -= 1
        mask >>= 1

    mantissa = (sample >> (exponent + 3)) & 0x0F
    return ~(sign | (exponent << 4) | mantissa) & 0xFF


def tone_ulaw(digit: str, duration_ms: int = 200) -> bytes:
    """The digit as raw μ-law bytes.

    Each tone is at a quarter of full scale so the two summed sines cannot clip — a clipped DTMF
    tone gains harmonics and detectors reject it, which would look like the digit being ignored.
    """
    pair = _TONES.get(digit.upper())
    if pair is None:
        raise ValueError(f"{digit!r} is not a DTMF digit")
    low, high = pair
    amplitude = 8000  # ~1/4 of full scale each; summed peak stays well under 32767

    out = bytearray()
    for n in range(SAMPLE_RATE * duration_ms // 1000):
        t = n / SAMPLE_RATE
        sample = int(
            amplitude * math.sin(2 * math.pi * low * t)
            + amplitude * math.sin(2 * math.pi * high * t)
        )
        out.append(linear_to_ulaw(sample))
    return bytes(out)


def tone_frames(digit: str, duration_ms: int = 200) -> list[str]:
    """The digit as base64 20 ms frames, ready for Twilio `media` messages.

    Framed and sent at real time rather than as one blob: a DTMF detector expects the tone to
    arrive at the rate it would be spoken, and some reject a burst that lands all at once.
    """
    payload = tone_ulaw(digit, duration_ms)
    frames: list[str] = []
    for i in range(0, len(payload), FRAME_SAMPLES):
        chunk = payload[i : i + FRAME_SAMPLES]
        if len(chunk) < FRAME_SAMPLES:
            chunk = chunk + b"\xff" * (FRAME_SAMPLES - len(chunk))  # μ-law silence
        frames.append(base64.b64encode(chunk).decode("ascii"))
    return frames


__all__ = ["FRAME_MS", "SAMPLE_RATE", "linear_to_ulaw", "tone_frames", "tone_ulaw"]
