"""Check that this poller can reach the backend, and say exactly what went wrong if it can't.

    python scripts/checks/verify_backend.py

Sends one real heartbeat and reports the HTTP status. The poller's own heartbeat is best-effort and
deliberately quiet — it must never take down transcription — which means a mis-set BACKEND_URL or a
stale ingest key looks identical to everything working, except the dashboard's poller status stays
grey with no explanation. This is the thing to run when that happens.

Nothing is written to the Google Sheet and no mailbox is touched.
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from transcribe_app.config import Config  # noqa: E402


def main() -> int:
    cfg = Config.load()

    if not cfg.backend_url:
        print("backend: not configured — BACKEND_URL is empty in .env.")
        print("The poller will still transcribe; nothing reaches the dashboard, including the")
        print("heartbeat, so its poller status stays grey.")
        return 1

    url = cfg.backend_url.rstrip("/") + "/transcribe/heartbeat"
    mailbox = cfg.mailbox_email()
    print(f"backend url : {cfg.backend_url}")
    print(f"mailbox     : {mailbox or '(none — runs report as unattributed)'}")
    print(f"ingest key  : {'set' if cfg.transcribe_ingest_key else 'NOT SET'}")
    print(f"POST        : {url}")
    print()

    payload = {
        "intervalSeconds": int(cfg.poll_interval_seconds),
        "lastCycleOk": True,
        "detail": "verify_backend.py",
        "host": "verify_backend",
    }
    if mailbox:
        payload["mailboxEmail"] = mailbox

    req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), method="POST")
    req.add_header("Content-Type", "application/json")
    if cfg.transcribe_ingest_key:
        req.add_header("x-transcribe-key", cfg.transcribe_ingest_key)

    try:
        with urllib.request.urlopen(req, timeout=cfg.request_timeout) as resp:
            body = resp.read().decode("utf-8", "replace")[:300]
            print(f"backend: ok — HTTP {resp.status} {body}")
            print()
            print("The dashboard's poller status should turn green within a minute (admins only).")
            return 0
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:300]
        print(f"backend: FAIL — HTTP {exc.code}: {detail}")
        if exc.code == 401:
            print("  -> TRANSCRIBE_INGEST_KEY here doesn't match the backend's. The heartbeat and")
            print("     run reporting share that key, so both are failing.")
        elif exc.code == 404:
            print("  -> No /transcribe/heartbeat on that backend. It is running a build from")
            print("     before the heartbeat was added — redeploy transcribe-backend.")
        elif exc.code >= 500:
            print("  -> The backend errored. Check its logs; if this is the first request after a")
            print("     deploy it may be the schema migration failing.")
        return 1
    except Exception as exc:  # noqa: BLE001 — DNS, TLS, timeouts all land here
        print(f"backend: FAIL — {exc}")
        print("  -> Couldn't reach it at all. Check BACKEND_URL is right and reachable from this")
        print("     machine (a VPS firewall or a typo in the host are the usual causes).")
        return 1


if __name__ == "__main__":
    sys.exit(main())
