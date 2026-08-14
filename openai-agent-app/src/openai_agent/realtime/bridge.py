"""The heart of the call: relay audio between Twilio and the OpenAI Realtime API, and run tools.

Flow of one call:
  1. Twilio connects the media stream and sends a "start" event carrying the streamSid and the
     lead's details (passed as <Stream> parameters — see outbound.py).
  2. We open a Realtime session, configured with instructions rendered for THIS lead + the tools.
  3. Two loops run concurrently: caller audio → OpenAI, and OpenAI audio/events → caller. Tool
     calls the model makes are executed against the backend and fed back.
Both sides speak G.711 μ-law, so audio bytes pass straight through (base64) with no conversion.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time

import websockets
from fastapi import WebSocket, WebSocketDisconnect

from ..config import Config
from ..telephony.outbound import is_machine
from ..tools.agent_tools import ToolExecutor
from . import amd
from .instructions import build_instructions
from .session import build_session_update

log = logging.getLogger(__name__)

_OPENAI_WS = "wss://api.openai.com/v1/realtime?model={model}"

# If Twilio never echoes our hang-up mark (it normally does within a second or two), close anyway
# after this long so a finished call can't hold the line — and the meter — open.
_HANGUP_FALLBACK_SECONDS = 12


async def run_bridge(twilio_ws: WebSocket, cfg: Config) -> None:
    await twilio_ws.accept()

    # 1. Wait for Twilio's "start" event — it carries the streamSid, the call's SID (for AMD), and
    #    the lead's context.
    stream_sid, call_sid, params = await _await_start(twilio_ws)
    if not stream_sid:
        return
    log.info("call started for lead_name=%r intake_id=%r", params.get("lead_name"), params.get("intake_id"))

    # 2. Render instructions + tools for this specific lead.
    instructions = build_instructions(
        lead_name=params.get("lead_name", ""),
        purpose=params.get("purpose", ""),
        desired_time=params.get("desired_time", ""),
        desired_time_iso=params.get("dateTime", ""),
        email=params.get("email", ""),
        timezone=cfg.timezone,
        is_callback=str(params.get("is_callback", "")).lower() in ("yes", "true", "1"),
        language=params.get("language", ""),
    )
    executor = ToolExecutor(cfg, intake_id=params.get("intake_id", ""))

    # 3. Open the Realtime session and configure it.
    url = _OPENAI_WS.format(model=cfg.openai_model)
    headers = {"Authorization": f"Bearer {cfg.openai_api_key}"}
    state = {
        "stream_sid": stream_sid,
        "response_active": False,
        # Has the agent spoken any audio since the lead last talked? Used to refuse a
        # "silent" end_call (hanging up with no goodbye) and force a farewell first.
        "spoke_since_user": False,
        # A hang-up the model asked for that's waiting on a goodbye being spoken first.
        "hangup_pending": False,
        # Set once we've begun closing, so the hang-up can't fire twice.
        "closing": False,
        # In-flight tool tasks, kept referenced so they aren't garbage-collected.
        "_tool_tasks": set(),
        # Running transcript of the call: list of (speaker, text) as each turn completes.
        "transcript": [],
        # What the call resulted in, inferred from the tools the agent used (booked / callback /
        # declined / wrong_number …); None if nothing conclusive happened.
        "outcome": None,
        # Monotonic start time, for the call duration in the summary.
        "started": time.monotonic(),
    }
    # Register for this call's answering-machine-detection result (delivered by the /amd webhook).
    amd_queue = amd.register(call_sid)
    try:
        async with websockets.connect(url, additional_headers=headers) as openai_ws:
            await openai_ws.send(json.dumps(build_session_update(cfg, instructions)))
            # Watch for the AMD result in the background: if it's a machine, have the agent leave a
            # voicemail and end the call. Does nothing for a live person.
            watcher = asyncio.create_task(_watch_amd(amd_queue, openai_ws, twilio_ws, state))
            try:
                # 4. Relay both directions until either side ends.
                await asyncio.gather(
                    _caller_to_model(twilio_ws, openai_ws),
                    _model_to_caller(twilio_ws, openai_ws, state, executor),
                )
            finally:
                watcher.cancel()
    except Exception as exc:  # noqa: BLE001 — surface, don't crash the server
        log.warning("bridge ended: %s", exc)
    finally:
        amd.unregister(call_sid)
        await _finalize_call(state, params, executor)


def _record(state: dict, speaker: str, text: str | None) -> None:
    """Append a completed turn to the running transcript and log it as it happens."""
    line = (text or "").strip()
    if not line:
        return
    state["transcript"].append((speaker, line))
    log.info("%s: %s", speaker.upper(), line)


def _note_outcome(state: dict, name: str, args: dict, result: str) -> None:
    """Infer the call's outcome from the tool the agent just used successfully."""
    try:
        data = json.loads(result)
    except (json.JSONDecodeError, TypeError):
        data = {}
    if name == "book_appointment" and data.get("booked"):
        state["outcome"] = "booked"
    elif name == "schedule_callback" and data.get("scheduled"):
        state["outcome"] = "callback"
    elif name == "mark_outcome":
        outcome = (args.get("outcome") or "").strip()
        if outcome:
            state["outcome"] = outcome  # wrong_number / declined / unreachable


