"""ElevenLabs text-to-speech — gives the intake agent its spoken voice.

The agent produces text (greeting / agent_message); this turns that text into
audio in the configured voice. Uses the ElevenLabs REST API directly over
urllib, matching the lightweight approach in hermes.py — no extra dependency.
"""

from __future__ import annotations

import io
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
import wave
from pathlib import Path

from ..config import Config

_API_ROOT = "https://api.elevenlabs.io/v1"
# 44.1 kHz / 128 kbps mp3 — a good default for saving speech to a file.
_OUTPUT_FORMAT = "mp3_44100_128"
# Raw 16-bit mono PCM for inline playback. 24 kHz is the highest the free tier
# allows (pcm_44100 needs a paid plan); it's plenty for speech.
_PCM_SAMPLE_RATE = 24000


class VoiceError(RuntimeError):
    """Synthesis failed or the voice/key is not usable."""


class ElevenLabsVoice:
    """Text-to-speech in a single configured voice."""

    def __init__(self, cfg: Config) -> None:
        self._cfg = cfg
        self._api_key = cfg.elevenlabs_api_key
        self._voice_id = cfg.elevenlabs_voice_id
        self._model_id = cfg.elevenlabs_model_id

    # -- transport -------------------------------------------------------

    def _request(self, url: str, *, method: str = "GET", body: dict | None = None,
                 accept: str = "application/json") -> tuple[int, str, bytes]:
        data = json.dumps(body).encode() if body is not None else None
        headers = {"xi-api-key": self._api_key, "Accept": accept}
        if data is not None:
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(url, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=self._cfg.request_timeout) as response:
                return response.status, response.headers.get("content-type", ""), response.read()
        except urllib.error.HTTPError as exc:
            return exc.code, exc.headers.get("content-type", ""), exc.read()

    @staticmethod
    def _error_detail(body: bytes) -> str:
        try:
            payload = json.loads(body)
            detail = payload.get("detail", payload)
            if isinstance(detail, dict):
                return detail.get("message") or json.dumps(detail)
            return str(detail)
        except Exception:
            return body[:200].decode("utf-8", "replace")

    # -- public API ------------------------------------------------------

    def voice_info(self) -> dict:
        """Validate the key + voice id; return the voice's name and category."""
        status, _ctype, body = self._request(f"{_API_ROOT}/voices/{self._voice_id}")
        if status == 401:
            raise VoiceError("ELEVENLABS_API_KEY rejected (401). Check the key.")
        if status == 404:
            raise VoiceError(f"voice id {self._voice_id!r} not found (404). Check ELEVENLABS_VOICE_ID.")
        if status >= 400:
            raise VoiceError(f"voice lookup failed [{status}]: {self._error_detail(body)}")
        data = json.loads(body)
        return {"name": data.get("name", ""), "category": data.get("category", "")}

    def synthesize(
        self,
        text: str,
        *,
        output_format: str = _OUTPUT_FORMAT,
        optimize_latency: int | None = None,
    ) -> bytes:
        """Return spoken-audio mp3 bytes for `text`.

        For phone calls, a smaller format (e.g. mp3_22050_32) plus
        `optimize_latency` cuts synthesis + download time with no audible loss
        over an 8 kHz line.
        """
        if not text.strip():
            raise VoiceError("nothing to synthesize (empty text)")
        params: dict[str, object] = {"output_format": output_format}
        if optimize_latency is not None:
            params["optimize_streaming_latency"] = optimize_latency
        url = f"{_API_ROOT}/text-to-speech/{self._voice_id}?{urllib.parse.urlencode(params)}"
        status, ctype, body = self._request(
            url,
            method="POST",
            body={"text": text, "model_id": self._model_id},
            accept="audio/mpeg",
        )
        if status >= 400:
            raise VoiceError(f"synthesis failed [{status}]: {self._error_detail(body)}")
        if "audio" not in ctype:
            raise VoiceError(f"expected audio, got {ctype or 'unknown type'}: {self._error_detail(body)}")
        return body

    def save(self, text: str, path: str | Path) -> Path:
        """Synthesize `text` and write the mp3 to `path`. Returns the path."""
        out = Path(path)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(self.synthesize(text))
        return out

    def synthesize_pcm(self, text: str, sample_rate: int = _PCM_SAMPLE_RATE) -> bytes:
        """Return raw 16-bit mono PCM audio for `text` (for inline playback)."""
        if not text.strip():
            raise VoiceError("nothing to synthesize (empty text)")
        query = urllib.parse.urlencode({"output_format": f"pcm_{sample_rate}"})
        url = f"{_API_ROOT}/text-to-speech/{self._voice_id}?{query}"
        status, ctype, body = self._request(
            url,
            method="POST",
            body={"text": text, "model_id": self._model_id},
            accept="audio/pcm",
        )
        if status >= 400:
            raise VoiceError(f"synthesis failed [{status}]: {self._error_detail(body)}")
        return body

    def speak(self, text: str, sample_rate: int = _PCM_SAMPLE_RATE) -> None:
        """Synthesize `text` and play it through the default audio device.

        Blocks until playback finishes. No file is written and no external
        player window opens — the audio just comes out of the speakers.
        """
        pcm = self.synthesize_pcm(text, sample_rate)
        wav = _pcm_to_wav(pcm, sample_rate)
        _play_wav_bytes(wav)


def _pcm_to_wav(pcm: bytes, sample_rate: int) -> bytes:
    """Wrap raw 16-bit mono PCM in a WAV container in memory."""
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)  # 16-bit
        wav.setframerate(sample_rate)
        wav.writeframes(pcm)
    return buffer.getvalue()


def _play_wav_bytes(wav: bytes) -> None:
    """Play WAV bytes on the default device, blocking until done."""
    if sys.platform == "win32":
        import winsound

        winsound.PlaySound(wav, winsound.SND_MEMORY)  # synchronous by default
        return
    # macOS / Linux: hand a temp file to the system player.
    import subprocess
    import tempfile

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as handle:
        handle.write(wav)
        path = handle.name
    player = ["afplay", path] if sys.platform == "darwin" else ["aplay", "-q", path]
    try:
        subprocess.run(player, check=False)
    except FileNotFoundError as exc:
        raise VoiceError(f"no audio player found ({player[0]}): {exc}") from exc
