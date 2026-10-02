"""One scenario, once: voice the customer's lines, hold the GPT-Live session, report what happened.

The session is the one transcribe-backend composed for the pass (channel "sim"), started with the
same build_composed_session_start the phone uses, on the same models. Every tool call goes to the
backend's sandbox. The run ends when the agent ends the call, the customer has nothing left to say,
or a limit is hit — whichever is first. Nothing is retried.
"""

from __future__ import annotations

import asyncio
import collections
import contextlib
import json
import logging
import time
from datetime import datetime, timezone

import websockets

from ..config import Config
from ..realtime.greeting_audio import frames
from ..realtime.live_session import VOICE_PRICE_PER_MINUTE, backend_cost, build_composed_session_start
from .audio import FRAME_SECONDS, SILENCE_FRAME, TTS_PRICE_PER_MINUTE, has_sound, seconds, synthesize
from .backend_client import BackendClient
from .settings import RunnerSettings
from .turns import Transcript, TurnPolicy

log = logging.getLogger(__name__)

START_TIMEOUT = 15.0  # connecting, and then session.started, each at most this long
MAX_LAG = 0.1  # the send loop this far behind: resync instead of bursting frames to catch up


async def run_scenario(cfg: Config, rs: RunnerSettings, backend: BackendClient, job: dict) -> dict:
    started = time.monotonic()
    usage = {"voice_seconds": 0.0, "backend": 0.0, "tts": 0.0, "started_at": None}
    transcript = Transcript()
    backend.tool_failed = False
    max_seconds = None
    try:
        # Read inside the try: a malformed job is this run's error, not the pass's.
        run_id = job["runId"]
        max_seconds = job["limits"]["maxSeconds"]
        audio = [await synthesize(cfg.openai_api_key, rs.tts_model, rs.customer_voice, line) for line in job["customerLines"]]
        usage["tts"] = sum(seconds(a) for a in audio) / 60 * TTS_PRICE_PER_MINUTE
        status, reason = await asyncio.wait_for(
            _converse(cfg, rs, backend, job, run_id, audio, transcript, usage), timeout=max_seconds + 30
        )
    except TimeoutError:
        # Only the wait_for above: _converse turns its own setup timeouts into a RuntimeError.
        status, reason = "error", f"time limit ({max_seconds} s)"
    except Exception as exc:  # noqa: BLE001 — any failure is this run's run error, never the pass's
        log.exception("scenario run %s failed", job.get("runId"))
        status, reason = "error", f"{type(exc).__name__}: {exc}"
    if status == "completed" and backend.tool_failed:
        status, reason = "error", "a sandbox tool call failed"
    cost = usage["voice_seconds"] / 60 * VOICE_PRICE_PER_MINUTE + usage["backend"] + usage["tts"]
    result = {
        "status": status,
        "transcript": [{**e, "text": e["text"].strip()} for e in transcript.entries if e["text"].strip()],
        "durationSec": round(time.monotonic() - started),
        "costUsd": round(cost, 4),
    }
    if usage["started_at"]:
        result["startedAt"] = usage["started_at"]
    if status == "error":
        result["errorReason"] = reason
    return result


async def _wait_started(ws) -> None:
    async def wait() -> None:
        async for raw in ws:
            evt = json.loads(raw)
            if evt.get("type") == "session.started":
                return
            if evt.get("type") == "error":
                raise RuntimeError(f"GPT-Live refused the session: {evt.get('error')}")
        raise RuntimeError("GPT-Live closed before the session started")

    await asyncio.wait_for(wait(), timeout=START_TIMEOUT)


async def _converse(cfg, rs, backend, job, run_id, audio, transcript, usage) -> tuple[str, str]:
    session = job["session"]
    limits = job["limits"]
    lines = job["customerLines"]
    policy = TurnPolicy(lines=len(audio), max_seconds=limits["maxSeconds"], max_turns=limits["maxTurns"])
    # A setup timeout is a TimeoutError too, which run_scenario would report as the run's time limit.
    not_started = f"GPT-Live did not start the session within {START_TIMEOUT:g} s"
    try:
        ws = await websockets.connect(
            rs.live_url,
            additional_headers={"Authorization": f"Bearer {cfg.openai_api_key}"},
            open_timeout=START_TIMEOUT,
        )
    except TimeoutError as exc:
        raise RuntimeError(not_started) from exc
    async with ws:
        start = build_composed_session_start(
            cfg, session["live"], session["backend"], session["tools"],
            greet_now=session.get("greeting") or "", voice=session.get("voice") or "",
        )
        await ws.send(json.dumps(start))
        try:
            await _wait_started(ws)
        except TimeoutError as exc:
            raise RuntimeError(not_started) from exc
        t0 = time.monotonic()
        usage["started_at"] = datetime.now(timezone.utc).isoformat()
        policy.started = t0
        outgoing: collections.deque[str] = collections.deque()
        tool_tasks: set[asyncio.Task] = set()
        receiver = asyncio.create_task(_receive(cfg, ws, policy, backend, run_id, transcript, usage, t0, tool_tasks))
        try:
            next_tick = time.monotonic()
            while True:
                now = time.monotonic()
                if receiver.done():
                    receiver.result()  # re-raises what ended it
                    return "error", "the live session closed early"
                action = policy.tick(now)
                if action == "speak":
                    i = policy.next_line
                    outgoing.extend(frames(audio[i]))
                    at = int((now - t0) * 1000)
                    transcript.caller(lines[i], at, at + int(seconds(audio[i]) * 1000))
                    policy.started_line(now, seconds(audio[i]))
                elif action == "close":
                    return "completed", ""
                elif action == "time_limit":
                    return "error", f"time limit ({limits['maxSeconds']} s)"
                elif action == "turn_limit":
                    return "error", f"turn limit ({limits['maxTurns']} agent turns in one exchange)"
                # Like a phone line, the input never stops: the line's audio, else silence.
                frame = outgoing.popleft() if outgoing else SILENCE_FRAME
                await ws.send(json.dumps({"type": "session.input_audio.append", "audio": frame}))
                next_tick += FRAME_SECONDS
                now = time.monotonic()
                if now - next_tick > MAX_LAG:
                    next_tick = now  # fell behind: resync, never burst frames to catch up
                await asyncio.sleep(max(0.0, next_tick - now))
        finally:
            usage["voice_seconds"] = max(usage["voice_seconds"], time.monotonic() - t0)
            pending = [receiver, *tool_tasks]
            for task in pending:
                task.cancel()
            for task in pending:
                with contextlib.suppress(Exception, asyncio.CancelledError):
                    await task
            try:
                await ws.send(json.dumps({"type": "session.close"}))
            except Exception:  # noqa: BLE001 — the socket may already be gone
                pass


