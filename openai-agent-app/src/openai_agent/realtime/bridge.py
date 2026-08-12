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

import websockets
from fastapi import WebSocket, WebSocketDisconnect

from ..config import Config
from ..tools.agent_tools import ToolExecutor
from .instructions import build_instructions
from .session import build_session_update

log = logging.getLogger(__name__)

_OPENAI_WS = "wss://api.openai.com/v1/realtime?model={model}"


async def run_bridge(twilio_ws: WebSocket, cfg: Config) -> None:
    await twilio_ws.accept()

    # 1. Wait for Twilio's "start" event — it carries the streamSid and the lead's context.
    stream_sid, params = await _await_start(twilio_ws)
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
    )
    executor = ToolExecutor(cfg, intake_id=params.get("intake_id", ""))

    # 3. Open the Realtime session and configure it.
    url = _OPENAI_WS.format(model=cfg.openai_model)
    headers = {"Authorization": f"Bearer {cfg.openai_api_key}"}
    try:
        async with websockets.connect(url, additional_headers=headers) as openai_ws:
            await openai_ws.send(json.dumps(build_session_update(cfg, instructions)))
            state = {"stream_sid": stream_sid, "response_active": False}
            # 4. Relay both directions until either side ends.
            await asyncio.gather(
                _caller_to_model(twilio_ws, openai_ws),
                _model_to_caller(twilio_ws, openai_ws, state, executor),
            )
    except Exception as exc:  # noqa: BLE001 — surface, don't crash the server
        log.warning("bridge ended: %s", exc)


async def _await_start(twilio_ws: WebSocket) -> tuple[str, dict]:
    """Read Twilio events until the 'start' arrives; return (streamSid, customParameters)."""
    try:
        while True:
            evt = json.loads(await twilio_ws.receive_text())
            if evt.get("event") == "start":
                start = evt.get("start", {})
                return start.get("streamSid", ""), (start.get("customParameters") or {})
            if evt.get("event") == "stop":
                return "", {}
    except WebSocketDisconnect:
        return "", {}


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
                await twilio_ws.send_json(
                    {"event": "media", "streamSid": state["stream_sid"], "media": {"payload": evt["delta"]}}
                )
            elif t == "response.created":
                state["response_active"] = True
            elif t == "response.done":
                state["response_active"] = False
            elif t == "input_audio_buffer.speech_started":
                # Barge-in: the caller started talking — flush what we're playing and stop the
                # model's current response so it doesn't talk over them.
                await twilio_ws.send_json({"event": "clear", "streamSid": state["stream_sid"]})
                if state["response_active"]:
                    await openai_ws.send(json.dumps({"type": "response.cancel"}))
            elif t == "response.function_call_arguments.done":
                await _handle_tool_call(openai_ws, evt, executor)
            elif t == "error":
                log.warning("openai error: %s", evt.get("error"))
    except WebSocketDisconnect:
        pass
    except websockets.ConnectionClosed:
        pass


async def _handle_tool_call(openai_ws, evt: dict, executor: ToolExecutor) -> None:
    name = evt.get("name", "")
    call_id = evt.get("call_id", "")
    try:
        args = json.loads(evt.get("arguments") or "{}")
    except json.JSONDecodeError:
        args = {}
    log.info("tool call: %s %s", name, args)
    result = await executor.run(name, args)
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
