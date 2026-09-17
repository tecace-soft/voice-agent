"""The GPT-Live call bridge — runs every call instead of bridge.py when OPENAI_LIVE_MODEL is set.

The Twilio half of a call is identical on both engines: the same start event, the same prompts,
the same tools and backend, the same marks, AMD, transfer redirect and call record. Those are
borrowed from bridge.py unchanged. What differs is everything said to OpenAI, because GPT-Live has
a different API and is missing several things the Realtime bridge is built on:

  * No `response.done`, so there is no signal that the agent has finished a sentence. Hanging up
    after the farewell (and after a voicemail) waits for the agent's audio to go QUIET instead.
  * No per-response `instructions`. The bridge's farewell, voicemail and "transfer failed" lines are
    appended to the session with `session.instructions.append`.
  * No `response.cancel` / `speech_started`. GPT-Live is full duplex and handles barge-in itself.
    Where the Realtime bridge DROPS audio the model must not hear (the carrier's forwarding
    announcement, a voicemail greeting), this one sends μ-law silence in its place, because GPT-Live
    expects input audio to keep flowing.
  * Tool calls come from the BACKEND model, wrapped in `response.event`. Results go back with
    `response.item.create` + `response.create`.
  * Transcripts arrive as timed fragments of both sides, not as finished turns.

UNVERIFIED on a real call: whether Twilio's playback buffer outlives an interruption. Twilio's own
GPT-Live sample never clears it. The call-end log reports how far audio ran ahead of playback; if
that is seconds rather than a fraction of one, callers will hear the agent keep talking after they
cut in.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import time

import websockets
from fastapi import WebSocket, WebSocketDisconnect

from ..config import Config
from ..telephony import transfer
from ..telephony.outbound import is_machine
from ..tools.agent_tools import INBOUND_TOOL_SCHEMAS, ToolExecutor
from ..tools.business_config import fetch_business_config
from . import amd, greeting_audio
from .bridge import (
    _HANGUP_FALLBACK_SECONDS,
    _SPOKEN_HOLD_LINE,
    _TRANSFER_FAILED_INSTRUCTION,
    _TRANSFER_FALLBACK_SECONDS,
    _VOICEMAIL_BACKSTOP_SECONDS,
    _VOICEMAIL_INSTRUCTION,
    _accept_forwarded_call,
    _await_start,
    _drain_and_close,
    _farewell_instruction,
    _finalize_call,
    _name_from_transcript,
    _note_outcome,
    _turns,
)
from .instructions import build_instructions
from .instructions_inbound import RETURN_GREETING, spoken_greeting
from .instructions_inbound import build_instructions as build_instructions_inbound
from .instructions_neutral import build_instructions_neutral
from .korean import HANGUL, korean_speech_guide
from .live_session import LIVE_URL, VOICE_PRICE_PER_MINUTE, backend_cost, build_live_session_start

log = logging.getLogger(__name__)

# No agent audio for this long means the closing words have finished generating. The hang-up mark
# then waits for Twilio to finish PLAYING them, so this only has to outlast a pause between words.
_QUIET_SECONDS = 1.5
# How much closing audio must have been heard before quiet counts. Stops a hang-up in the gap
# between whatever the agent was saying and the farewell it was just asked for.
_FAREWELL_MIN_AUDIO = 1.0
# Counted in chunks that contain sound, so the gaps between words don't count — lower than the
# message's length on purpose.
_VOICEMAIL_MIN_AUDIO = 3.0
# Agent audio within this long means it is mid-sentence (usually its own "let me put you through"),
# so a transfer drains that first instead of having Twilio speak a hold line over it.
_RECENTLY_SPOKE_SECONDS = 2.0
# Caller audio that arrives before the session has started is held, not lost — on an outbound call
# it is the lead's "hello?". Capped so a session that never starts cannot grow it without limit.
_MAX_HELD_FRAMES = 150  # 3s of 20ms frames
# An inbound agent greets first; until it does, the caller cannot have said anything. If the
# greeting never comes, stop waiting for it rather than leaving the caller unheard for the call.
_GREETING_WAIT_SECONDS = 6.0
_MULAW_SAMPLES_PER_SECOND = 8000
# μ-law byte -> 1 if its amplitude is well above line noise (segment 3 or higher), else 0.
_LOUD_BYTES = bytes(1 if ((0xFF ^ b) >> 4) & 7 >= 3 else 0 for b in range(256))
# Dead air with no backend work in flight. GPT-Live decides for itself whether to delegate, and on
# the first real call it said "let me put you through" and never delegated the transfer — the caller
# sat in silence until they hung up. After this long the agent is reminded to act.
_STUCK_SECONDS = 6.0
# A delegation with no backend response by now is logged: from the outside it looks exactly like
# the model never delegating at all.
_BACKEND_STALL_SECONDS = 15.0
# The agent answered and stopped on a statement — no "anything else?" — and the caller, who cannot
# tell it has finished, says nothing either. The prompt asks for the hand-back, but GPT-Live skips it
# often enough (in a real session: one answer handed back, the next did not) to need a backstop that
# is much sooner than the general dead-air nudge.
_FOLLOWUP_SECONDS = 2.5
# How far ahead of playback the pre-rendered greeting is allowed to run at Twilio. Enough that a
# late frame never leaves a gap in a word, small enough that flushing it on an interruption is not
# noticeable.
_GREETING_LEAD_SECONDS = 0.2

_GREET_NOW = (
    "The call has just connected. Speak your opening line now, first, without waiting for the "
    "caller to say anything. Then listen."
)
# Sent when an inbound agent was asked to greet and has still said nothing. A greeting request is
# only a request to GPT-Live: a caller coming back from a failed transfer once sat through 17 seconds
# of silence and hung up, although the same prompt greeted promptly when tried on its own.
_GREET_AGAIN = (
    "You have not said anything yet, and the caller is waiting on the line in silence. Say your "
    "opening line from the call flow now, in full, and then listen."
)
_ASK_ANYTHING_ELSE = (
    "You stopped speaking without handing the conversation back, and the caller is waiting in "
    "silence. In one short line, in the language they are speaking, ask whether they need anything "
    "else — phrased differently from however you asked earlier in this call, and never the same "
    "sentence twice. If you were waiting on them for something specific, ask for that instead. If "
    "they have already said goodbye, say a brief warm farewell and end the call instead of asking."
)
_STOP_FOR_TRANSFER = (
    "The caller is being transferred to a colleague right now. Do not say anything more."
)
_NUDGE = (
    "The line has been silent for several seconds. If you told the caller you would do something "
    "that needs the backend — put them through, take a message, check or book a time, or end the "
    "call — delegate it to the backend now, without repeating what you already said. Otherwise, "
    "carry on the conversation naturally."
)


async def _open_live(cfg: Config):
    """Open the GPT-Live connection (a coroutine, for the same create_task reason as bridge.py)."""
    return await websockets.connect(
        LIVE_URL, additional_headers={"Authorization": f"Bearer {cfg.openai_api_key}"}
    )


async def run_live_bridge(twilio_ws: WebSocket, cfg: Config) -> None:
    await twilio_ws.accept()
    # Opened alongside Twilio's start handshake, as in bridge.py — every millisecond is silence.
    connecting = asyncio.create_task(_open_live(cfg))

    stream_sid, call_sid, params = await _await_start(twilio_ws)
    if not stream_sid:
        try:
            await (await connecting).close()
        except Exception:  # noqa: BLE001 — best effort; the call is already gone
            pass
        return

    is_inbound = str(params.get("direction", "")).strip().lower() == "inbound"
    caller = str(params.get("caller", ""))
    opening = ""
    prerendered: bytes | None = None
    returning = str(params.get("transfer_failed", "")).lower() in ("yes", "true", "1")
    business = None

    # The same prompt and tool selection as run_bridge — see the reasoning there.
    if is_inbound:
        dialled = str(params.get("dialled", ""))
        log.info(
            "inbound call started from %r to %r on call %s (transfer_failed=%r) [live]",
            caller or "unknown", dialled or "unknown", call_sid or "?", params.get("transfer_failed"),
        )
        business = await fetch_business_config(cfg, dialled)
        if business is None:
            log.warning("answering %r neutrally — no business identified", dialled or "unknown")
            instructions = build_instructions_neutral(
                caller=caller, timezone=cfg.timezone, disclose_recording=cfg.disclose_recording
            )
        else:
            instructions = build_instructions_inbound(
                caller=caller,
                business_name=business.business_name,
                agent_name=business.agent_name or cfg.agent_name,
                business_hours=business.hours_text,
                business_facts=business.facts,
                # This call is for a customer: with no facts on file the agent must say it doesn't
                # know, NOT recite TecAce's.
                default_facts=False,
                open_hour=business.open_hour,
                close_hour=business.close_hour,
                timezone=cfg.timezone,
                transfer_failed=returning,
                disclose_recording=cfg.disclose_recording and not returning,
                greeting=RETURN_GREETING if returning else (business.greeting or cfg.greeting),
                caller_name=str(params.get("caller_name", "")),
                known_request=str(params.get("known_request", "")),
                transfer_topics=business.transfer_topics,
                can_transfer=bool(business.transfer_number) and not returning,
            )
        # The opening line the caller is about to hear. If it has been rendered already (the
        # /incoming webhook starts that while Twilio connects), it is played the instant the stream
        # opens and the model is told what was said instead of being asked to say it — which is the
        # ~2.5s the model needs before its first audible word, spent before the call was answered.
        if business is not None and not returning:
            opening = spoken_greeting(
                greeting=business.greeting or cfg.greeting,
                business_name=business.business_name,
                agent_name=business.agent_name or cfg.agent_name,
                disclose_recording=cfg.disclose_recording,
            )
            prerendered = greeting_audio.ready(cfg, opening)
            # Not cached yet (first call after a deploy or a greeting change): render it for the
            # next caller, and let the model speak this one, exactly as before.
            if prerendered is None:
                greeting_audio.warm(cfg, opening)

        tools = INBOUND_TOOL_SCHEMAS
        if returning or (business is not None and not business.transfer_number):
            tools = [t for t in INBOUND_TOOL_SCHEMAS if t.get("name") != "transfer_to_human"]
    else:
        log.info(
            "call started for lead_name=%r intake_id=%r [live]",
            params.get("lead_name"), params.get("intake_id"),
        )
        instructions = build_instructions(
            lead_name=params.get("lead_name", ""),
            purpose=params.get("purpose", ""),
            requested_date=params.get("requested_date", ""),
            requested_date_iso=params.get("requested_date_iso", ""),
            desired_time=params.get("desired_time", ""),
            desired_time_iso=params.get("dateTime", ""),
            email=params.get("email", ""),
            timezone=cfg.timezone,
            is_callback=str(params.get("is_callback", "")).lower() in ("yes", "true", "1"),
        )
        tools = None
    executor = ToolExecutor(cfg, intake_id=params.get("intake_id", ""))

    state: dict = {
        # ---- read by the helpers borrowed from bridge.py ----
        "stream_sid": stream_sid,
        "call_sid": call_sid,
        "is_inbound": is_inbound,
        "is_mini": False,
        "caller": caller,
        "dialled": str(params.get("dialled", "")),
        "human_number": business.transfer_number if business else "",
        "caller_name": str(params.get("caller_name", "")),
        "outcome": None,
        "messages": [],
        "transcript": [],
        "started": time.monotonic(),
        "closing": False,
        "hangup_pending": False,
        "forward_guard_until": 0.0,
        # ---- live only ----
        "ready": asyncio.Event(),  # set on session.started
        "greeted": False,  # the agent has produced audio
        "greeting_task": None,  # playing the pre-rendered opening line, if there is one
        "greet_deadline": float("inf"),
        "leaving_voicemail": False,
        "transfer_pending": None,
        "_tool_tasks": set(),
        "seen_calls": set(),
        # Transcript fragments: [speaker, start_ms or None, arrival index, text].
        "fragments": [],
        "current_run": None,  # [speaker, text] being logged as it is spoken
        # Agent audio accounting, for hanging up on quiet and for the playback-lead diagnostic.
        "last_audio_at": 0.0,
        "closing_audio": 0.0,
        "closing_event_id": None,
        "play_until": 0.0,
        "max_playback_lead": 0.0,
        "voice_seconds": None,
        "backend_usage": {"in": 0, "cached": 0, "out": 0, "cost": 0.0, "responses": 0},
        "append_count": 0,
        # ---- delegation visibility and the dead-air nudge ----
        "delegating_since": None,  # monotonic time backend work began; None when none is in flight
        "last_activity_at": 0.0,  # last agent audio, caller words or backend event
        "nudged": False,  # already nudged during this silence
        "greet_retried": False,  # an inbound greeting that never came has been asked for again
        "followup_asked": False,  # already prompted a hand-back for the agent's current turn
        # Appended the first time the caller is heard speaking Korean — see realtime/korean.py.
        "korean_guide": korean_speech_guide(instructions),
        "korean_guided": False,
        "backend_text": {},  # delegation_id -> the backend's reply so far
        "logged_types": set(),
        "fragment_fields_logged": set(),
    }
    amd_queue = amd.register(call_sid) if not is_inbound else None
    try:
        async with await connecting as live_ws:
            if is_inbound and prerendered:
                first_turn = greeting_audio.already_greeted(opening)
            elif is_inbound:
                # Inbound answers a ringing phone, so the order to speak first travels with the
                # session instead of costing a round trip once it is up. _GREET_AGAIN still covers
                # the session that comes up and says nothing anyway.
                first_turn = _GREET_NOW
            else:
                first_turn = ""
            await live_ws.send(json.dumps(build_live_session_start(
                cfg, instructions, tools, greet_now=first_turn,
            )))

            # Said before the model is even connected — this is the whole point of rendering it.
            if is_inbound and prerendered:
                state["greeting_task"] = asyncio.create_task(
                    _play_greeting(twilio_ws, state, prerendered)
                )

            forwarded_from = str(params.get("forwarded_from", ""))
            if is_inbound and forwarded_from:
                state["forward_guard_until"] = time.monotonic() + cfg.forward_announcement_seconds
                if cfg.forward_accept_inband and cfg.forward_accept_digit.strip():
                    log.info("call arrived forwarded from %s — sending the in-band accept digit",
                             forwarded_from)
                    await _accept_forwarded_call(twilio_ws, cfg, state)
                    remaining = state["forward_guard_until"] - time.monotonic()
                    if remaining > 0:
                        await asyncio.sleep(remaining)

            watcher = (
                asyncio.create_task(_watch_amd(amd_queue, live_ws, twilio_ws, state))
                if amd_queue is not None
                else None
            )
            relays = [
                asyncio.create_task(_caller_to_live(twilio_ws, live_ws, cfg, state)),
                asyncio.create_task(_live_to_caller(twilio_ws, live_ws, state, executor, cfg)),
            ]
            nudger = asyncio.create_task(_nudge_when_stuck(live_ws, state))
            try:
                # FIRST_COMPLETED, not gather — see run_bridge for why.
                done, pending = await asyncio.wait(relays, return_when=asyncio.FIRST_COMPLETED)
                for task in pending:
                    task.cancel()
                await asyncio.gather(*pending, return_exceptions=True)
                for task in done:
                    if task.exception() is not None:
                        raise task.exception()  # noqa: RSE102 — re-raise the original
            finally:
                for task in relays:
                    task.cancel()
                nudger.cancel()
                if watcher is not None:
                    watcher.cancel()
    except Exception as exc:  # noqa: BLE001 — surface, don't crash the server
        log.warning("live bridge ended: %s", exc)
    finally:
        amd.unregister(call_sid)
        _flush_run(state)
        _sync_transcript(state)
        _log_live_cost(state, cfg)
        await _finalize_call(state, params, executor, cfg)


# ---------------------------------------------------------------------------
# Caller -> GPT-Live
# ---------------------------------------------------------------------------

_silence_cache: dict[int, str] = {}


def _payload_bytes(payload: str) -> int:
    """Decoded length of a base64 payload, without decoding it."""
    return len(payload) * 3 // 4 - payload.count("=")


def _silence_like(payload: str) -> str:
    """μ-law silence the same length as `payload`. 0xFF is digital silence in G.711 μ-law."""
    n = _payload_bytes(payload)
    if n not in _silence_cache:
        _silence_cache[n] = base64.b64encode(b"\xff" * n).decode("ascii")
    return _silence_cache[n]


def _not_the_caller(state: dict) -> bool:
    """Is what is on the line right now something the model must not treat as the caller?"""
    now = time.monotonic()
    return (
        # Inbound, before the greeting: the caller has heard nothing and cannot have replied.
        (state["is_inbound"] and not state["greeted"] and now < state["greet_deadline"])
        # A forwarding carrier finishing its announcement.
        or now < state["forward_guard_until"]
        # A voicemail box's own audio must not interrupt the message being left on it.
        or state["leaving_voicemail"]
    )


async def _caller_to_live(twilio_ws: WebSocket, live_ws, cfg: Config, state: dict) -> None:
    """Forward the caller's audio to GPT-Live, and act on Twilio's mark echoes."""
    held: list[str] = []
    try:
        while True:
            evt = json.loads(await twilio_ws.receive_text())
            e = evt.get("event")
            if e == "media":
                payload = evt["media"]["payload"]
                if _not_the_caller(state):
                    payload = _silence_like(payload)
                if not state["ready"].is_set():
                    held.append(payload)
                    del held[:-_MAX_HELD_FRAMES]
                    continue
                for frame in held:
                    await _send_audio(live_ws, frame)
                held.clear()
                await _send_audio(live_ws, payload)
            elif e == "mark":
                mark_name = (evt.get("mark") or {}).get("name")
                # Same meaning as in bridge.py: the closing words have PLAYED, so hang up.
                if mark_name == "endcall":
                    await twilio_ws.close()
                    break
                # The hold line has played — redirect, and do NOT close (that would drop the call).
                if mark_name == "transfer":
                    await _do_transfer(cfg, live_ws, state)
                    continue
            elif e == "stop":
                break
    except WebSocketDisconnect:
        pass
    finally:
        try:
            await live_ws.send(json.dumps({"type": "session.close"}))
        except Exception:  # noqa: BLE001 — the socket may already be gone
            pass
        await live_ws.close()


async def _send_audio(live_ws, payload: str) -> None:
    await live_ws.send(json.dumps({"type": "session.input_audio.append", "audio": payload}))


# ---------------------------------------------------------------------------
# GPT-Live -> caller
# ---------------------------------------------------------------------------


async def _live_to_caller(
    twilio_ws: WebSocket, live_ws, state: dict, executor: ToolExecutor, cfg: Config
) -> None:
    """Forward the agent's audio to the caller; collect transcripts; run the backend's tool calls."""
    try:
        async for raw in live_ws:
            evt = json.loads(raw)
            t = evt.get("type")

            if t == "session.output_audio.delta":
                payload = evt.get("delta") or ""
                _note_agent_audio(state, payload)
                await twilio_ws.send_json(
                    {"event": "media", "streamSid": state["stream_sid"], "media": {"payload": payload}}
                )
            elif t == "session.started":
                log.info("live session started: %s", (evt.get("session") or {}).get("id", "?"))
                state["ready"].set()
                if state["is_inbound"]:
                    # The order to greet already went with session.start — appending it again here
                    # would only ask twice. The deadline still arms _GREET_AGAIN for the session
                    # that comes up and stays silent.
                    state["greet_deadline"] = time.monotonic() + _GREETING_WAIT_SECONDS
            elif t == "session.input_transcript.delta":
                # The caller talked over the pre-rendered greeting: stop it mid-sentence, as a
                # person would, rather than finishing the introduction into their first question.
                task = state.get("greeting_task")
                if task is not None and not task.done():
                    task.cancel()
                if state["is_inbound"] and not state["greeted"]:
                    log.info("ignoring %r heard before the greeting", evt.get("delta"))
                    continue
                state["last_activity_at"] = time.monotonic()
                state["nudged"] = False  # the caller spoke, so the next silence is a new one
                state["followup_asked"] = False  # ...and the agent's next turn is a new one
                _add_fragment(state, "lead", evt)
                if not state["korean_guided"] and HANGUL.search(evt.get("delta") or ""):
                    state["korean_guided"] = True
                    log.info("caller is speaking Korean — adding Korean pronunciation guidance")
                    await _append(live_ws, state, state["korean_guide"])
            elif t == "session.output_transcript.delta":
                _add_fragment(state, "agent", evt)
            elif t == "response.event":
                state["last_activity_at"] = time.monotonic()
                await _on_backend_event(twilio_ws, live_ws, evt, state, executor, cfg)
            elif t == "session.instructions.appended":
                # The closing instruction has landed. Audio from BEFORE this was the agent's
                # previous sentence and must not count toward the farewell having been said.
                if evt.get("client_event_id") and evt.get("client_event_id") == state["closing_event_id"]:
                    state["closing_audio"] = 0.0
            elif t == "session.delegation.created":
                # INFO, not DEBUG: "did the agent delegate at all?" is the first question whenever
                # a tool didn't happen, and it cannot be answered from anything else in the log.
                log.info("agent delegated to the backend (%s)", (evt.get("delegation") or {}).get("id"))
                state["delegating_since"] = state["last_activity_at"] = time.monotonic()
            elif t == "session.usage.updated":
                seconds = (evt.get("usage") or {}).get("seconds")
                if isinstance(seconds, (int, float)):
                    state["voice_seconds"] = seconds
            elif t == "session.closed":
                seconds = (evt.get("usage") or {}).get("seconds")
                if isinstance(seconds, (int, float)):
                    state["voice_seconds"] = seconds
                log.info("live session closed: %s", evt.get("reason"))
                break
            elif t == "error":
                log.warning("live error: %s", evt.get("error") or evt)
            else:
                _log_unexpected(state, "session", evt)
    except WebSocketDisconnect:
        pass
    except websockets.ConnectionClosed:
        pass


def _has_sound(payload: str) -> bool:
    """Does this chunk of μ-law audio contain actual sound, rather than silence?

    GPT-Live streams output audio CONTINUOUSLY — silence included, from before the agent says a word
    until the session ends (measured against the real API). Every "is the agent talking?" decision
    in this bridge therefore has to look at the samples, not at whether a chunk arrived: counting
    silent chunks marked the agent as having greeted before it spoke, kept the dead-air nudge from
    ever firing, and would have kept a finished farewell from ever going quiet.
    """
    try:
        raw = base64.b64decode(payload)
    except (ValueError, TypeError):
        return False
    return bool(raw) and raw.translate(_LOUD_BYTES).count(1) * 50 >= len(raw)  # >= 2% loud


def _note_agent_audio(state: dict, payload: str) -> None:
    """Account one chunk of agent audio: how long it plays, how far ahead it is, and — only if it
    contains sound — that the agent is speaking."""
    now = time.monotonic()
    seconds = _payload_bytes(payload) / _MULAW_SAMPLES_PER_SECOND
    # When Twilio will finish playing everything sent so far. GPT-Live's output events carry no
    # timing, so the only way to see whether audio arrives faster than it plays is to measure it.
    # Silence counts here: it occupies Twilio's buffer just the same.
    state["play_until"] = max(state["play_until"], now) + seconds
    state["max_playback_lead"] = max(state["max_playback_lead"], state["play_until"] - now)
    if not _has_sound(payload):
        return
    if not state["greeted"]:
        state["greeted"] = True
        log.info("agent first spoke %.1fs after the stream opened", now - state["started"])
    state["last_audio_at"] = state["last_activity_at"] = now
    if state["hangup_pending"]:
        state["closing_audio"] += seconds


async def _append(live_ws, state: dict, content: str) -> str:
    """Add a system-level instruction to the live session. Returns its event_id."""
    state["append_count"] += 1
    event_id = f"append_{state['append_count']}"
    await live_ws.send(
        json.dumps(
            {
                "type": "session.instructions.append",
                "event_id": event_id,
                "delegation_id": None,
                "content": content,
            }
        )
    )
    return event_id


def _log_unexpected(state: dict, where: str, evt: dict) -> None:
    """Make an event the bridge does not handle visible, instead of silently dropping it.

    Anything that looks like a failure is logged every time, in full, as a warning. Everything else
    is logged once per type — enough to learn the protocol from a real call without flooding it.
    """
    t = str(evt.get("type") or "?")
    if "error" in t or "fail" in t:
        log.warning("live %s event %s: %s", where, t, json.dumps(evt)[:1000])
        return
    key = f"{where}:{t}"
    if key not in state["logged_types"]:
        state["logged_types"].add(key)
        log.info("unhandled live %s event %s (logged once): %s", where, t, json.dumps(evt)[:500])


async def _play_greeting(twilio_ws: WebSocket, state: dict, audio: bytes) -> None:
    """Play the pre-rendered opening line to the caller, in real time.

    Sent with a SHORT LEAD rather than one frame per 20ms exactly. Twilio plays what it has at a
    fixed rate, so a sender that is occasionally a few milliseconds late leaves gaps mid-word — the
    first version did that and the greeting came back described as disjointed. A fifth of a second
    of slack absorbs the jitter, and is still little enough that a caller who talks over the
    greeting hears at most that much of it after the buffer is flushed.
    """
    state["greeted"] = True  # the caller HAS been greeted, whatever the model does next
    frames = greeting_audio.frames(audio)
    log.info("playing the pre-rendered greeting (%.1fs) — the model did not have to speak it",
             len(audio) / 8000)
    started = time.monotonic()
    try:
        for i, frame in enumerate(frames):
            await twilio_ws.send_json(
                {"event": "media", "streamSid": state["stream_sid"], "media": {"payload": frame}}
            )
            state["last_audio_at"] = time.monotonic()
            state["last_activity_at"] = state["last_audio_at"]
            # Stay _GREETING_LEAD_SECONDS ahead of playback, never further.
            ahead = (i + 1) * 0.02 - (time.monotonic() - started)
            if ahead > _GREETING_LEAD_SECONDS:
                await asyncio.sleep(ahead - _GREETING_LEAD_SECONDS)
    except asyncio.CancelledError:
        # The caller started talking. Drop what Twilio has not played yet so the agent is not still
        # introducing itself over them.
        try:
            await twilio_ws.send_json({"event": "clear", "streamSid": state["stream_sid"]})
        except Exception:  # noqa: BLE001 — the call may already be gone
            pass
        log.info("caller spoke during the greeting — stopped playing it")
        raise
    finally:
        state["greeting_task"] = None


async def _nudge_when_stuck(live_ws, state: dict) -> None:
    """Remind the agent to act when the line has gone dead with no backend work in flight.

    GPT-Live alone decides whether to delegate, so an agent can promise a transfer, never delegate
    it, and wait forever. One reminder per silence; the caller speaking starts a new one.
    """
    stall_logged = False
    while not state["closing"]:
        await asyncio.sleep(0.5)
        now = time.monotonic()
        since = state["delegating_since"]
        if since is not None:
            # Delegated and waiting on the backend: that silence is not the agent's to fix.
            if not stall_logged and now - since >= _BACKEND_STALL_SECONDS:
                stall_logged = True
                log.warning("the backend has not answered %.0fs after the agent delegated", now - since)
            continue
        stall_logged = False
        if state["is_inbound"] and not state["greeted"] and not state["greet_retried"]:
            # Waiting on the greeting. greet_deadline is only set once the session has started.
            if now >= state["greet_deadline"]:
                state["greet_retried"] = True
                state["last_activity_at"] = now  # the regular nudge waits a full silence after this
                log.info(
                    "the agent has not greeted %.0fs after the session started — asking again",
                    _GREETING_WAIT_SECONDS,
                )
                try:
                    await _append(live_ws, state, _GREET_AGAIN)
                except websockets.ConnectionClosed:
                    return
            continue
        busy = state["hangup_pending"] or state["transfer_pending"] or state["_tool_tasks"]
        # The agent's turn so far (everything it has said since the caller last spoke) ended on a
        # FINISHED statement, and it has gone quiet. Judged by the transcript's closing punctuation,
        # which GPT-Live writes in every language it speaks. A question hands the turn back already;
        # no punctuation at all means it paused mid-sentence — measured on the real API at over 1.5s
        # ("…and Claude" … "training.") — and must not be talked over.
        run = state["current_run"]
        if (
            run
            and run[0] == "agent"
            and not busy
            and not state["followup_asked"]
            and state["last_audio_at"]
            and now - state["last_audio_at"] >= _FOLLOWUP_SECONDS
            and run[1].rstrip().endswith((".", "!", "。", "！"))
        ):
            state["followup_asked"] = True
            log.info("agent stopped on a statement without handing the turn back — prompting a follow-up")
            try:
                await _append(live_ws, state, _ASK_ANYTHING_ELSE)
            except websockets.ConnectionClosed:
                return
            continue
        if (
            (state["greeted"] or state["greet_retried"])
            and not busy
            and not state["nudged"]
            and now - state["last_activity_at"] >= _STUCK_SECONDS
        ):
            state["nudged"] = True
            log.info(
                "%.0fs of dead air with nothing delegated — reminding the agent to act",
                now - state["last_activity_at"],
            )
            try:
                await _append(live_ws, state, _NUDGE)
            except websockets.ConnectionClosed:
                return


# ---------------------------------------------------------------------------
# Transcript
# ---------------------------------------------------------------------------


def _add_fragment(state: dict, speaker: str, evt: dict) -> None:
    text = evt.get("delta") or ""
    if not text:
        return
    if speaker not in state["fragment_fields_logged"]:
        # The transcript is ordered by start_ms only when every fragment carries it; this shows
        # which side (if either) does not.
        state["fragment_fields_logged"].add(speaker)
        log.info("first %s transcript fragment carries fields %s", speaker, sorted(evt))
    start = evt.get("start_ms")
    frags = state["fragments"]
    frags.append([speaker, start if isinstance(start, (int, float)) else None, len(frags), text])
    # Log turn by turn as it happens, like the Realtime bridge: a run ends when the other side talks.
    run = state["current_run"]
    if run and run[0] == speaker:
        run[1] += text
    else:
        _flush_run(state)
        state["current_run"] = [speaker, text]


def _flush_run(state: dict) -> None:
    run = state.get("current_run")
    if run and run[1].strip():
        log.info("%s: %s", run[0].upper(), " ".join(run[1].split()))
    state["current_run"] = None


def _sync_transcript(state: dict) -> None:
    """Rebuild state["transcript"] from the fragments, in the order the words were spoken.

    Both sides can talk at once, so fragments are ordered by when they STARTED rather than when they
    arrived, then consecutive fragments from the same speaker are joined into one turn.
    """
    frags = state["fragments"]
    if frags and all(f[1] is not None for f in frags):
        frags = sorted(frags, key=lambda f: (f[1], f[2]))
    turns: list[list[str]] = []
    for who, _start, _index, text in frags:
        if turns and turns[-1][0] == who:
            turns[-1][1] += text
        else:
            turns.append([who, text])
    state["transcript"] = [[who, " ".join(text.split())] for who, text in turns]


# ---------------------------------------------------------------------------
# Backend tool calls
# ---------------------------------------------------------------------------


async def _on_backend_event(
    twilio_ws: WebSocket, live_ws, evt: dict, state: dict, executor: ToolExecutor, cfg: Config
) -> None:
    inner = evt.get("event") or {}
    it = inner.get("type")
    if it == "response.output_item.done":
        item = inner.get("item") or {}
        if item.get("type") != "function_call" or item.get("status", "completed") != "completed":
            return
        call_id = item.get("call_id", "")
        if call_id in state["seen_calls"]:
            return
        state["seen_calls"].add(call_id)
        name = item.get("name", "")
        try:
            args = json.loads(item.get("arguments") or "{}")
        except json.JSONDecodeError:
            args = {}
        if name == "end_call":
            await _handle_end_call(twilio_ws, live_ws, call_id, state)
        elif name == "transfer_to_human":
            await _handle_transfer(twilio_ws, live_ws, call_id, args, state, cfg)
        else:
            # Off the receive loop, so the caller's audio keeps flowing while the backend works.
            task = asyncio.create_task(_handle_tool_call(live_ws, call_id, name, args, executor, state))
            state["_tool_tasks"].add(task)
            task.add_done_callback(state["_tool_tasks"].discard)
    elif it == "response.created":
        if state["delegating_since"] is None:
            state["delegating_since"] = time.monotonic()
        log.info("backend is working")
    elif it == "response.output_text.delta":
        key = evt.get("delegation_id") or ""
        state["backend_text"][key] = state["backend_text"].get(key, "") + (inner.get("delta") or "")
    elif it == "response.completed":
        state["delegating_since"] = None
        text = " ".join(state["backend_text"].pop(evt.get("delegation_id") or "", "").split())
        log.info("backend finished%s", f": {text}" if text else " (no text)")
        _record_backend_usage(state, (inner.get("response") or {}).get("usage"), cfg)
    elif it in ("response.failed", "response.incomplete", "error"):
        state["delegating_since"] = None
        state["backend_text"].pop(evt.get("delegation_id") or "", None)
        log.warning("backend %s: %s", it, json.dumps(inner)[:1000])
    else:
        _log_unexpected(state, "backend", inner)


async def _send_tool_output(live_ws, call_id: str, output: str, *, resume: bool = True) -> None:
    await live_ws.send(
        json.dumps(
            {
                "type": "response.item.create",
                "item": {"type": "function_call_output", "call_id": call_id, "output": output},
            }
        )
    )
    if resume:
        await live_ws.send(json.dumps({"type": "response.create"}))


async def _handle_tool_call(
    live_ws, call_id: str, name: str, args: dict, executor: ToolExecutor, state: dict
) -> None:
    log.info("tool call: %s %s", name, args)
    result = await executor.run(name, args)
    _note_outcome(state, name, args, result)
    if state["closing"]:
        return
    try:
        await _send_tool_output(live_ws, call_id, result)
    except websockets.ConnectionClosed:
        pass


async def _handle_end_call(twilio_ws: WebSocket, live_ws, call_id: str, state: dict) -> None:
    """Deliver the farewell ourselves, then hang up once the agent goes quiet.

    The backend is NOT resumed after end_call: left to continue it would compose a goodbye of its
    own, and the caller would hear two.
    """
    await _send_tool_output(live_ws, call_id, '{"ok": true}', resume=False)
    if state["hangup_pending"] or state["closing"]:
        return
    log.info("end_call — delivering the farewell, then hanging up")
    await _start_closing(
        twilio_ws, live_ws, state, _farewell_instruction(state),
        min_audio=_FAREWELL_MIN_AUDIO, backstop=_HANGUP_FALLBACK_SECONDS,
    )


async def _start_closing(
    twilio_ws: WebSocket, live_ws, state: dict, instruction: str, *, min_audio: float, backstop: float
) -> None:
    """Ask for the closing words, and hang up once they have been said (or the backstop fires)."""
    state["hangup_pending"] = True
    state["closing_audio"] = 0.0
    state["closing_event_id"] = await _append(live_ws, state, instruction)
    state["hangup_task"] = asyncio.create_task(
        _hang_up_when_quiet(twilio_ws, state, min_audio=min_audio, backstop=backstop)
    )


async def _hang_up_when_quiet(
    twilio_ws: WebSocket, state: dict, *, min_audio: float, backstop: float
) -> None:
    """Stand-in for the Realtime bridge's response.done: the closing words have been generated once
    enough of them has been heard and the agent has then stopped producing audio."""
    asked = time.monotonic()
    while not state["closing"]:
        await asyncio.sleep(0.2)
        now = time.monotonic()
        if state["closing_audio"] >= min_audio and now - state["last_audio_at"] >= _QUIET_SECONDS:
            log.info("closing words finished (%.1fs of audio) — hanging up", state["closing_audio"])
            break
        if now - asked >= backstop:
            log.info("closing words not finished after %.0fs — hanging up anyway", backstop)
            break
    await _drain_and_close(twilio_ws, state)


# ---------------------------------------------------------------------------
# Voicemail (outbound) and transfer (inbound)
# ---------------------------------------------------------------------------


async def _watch_amd(queue: asyncio.Queue, live_ws, twilio_ws: WebSocket, state: dict) -> None:
    """If Twilio's AMD says a machine answered, leave the voicemail and hang up."""
    try:
        answered_by = await queue.get()
    except asyncio.CancelledError:
        return
    if not is_machine(answered_by) or state["closing"] or state["hangup_pending"]:
        return
    log.info("AMD says voicemail (%s) — leaving a message, then hanging up", answered_by)
    state["outcome"] = "voicemail"
    # From here the model hears silence instead of the machine, so nothing interrupts the message.
    state["leaving_voicemail"] = True
    await twilio_ws.send_json({"event": "clear", "streamSid": state["stream_sid"]})
    await _start_closing(
        twilio_ws, live_ws, state,
        "Stop whatever you were saying. " + _VOICEMAIL_INSTRUCTION,
        min_audio=_VOICEMAIL_MIN_AUDIO, backstop=_VOICEMAIL_BACKSTOP_SECONDS,
    )


