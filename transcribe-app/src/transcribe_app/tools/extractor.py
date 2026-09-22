"""Transcribe a voicemail and pull its important fields — one Google Gemini call, audio in.

Gemini is multimodal, so the recording (any supported audio format) goes straight in and both
the verbatim transcript and the structured fields come back together. We use Gemini's structured
output (a response schema the model must satisfy) so every row has the same, parseable shape,
and put `transcript` first in the schema so the model writes the transcript before reading
fields off it.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass

from google import genai
from google.genai import types

from ..config import Config
from .email_source import AudioAttachment

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
            "description": "A callback phone number the caller gives, as digits only, e.g. 2069298767. Omit any words.",
        },
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
        "transcript", "caller_name", "phone_number", "requested_time",
        "callback_requested", "summary",
    ],
    "propertyOrdering": [
        "transcript", "caller_name", "phone_number", "requested_time",
        "callback_requested", "summary",
    ],
}

# How much room the model gets for its answer. The transcript is the whole of it in practice —
# the five other fields are a line each — and 2048 was not enough: that is roughly 1,200 English
# words, and Korean or mixed-language speech tokenises several times denser, so a couple of minutes
# of it runs out of room mid-sentence. The model stops where it stops and the JSON never closes,
# which surfaces as an unterminated-string parse error that names nothing useful. The model's own
# ceiling is far higher than this; 8192 is headroom for a real voicemail while still being a stop
# on a model that has started repeating itself on low-information audio.
_MAX_OUTPUT_TOKENS = 8192

_SYSTEM = (
    "You are given a voicemail recording a caller left for a business — they may be asking to "
    "book an appointment, requesting a callback, or leaving a question. First transcribe the "
    "audio verbatim into `transcript`, then fill in the other fields using only what the caller "
    "actually said — use null for anything not mentioned. Do not invent details. "
    "Some recordings are only a few seconds of hesitation, background noise or silence. If there "
    "is nothing intelligible to transcribe, write the little you can hear, mark the rest "
    "[unintelligible], and stop. Never repeat a word or phrase over and over: if you find "
    "yourself repeating, the recording has nothing further in it and the transcript is finished."
)

# Greedy decoding transcribes most accurately, so it goes first. It is also what makes a repetition
# loop inescapable: at temperature 0 the next token is always the same one, so a model that has
# begun saying "uh, uh, uh" can never stop, and it says it until the output ceiling. A warmer
# second pass breaks the tie. Two attempts and no more — a third only spends money on a recording
# that has nothing in it.
_TEMPERATURES = (0.0, 0.4)

# What goes in the Summary column when neither pass produced usable text. Whoever works the sheet
# needs to know the recording exists and that a machine could not read it, rather than wonder why
# a row is blank. The caller's number and the link to the email are on the row either way, so the
# voicemail can still be listened to and returned.
_UNTRANSCRIBABLE = "Could not be transcribed automatically — open the email to listen."


def _hit_token_ceiling(response) -> bool:
    """True when the model stopped because it ran out of output budget, not because it was done.

    Read by name rather than compared against an imported enum member: the SDK has moved these
    around between versions, and a missing attribute here must not become a second failure on top
    of the one we are trying to explain.
    """
    try:
        reason = response.candidates[0].finish_reason
    except (AttributeError, IndexError, TypeError):
        return False
    return "MAX_TOKENS" in str(getattr(reason, "name", reason) or "")


def _truncation_report(response, attachment, text: str) -> str:
    """What the model actually produced, for the log, when it ran out of room.

    A transcript that runs to the ceiling is one of two things, and they need opposite fixes:
    a genuinely long recording, or a model repeating itself on audio with nothing in it. The
    head and the tail of the output tell them apart at a glance — a loop reads the same in
    both, a real transcript has moved on. The audio size settles it either way: voicemail audio
    runs a few KB a second, so a small file that produced thousands of tokens can only be a
    loop. One line, because this is read in a journal alongside everything else.
    """
    usage = getattr(response, "usage_metadata", None)
    flat = " ".join(text.split())
    return (
        f"{len(attachment.data)} bytes of {attachment.content_type}, "
        f"{getattr(usage, 'candidates_token_count', None)} tokens out "
        f"of {getattr(usage, 'prompt_token_count', None)} in"
        f" | STARTS: {flat[:200]}"
        f" | ENDS: {flat[-200:]}"
    )


def _empty(summary: str = "") -> VoicemailInfo:
    """A record with no model output in it, still traceable by caller ID, filename and email link.

    Keyword arguments on purpose: the positional form of this was passing one argument too many,
    which landed the boolean False in the Summary column of every blocked voicemail.
    """
    return VoicemailInfo(
        caller_name=None, phone_number=None, requested_time=None,
        callback_requested=False, summary=summary, transcript="",
    )


@dataclass(frozen=True)
class VoicemailInfo:
    caller_name: str | None
    phone_number: str | None
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
            # Bound each request so a stalled API call can't hang the run forever (ms). Generous,
            # since transcribing a longer voicemail legitimately takes a few seconds.
            timeout_ms = int(max(self._cfg.request_timeout, 120) * 1000)
            self._client = genai.Client(
                api_key=self._cfg.gemini_api_key,
                http_options=types.HttpOptions(timeout=timeout_ms),
            )
        return self._client

    def _generate(self, audio, temperature: float):
        """One call. Split out so the retry differs in exactly one argument and nothing else."""
        return self._gemini().models.generate_content(
            model=self._cfg.extract_model,
            contents=[audio],
            config=types.GenerateContentConfig(
                system_instruction=_SYSTEM,
                temperature=temperature,
                # Room for the full transcript plus the fields, and a stop on a runaway.
                max_output_tokens=_MAX_OUTPUT_TOKENS,
                # Transcription + copying stated facts needs no deliberation — disable Gemini's
                # "thinking" to keep it fast and cheap.
                thinking_config=types.ThinkingConfig(thinking_budget=0),
                # Constrain the output to our schema so the first (only) part is parseable JSON.
                response_mime_type="application/json",
                response_schema=_SCHEMA,
            ),
        )

    def extract(self, attachment: AudioAttachment) -> VoicemailInfo:
        """Transcribe and extract one voicemail: the audio goes in, a transcript plus the
        structured fields come back. Empty audio short-circuits to an empty record so we don't
        spend a model call on nothing.

        Normally this is one call. A second happens only when the first ran to the output ceiling,
        which on a short recording means the model got stuck repeating itself rather than that it
        had that much to say.
        """
        if not attachment.data:
            return _empty()
        log.info(
            "transcribing %s (%d bytes) with %s ...",
            attachment.filename, len(attachment.data), self._cfg.extract_model,
        )
        audio = types.Part.from_bytes(data=attachment.data, mime_type=attachment.content_type)

        for temperature in _TEMPERATURES:
            response = self._generate(audio, temperature)
            # If Gemini blocked the response (e.g. a safety filter), `.text` is empty/raises —
            # record an empty row (still traceable by sender + filename) rather than dropping the
            # voicemail. A different temperature would not unblock it, so this returns rather than
            # spending the second attempt.
            try:
                text = response.text
            except Exception:  # noqa: BLE001 — any access failure means "no usable content"
                text = None
            if not text:
                log.warning("extraction returned no content (blocked or empty); storing empty row")
                return _empty()
            # A response that ran out of room is still returned, just not finished: the JSON stops
            # mid-transcript with the string still open, and parsing it reports an unterminated
            # string at a character offset that explains nothing. Name it, and try once more.
            if not _hit_token_ceiling(response):
                return VoicemailInfo.from_dict(json.loads(text))
            log.warning(
                "output ran to the ceiling on %s at temperature %s — %s",
                attachment.filename, temperature,
                _truncation_report(response, attachment, text),
            )

        # Both passes ran away, so this recording has nothing a model can read. Write the row and
        # let it go: raising here would leave the voicemail unprocessed, and the poller would send
        # the same few seconds of noise to Gemini every quarter of an hour for ever. A row with the
        # caller's number, the filename and the link to the email is something a person can act on;
        # a voicemail that never appears is not.
        log.error(
            "could not transcribe %s after %d attempts — writing a row that says so",
            attachment.filename, len(_TEMPERATURES),
        )
        return _empty(_UNTRANSCRIBABLE)
