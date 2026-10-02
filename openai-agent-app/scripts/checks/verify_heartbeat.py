"""Check the heartbeat sender against a local fake backend, without a network or keys.

    python scripts/checks/verify_heartbeat.py

Sends one tick through the synchronous and the asynchronous sender and checks what reaches
POST /agent/heartbeat: the URL, the x-agent-key header and every body field; that a status function
which throws goes out as ok:false; that a backend answering 500 (or 401, or nothing at all) never
raises into the caller; and that an unset URL sends nothing.

Run it after editing src/openai_agent/heartbeat.py.
"""

from __future__ import annotations

import asyncio
import datetime
import json
import socket
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from openai_agent import heartbeat as hb  # noqa: E402

KEY = "test-agent-key"
received: list[dict] = []
reply_status = 200


class Handler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("Content-Length", "0"))
        body = json.loads(self.rfile.read(length) or b"{}")
        received.append({"path": self.path, "key": self.headers.get("x-agent-key"), "body": body})
        self.send_response(reply_status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"ok":true}')

    def log_message(self, *_args) -> None:  # keep the output readable
        pass


server = HTTPServer(("127.0.0.1", 0), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{server.server_port}"


def cfg(url: str = BASE, key: str = KEY) -> SimpleNamespace:
    return SimpleNamespace(business_config_url=url, agent_config_key=key)


def fine() -> tuple[bool, str, dict]:
    return True, "", {"activeCalls": 2}


def boom() -> tuple[bool, str, dict]:
    raise RuntimeError("status exploded")


failures = 0


def check(name: str, cond: bool) -> None:
    global failures
    print(("ok    " if cond else "FAIL  ") + name)
    if not cond:
        failures += 1


def reset(status: int = 200) -> None:
    global reply_status
    received.clear()
    reply_status = status
    hb._delivered.clear()


def check_good(label: str, sent: bool) -> None:
    check(f"{label}: send reported success", sent is True)
    check(f"{label}: exactly one POST", len(received) == 1)
    got = received[0]
    body = got["body"]
    check(f"{label}: path is /agent/heartbeat", got["path"] == "/agent/heartbeat")
    check(f"{label}: x-agent-key header", got["key"] == KEY)
    check(f"{label}: service", body["service"] == "server")
    check(f"{label}: intervalSeconds is the 60 s default", body["intervalSeconds"] == 60)
    check(f"{label}: ok true", body["ok"] is True)
    check(f"{label}: detail empty when fine", body["detail"] == "")
    check(f"{label}: host", body["host"] == socket.gethostname())
    check(f"{label}: metrics", body["metrics"] == {"activeCalls": 2})
    started = datetime.datetime.fromisoformat(body["startedAt"])
    check(f"{label}: startedAt is a UTC ISO-8601 time", started.utcoffset() == datetime.timedelta(0))


def check_error_path(label: str, sent: bool) -> None:
    check(f"{label}: send reported success", sent is True)
    body = received[0]["body"]
    check(f"{label}: ok false when the status function throws", body["ok"] is False)
    check(f"{label}: detail carries the exception text", "status exploded" in body["detail"])
    check(f"{label}: metrics still an object", body["metrics"] == {})


# --- Synchronous sender ---------------------------------------------------------------------
reset()
check_good("sync", hb.send_once(cfg(), "server", fine))
reset()
check_error_path("sync", hb.send_once(cfg(), "server", boom))

# --- Asynchronous sender --------------------------------------------------------------------
reset()
check_good("async", asyncio.run(hb.send_once_async(cfg(), "server", fine)))
reset()
check_error_path("async", asyncio.run(hb.send_once_async(cfg(), "server", boom)))

# --- detail is capped at 300 characters, to match the backend ----------------------------------
reset()
hb.send_once(cfg(), "server", lambda: (False, "x" * 1000, {}))
check("detail capped at 300 characters", received and len(received[0]["body"]["detail"]) == 300)

# --- A trailing slash on the URL does not double up -----------------------------------------
reset()
hb.send_once(cfg(BASE + "/"), "server", fine)
check("trailing slash tolerated", received and received[0]["path"] == "/agent/heartbeat")

# --- A failing backend never raises, and is warned about once -------------------------------
for status in (500, 401):
    reset(status)
    warnings: list[str] = []

    class Capture(__import__("logging").Handler):
        def emit(self, record) -> None:  # noqa: D102
            if record.levelname == "WARNING":
                warnings.append(record.getMessage())

    handler = Capture()
    hb.log.addHandler(handler)
    try:
        r1 = hb.send_once(cfg(), "server", fine)
        r2 = asyncio.run(hb.send_once_async(cfg(), "server", fine))
        r3 = hb.send_once(cfg(), "server", fine)
    finally:
        hb.log.removeHandler(handler)
    check(f"{status}: sync/async senders return False instead of raising", (r1, r2, r3) == (False, False, False))
    check(f"{status}: three identical failures log one warning", len(warnings) == 1)
    reset(200)
    check(f"{status}: recovery is reported as success", hb.send_once(cfg(), "server", fine) is True)

# --- A backend that is not listening at all never raises ------------------------------------
reset()
dead = socket.socket()
dead.bind(("127.0.0.1", 0))
dead_port = dead.getsockname()[1]
dead.close()
check("unreachable backend: sync returns False", hb.send_once(cfg(f"http://127.0.0.1:{dead_port}"), "server", fine) is False)
check(
    "unreachable backend: async returns False",
    asyncio.run(hb.send_once_async(cfg(f"http://127.0.0.1:{dead_port}"), "server", fine)) is False,
)

# --- Unset URL or key sends nothing ---------------------------------------------------------
reset()
check("unset URL: sync sends nothing", hb.send_once(cfg(url=""), "server", fine) is False)
check("unset URL: async sends nothing", asyncio.run(hb.send_once_async(cfg(url=""), "server", fine)) is False)
check("unset key: sync sends nothing", hb.send_once(cfg(key=""), "server", fine) is False)
check("unset URL: no thread started", hb.start_heartbeat_thread(cfg(url=""), "poller", fine) is None)
check("nothing reached the server", received == [])

# --- The thread and the loop beat once at start ---------------------------------------------
reset()
thread = hb.start_heartbeat_thread(cfg(), "poller", fine)
for _ in range(50):
    if received:
        break
    threading.Event().wait(0.1)
check("thread: beats at start, as a daemon", thread is not None and thread.daemon and len(received) >= 1)
check("thread: service name carried", received and received[0]["body"]["service"] == "poller")


async def loop_beats_at_start() -> bool:
    task = asyncio.create_task(hb.heartbeat_loop(cfg(), "scenarios", fine))
    for _ in range(50):
        if any(r["body"]["service"] == "scenarios" for r in received):
            break
        await asyncio.sleep(0.1)
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    return any(r["body"]["service"] == "scenarios" for r in received)


check("loop: beats at start and cancels cleanly", asyncio.run(loop_beats_at_start()))

server.shutdown()
print()
print("FAILED" if failures else "all heartbeat checks passed")
sys.exit(1 if failures else 0)
