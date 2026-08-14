"""Bridge between Twilio's async answering-machine-detection callback and the live call.

Twilio posts the AMD result to the server's `/amd` endpoint mid-call (see telephony/server.py),
in the SAME process as the media-stream bridge. This tiny registry lets that callback hand the
result to the right in-flight call (keyed by Twilio CallSid) so the bridge can have the agent leave
a voicemail the instant a machine is detected — without polling and without delaying a live person.
"""

from __future__ import annotations

import asyncio

# CallSid -> a one-slot queue the bridge awaits for that call's AMD result.
_queues: dict[str, asyncio.Queue] = {}


def register(call_sid: str) -> asyncio.Queue:
    """Called by the bridge when a call starts. Returns a queue that will receive the AMD result
    (e.g. 'human', 'machine_end_beep') once Twilio decides."""
    queue: asyncio.Queue = asyncio.Queue(maxsize=1)
    if call_sid:
        _queues[call_sid] = queue
    return queue


def unregister(call_sid: str) -> None:
    """Called by the bridge when the call ends, so we don't leak entries."""
    _queues.pop(call_sid, None)


def deliver(call_sid: str, answered_by: str) -> None:
    """Called by the /amd webhook with Twilio's detection result for a call."""
    queue = _queues.get(call_sid)
    if queue is not None:
        try:
            queue.put_nowait(answered_by)
        except asyncio.QueueFull:
            pass  # already delivered a result for this call
