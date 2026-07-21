"""Gemini 2.5 Flash Lite helpers used by the intake agent.

We drive the conversation (see agent.py) and lean on Gemini for the cheap,
deterministic language work: pulling structured fields out of free-form speech,
bucketing text into a fixed label set, and phrasing the next question. The
structured calls run at temperature 0 with a response schema so their output is
parseable JSON rather than prose.
"""

from __future__ import annotations

import json
from typing import Any

from google import genai
from google.genai import types

from ..config import Config

_EXTRACT_SYSTEM = (
    "You extract structured data from transcribed speech. Transcripts are messy: "
    "filler words, self-corrections, and misheard words are normal. When a caller "
    "corrects themselves, keep the corrected value. Never invent a value — if a "
    "field was not stated, return null for it."
)


class GeminiTools:
    def __init__(self, cfg: Config) -> None:
        self._client = genai.Client(api_key=cfg.gemini_api_key)
        self._model = cfg.gemini_model

    def extract_fields(self, transcript: str, fields: list[dict[str, Any]]) -> dict[str, Any]:
        """Pull the requested fields out of a transcript.

        `fields` is a list of {"name": str, "description": str}. Returns
        {"values": {...}, "missing": [...]} where `missing` names the fields the
        caller has not given yet, so Hermes knows what still to ask for.
        """
        if not fields:
            return {"values": {}, "missing": []}

        schema = types.Schema(
            type=types.Type.OBJECT,
            properties={
                f["name"]: types.Schema(
                    type=types.Type.STRING,
                    nullable=True,
                    description=f.get("description", ""),
                )
                for f in fields
            },
        )

        response = self._client.models.generate_content(
            model=self._model,
            contents=f"Transcript:\n{transcript}",
            config=types.GenerateContentConfig(
                system_instruction=_EXTRACT_SYSTEM,
                response_mime_type="application/json",
                response_schema=schema,
                temperature=0,
            ),
        )

        values = _parse_json_object(response.text)
        return {
            "values": {k: v for k, v in values.items() if v is not None},
            "missing": [f["name"] for f in fields if not values.get(f["name"])],
        }

    def classify(self, text: str, labels: list[str]) -> dict[str, Any]:
        """Assign `text` exactly one of `labels`, with a short justification."""
        if not labels:
            raise ValueError("classify requires at least one label")

        schema = types.Schema(
            type=types.Type.OBJECT,
            properties={
                "label": types.Schema(type=types.Type.STRING, enum=labels),
                "reason": types.Schema(type=types.Type.STRING),
            },
            required=["label", "reason"],
        )

        response = self._client.models.generate_content(
            model=self._model,
            contents=f"Text:\n{text}\n\nChoose the single best label from: {', '.join(labels)}",
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=schema,
                temperature=0,
            ),
        )
        return _parse_json_object(response.text)

    def generate(self, system: str, user: str, *, temperature: float = 0.4) -> str:
        """Free-text generation — used to phrase the next spoken question."""
        response = self._client.models.generate_content(
            model=self._model,
            contents=user,
            config=types.GenerateContentConfig(
                system_instruction=system,
                temperature=temperature,
            ),
        )
        return (response.text or "").strip()


def _parse_json_object(raw: str | None) -> dict[str, Any]:
    """Gemini can return None when a response is blocked by a safety filter."""
    if not raw:
        raise RuntimeError("Gemini returned an empty response (possibly filtered)")
    parsed = json.loads(raw)
    if not isinstance(parsed, dict):
        raise RuntimeError(f"Gemini returned {type(parsed).__name__}, expected a JSON object")
    return parsed
