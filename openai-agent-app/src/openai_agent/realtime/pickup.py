"""How long a caller waited from ringing to hearing the agent — and the line they heard first.

WHY. Pickup is split across two places that never share a call object: the /incoming webhook
(which decides when Twilio answers) and the media-stream bridge (which plays the greeting). The
timeline is noted by CallSid in the first and taken by the second, which logs one line per call:

    pickup: greeting=disk held=memory hold=180ms answer->stream=640ms stream->first audio=12ms ...

`greeting` is where the bridge found the rendered opening ("memory", "disk", "waited" for a render
that landed just in time, "miss" — the model greets, ~2.5s — or "off"); `held` is what /incoming
found while the phone was still ringing ("timeout" if the business lookup itself ran out of time,
"none" if the number belongs to no business). Both processes are one uvicorn worker, so monotonic
times compare directly.

expected_opening lives here because /incoming, the warm-up pass and the bridge must all render
EXACTLY the same text — a greeting rendered from different words is a cache miss on every call.
"""

from __future__ import annotations

import time

from ..config import Config
from .composed import opening_line
from .instructions_inbound import spoken_greeting

# A call whose stream never opened (the caller hung up while it rang) leaves its notes behind.
_KEEP_SECONDS = 60.0
_pending: dict[str, dict] = {}


def expected_opening(cfg: Config, business) -> str:
    """The line the caller hears first: the dashboard's composed greeting where there is one."""
    if business.session:
        return opening_line(cfg, business)
    return spoken_greeting(
        greeting=business.greeting or cfg.greeting,
        business_name=business.business_name,
        agent_name=business.agent_name or cfg.agent_name,
        disclose_recording=cfg.disclose_recording,
    )


def note(call_sid: str, **fields: object) -> None:
    """Record timeline fields for a call that is still ringing."""
    if not call_sid:
        return
    now = time.monotonic()
    for sid in [s for s, t in _pending.items() if now - t.get("created", now) > _KEEP_SECONDS]:
        del _pending[sid]
    _pending.setdefault(call_sid, {"created": now}).update(fields)


def take(call_sid: str) -> dict:
    """Hand a call's timeline to its bridge. Empty for an outbound call or an unknown CallSid."""
    return _pending.pop(call_sid, {}) if call_sid else {}


def _is_time(value: object) -> bool:
    # An int is a time too (a caller or a test noting `incoming_at=0` must not read as "missing"),
    # but a bool is an int that was never a timestamp.
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _ms(later: object, earlier: object) -> str:
    if not _is_time(later) or not _is_time(earlier):
        return "?"
    return f"{(later - earlier) * 1000:.0f}ms"


def summary(t: dict) -> str:
    """One log line. ASCII only: it goes to docker logs and to a Windows console alike."""
    return (
        f"pickup: greeting={t.get('greeting_source', '?')} held={t.get('hold_source', '-')} "
        f"hold={_ms(t.get('twiml_at'), t.get('incoming_at'))} "
        f"answer->stream={_ms(t.get('stream_start_at'), t.get('twiml_at'))} "
        f"stream->first audio={_ms(t.get('first_audio_at'), t.get('stream_start_at'))} "
        f"stream->model audio={_ms(t.get('model_first_audio_at'), t.get('stream_start_at'))}"
    )


__all__ = ["expected_opening", "note", "summary", "take"]
