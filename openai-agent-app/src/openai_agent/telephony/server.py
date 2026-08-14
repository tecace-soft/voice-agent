"""The media-stream server: the WebSocket endpoint Twilio connects each call's audio to.

Twilio's <Connect><Stream> (see outbound.py) points at ws(s)://<public_host>/media-stream;
each connection is handed to run_bridge, which drives that one call. `/health` reports whether
the server has what it needs to run.
"""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request, WebSocket

from ..config import Config
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
        form = await request.form()
        log.info("AMD: call=%s answered_by=%s", form.get("CallSid"), form.get("AnsweredBy"))
    except Exception as exc:  # noqa: BLE001 — never fail Twilio's callback
        log.warning("AMD callback parse error: %s", exc)
    return {"ok": True}


@app.websocket("/media-stream")
async def media_stream(websocket: WebSocket) -> None:
    await run_bridge(websocket, cfg)