_OUTCOME_SUMMARY = {
    "booked": "Booked a consultation.",
    "callback": "Asked to be called back later.",
    "declined": "Not interested — declined.",
    "wrong_number": "Wrong number.",
    "unreachable": "Could not reach the lead.",
    "voicemail": "Left a voicemail.",
}


def _fmt_duration(seconds: float) -> str:
    total = int(seconds)
    return f"{total // 60}m {total % 60}s"


def _summary(state: dict) -> str:
    """A one-line summary: what happened + how long the call took."""
    base = _OUTCOME_SUMMARY.get(state.get("outcome") or "", "Call ended with no clear outcome.")
    return f"{base} ({_fmt_duration(time.monotonic() - state.get('started', time.monotonic()))})"


def _log_call_end(state: dict, params: dict) -> None:
    """When the call ends, log the whole transcript in one block for easy review."""
    turns = state.get("transcript", [])
    lead = params.get("lead_name") or "?"
    if not turns:
        log.info("call ended (lead %s) — no transcript captured", lead)
        return
    block = "\n".join(f"  {who.upper()}: {text}" for who, text in turns)
    log.info("call ended (lead %s) — %s — %d turns:\n%s", lead, _summary(state), len(turns), block)


async def _finalize_call(state: dict, params: dict, executor: ToolExecutor) -> None:
    """At call end: log the transcript, then persist it (+ summary) to the backend per lead."""
    _log_call_end(state, params)
    turns = state.get("transcript", [])
    if not turns:
        return
    transcript_text = "\n".join(f"{who.upper()}: {text}" for who, text in turns)
    await executor.record_call_log(transcript_text, _summary(state))


async def _await_start(twilio_ws: WebSocket) -> tuple[str, str, dict]:
    """Read Twilio events until the 'start' arrives; return (streamSid, callSid, customParameters)."""
    try:
        while True:
            evt = json.loads(await twilio_ws.receive_text())
            if evt.get("event") == "start":
                start = evt.get("start", {})
                return (
                    start.get("streamSid", ""),
                    start.get("callSid", ""),
                    (start.get("customParameters") or {}),
                )
            if evt.get("event") == "stop":
                return "", "", {}
    except WebSocketDisconnect:
        return "", "", {}


_VOICEMAIL_INSTRUCTION = (
    "You've reached the person's voicemail, not a live person. Leave a brief spoken message in the "
    "SAME language you have been using: say you're Tess from TecAce, following up on the "
    "consultation they requested, and that you'll try again soon. Do NOT ask questions or wait for "
    "a reply, and do NOT mention email. Keep it under 15 seconds and speak only the message."
)


async def _send_voicemail_response(openai_ws) -> None:
    """Drive a response whose only job is to speak the voicemail message."""
    await openai_ws.send(
        json.dumps({"type": "response.create", "response": {"instructions": _VOICEMAIL_INSTRUCTION}})
    )


