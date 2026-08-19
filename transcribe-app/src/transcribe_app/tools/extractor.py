"""Pull the important fields out of a voicemail transcript with Claude.

The transcript is free-form speech ("Hi, this is Jane, 555-0142, I'd love to come in Saturday
afternoon..."); this turns it into structured fields for the spreadsheet. We use structured
outputs (a JSON schema the model must satisfy) so every row has the same, parseable shape.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass

import anthropic

from ..config import Config

log = logging.getLogger(__name__)

# Structured-outputs schema. Every field is required (structured outputs needs `required` +
# additionalProperties:false); fields that may be absent from a given voicemail are made
# nullable with a ["string", "null"] type so the model can return null instead of guessing.
_SCHEMA = {
    "type": "object",
    "properties": {
        "caller_name": {"type": ["string", "null"], "description": "The caller's name if stated."},
        "phone_number": {
            "type": ["string", "null"],
            "description": "A callback phone number the caller gives, digits as spoken.",
        },
        "email": {"type": ["string", "null"], "description": "An email address if the caller gives one."},
        "requested_time": {
            "type": ["string", "null"],
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
    "required": ["caller_name", "phone_number", "email", "requested_time", "callback_requested", "summary"],
    "additionalProperties": False,
}

_SYSTEM = (
    "You extract structured details from a voicemail a caller left for a business — they may be "
    "asking to book an appointment, requesting a callback, or leaving a question. Read the "
    "transcript and fill in only what the caller actually said — use null for anything not "
    "mentioned. Do not invent details."
)


@dataclass(frozen=True)
class VoicemailInfo:
    caller_name: str | None
    phone_number: str | None
    email: str | None
    requested_time: str | None
    callback_requested: bool
    summary: str

    @classmethod
    def from_dict(cls, d: dict) -> VoicemailInfo:
        return cls(
            caller_name=d.get("caller_name"),
            phone_number=d.get("phone_number"),
            email=d.get("email"),
            requested_time=d.get("requested_time"),
            callback_requested=bool(d.get("callback_requested", False)),
            summary=str(d.get("summary") or ""),
        )


class Extractor:
    def __init__(self, cfg: Config) -> None:
        self._cfg = cfg
        self._client: anthropic.Anthropic | None = None

    def _anthropic(self) -> anthropic.Anthropic:
        if self._client is None:
            self._client = anthropic.Anthropic(api_key=self._cfg.anthropic_api_key)
        return self._client

    def extract(self, transcript: str) -> VoicemailInfo:
        """Extract fields from one transcript. An empty transcript short-circuits to an empty
        record so we don't spend a model call on silence."""
        if not transcript.strip():
            return VoicemailInfo(None, None, None, None, False, "")
        response = self._anthropic().messages.create(
            model=self._cfg.extract_model,
            max_tokens=1024,
            system=_SYSTEM,
            # Extraction is a simple, well-specified task — low effort keeps it fast and cheap.
            output_config={
                "effort": "low",
                "format": {"type": "json_schema", "schema": _SCHEMA},
            },
            messages=[{"role": "user", "content": f"Voicemail transcript:\n\n{transcript}"}],
        )
        if response.stop_reason == "refusal":
            log.warning("extraction refused; storing summary only")
            return VoicemailInfo(None, None, None, None, False, transcript[:200])
        # With output_config.format the first text block is guaranteed valid JSON for our schema.
        text = next((b.text for b in response.content if b.type == "text"), "")
        return VoicemailInfo.from_dict(json.loads(text))
