"""The media-stream server: the WebSocket endpoint Twilio connects each call's audio to.

Twilio's <Connect><Stream> (see outbound.py) points at ws(s)://<public_host>/media-stream;
each connection is handed to run_bridge, which drives that one call. `/health` reports whether
the server has what it needs to run.
"""

from __future__ import annotations

import logging

from fastapi import FastAPI, WebSocket

from ..config import Config
from ..realtime.bridge import run_bridge

log = logging.getLogger(__name__)

cfg = Config.load()
app = FastAPI(title="openai-agent-app media stream")


@app.get("/health")
async def health() -> dict:
    return {"ok": not cfg.missing_for_server(), "missing": cfg.missing_for_server()}


@app.websocket("/media-stream")
async def media_stream(websocket: WebSocket) -> None:
    await run_bridge(websocket, cfg)
