"""A stand-in for voiceagent_promo's API, for the Demos end-to-end check (demos_e2e.py).

Mirrors the real routes the dashboard uses, as they behave in the promo repo @ f482848, with the
record shapes of its lib/types.ts (Customer, CustomerWithStats) and lib/analytics.ts (Kpis,
DayBucket):
- POST /api/admin/login {password} -> 200 {ok} + httpOnly admin_session cookie, or 401 {error};
  a body that isn't parsable JSON (an empty one included) -> 400 {error: "Invalid request body."}
- DELETE /api/admin/login -> 200 {ok}, clears the cookie
- every other /api/admin/* needs the cookie, else 401 {error: "Not signed in."} (its middleware)
- GET /api/admin/health -> 503 JSON (the promo's "config incomplete" answer — still signed in)
- GET /api/admin/analytics?days=N[&includeTests=1] -> {kpis, window, callsPerDay, topCustomers,
  recentCalls, realCallCount, testCallCount, includeTests} (N outside 7/30/90 -> 30, as the route).
  testCallCount counts the window's test calls whether or not includeTests=1, as the real route's
  `testCalls(windowRaw)` does (the Overview only shows it when test calls are left out)
- GET /api/admin/customers -> {customers: CustomerWithStats[]} (Harbor Dental: ready, live, hot;
  Cedar Bakery: researching, paused, cold, no profile name yet)
- POST /api/admin/customers -> 201 {customer}; bad JSON -> 400 "Invalid request body."; no
  businessName -> 400 "Enter the business name."; a website without http(s):// -> 400; a mapsUrl
  that isn't a Google Maps link (lib/maps.ts isMapsUrl) -> 400 (the route's own messages)
- GET /api/admin/customers/<id> -> {customer, stats, calls, events, notes}
- PATCH /api/admin/customers/<id> -> {customer} (the record with the body's fields applied); bad
  JSON -> 400 "Invalid request body."; a voice not in LIVE_VOICES -> 400 "Unknown voice."; a stage
  not in CUSTOMER_STAGES -> 400 "Unknown stage." (lib/types.ts)
- DELETE /api/admin/customers/<id> -> {ok: true}
- an unknown <id> on GET/PATCH/DELETE -> 404 {error: "Customer not found."}
STATELESS: writes answer as if they worked and change nothing, so every run starts from the same
two records. Every response is JSON — but two known gaps from the real thing: the real promo
answers an unknown route with Next's own HTML 404 page, where this fake still answers JSON; and the
real login cookie carries `Secure` under NODE_ENV=production, which this fake omits (the harness
only ever runs over plain http, where a Secure cookie would just get silently dropped).
"""

from __future__ import annotations

import json
import re
import threading
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

PORT = 8898
# lib/types.ts LIVE_VOICES and CUSTOMER_STAGES, which PATCH validates against.
LIVE_VOICES = ("gleam", "meridian", "delta", "cinder", "quartz", "ripple", "vesper", "willow",
               "stone", "beacon", "bossa", "tempo")
CUSTOMER_STAGES = ("new", "contacted", "interested", "won", "lost")
MAPS_SHORT_HOSTS = ("maps.app.goo.gl", "goo.gl", "g.co")
PASSWORD = "letmein"
COOKIE = "admin_session"
TOKEN = "valid-session"


def _iso(dt: datetime) -> str:
    """The promo's timestamps: `new Date().toISOString()` (UTC, milliseconds, `Z`)."""
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def _ago(**delta: float) -> str:
    return _iso(datetime.now(timezone.utc) - timedelta(**delta))


def _prompts(name: str, agent: str) -> dict:
    who = name or "the business"
    return {
        "live": f"You are {agent}, the receptionist at {who}. Answer callers warmly.",
        "backend": f"Facts about {who} for the receptionist.",
        "greeting": f"Thanks for calling {name or 'us'}, this is {agent}. How can I help?",
        "edited": False,
        "version": 1,
    }


def _empty_profile(name: str) -> dict:
    """lib/research.ts emptyProfile()."""
    return {"name": name, "category": "", "address": "", "hours": [], "services": [],
            "highlights": [], "policies": {}, "faqs": []}


def _empty_stats() -> dict:
    """lib/analytics.ts emptyStats()."""
    return {"views": 0, "calls": 0, "totalSec": 0, "visitors": 0}


