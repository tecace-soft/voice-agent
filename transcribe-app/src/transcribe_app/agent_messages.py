"""Messages the voice agent took, written into the same sheet the voicemails go to.

A caller who wanted an appointment and could not be put through to a person is, from the front
desk's point of view, exactly the same job as a voicemail: someone rang, here is who they are and
what they want, please call them back. So the rows go in the same columns, in the same shapes,
and whoever works the sheet does not have to learn a second format.

WHY THIS LIVES HERE AND NOT IN THE AGENT. All the hard-won sheet logic is in tools/sheets.py —
matching a tab by name, mapping columns by heading rather than position, filling gaps instead of
appending past stray data, inserting before the client's own end section. Writing these rows from
the agent would mean a second implementation of all of that, in another language, drifting from
this one. Instead the agent records the message through the backend, and this pulls it.

WHICH SHEET IT WRITES TO is decided entirely by the config it is handed. Run it with the test
environment and it can only reach the test sheet; there is no client sheet id anywhere in this
module. That is deliberate — the separation is structural rather than a flag someone can forget.
"""

from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from .callerid import normalize_phone
from .config import Config

log = logging.getLogger(__name__)

_TIMEOUT = 30


@dataclass(frozen=True)
class AgentMessage:
    """One message the assistant took, as the backend hands it over."""

    id: str
    started_at: str
    caller_name: str
    phone: str
    requested_time: str
    callback_requested: bool
    # What the caller wants, in the words the assistant took down. This is the Summary column: it
    # is the same thing a voicemail's summary is — what this call is ABOUT — and it is the only
    # part a person needs to read before picking up the phone.
    request: str
    # What the call RESULTED in ("Took a message for the team."). Useful context, useless as a
    # summary: the row existing already says a message was taken. Kept only as a fallback for the
    # rare row that somehow has no request.
    outcome_summary: str
    transcript: str


def _request(cfg: Config, path: str, *, method: str = "GET") -> dict:
    req = urllib.request.Request(
        f"{cfg.backend_url.rstrip('/')}{path}",
        method=method,
        headers={"x-agent-key": cfg.agent_key, "accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=_TIMEOUT) as resp:
        body = resp.read().decode("utf-8") or "{}"
    return json.loads(body)


def _spoken_transcript(turns: list[dict]) -> str:
    """The conversation as one readable block, in the same spirit as a voicemail transcript.

    "Caller" and "Assistant" rather than the internal speaker names: the person reading this sheet
    is looking at a phone call, not at our plumbing.
    """
    lines = []
    for turn in turns or []:
        if not isinstance(turn, dict):
            continue
        text = str(turn.get("text") or "").strip()
        if not text:
            continue
        who = "Assistant" if turn.get("speaker") == "agent" else "Caller"
        lines.append(f"{who}: {text}")
    return "\n".join(lines)


def _received(started_at: str, tz: str) -> str:
    """The call's start time in local wall-clock, matching timefmt.format_received's shape.

    Not that function itself: it parses an email Date header, and this is ISO 8601 from the
    backend. Same output format, because both end up in the same column.
    """
    try:
        started = datetime.fromisoformat(started_at.replace("Z", "+00:00"))
    except (AttributeError, ValueError):
        started = datetime.now(timezone.utc)
    if started.tzinfo is None:
        started = started.replace(tzinfo=timezone.utc)
    return started.astimezone(ZoneInfo(tz)).strftime("%Y-%m-%d %H:%M:%S")


def fetch_pending(cfg: Config) -> list[AgentMessage]:
    """Messages that still owe a row. Empty on any failure — this is not worth waking anyone for."""
    if not cfg.backend_url or not cfg.agent_key:
        log.warning("no BACKEND_URL / AGENT_CONFIG_KEY set — nothing to pull")
        return []
    try:
        data = _request(cfg, "/calls/awaiting-sheet")
    except (urllib.error.URLError, ValueError, TimeoutError) as exc:
        log.warning("could not fetch messages awaiting a row: %s", exc)
        return []

    out: list[AgentMessage] = []
    for call in data.get("calls") or []:
        out.append(
            AgentMessage(
                id=str(call.get("id") or ""),
                started_at=str(call.get("startedAt") or ""),
                caller_name=str(call.get("callerName") or ""),
                # The number to ring back on, which is what this column is for. The confirmed
                # callback wins over the network's caller ID: the agent read it back to them.
                phone=normalize_phone(
                    str(call.get("callbackNumber") or call.get("caller") or "")
                ),
                requested_time=str(call.get("requestedTime") or ""),
                callback_requested=bool(call.get("callbackRequested")),
                request=str(call.get("request") or ""),
                outcome_summary=str(call.get("summary") or ""),
                transcript=_spoken_transcript(call.get("turns") or []),
            )
        )
    return out


def build_row(msg: AgentMessage, tz: str = "America/Los_Angeles") -> list[str]:
    """One spreadsheet row — column order must match sheets.HEADER.

    "Audio file" and "Open email" are blank on purpose. There is no recording and no email: the
    assistant answered live and the words are already in the Transcript column. Writing something
    like "n/a" would put noise in a client's spreadsheet to describe an absence they can already
    see.
    """
    return [
        _received(msg.started_at, tz),
        msg.caller_name,
        msg.phone,
        msg.requested_time,
        "yes" if msg.callback_requested else "no",
        # The Summary column means "what is this call about", because that is what it means for a
        # voicemail and the same person reads both. An outcome label belongs in neither.
        msg.request.strip() or msg.outcome_summary,
        msg.transcript,
        "",
        "",
    ]


def mark_written(cfg: Config, message_id: str) -> bool:
    """Tell the backend the row exists, so the next run does not write it again."""
    try:
        _request(cfg, f"/calls/{message_id}/sheet-written", method="POST")
        return True
    except (urllib.error.URLError, ValueError, TimeoutError) as exc:
        # The row IS written. Failing to say so means a duplicate next run, which someone can
        # delete; not writing it at all would mean a caller never gets rung back. Loud, not fatal.
        log.warning("wrote the row for %s but could not mark it written: %s", message_id, exc)
        return False
