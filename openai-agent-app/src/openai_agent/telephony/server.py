"""The media-stream server: the WebSocket endpoint Twilio connects each call's audio to.

Twilio's <Connect><Stream> (see outbound.py) points at ws(s)://<public_host>/media-stream;
each connection is handed to run_bridge, which drives that one call. `/health` reports whether
the server has what it needs to run.
"""

from __future__ import annotations

import logging
from urllib.parse import parse_qs

from fastapi import FastAPI, Request, WebSocket

from ..config import Config
from ..realtime import amd
from ..realtime.bridge import run_bridge

log = logging.getLogger(__name__)

cfg = Config.load()
app = FastAPI(title="openai-agent-app media stream")


@app.get("/health")
async def health() -> dict:
    return {"ok": not cfg.missing_for_server(), "missing": cfg.missing_for_server()}


@app.post("/amd")
async def amd_callback(request: Request) -> dict:
    """Twilio's async answering-machine-detection result lands here (it runs in the background so
    it never delays the call). We just log it; the poller reads the same result off the call to
    know when a call reached voicemail. Twilio only needs a 200 back."""
    try:
        # Twilio posts application/x-www-form-urlencoded. Parse the raw body ourselves so we don't
        # depend on python-multipart (which request.form() requires).
        body = (await request.body()).decode("utf-8", "ignore")
        fields = parse_qs(body)
        call_sid = (fields.get("CallSid") or [""])[0]
        answered_by = (fields.get("AnsweredBy") or [""])[0]
        log.info("AMD: call=%s answered_by=%s", call_sid, answered_by)
        # Hand the result to the live call so it can leave a voicemail if this is a machine.
        amd.deliver(call_sid, answered_by)
    except Exception as exc:  # noqa: BLE001 — never fail Twilio's callback
        log.warning("AMD callback parse error: %s", exc)
    return {"ok": True}


@app.websocket("/media-stream")
async def media_stream(websocket: WebSocket) -> None:
    await run_bridge(websocket, cfg)