# Harbor Dental's real (non-test) calls, newest first: (days ago, duration s, turns). The list's
# stats, the analytics KPIs and the "Recent calls" table all come from these, so they agree.
HARBOR_CALLS = [(0, 240, 18), (1, 180, 12), (4, 120, 9)]
# One operator test call, today: left out of the numbers unless includeTests=1.
HARBOR_TEST_CALLS = [(0, 60, 4)]
HARBOR_VIEWS = 14
HARBOR_CONTACT = "Dana Reyes"


def prospects() -> list[dict]:
    """Two full CustomerWithStats records. Cedar's profile has no name yet (research is running),
    so the table shows it as "Unnamed" and search finds it by its contact email. Timestamps are
    relative to now, so Cedar Bakery reads as "researching" (not stalled — lib/analytics.ts
    RESEARCH_STALL_MS) and Harbor's last call is today."""
    harbor_sec = sum(sec for _, sec, _ in HARBOR_CALLS)
    weekdays = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday")
    harbor = {
        "id": "pr0SPct1",
        "label": "Met at the expo",
        "contactName": HARBOR_CONTACT,
        "contactEmail": "dana@harbordental.example",
        "active": True,
        "businessName": "Harbor Dental",
        "websiteUrl": "https://harbordental.example",
        "profile": {
            "name": "Harbor Dental",
            "category": "Dentist",
            "address": "12 Wharf St, Portland, ME",
            "phone": "+1 207 555 0142",
            "website": "https://harbordental.example",
            "hours": [{"day": d, "open": "08:00", "close": "17:00"} for d in weekdays]
            + [{"day": "Saturday", "open": "", "close": "", "closed": True},
               {"day": "Sunday", "open": "", "close": "", "closed": True}],
            "services": [{"name": "Cleaning", "price": "$120"},
                         {"name": "Whitening", "description": "In-office, one visit."}],
            "highlights": ["Same-week appointments", "Free parking"],
            "policies": {"cancellation": "24 hours notice, please.",
                         "payment": "Cards and most insurance."},
            "faqs": [{"q": "Do you take new patients?", "a": "Yes."}],
            "rating": 4.8,
        },
        "dossier": "Harbor Dental is a family dental practice on the Portland waterfront.",
        "sources": [{"url": "https://harbordental.example", "title": "Harbor Dental"}],
        "prompts": _prompts("Harbor Dental", "Alex"),
        "voice": "gleam",
        "callSound": {"phoneLine": True, "ambience": "quiet"},
        "agentName": "Alex",
        "language": "en",
        "stage": "interested",
        "status": "ready",
        "createdAt": _ago(days=10),
        "updatedAt": _ago(days=2),
        "researchedAt": _ago(days=10),
        "stats": {"views": HARBOR_VIEWS, "calls": len(HARBOR_CALLS), "totalSec": harbor_sec,
                  "visitors": 4, "lastCallAt": _ago(hours=2), "lastViewAt": _ago(hours=3)},
        # engagement(): 3 calls*12 + 9 min*6 + 39 turns*0.6 + min(14 views, 10) = 123.4 -> hot
        "heat": {"score": 123, "level": "hot", "reason": "3 calls · 9 min · today"},
    }
    cedar = {
        "id": "cedar42",
        "contactName": "Sam Ortiz",
        "contactEmail": "sam@cedarbakery.example",
        # Paused, so the table's live switch can be seen going both ways (Harbor's is live).
        "active": False,
        "businessName": "Cedar Bakery",
        "profile": _empty_profile(""),
        "dossier": "",
        "sources": [],
        "prompts": _prompts("", "Alex"),
        "voice": "gleam",
        "callSound": {"phoneLine": True, "ambience": "quiet"},
        "agentName": "Alex",
        "language": "en",
        "status": "researching",
        "createdAt": _ago(minutes=1),
        "updatedAt": _ago(minutes=1),
        "stats": _empty_stats(),
        "heat": {"score": 0, "level": "cold", "reason": "No activity yet"},
    }
    return [harbor, cedar]


def _bare(record: dict) -> dict:
    """A CustomerWithStats as the plain Customer the [id] route answers with."""
    return {k: v for k, v in record.items() if k not in ("stats", "heat")}


