"""Deterministic, stateless stand-in for transcribe-backend, for dashboard regression runs.

Every route the dashboard calls answers with fixed data shaped like src/api/types.ts. Nothing is
stored: a POST that would change state answers as if it worked and forgets it, so two runs in a row
(old app, then new app) see exactly the same backend.
"""

from __future__ import annotations

import json
import threading
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

NOW = datetime(2026, 9, 15, 18, 0, 0, tzinfo=timezone.utc)


def iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%S.000Z")


ADMIN = {"id": "u-admin", "email": "admin@tecace.com", "name": "Ada Admin", "role": "admin",
         "lastLoginAt": iso(NOW - timedelta(hours=2))}
USER = {"id": "u-sam", "email": "sam@tecace.com", "name": "Sam Customer", "role": "user",
        "lastLoginAt": iso(NOW - timedelta(days=1))}
TOKENS = {"tok-admin": ADMIN, "tok-user": USER}
SAM = "sam@tecace.com"


def _runs() -> list[dict]:
    """20 runs, one every 6 hours, newest first. Every 4th is empty, every 7th has a failure."""
    runs = []
    for i in range(20):
        processed = 0 if i % 4 == 3 else (i % 5) + 1
        failed = 1 if i % 7 == 2 else 0
        skipped = i % 3
        runs.append({
            "id": f"run-{i:02d}",
            "mailboxEmail": SAM if i % 2 == 0 else None,
            "voicemails": processed + failed + skipped,
            "processed": processed,
            "skipped": skipped,
            "failed": failed,
            "createdAt": iso(NOW - timedelta(hours=6 * i, minutes=5)),
        })
    return runs


RUNS = _runs()


def stats() -> dict:
    # Deliberately ignores ?mailbox: every scope gets the same numbers. The harness compares old vs
    # new under identical input, so realism per scope doesn't matter — determinism does.
    daily = []
    for d in range(13, -1, -1):
        day = (NOW - timedelta(days=d)).strftime("%Y-%m-%d")
        daily.append({"day": day, "processed": (d * 3) % 7})
    return {
        "totalProcessed": sum(r["processed"] for r in RUNS),
        "totalFailed": sum(r["failed"] for r in RUNS),
        "runs": len(RUNS),
        "lastRunAt": RUNS[0]["createdAt"],
        "today": 4,
        "last7Days": 23,
        "thisMonth": 41,
        "prevMonth": 57,
        "cap": {"limit": 50, "warnAt": 0.8, "overageRate": 0.25},
        "daily": daily,
        "recent": RUNS[:10],
        "runSeries": list(reversed(RUNS)),
    }


def analytics() -> dict:
    # Like stats(), deliberately ignores ?mailbox.
    productive = [r for r in RUNS if r["processed"] > 0]
    sessions = []
    for idx, r in enumerate(productive):
        sessions.append({**r, "sincePreviousSeconds": 21600 * (1 if idx % 3 else 2)})
    return {
        "totals": {
            "voicemails": sum(r["voicemails"] for r in RUNS),
            "processed": sum(r["processed"] for r in RUNS),
            "skipped": sum(r["skipped"] for r in RUNS),
            "failed": sum(r["failed"] for r in RUNS),
            "runs": len(RUNS),
            "emptyRuns": len(RUNS) - len(productive),
            "firstRunAt": RUNS[-1]["createdAt"],
            "lastRunAt": RUNS[0]["createdAt"],
        },
        "sessions": sessions,
        "byHour": [{"hour": h, "processed": (h * 5) % 9, "runs": (h % 4) + 1} for h in range(24)],
        "byWeekday": [{"weekday": w, "processed": w * 3, "runs": w + 1} for w in range(1, 8)],
        "cadence": {"medianGapSeconds": 21600, "longestGapSeconds": 190000,
                    "longestGapEndedAt": iso(NOW - timedelta(days=3))},
        "perRun": {
            "productiveRuns": len(productive),
            "medianProcessed": 3,
            "maxProcessed": 5,
            "distribution": [{"processed": n, "runs": 5 - abs(3 - n)} for n in range(1, 6)],
        },
    }