async def _watch_amd(queue: asyncio.Queue, openai_ws, twilio_ws: WebSocket, state: dict) -> None:
    """Wait for Twilio's answering-machine-detection result. If a machine answered, cut whatever
    the agent was saying, have it leave a voicemail, and end the call. Does nothing for a human."""
    try:
        answered_by = await queue.get()
    except asyncio.CancelledError:
        return
    if not is_machine(answered_by) or state.get("closing") or state.get("hangup_pending"):
        return
    log.info("AMD says voicemail (%s) — leaving a message, then hanging up", answered_by)
    state["outcome"] = "voicemail"
    state["hangup_pending"] = True
    state["spoke_since_user"] = False
    # Cut any half-spoken greeting to the machine, cancel whatever's in flight (best-effort — if
    # nothing is active OpenAI just logs an error), give it a beat to settle, then leave the
    # voicemail. We don't rely on response-state tracking here since it can drift.
    await twilio_ws.send_json({"event": "clear", "streamSid": state["stream_sid"]})
    await openai_ws.send(json.dumps({"type": "response.cancel"}))
    await asyncio.sleep(0.4)
    await _send_voicemail_response(openai_ws)

    async def _backstop() -> None:
        await asyncio.sleep(_HANGUP_FALLBACK_SECONDS)
        if state.get("hangup_pending"):  # message never finished — end anyway
            await _drain_and_close(twilio_ws, state)

    state["hangup_backstop"] = asyncio.create_task(_backstop())


async def _caller_to_model(twilio_ws: WebSocket, openai_ws) -> None:
    """Forward the caller's audio to the model."""
    try:
        while True:
            evt = json.loads(await twilio_ws.receive_text())
            e = evt.get("event")
            if e == "media":
                await openai_ws.send(
                    json.dumps({"type": "input_audio_buffer.append", "audio": evt["media"]["payload"]})
                )
            elif e == "mark":
                # The agent asked to hang up; Twilio echoes our "endcall" mark once it has played
                # all the audio queued before it (i.e. the goodbye finished). Now close the stream,
                # which ends the <Connect><Stream> and hangs up the call.
                if (evt.get("mark") or {}).get("name") == "endcall":
                    await twilio_ws.close()
                    break
            elif e == "stop":
                break
    except WebSocketDisconnect:
        pass
    finally:
        await openai_ws.close()


async def _model_to_caller(twilio_ws: WebSocket, openai_ws, state: dict, executor: ToolExecutor) -> None:
    """Forward the model's audio to the caller and handle tool calls + barge-in."""
    try:
        async for raw in openai_ws:
            evt = json.loads(raw)
            t = evt.get("type")

            if t == "response.output_audio.delta":
                state["spoke_since_user"] = True
                await twilio_ws.send_json(
                    {"event": "media", "streamSid": state["stream_sid"], "media": {"payload": evt["delta"]}}
                )
            elif t == "response.created":
                state["response_active"] = True
            elif t == "response.done":
                state["response_active"] = False
                # If a hang-up is pending and the agent just spoke (its farewell / voicemail),
                # close now — we don't wait for the model to call end_call a second time.
                if state.get("hangup_pending") and state.get("spoke_since_user"):
                    await _drain_and_close(twilio_ws, state)
            elif t == "input_audio_buffer.speech_started":
                # The lead started talking. Reset the "agent has spoken" flag so a goodbye is
                # required again before we'll hang up, and cancel any pending hang-up — they have
                # more to say. Also barge-in: flush what we're playing and stop the current
                # response so it doesn't talk over them.
                state["spoke_since_user"] = False
                state["hangup_pending"] = False
                await twilio_ws.send_json({"event": "clear", "streamSid": state["stream_sid"]})
                if state["response_active"]:
                    await openai_ws.send(json.dumps({"type": "response.cancel"}))
            elif t == "response.output_audio_transcript.done":
                # What the AGENT just said (transcribed from its own audio).
                _record(state, "agent", evt.get("transcript"))
            elif t == "conversation.item.input_audio_transcription.completed":
                # What the LEAD just said (transcribed from their audio).
                _record(state, "lead", evt.get("transcript"))
            elif t == "response.function_call_arguments.done":
                if evt.get("name") == "end_call":
                    await _handle_end_call(twilio_ws, openai_ws, evt, state)
                else:
                    # Run the tool WITHOUT blocking this receive loop: while the backend request is
                    # in flight, events that arrive (the response finishing, or the lead saying
                    # "okay") get handled in order rather than piling up and cancelling the tool's
                    # own reply once it's created. Keep a reference so the task isn't GC'd.
                    task = asyncio.create_task(_handle_tool_call(openai_ws, evt, executor, state))
                    state["_tool_tasks"].add(task)
                    task.add_done_callback(state["_tool_tasks"].discard)
            elif t == "error":
                log.warning("openai error: %s", evt.get("error"))
    except WebSocketDisconnect:
        pass
    except websockets.ConnectionClosed:
        pass


