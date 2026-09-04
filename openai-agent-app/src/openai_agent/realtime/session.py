"""Build the `session.update` payload that configures an OpenAI Realtime session.

Audio in and out are G.711 μ-law (`audio/pcmu`) — the codec Twilio Media Streams uses — so the
bridge forwards audio bytes straight through with no resampling. Turn-taking is server-side VAD,
so the model decides when the lead has finished and responds. Tools are the shared backend
functions from tools.py.
"""

from __future__ import annotations

from ..config import Config
from ..tools.agent_tools import TOOL_SCHEMAS


def _transcription_prompt(terms: list[str] | None) -> str:
    """Bias the transcriber toward names it will otherwise mangle.

    The transcription pass hears 8kHz phone audio with no idea what the business is called, so a
    company name gets rewritten into whatever common words it sounds like — "TecAce" comes back as
    "that case", and the saved transcript reads as though the caller asked about something else
    entirely. The model driving the conversation is unaffected (it works from the audio and answers
    correctly); it is only the written record that goes wrong, which is precisely the record the
    customer reads afterwards.

    Naming the handful of proper nouns a call will actually contain fixes this. Only names go in —
    a prompt describing the conversation would invite the transcriber to write down what it expects
    to hear rather than what was said, which is the failure we are trying to remove.
    """
    named = list(dict.fromkeys(t.strip() for t in (terms or []) if t and t.strip()))
    if not named:
        return ""
    return "The speakers may say these names: " + ", ".join(named) + "."


def build_session_update(
    cfg: Config,
    instructions: str,
    tools: list[dict] | None = None,
    vocabulary: list[str] | None = None,
    force_server_vad: bool = False,
) -> dict:
    """Build the session config. `tools` defaults to the outbound set, so the outbound call path
    behaves exactly as it did before inbound screening existed; the inbound bridge passes its own
    (INBOUND_TOOL_SCHEMAS). `vocabulary` names this call's proper nouns for the transcriber."""
    # Loudness cannot separate the caller from the people around them — a speakerphone in an open
    # office delivers both at similar volume, and raising the threshold far enough to exclude the
    # room starts excluding quiet callers too. semantic_vad judges whether the speech is aimed at
    # the assistant, which is the actual question. `force_server_vad` is the runtime fallback for a
    # model that rejects it (see the bridge) — never a silent default.
    if cfg.vad_type == "semantic_vad" and not force_server_vad:
        turn_detection: dict = {"type": "semantic_vad", "eagerness": cfg.vad_eagerness}
    else:
        turn_detection = {
            "type": "server_vad",
            "threshold": cfg.vad_threshold,
            "prefix_padding_ms": cfg.vad_prefix_padding_ms,
            "silence_duration_ms": cfg.vad_silence_ms,
        }

    transcription: dict = {"model": cfg.openai_transcribe_model}
    prompt = _transcription_prompt(vocabulary)
    if prompt:
        transcription["prompt"] = prompt
    # `language` is deliberately NOT set: the agent works out the caller's language from how they
    # answer the phone, and pinning the transcriber to English would corrupt every call that isn't.
    return {
        "type": "session.update",
        "session": {
            "type": "realtime",
            "model": cfg.openai_model,
            "output_modalities": ["audio"],
            "audio": {
                "input": {
                    "format": {"type": "audio/pcmu"},
                    "turn_detection": turn_detection,
                    # Transcribe the lead's speech too, so the bridge can log/track both sides of
                    # the conversation (the agent's side is transcribed automatically).
                    "transcription": transcription,
                },
                "output": {
                    "format": {"type": "audio/pcmu"},
                    "voice": cfg.openai_voice,
                },
            },
            "instructions": instructions,
            "tools": TOOL_SCHEMAS if tools is None else tools,
            "tool_choice": "auto",
        },
    }