def mailboxes() -> list[dict]:
    def summary(email, runs, processed):
        return {"mailboxEmail": email, "runs": runs, "voicemails": processed + 3, "processed": processed,
                "skipped": 2, "failed": 1, "today": 2, "last7Days": 9, "activeDays": 11,
                "firstRunAt": RUNS[-1]["createdAt"], "lastRunAt": RUNS[0]["createdAt"]}
    return [summary(SAM, 10, 30), summary(None, 10, 12)]


FAILURES = [
    {"id": "f-1", "runId": "run-02", "mailboxEmail": SAM, "filename": "voicemail-0912.wav",
     "fromAddr": "+15551230001", "error": "Sheets API 503: backend unavailable",
     "createdAt": iso(NOW - timedelta(hours=12)), "acknowledgedAt": None},
    {"id": "f-2", "runId": "run-09", "mailboxEmail": None, "filename": "voicemail-0911.wav",
     "fromAddr": "+15551230002", "error": "Audio too short (0.4s)",
     "createdAt": iso(NOW - timedelta(days=2)), "acknowledgedAt": iso(NOW - timedelta(days=1))},
]

HEARTBEATS = [
    {"mailboxEmail": SAM, "lastSeenAt": iso(NOW - timedelta(seconds=40)), "intervalSeconds": 300,
     "lastCycleOk": True, "detail": None, "host": "vps-1", "online": True, "secondsSinceSeen": 40},
]

FEEDBACK = [
    {"id": "fb-1", "userId": "u-sam", "authorName": "Sam Customer", "authorEmail": SAM,
     "category": "bug", "message": "The chart label overlaps\non small screens.", "screenshot": None,
     "status": "open", "createdAt": iso(NOW - timedelta(days=1)), "resolvedAt": None, "resolvedBy": None},
    {"id": "fb-2", "userId": "u-admin", "authorName": "Ada Admin", "authorEmail": "admin@tecace.com",
     "category": "idea", "message": "Weekly email digest?", "screenshot": None, "status": "resolved",
     "createdAt": iso(NOW - timedelta(days=5)), "resolvedAt": iso(NOW - timedelta(days=4)),
     "resolvedBy": "Ada Admin"},
]

NUMBERS = [
    {"id": "n-1", "phoneE164": "+14255550100", "label": "Main line", "userId": "u-sam",
     "userEmail": SAM, "userName": "Sam Customer", "createdAt": iso(NOW - timedelta(days=30)),
     "updatedAt": iso(NOW - timedelta(days=10))},
    {"id": "n-2", "phoneE164": "+14255550199", "label": None, "userId": None, "userEmail": None,
     "userName": None, "createdAt": iso(NOW - timedelta(days=3)), "updatedAt": iso(NOW - timedelta(days=3))},
]

PROFILE = {
    "userId": "u-sam",
    "sourceText": "Sam's Dental. Open 8 to 5 weekdays. Cleanings, whitening, emergency visits.",
    "businessName": "Sam's Dental", "hoursText": "Mon–Fri 8am–5pm", "openHour": 8, "closeHour": 17,
    "website": "https://samsdental.example", "facts": "- Cleanings\n- Whitening\n- Emergency visits",
    "transferNumber": "+14255550111", "agentName": None, "greeting": None, "houseRules": None,
    "transferTopics": None, "isLive": True, "extractedAt": iso(NOW - timedelta(days=10)),
    "updatedAt": iso(NOW - timedelta(days=10)),
}

CALLS = [
    {"id": "c-1", "userId": "u-sam", "dialled": "+14255550100", "caller": "+15551234567",
     "callerName": "Jordan Lee", "callbackNumber": "+15551234567", "request": "Book a cleaning",
     "summary": "Wants a cleaning next week.", "outcome": "callback", "callbackRequested": True,
     "durationSeconds": 94, "turns": [{"speaker": "agent", "text": "Hello, Sam's Dental."},
                                     {"speaker": "caller", "text": "I'd like a cleaning."}],
     "startedAt": iso(NOW - timedelta(hours=5)), "createdAt": iso(NOW - timedelta(hours=5))},
]

MINUTES = [
    {"userId": "u-sam", "email": SAM, "name": "Sam Customer", "businessName": "Sam's Dental",
     "currentMonth": "2026-09", "currentSeconds": 1260, "currentMinutes": 21, "previousMonth": "2026-08",
     "previousSeconds": 3000, "previousMinutes": 50, "updatedAt": iso(NOW - timedelta(hours=5))},
]