async def _receive(cfg, ws, policy, backend, run_id, transcript, usage, t0, tool_tasks) -> None:
    seen: set[str] = set()
    async for raw in ws:
        evt = json.loads(raw)
        t = evt.get("type")
        now = time.monotonic()
        if t == "session.output_audio.delta":
            if has_sound(evt.get("delta") or ""):
                policy.agent_sound(now)
        elif t == "session.output_transcript.delta":
            transcript.agent(evt.get("delta") or "", int((now - t0) * 1000))
        elif t == "session.delegation.created":
            policy.delegation(True, now)
        elif t == "response.event":
            _backend_event(cfg, ws, evt.get("event") or {}, policy, backend, run_id, usage, seen, tool_tasks, now)
        elif t in ("session.usage.updated", "session.closed"):
            secs = (evt.get("usage") or {}).get("seconds")
            if isinstance(secs, (int, float)):
                usage["voice_seconds"] = float(secs)
            if t == "session.closed":
                return
        elif t == "error":
            log.warning("live error during a scenario run: %s", evt.get("error") or evt)


def _backend_event(cfg, ws, inner: dict, policy, backend, run_id, usage, seen, tool_tasks, now: float) -> None:
    it = inner.get("type")
    if it == "response.created":
        policy.delegation(True, now)
    elif it in ("response.completed", "response.failed", "response.incomplete", "error"):
        # As live_bridge: however the backend's response ends, it is no longer working.
        policy.delegation(False, now)
        if it == "error":
            log.warning("backend error during a scenario run: %s", json.dumps(inner)[:1000])
            return
        u = (inner.get("response") or {}).get("usage") or {}
        usage["backend"] += backend_cost(
            cfg.openai_live_backend_model,
            int(u.get("input_tokens") or 0),
            int((u.get("input_tokens_details") or {}).get("cached_tokens") or 0),
            int(u.get("output_tokens") or 0),
        )
    elif it == "response.output_item.done":
        item = inner.get("item") or {}
        if item.get("type") != "function_call" or item.get("status", "completed") != "completed":
            return
        call_id = item.get("call_id", "")
        if call_id and call_id in seen:
            return
        seen.add(call_id)
        name = item.get("name", "")
        try:
            args = json.loads(item.get("arguments") or "{}")
        except json.JSONDecodeError:
            args = {}
        # Before the task starts: from here until the next backend response starts, an answer is owed.
        # Not for an empty call_id: no output (so no response.create) follows it.
        if call_id:
            policy.tool_called(now)
        # Off the receive loop, as on the phone: GPT-Live's events keep being read while the sandbox works.
        task = asyncio.create_task(_tool_call(ws, policy, backend, run_id, call_id, name, args, now))
        tool_tasks.add(task)
        task.add_done_callback(tool_tasks.discard)
        task.add_done_callback(_log_tool_failure)


def _log_tool_failure(task: asyncio.Task) -> None:
    if not task.cancelled() and task.exception() is not None:
        log.warning("scenario tool call failed: %r", task.exception())


async def _tool_call(ws, policy, backend, run_id, call_id: str, name: str, args: dict, called_at: float) -> None:
    output = await backend.tool(run_id, name, args)
    ends = name == "end_call" or (name == "transfer_call" and output.get("result") == "accepted")
    if ends:
        # Timed from when the call arrived, so "the goodbye came just before it" is judged right.
        policy.end_requested(called_at)
    # Without a call_id nothing is waiting for an output (GPT-Live rejects an empty one); the sandbox
    # call above still recorded it.
    if not call_id:
        return
    try:
        await ws.send(json.dumps({
            "type": "response.item.create",
            "item": {"type": "function_call_output", "call_id": call_id, "output": json.dumps(output)},
        }))
        # As on the phone, the backend is not resumed once the call is ending (end_call, an accepted
        # transfer): it would compose a second goodbye.
        if not ends:
            await ws.send(json.dumps({"type": "response.create"}))
    except websockets.ConnectionClosed:
        pass