async def _handle_transfer(
    twilio_ws: WebSocket, live_ws, call_id: str, args: dict, state: dict, cfg: Config
) -> None:
    """Hand the caller to a person. Mirrors bridge._handle_transfer."""
    await _send_tool_output(live_ws, call_id, '{"ok": true}', resume=False)
    if state["transfer_pending"] or state.get("transfer_done") or state["closing"]:
        return
    reason = (args.get("reason") or "").strip() or "Caller would like to book something."
    named = (args.get("caller_name") or "").strip()
    if named and not state["caller_name"]:
        state["caller_name"] = named
    log.info("transfer_to_human — %s", reason)
    state["transfer_pending"] = reason
    await _append(live_ws, state, _STOP_FOR_TRANSFER)

    if time.monotonic() - state["last_audio_at"] < _RECENTLY_SPOKE_SECONDS:
        # The agent is saying its own hold line — let it finish playing, then hand off.
        await _drain_and_transfer(twilio_ws, live_ws, cfg, state)
        return
    log.info("transfer requested with no hold line spoken — handing off immediately")
    state["transfer_hold_line"] = _SPOKEN_HOLD_LINE
    await _do_transfer(cfg, live_ws, state)


async def _drain_and_transfer(twilio_ws: WebSocket, live_ws, cfg: Config, state: dict) -> None:
    if state["closing"] or state.get("transfer_marked"):
        return
    state["transfer_marked"] = True
    await twilio_ws.send_json(
        {"event": "mark", "streamSid": state["stream_sid"], "mark": {"name": "transfer"}}
    )

    async def _fallback() -> None:
        await asyncio.sleep(_TRANSFER_FALLBACK_SECONDS)
        await _do_transfer(cfg, live_ws, state)

    state["transfer_fallback"] = asyncio.create_task(_fallback())