KEYS = [
    {"id": "k-1", "name": "CRM sync", "keyPrefix": "tk_live_ab", "createdAt": iso(NOW - timedelta(days=9)),
     "createdBy": "Ada Admin", "lastUsedAt": iso(NOW - timedelta(hours=1)), "revokedAt": None},
]


def route(method: str, path: str, query: dict, user: dict | None):
    """Returns (status, body). `user` is None when no/unknown bearer token was sent."""
    if path == "/auth/setup-state":
        return 200, {"needsSetup": False}
    if path == "/auth/login" and method == "POST":
        return 401, {"message": "Wrong email or password."}
    if user is None:
        return 401, {"message": "Not signed in."}
    admin = user["role"] == "admin"

    if path == "/auth/me":
        return 200, {"user": user}
    if path == "/auth/logout":
        return 200, {}
    if path == "/auth/users" and method == "GET":
        return (200, {"users": [ADMIN, USER]}) if admin else (403, {"message": "Admins only."})
    if path == "/transcribe/stats":
        return 200, stats()
    if path == "/transcribe/analytics":
        return 200, analytics()
    if path == "/transcribe/mailboxes":
        return 200, {"mailboxes": mailboxes()}
    if path == "/transcribe/failures":
        return 200, {"failures": FAILURES, "unacknowledged": 1}
    if path == "/transcribe/failures/count":
        return 200, {"unacknowledged": 1}
    if path == "/transcribe/failures/acknowledge":
        return 200, {"cleared": 1}
    if path == "/transcribe/heartbeats":
        return 200, {"pollers": HEARTBEATS, "offline": 0}
    if path == "/feedback/mine":
        return 200, {"feedback": [f for f in FEEDBACK if f["userId"] == user["id"]]}
    if path == "/feedback/open-count":
        return 200, {"open": 1}
    if path == "/feedback" and method == "GET":
        return 200, {"feedback": FEEDBACK, "open": 1}
    if path == "/business/numbers" and method == "GET":
        return 200, {"numbers": NUMBERS}
    if path == "/business/profile" and method == "GET":
        return 200, {"profile": PROFILE, "defaultBehaviour": [
            {"does": "Answers in the caller's language", "because": "Callers switch languages."},
            {"does": "Offers a callback when it can't help"}],
            "factsStale": False, "number": NUMBERS[0], "maxSourceChars": 4000}
    if path == "/calls":
        return 200, {"calls": CALLS}
    if path == "/usage/minutes":
        return 200, {"timezone": "America/Los_Angeles", "minutes": MINUTES}
    if path == "/api-keys" and method == "GET":
        return 200, {"keys": KEYS}
    return 404, {"message": f"No fake for {method} {path}"}


class Handler(BaseHTTPRequestHandler):
    def _send(self, status: int, body: dict | None) -> None:
        payload = b"" if body is None else json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "authorization, content-type, accept")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _handle(self, method: str) -> None:
        url = urlparse(self.path)
        auth = self.headers.get("authorization", "")
        user = TOKENS.get(auth.removeprefix("Bearer ").strip())
        length = int(self.headers.get("content-length") or 0)
        if length:
            self.rfile.read(length)  # drain; the fake never uses bodies
        status, body = route(method, url.path, parse_qs(url.query), user)
        self._send(status, body)

    def do_OPTIONS(self):  # noqa: N802 — BaseHTTPRequestHandler naming
        self._send(204, None)

    def do_GET(self):  # noqa: N802
        self._handle("GET")

    def do_POST(self):  # noqa: N802
        self._handle("POST")

    def do_DELETE(self):  # noqa: N802
        self._handle("DELETE")

    def log_message(self, *_args):  # keep the harness output readable
        pass


class _Server(ThreadingHTTPServer):
    # HTTPServer sets SO_REUSEADDR, which on Windows lets two servers bind the same port silently
    # (so a stray fake from an earlier run could answer instead of this one). Refuse instead.
    allow_reuse_address = False
    daemon_threads = True


def start(port: int = 8899) -> ThreadingHTTPServer:
    server = _Server(("127.0.0.1", port), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


if __name__ == "__main__":
    srv = start()
    print("fake transcribe-backend on http://127.0.0.1:8899 — Ctrl+C to stop")
    try:
        threading.Event().wait()
    except KeyboardInterrupt:
        srv.shutdown()
