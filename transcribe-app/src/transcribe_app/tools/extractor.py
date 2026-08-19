"""Transcribe a voicemail and pull its important fields — one Google Gemini call, audio in.

Gemini is multimodal, so the `.wav` goes straight in and both the verbatim transcript and the
structured fields come back together. We use Gemini's structured output (a response schema the
model must satisfy) so every row has the same, parseable shape, and put `transcript` first in
the schema so the model writes the transcript before reading fields off it.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass

from google import genai
from google.genai import types

from ..config import Config
from .email_source import WavAttachment

log = logging.getLogger(__name__)

# Response schema (Gemini's OpenAPI-3.0 subset — not full JSON Schema). Fields that may be absent
# from a given voicemail are marked `nullable` so the model returns null instead of guessing,
# rather than JSON Schema's ["string", "null"] union (which this subset doesn't accept).
# `propertyOrdering` fixes the output order — transcript first, so the model transcribes the audio
# before extracting details from it.
_SCHEMA = {
    "type": "object",
    "properties": {
        "transcript": {
            "type": "string",
            "description": "The full, verbatim transcript of everything the caller said in the voicemail.",
        },
        "caller_name": {"type": "string", "nullable": True, "description": "The caller's name if stated."},
        "phone_number": {
            "type": "string",
            "nullable": True,
            "description": "A callback phone number the caller gives, digits as spoken.",
        },
        "email": {"type": "string", "nullable": True, "description": "An email address if the caller gives one."},
        "requested_time": {
            "type": "string",
            "nullable": True,
            "description": "The day/time the caller wants their appointment or callback, in their own words (e.g. 'Saturday afternoon', 'tomorrow at 2').",
        },
        "callback_requested": {
            "type": "boolean",
            "description": "True if the caller asked to be called back.",
        },
        "summary": {
            "type": "string",
            "description": "One sentence capturing what the caller wants.",
        },
    },
    "required": [
        "transcript", "caller_name", "phone_number", "email", "requested_time",
        "callback_requested", "summary",
    ],
    "propertyOrdering": [
        "transcript", "caller_name", "phone_number", "email", "requested_time",
        "callback_requested", "summary",
    ],
}

_SYSTEM = (
    "You are given a voicemail recording a caller left for a business — they may be asking to "
    "book an appointment, requesting a callback, or leaving a question. First transcribe the "
    "audio verbatim into `transcript`, then fill in the other fields using only what the caller "
    "actually said — use null for anything not mentioned. Do not invent details."
)


@dataclass(frozen=True)
class VoicemailInfo:
    caller_name: str | None
    phone_number: str | None
    email: str | None
    requested_time: str | None
    callback_requested: bool
    summary: str
    # The verbatim transcript Gemini produced from the audio (stored in its own sheet column).
    transcript: str = ""

    @classmethod
    def from_dict(cls, d: dict) -> VoicemailInfo:
        return cls(
            caller_name=d.get("caller_name"),
            phone_number=d.get("phone_number"),
            email=d.get("email"),
            requested_time=d.get("requested_time"),
            callback_requested=bool(d.get("callback_requested", False)),
            summary=str(d.get("summary") or ""),
            transcript=str(d.get("transcript") or ""),
        )


class Extractor:
    def __init__(self, cfg: Config) -> None:
        self._cfg = cfg
        self._client: genai.Client | None = None

    def _gemini(self) -> genai.Client:
        if self._client is None:
            self._client = genai.Client(api_key=self._cfg.gemini_api_key)
        return self._client

    def extract(self, attachment: WavAttachment) -> VoicemailInfo:
        """Transcribe and extract one voicemail in a single Gemini call: the audio goes in, a
        transcript plus the structured fields come back. Empty audio short-circuits to an empty
        record so we don't spend a model call on nothing."""
        if not attachment.data:
            return VoicemailInfo(None, None, None, None, False, "")
        audio = types.Part.from_bytes(data=attachment.data, mime_type="audio/wav")
        response = self._gemini().models.generate_content(
            model=self._cfg.extract_model,
            contents=[audio],
            config=types.GenerateContentConfig(
                system_instruction=_SYSTEM,
                temperature=0,
                # Room for the full transcript plus the fields.
                max_output_tokens=2048,
                # Transcription + copying stated facts needs no deliberation — disable Gemini's
                # "thinking" to keep it fast and cheap.
                thinking_config=types.ThinkingConfig(thinking_budget=0),
                # Constrain the output to our schema so the first (only) part is parseable JSON.
                response_mime_type="application/json",
                response_schema=_SCHEMA,
            ),
        )
        # If Gemini blocked the response (e.g. a safety filter), `.text` is empty/raises — record
        # an empty row (still traceable by sender + filename) rather than dropping the voicemail.
        try:
            text = response.text
        except Exception:  # noqa: BLE001 — any access failure means "no usable content"
            text = None
        if not text:
            log.warning("extraction returned no content (blocked or empty); storing empty row")
            return VoicemailInfo(None, None, None, None, False, "")
        return VoicemailInfo.from_dict(json.loads(text))
