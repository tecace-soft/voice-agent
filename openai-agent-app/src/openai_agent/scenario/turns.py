"""When the scripted customer speaks, and when a run is over. Pure: no sockets, no clock of its own.

GPT-Live streams output audio continuously, silence included, so "the agent is talking" is decided
from the samples (audio.has_sound) and fed in here as agent_sound(now).

A line counts as answered only by sound the agent makes after the line ended AND after the backend's
latest delegation ended. The sound from before a delegation ("let me check") is not the answer: the
voice model speaks the backend's result some 0.5-2 s after the backend's response.completed, and the
customer must not talk over it.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

QUIET_SECONDS = 1.2      # the agent silent this long = its turn is over
GREETING_WAIT = 10.0     # speak the first line anyway if the agent never greets
ANSWER_WAIT = 10.0       # an unanswered line: move on after this long (from the line's end or the latest delegation's end)
DONE_SILENCE = 8.0       # after the last line, this much quiet ends the run (the customer hangs up)
LAST_LINE_MAX = 25.0     # after the last line ends, the run closes at the latest this long after
FAREWELL_MAX = 8.0       # after end_call, close at the latest this long after
FAREWELL_RECENT = 2.0    # sound this recent when end_call arrives = the goodbye was said before it
DELEGATION_STALL = 15.0  # a delegation (or an owed tool output) older than this no longer holds the customer back
TRANSCRIPT_GAP_MS = 1200  # a pause this long between the agent's deltas starts a new transcript entry

Action = Literal["wait", "speak", "close", "time_limit", "turn_limit"]


@dataclass
class TurnPolicy:
    lines: int
    max_seconds: float
    max_turns: int  # per exchange: agent turns since the customer's latest line
    started: float = 0.0
    next_line: int = 0
    speaking_until: float = 0.0
    agent_loud_at: float | None = None
    agent_turns: int = 0
    in_agent_turn: bool = False
    delegating: bool = False
    delegating_since: float | None = None
    delegation_ended_at: float = 0.0
    tool_pending: bool = False
    tool_pending_since: float | None = None
    ending_since: float | None = None
    goodbye_before_end: bool = False

    def agent_sound(self, now: float) -> None:
        self.agent_loud_at = now
        if not self.in_agent_turn:
            self.in_agent_turn = True
            self.agent_turns += 1

    def delegation(self, active: bool, now: float) -> None:
        if active:
            if not self.delegating:
                self.delegating_since = now
            self.delegating = True
            # The response the owed tool output asked for has started: delegating covers it from here.
            self.tool_pending = False
            self.tool_pending_since = None
        else:
            if self.delegating:
                self.delegation_ended_at = now
            self.delegating = False
            self.delegating_since = None

    def tool_called(self, now: float) -> None:
        """A function call arrived: its output is owed, and a new backend response will follow it."""
        self.tool_pending = True
        self.tool_pending_since = now

    def end_requested(self, now: float) -> None:
        if self.ending_since is None:
            self.ending_since = now
            self.goodbye_before_end = self.agent_loud_at is not None and now - self.agent_loud_at <= FAREWELL_RECENT

    def started_line(self, now: float, seconds: float) -> None:
        self.speaking_until = now + seconds
        self.next_line += 1
        self.agent_turns = 0  # max_turns guards each exchange, not the whole run

    def _busy(self, now: float) -> bool:
        """The backend is working, or owes the voice model an answer. A stalled one stops counting."""
        delegating = self.delegating and (
            self.delegating_since is None or now - self.delegating_since < DELEGATION_STALL
        )
        pending = self.tool_pending and (
            self.tool_pending_since is None or now - self.tool_pending_since < DELEGATION_STALL
        )
        return delegating or pending

    def tick(self, now: float) -> Action:
        if now - self.started >= self.max_seconds:
            return "time_limit"
        quiet = self.agent_loud_at is None or now - self.agent_loud_at >= QUIET_SECONDS
        if quiet:
            self.in_agent_turn = False
        if self.ending_since is not None:
            said_goodbye = self.agent_loud_at is not None and self.agent_loud_at > self.ending_since
            if said_goodbye and quiet:
                return "close"
            if self.goodbye_before_end and quiet and now - self.ending_since >= QUIET_SECONDS:
                return "close"
            if now - self.ending_since >= FAREWELL_MAX:
                return "close"
            return "wait"
        if self.agent_turns > self.max_turns:
            return "turn_limit"
        last_line_done = self.next_line >= self.lines and self.next_line > 0
        if last_line_done and now - self.speaking_until >= LAST_LINE_MAX:
            return "close"
        if now < self.speaking_until or self._busy(now) or not quiet:
            return "wait"
        if self.next_line == 0 and self.lines > 0:
            waiting_for_greeting = self.agent_loud_at is None and now - self.started < GREETING_WAIT
            return "wait" if waiting_for_greeting else "speak"
        since = max(self.speaking_until, self.delegation_ended_at)
        answered = self.agent_loud_at is not None and self.agent_loud_at > since
        if self.next_line < self.lines:
            return "speak" if answered or now - since >= ANSWER_WAIT else "wait"
        # The last line: the customer hangs up once the agent has answered it and gone quiet, or
        # has said nothing at all for a while.
        if now - max(since, self.agent_loud_at or 0.0) >= DONE_SILENCE:
            return "close"
        return "wait"


@dataclass
class Transcript:
    """The run's transcript, in transcribe-backend's TranscriptEntry shape."""

    entries: list[dict] = field(default_factory=list)

    def caller(self, text: str, start_ms: int, end_ms: int) -> None:
        self.entries.append(
            {"id": f"t{len(self.entries) + 1}", "speaker": "caller", "text": text, "startMs": start_ms, "endMs": end_ms}
        )

    def agent(self, delta: str, at_ms: int) -> None:
        if not delta:
            return
        last = self.entries[-1] if self.entries else None
        if last and last["speaker"] == "receptionist" and at_ms - last["endMs"] < TRANSCRIPT_GAP_MS:
            last["text"] += delta
            last["endMs"] = at_ms
            return
        self.entries.append(
            {"id": f"t{len(self.entries) + 1}", "speaker": "receptionist", "text": delta, "startMs": at_ms, "endMs": at_ms}
        )