def _farewell_instruction(state: dict) -> str:
    """The per-response instruction that makes the model speak the farewell — and ONLY that. Kept
    out of the model's own composition on purpose: left to itself it narrates ("let me wrap this
    up…") or skips the farewell. Tailored to the outcome so a booked call looks forward to the
    consultation while a wrong number / decline just signs off warmly."""
    if state.get("outcome") == "booked":
        core = (
            'On behalf of the team (use "we", not "I"), tell them we are looking forward to '
            "speaking with them at their consultation, then wish them a wonderful day and say "
            'goodbye — for example: "We are looking forward to speaking with you at your '
            'consultation. Have a wonderful day — goodbye!"'
        )
    else:
        core = (
            "Warmly wish them a wonderful day and say goodbye — for example: "
            '"Thanks so much. Have a wonderful day — goodbye!"'
        )
    return (
        "The call is ending now. Speak a short, warm farewell to the person, in the SAME language "
        "you have been speaking (translate the example if that language is not English). "
        + core
        + " Output ONLY the spoken farewell words — do NOT announce or describe it, and do NOT say "
        "things like 'let me wrap this up' or 'let me close things out'. Just say the farewell."
    )


async def _handle_end_call(twilio_ws: WebSocket, openai_ws, evt: dict, state: dict) -> None:
    """End the call. We ALWAYS deliver the farewell ourselves via a tight per-response instruction,
    then hang up once it plays — so the model can't narrate the goodbye, water it down, or skip it.
    The agent's only job is to CALL end_call when the conversation is genuinely over; the farewell
    wording and the hang-up are handled here.

    We ack the tool, then drive a farewell-only response. Its response.done triggers the drain (see
    _model_to_caller), and a backstop timer closes the line even if that farewell never comes.
    """
    call_id = evt.get("call_id", "")
    await openai_ws.send(
        json.dumps(
            {
                "type": "conversation.item.create",
                "item": {"type": "function_call_output", "call_id": call_id, "output": '{"ok": true}'},
            }
        )
    )
    # Already ending (a second end_call, or one fired during the farewell) — don't double up.
    if state.get("hangup_pending") or state.get("closing"):
        return

    log.info("end_call — delivering the farewell, then hanging up")
    state["hangup_pending"] = True
    # Anything the model may have said in THIS turn shouldn't count as the farewell: reset the flag
    # so the drain waits for the farewell response's audio (below), not this turn's response.done.
    state["spoke_since_user"] = False
    await openai_ws.send(
        json.dumps({"type": "response.create", "response": {"instructions": _farewell_instruction(state)}})
    )

    async def _backstop() -> None:
        await asyncio.sleep(_HANGUP_FALLBACK_SECONDS)
        if state.get("hangup_pending"):  # farewell never completed — end anyway
            await _drain_and_close(twilio_ws, state)

    state["hangup_backstop"] = asyncio.create_task(_backstop())


async def _drain_and_close(twilio_ws: WebSocket, state: dict) -> None:
    """Play out the buffered goodbye, then hang up. Idempotent (guarded by 'closing').

    Sends Twilio a "mark"; Twilio finishes playing everything queued and echoes it back (handled in
    _caller_to_model), which closes the stream and ends the <Connect><Stream> — i.e. hangs up. A
    fallback timer guarantees the hang-up even if the echo never arrives.
    """
    if state.get("closing"):
        return
    state["closing"] = True
    state["hangup_pending"] = False
    await twilio_ws.send_json(
        {"event": "mark", "streamSid": state["stream_sid"], "mark": {"name": "endcall"}}
    )

    async def _fallback() -> None:
        await asyncio.sleep(_HANGUP_FALLBACK_SECONDS)
        try:
            await twilio_ws.close()
        except Exception:  # noqa: BLE001 — best-effort backstop
            pass

    # Keep a reference on state so the task isn't garbage-collected before it fires.
    state["hangup_fallback"] = asyncio.create_task(_fallback())


async def _handle_tool_call(openai_ws, evt: dict, executor: ToolExecutor, state: dict) -> None:
    name = evt.get("name", "")
    call_id = evt.get("call_id", "")
    try:
        args = json.loads(evt.get("arguments") or "{}")
    except json.JSONDecodeError:
        args = {}
    log.info("tool call: %s %s", name, args)
    result = await executor.run(name, args)
    _note_outcome(state, name, args, result)
    # Feed the result back and let the model continue speaking.
    await openai_ws.send(
        json.dumps(
            {
                "type": "conversation.item.create",
                "item": {"type": "function_call_output", "call_id": call_id, "output": result},
            }
        )
    )
    await openai_ws.send(json.dumps({"type": "response.create"}))