def analytics(days: int, include_tests: bool) -> dict:
    """GET /api/admin/analytics, shaped as app/api/admin/analytics/route.ts answers it."""
    window = days if days in (7, 30, 90) else 30
    counted = HARBOR_CALLS + (HARBOR_TEST_CALLS if include_tests else [])
    in_window = [c for c in counted if c[0] < window]
    total_sec = sum(sec for _, sec, _ in in_window)
    today = datetime.now(timezone.utc).date()
    per_day = []
    for offset in range(window - 1, -1, -1):
        on_day = [c for c in in_window if c[0] == offset]
        per_day.append({"date": (today - timedelta(days=offset)).isoformat(),
                        "calls": len(on_day),
                        "minutes": round(sum(sec for _, sec, _ in on_day) / 60, 1)})
    # Recent calls ignore the window and the test filter, as the route's `calls.slice(0, 20)`.
    recent = [(d, sec, turns, False) for d, sec, turns in HARBOR_CALLS]
    recent += [(d, sec, turns, True) for d, sec, turns in HARBOR_TEST_CALLS]
    recent.sort(key=lambda c: (c[0], not c[3]))  # newest first; today's test call is the newest
    return {
        "kpis": {
            "customers": 2,
            "testedCustomers": 1 if in_window else 0,
            "totalCalls": len(in_window),
            "totalMinutes": round(total_sec / 60, 1),
            "avgCallSec": round(total_sec / len(in_window)) if in_window else 0,
            "totalViews": HARBOR_VIEWS,
        },
        "window": window,
        "callsPerDay": per_day,
        "topCustomers": [{"id": "pr0SPct1", "name": "Harbor Dental",
                          "minutes": round(total_sec / 60, 1), "calls": len(in_window)}]
        if in_window else [],
        "recentCalls": [
            {"id": f"call{i + 1}", "customerId": "pr0SPct1", "customerName": "Harbor Dental",
             "contactName": HARBOR_CONTACT, "startedAt": _ago(days=d, minutes=30 + 60 * i),
             "durationSec": sec, "status": "completed", "isTest": is_test, "turns": turns}
            for i, (d, sec, turns, is_test) in enumerate(recent)
        ],
        "realCallCount": len(HARBOR_CALLS),
        "testCallCount": len([c for c in HARBOR_TEST_CALLS if c[0] < window]),
        "includeTests": include_tests,
    }


def is_maps_url(raw: str) -> bool:
    """lib/maps.ts isMapsUrl(): a URL whose host (minus www.) is a Google short-link host, ends with
    google.com or starts with maps.google. (urlparse stands in for `new URL`, which throws on
    anything without a scheme and host.)"""
    try:
        parsed = urlparse(raw)
        host = (parsed.hostname or "").removeprefix("www.")
    except ValueError:
        return False
    if not parsed.scheme or not host:
        return False
    return host in MAPS_SHORT_HOSTS or host.endswith("google.com") or host.startswith("maps.google.")


def new_customer(body: dict, name: str) -> dict:
    """The record POST /api/admin/customers saves (before research runs)."""
    agent = str(body.get("agentName") or "Alex").strip() or "Alex"
    now = _ago(seconds=0)
    record = {
        "id": "n3wCustomer1",
        "active": True,
        "businessName": name,
        "profile": _empty_profile(name),
        "dossier": "",
        "sources": [],
        "prompts": _prompts(name, agent),
        "voice": "gleam",
        "callSound": {"phoneLine": True, "ambience": "quiet"},
        "agentName": agent,
        "language": "en",
        "status": "researching",
        "createdAt": now,
        "updatedAt": now,
    }
    for key in ("label", "contactName", "contactEmail", "researchNotes", "websiteUrl", "mapsUrl"):
        value = str(body.get(key) or "").strip()
        if value:
            record[key] = value
    return record


# Fields PATCH /api/admin/customers/<id> accepts and simply stores.
PATCHABLE = ("businessName", "label", "contactName", "contactEmail", "notes", "active", "agentName",
             "demoMinutes", "voice", "language", "stage", "lastContactedAt", "followUpAt",
             "callSound", "profile", "websiteUrl", "mapsUrl", "researchNotes")


class _Server(ThreadingHTTPServer):
    allow_reuse_address = False
    daemon_threads = True


