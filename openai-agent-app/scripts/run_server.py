"""Run the media-stream server (the WebSocket Twilio connects each call to).

    python scripts/run_server.py

Then expose it publicly (e.g. `ngrok http 5050`) and set PUBLIC_HOST to the ngrok host so
Twilio's <Stream> can reach it. Requires OPENAI_API_KEY and BACKEND_URL (see .env.example).
"""

from __future__ import annotations

import logging

import uvicorn

from openai_agent.config import Config


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    cfg = Config.load()
    gaps = cfg.missing_for_server()
    if gaps:
        print("WARNING — missing settings the server needs: " + ", ".join(gaps))
        print("The server will start, but calls will fail until these are set (see .env.example).")
    for gap in cfg.insecure_endpoints():
        print("WARNING — unauthenticated: " + gap)
    print(f"media-stream server on :{cfg.port} — WebSocket path /media-stream")
    uvicorn.run("openai_agent.telephony.server:app", host="0.0.0.0", port=cfg.port)


if __name__ == "__main__":
    main()