async def _do_transfer(cfg: Config, live_ws, state: dict) -> None:
    """Redirect the live call to the human. Idempotent. Mirrors bridge._do_transfer."""
    if state.get("transfer_done"):
        return
    state["transfer_done"] = True
    _sync_transcript(state)
    result = await transfer.redirect_to_human(
        cfg,
        call_sid=state["call_sid"],
        reason=state["transfer_pending"] or "",
        caller=state["caller"],
        human_number=state["human_number"],
        dialled=state["dialled"],
        caller_name=state["caller_name"] or _name_from_transcript(_turns(state)),
        hold_line=state.get("transfer_hold_line", ""),
    )
    if result == "ok":
        state["outcome"] = "transferred"
        return
    if result == "call_gone":
        log.info("transfer aborted — the caller had already hung up")
        state["transfer_pending"] = None
        state["outcome"] = "caller_hung_up"
        return
    log.warning("transfer failed — falling back to taking a message")
    state["transfer_pending"] = None
    state["outcome"] = "transfer_failed"
    try:
        await _append(live_ws, state, _TRANSFER_FAILED_INSTRUCTION)
    except websockets.ConnectionClosed:
        pass


# ---------------------------------------------------------------------------
# Cost
# ---------------------------------------------------------------------------


def _record_backend_usage(state: dict, usage, cfg: Config) -> None:
    """Account one backend response's tokens. Never allowed to take a call down."""
    try:
        if not isinstance(usage, dict):
            return
        tokens_in = int(usage.get("input_tokens") or 0)
        cached = int((usage.get("input_tokens_details") or {}).get("cached_tokens") or 0)
        tokens_out = int(usage.get("output_tokens") or 0)
        u = state["backend_usage"]
        u["in"] += tokens_in
        u["cached"] += cached
        u["out"] += tokens_out
        u["cost"] += backend_cost(cfg.openai_live_backend_model, tokens_in, cached, tokens_out)
        u["responses"] += 1
    except Exception as exc:  # noqa: BLE001
        log.warning("could not read backend usage (%s); the call is unaffected", exc)


def _log_live_cost(state: dict, cfg: Config) -> None:
    seconds = state["voice_seconds"]
    estimated = seconds is None
    if estimated:
        seconds = time.monotonic() - state["started"]
    voice = seconds / 60 * VOICE_PRICE_PER_MINUTE
    u = state["backend_usage"]
    cached_pct = u["cached"] / u["in"] * 100 if u["in"] else 0.0
    log.info(
        "call cost (live): voice %ds%s $%.4f + backend %s %d responses, %d in (%.0f%% cached), "
        "%d out $%.4f = $%.4f",
        int(seconds), " (estimated)" if estimated else "", voice, cfg.openai_live_backend_model,
        u["responses"], u["in"], cached_pct, u["out"], u["cost"], voice + u["cost"],
    )
    # The barge-in diagnostic. A caller who interrupts still hears up to this much of the agent,
    # because it is already queued at Twilio. Well under a second is fine; seconds means Twilio's
    # buffer has to be cleared on interruption.
    log.info("agent audio ran up to %.1fs ahead of playback", state["max_playback_lead"])