class Handler(BaseHTTPRequestHandler):
    def _send(self, status: int, body: dict, cookie: str | None = None) -> None:
        payload = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        if cookie is not None:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(payload)

    def _signed_in(self) -> bool:
        raw = self.headers.get("cookie", "")
        pairs = dict(p.strip().split("=", 1) for p in raw.split(";") if "=" in p)
        return pairs.get(COOKIE) == TOKEN

    def _body_bytes(self) -> bytes:
        length = int(self.headers.get("content-length") or 0)
        return self.rfile.read(length) if length else b""

    def _json_body(self) -> dict | None:
        """The request's JSON object, or None after answering 400 as the promo's routes do."""
        try:
            body = json.loads(self._body_bytes())  # an empty body fails too, as request.json() does
            if not isinstance(body, dict):
                raise ValueError("body must be a JSON object")
        except ValueError:
            self._send(400, {"error": "Invalid request body."})
            return None
        return body

    def _handle(self, method: str) -> None:
        url = urlparse(self.path)
        path = url.path
        if path == "/api/admin/login" and method == "POST":
            body = self._json_body()
            if body is None:
                return
            if body.get("password") == PASSWORD:
                self._send(200, {"ok": True},
                           f"{COOKIE}={TOKEN}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800")
            else:
                self._send(401, {"error": "Wrong password."})
            return
        if path == "/api/admin/login" and method == "DELETE":
            self._send(200, {"ok": True}, f"{COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0")
            return
        if path.startswith("/api/admin/") and not self._signed_in():
            self._send(401, {"error": "Not signed in."})
            return
        if path == "/api/admin/health" and method == "GET":
            self._send(503, {"ok": False, "version": "fake", "onVercel": False, "checks": {}})
            return
        if path == "/api/admin/analytics" and method == "GET":
            query = parse_qs(url.query)
            try:
                days = int(query.get("days", ["30"])[0])
            except ValueError:
                days = 30
            self._send(200, analytics(days, query.get("includeTests", [""])[0] == "1"))
            return
        if path == "/api/admin/customers" and method == "GET":
            self._send(200, {"customers": prospects()})
            return
        if path == "/api/admin/customers" and method == "POST":
            body = self._json_body()
            if body is None:
                return
            name = str(body.get("businessName") or "").strip()
            if not name:
                self._send(400, {"error": "Enter the business name."})
                return
            website = str(body.get("websiteUrl") or "").strip()
            if website and not re.match(r"^https?://", website, re.IGNORECASE):
                self._send(400, {"error": "The website must start with http:// or https://."})
                return
            maps = str(body.get("mapsUrl") or "").strip()
            if maps and not is_maps_url(maps):
                self._send(400, {"error": "That does not look like a Google Maps link."})
                return
            self._send(201, {"customer": new_customer(body, name)})
            return
        prefix = "/api/admin/customers/"
        if path.startswith(prefix) and "/" not in path[len(prefix):] and method in ("GET", "PATCH", "DELETE"):
            wanted = unquote(path[len(prefix):])
            match = next((p for p in prospects() if p["id"] == wanted), None)
            if match is None:
                self._send(404, {"error": "Customer not found."})
            elif method == "GET":
                stats = match["stats"]
                self._send(200, {"customer": _bare(match), "stats": stats, "calls": [],
                                 "events": [], "notes": []})
            elif method == "PATCH":
                body = self._json_body()
                if body is None:
                    return
                if body.get("voice") and body["voice"] not in LIVE_VOICES:
                    self._send(400, {"error": "Unknown voice."})
                    return
                if body.get("stage") and body["stage"] not in CUSTOMER_STAGES:
                    self._send(400, {"error": "Unknown stage."})
                    return
                changed = {**_bare(match), **{k: body[k] for k in PATCHABLE if k in body},
                           "updatedAt": _ago(seconds=0)}
                self._send(200, {"customer": changed})
            else:
                self._send(200, {"ok": True})
            return
        self._send(404, {"error": f"No fake for {method} {path}"})

    def do_GET(self):  # noqa: N802 — BaseHTTPRequestHandler naming
        self._handle("GET")

    def do_POST(self):  # noqa: N802
        self._handle("POST")

    def do_PATCH(self):  # noqa: N802
        self._handle("PATCH")

    def do_DELETE(self):  # noqa: N802
        self._handle("DELETE")

    def log_message(self, *_args):
        pass


def start(port: int = PORT) -> ThreadingHTTPServer:
    server = _Server(("127.0.0.1", port), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


if __name__ == "__main__":
    srv = start()
    print(f"fake promo on http://127.0.0.1:{PORT} (password {PASSWORD!r}) — Ctrl+C to stop")
    try:
        threading.Event().wait()
    except KeyboardInterrupt:
        srv.shutdown()
