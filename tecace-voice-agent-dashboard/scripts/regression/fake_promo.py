"""A stand-in for voiceagent_promo's API, for the Demos end-to-end check (demos_e2e.py).

Mirrors the real routes the dashboard uses, as they behave in the promo repo @ f482848, with the
record shapes of its lib/types.ts (Customer, CustomerWithStats, CallLog, TranscriptEntry,
CallReview, TrackEvent, CrmNote) and lib/analytics.ts (Kpis, DayBucket, computeStats):
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
- GET /api/admin/customers/<id> -> {customer, stats, calls, events, notes}. Harbor Dental has four
  calls (newest first: a test call; two reviewed customer calls whose reviews share the gap "No
  price list for implants"; one unreviewed), 14 page views from 4 visitors and one CRM note —
  `stats` is computeStats() of exactly these, and the list, analytics and detail all agree.
  Cedar Bakery has none.
- PATCH /api/admin/customers/<id> -> {customer}: the route's merge (trimmed strings, "" clears,
  null/"" dates clear) and resolvePrompts() (a changed prompt text -> prompts.edited true;
  regeneratePrompts -> rebuilt). Bad JSON -> 400; a voice not in LIVE_VOICES -> 400 "Unknown
  voice."; a stage not in CUSTOMER_STAGES -> 400 "Unknown stage." (lib/types.ts)
- DELETE /api/admin/customers/<id> -> {ok: true}
- POST /api/admin/customers/<id>/research -> {customer} (status "ready", researchedAt now, prompts
  kept only if edited and regeneratePrompts isn't set); the body's businessName/website/maps/notes
  override the stored ones as in the route; no name at all -> 400 "Enter the business name."
- GET /api/admin/customers/<id>/calls -> {calls}; PATCH …/calls {callId, isTest | analyze: true}
  -> {call}; bad JSON -> 400; neither -> 400 "Send a callId with isTest or analyze."; unknown call
  -> 404 "Call not found."; analyze on a call with too few caller lines -> 400 "This call is too
  short to say anything about."
- GET /api/admin/crm -> {customers, feed}: the same two CustomerWithStats records the list route
  serves (so the board's stage counts and heat agree), and activityFeed() over the same call /
  event / note table the detail route reads — Harbor's calls, views and note plus Cedar's note,
  newest first, each row carrying customerId/customerName (and callId on a call row). Harbor is
  stage "interested"; Cedar is "contacted" with a followUpAt a day old, so the page's "Due now"
  section has exactly one entry.
- GET /api/admin/customers/<id>/notes -> {notes} (the detail route's list); POST -> 201 {note}
  ({id, at, text}, not stored); bad JSON -> 400 "Invalid request body."; blank/whitespace text ->
  400 "Write something first." (checked before the customer, as the route does)
- an unknown <id> on any /customers/<id> route -> 404 {error: "Customer not found."}
- POST /api/session (PUBLIC — not under /api/admin, no cookie needed, as in the promo) {customerId,
  sdp, isTest?}: bad JSON -> 400; missing customerId/sdp -> 400 "Missing customerId or sdp.";
  unknown customer -> 404 "This demo isn't available."; paused -> 403 "This demo is paused.";
  not ready -> 409 "This demo is still being prepared."; otherwise ALWAYS 429 "All the demo lines
  are busy right now. Try again in a moment." — a fake can't mint an OpenAI SDP answer, and the
  promo's own refusal is what the UI must handle. (The real route's per-IP rate limit and demo
  allowance aren't modelled.) The last request body is kept in LAST_SESSION_BODY for the harness.
- POST /api/calls/<callId> {customerId, status, …} -> bad JSON 400; unknown call 404 "Call not
  found."; a known call (all of the fake's are finished) -> {ok: true, alreadyReported: true}, as
  the route answers a report for a call that's no longer "started".
STATELESS: writes answer as if they worked and change nothing, so every run starts from the same
records. Every response is JSON — but two known gaps from the real thing: the real promo answers
an unknown route with Next's own HTML 404 page, where this fake still answers JSON; and the real
login cookie carries `Secure` under NODE_ENV=production, which this fake omits (the harness only
ever runs over plain http, where a Secure cookie would just get silently dropped).
"""

from __future__ import annotations

import json
import re
import threading
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

PORT = 8898
PASSWORD = "letmein"
COOKIE = "admin_session"
TOKEN = "valid-session"
# lib/types.ts LIVE_VOICES and CUSTOMER_STAGES, which PATCH validates against.
LIVE_VOICES = ("gleam", "meridian", "delta", "cinder", "quartz", "ripple", "vesper", "willow",
               "stone", "beacon", "bossa", "tempo")
CUSTOMER_STAGES = ("new", "contacted", "interested", "won", "lost")
LANGUAGES = ("en", "ko", "es", "zh", "ja", "vi", "fr", "de", "pt", "ru")  # lib/languages.ts
MAPS_SHORT_HOSTS = ("maps.app.goo.gl", "goo.gl", "g.co")
BUSY_EVERYWHERE = "All the demo lines are busy right now. Try again in a moment."
MIN_CALLER_LINES = 2  # lib/call-review.ts reviewable()

# The last POST /api/session body, for the harness to inspect (the fake refuses every session).
LAST_SESSION_BODY: dict | None = None


def _iso(dt: datetime) -> str:
    """The promo's timestamps: `new Date().toISOString()` (UTC, milliseconds, `Z`)."""
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def _ago(**delta: float) -> str:
    return _iso(datetime.now(timezone.utc) - timedelta(**delta))


def _prompts(name: str, agent: str) -> dict:
    """Stands in for lib/prompt.ts buildPrompts()."""
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


HARBOR_CONTACT = "Dana Reyes"
SHARED_GAP = "No price list for implants"

# Harbor Dental's calls, newest first: (id, days ago, duration s, turns, isTest, review gaps or
# None for no review). The analytics recent-calls table, the detail page's Activity tab and every
# count (list stats, KPIs) come from this one table. 3 real calls (540 s) + 1 test call (60 s).
CALL_SPECS = [
    ("call1", 0, 60, 4, True, None),
    ("call2", 0, 240, 18, False, [SHARED_GAP, "Could not say if Saturday opens again"]),
    ("call3", 1, 180, 12, False, [SHARED_GAP]),
    ("call4", 4, 120, 9, False, None),
]
VISITORS = ["v-anna", "v-ben", "v-cara", "v-dev"]
HARBOR_VIEWS = 14

LINES = [
    ("receptionist", "Thanks for calling Harbor Dental, this is Alex. How can I help?"),
    ("caller", "Hi, I'd like to book a cleaning next week."),
    ("receptionist", "Of course. We have Tuesday at ten or Thursday at two."),
    ("caller", "Thursday works. How much is a cleaning?"),
    ("receptionist", "A cleaning is one hundred and twenty dollars."),
    ("caller", "And what about implants, roughly?"),
    ("receptionist", "I don't have implant prices, but the dentist can go through them with you."),
    ("caller", "Okay. Is there parking?"),
    ("receptionist", "Yes, there's free parking right behind the building."),
    ("caller", "Great. Are you open on Saturdays?"),
    ("receptionist", "We're closed at weekends, Monday to Friday eight to five."),
    ("caller", "Do you take new patients?"),
    ("receptionist", "We do, and we'd be glad to have you."),
    ("caller", "Can I cancel if something comes up?"),
    ("receptionist", "Just give us twenty-four hours' notice."),
    ("caller", "Perfect, book me in for Thursday then."),
    ("receptionist", "Done. Thursday at two. Anything else?"),
    ("caller", "No, that's all, thanks."),
]


def _transcript(call_id: str, turns: int) -> list[dict]:
    """`turns` TranscriptEntry records (caller/receptionist, startMs/endMs)."""
    out = []
    at = 0
    for i, (speaker, text) in enumerate(LINES[:turns]):
        length = 1500 + 60 * len(text)
        out.append({"id": f"{call_id}-t{i + 1}", "speaker": speaker, "text": text,
                    "startMs": at, "endMs": at + length})
        at += length + 400
    return out


def _review(gaps: list[str], at: str) -> dict:
    return {
        "at": at,
        "model": "fake-review",
        "tested": "Booking a cleaning and asking about prices.",
        "worked": "Offered two times straight away and booked one.",
        "struggled": "Had no price for implants.",
        "gaps": gaps,
        "sentiment": "happy",
    }


def harbor_calls() -> list[dict]:
    """Harbor Dental's CallLogs, newest first (lib/calls.ts listCalls order)."""
    calls = []
    for i, (call_id, days, sec, turns, is_test, gaps) in enumerate(CALL_SPECS):
        started = datetime.now(timezone.utc) - timedelta(days=days, minutes=30 + 60 * i)
        ended = started + timedelta(seconds=sec)
        call = {
            "id": call_id, "customerId": "pr0SPct1", "liveSessionId": f"sess_{call_id}",
            "startedAt": _iso(started), "endedAt": _iso(ended), "durationSec": sec,
            "status": "completed", "endReason": "caller_hung_up", "turns": turns,
            "transcript": _transcript(call_id, turns), "visitorId": VISITORS[0], "isTest": is_test,
        }
        if gaps is not None:
            call["review"] = _review(gaps, _iso(ended))
        calls.append(call)
    return calls


def harbor_events() -> list[dict]:
    """HARBOR_VIEWS page_view TrackEvents from 4 visitors, the newest 3 hours ago."""
    return [{"type": "page_view", "customerId": "pr0SPct1",
             "at": _ago(hours=3 + 7 * i), "visitorId": VISITORS[i % len(VISITORS)]}
            for i in range(HARBOR_VIEWS)]


def harbor_notes() -> list[dict]:
    return [{"id": "note1", "at": _ago(days=2), "text": "Asked for a follow-up after the expo."}]


def cedar_notes() -> list[dict]:
    """Cedar has no calls or views (its stats stay empty, so its heat stays "cold / No activity
    yet"), but one note — enough for the CRM feed to carry both prospects."""
    return [{"id": "note2", "at": _ago(hours=5), "text": "Left a voicemail with the owner."}]


def compute_stats(calls: list[dict], events: list[dict]) -> dict:
    """lib/analytics.ts computeStats(): only real, finished calls count."""
    real = [c for c in calls if not c["isTest"] and c["status"] != "started"]
    seen = {x["visitorId"] for x in events + calls if x.get("visitorId")}
    anonymous = any(not x.get("visitorId") for x in events + calls)
    stats = {"views": len(events), "calls": len(real),
             "totalSec": sum(c.get("durationSec") or 0 for c in real),
             "visitors": len(seen) + (1 if anonymous else 0)}
    last_call = real[0] if real else next((c for c in calls if not c["isTest"]), None)
    if last_call:
        stats["lastCallAt"] = last_call["startedAt"]
    if events:
        stats["lastViewAt"] = max(e["at"] for e in events)
    return stats


def harbor_detail() -> dict:
    calls, events = harbor_calls(), harbor_events()
    return {"calls": calls, "events": events, "notes": harbor_notes(),
            "stats": compute_stats(calls, events)}


def detail_for(customer_id: str) -> dict:
    """One prospect's calls, events, notes and stats — the one table the detail route, the CRM
    feed and the notes routes all read."""
    if customer_id == "pr0SPct1":
        return harbor_detail()
    if customer_id == "cedar42":
        return {"calls": [], "events": [], "notes": cedar_notes(), "stats": _empty_stats()}
    return {"calls": [], "events": [], "notes": [], "stats": _empty_stats()}


def _format_duration(seconds: int | None) -> str:
    """lib/analytics.ts formatDuration()."""
    if not seconds or seconds < 1:
        return "0:00"
    return f"{seconds // 60}:{round(seconds % 60):02d}"


def activity_feed(limit: int = 40) -> list[dict]:
    """lib/analytics.ts activityFeed(): every prospect's timeline() rows, newest first, each
    carrying the prospect it belongs to (FeedEntry = TimelineEntry & {customerId, customerName})."""
    entries = []
    for customer in prospects():
        detail = detail_for(customer["id"])
        name = customer["profile"]["name"] or customer["businessName"] or "Unnamed"
        who = {"customerId": customer["id"], "customerName": name}
        for note in detail["notes"]:
            entries.append({"at": note["at"], "kind": "note", "text": note["text"], **who})
        for event in detail["events"]:
            entries.append({"at": event["at"], "kind": "view", "text": "Opened the demo link", **who})
        for call in detail["calls"]:
            turns = call.get("turns", len(call["transcript"]))
            length = _format_duration(call.get("durationSec"))
            entries.append({
                "at": call["startedAt"], "kind": "call", "callId": call["id"],
                "text": (f"Your test call · {length} · {turns} turns" if call["isTest"]
                         else f"Called · {length} · {turns} turns"),
                **who,
            })
    entries.sort(key=lambda e: e["at"], reverse=True)
    return entries[:limit]


def prospects() -> list[dict]:
    """Two full CustomerWithStats records. Cedar's profile has no name yet (research is running),
    so the table shows it as "Unnamed" and search finds it by its contact email. Timestamps are
    relative to now, so Cedar Bakery reads as "researching" (not stalled — lib/analytics.ts
    RESEARCH_STALL_MS) and Harbor's last call is today."""
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
        "dossier": ("## Harbor Dental\n\n**Family dental practice** on the Portland waterfront.\n\n"
                    "- Same-week appointments\n- Free parking behind the building\n"
                    "- Cleaning from $120\n"),
        "sources": [{"url": "https://harbordental.example", "title": "Harbor Dental"},
                    {"url": "https://maps.google.com/?cid=42", "title": "Harbor Dental on Google Maps"}],
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
        "stats": harbor_detail()["stats"],
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
        # dueFollowUps() counts a followUpAt whose instant is <= now, soonest first.
        "stage": "contacted",
        "followUpAt": _ago(days=1),
        "createdAt": _ago(minutes=1),
        "updatedAt": _ago(minutes=1),
        "stats": _empty_stats(),
        "heat": {"score": 0, "level": "cold", "reason": "No activity yet"},
    }
    return [harbor, cedar]


def _bare(record: dict) -> dict:
    """A CustomerWithStats as the plain Customer the [id] routes answer with."""
    return {k: v for k, v in record.items() if k not in ("stats", "heat")}


def analytics(days: int, include_tests: bool) -> dict:
    """GET /api/admin/analytics, shaped as app/api/admin/analytics/route.ts answers it."""
    window = days if days in (7, 30, 90) else 30
    calls = harbor_calls()
    in_window = [s for s in CALL_SPECS if s[1] < window and (include_tests or not s[4])]
    total_sec = sum(s[2] for s in in_window)
    today = datetime.now(timezone.utc).date()
    per_day = []
    for offset in range(window - 1, -1, -1):
        on_day = [s for s in in_window if s[1] == offset]
        per_day.append({"date": (today - timedelta(days=offset)).isoformat(),
                        "calls": len(on_day),
                        "minutes": round(sum(s[2] for s in on_day) / 60, 1)})
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
        # Recent calls ignore the window and the test filter, as the route's `calls.slice(0, 20)`.
        "recentCalls": [
            {"id": c["id"], "customerId": "pr0SPct1", "customerName": "Harbor Dental",
             "contactName": HARBOR_CONTACT, "startedAt": c["startedAt"],
             "durationSec": c["durationSec"], "status": c["status"], "isTest": c["isTest"],
             "turns": c["turns"]}
            for c in calls
        ],
        "realCallCount": len([c for c in calls if not c["isTest"]]),
        "testCallCount": len([s for s in CALL_SPECS if s[4] and s[1] < window]),
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


def _set_or_clear(record: dict, key: str, value) -> None:
    if value:
        record[key] = value
    else:
        record.pop(key, None)


def patched(customer: dict, body: dict) -> dict:
    """app/api/admin/customers/[id]/route.ts PATCH: the merged record it saves and answers."""
    nxt = dict(customer)
    if str(body.get("businessName") or "").strip():
        nxt["businessName"] = body["businessName"].strip()
    for key in ("websiteUrl", "mapsUrl", "researchNotes", "label", "contactName", "contactEmail",
                "notes"):
        if key in body and body[key] is not None:
            _set_or_clear(nxt, key, str(body[key]).strip())
    if body.get("active") is not None:
        nxt["active"] = body["active"]
    if str(body.get("agentName") or "").strip():
        nxt["agentName"] = body["agentName"].strip()
    if isinstance(body.get("demoMinutes"), (int, float)) and not isinstance(body["demoMinutes"], bool):
        nxt["demoMinutes"] = max(0, round(body["demoMinutes"]))
    for key in ("voice", "stage", "callSound", "profile"):
        if body.get(key) is not None:
            nxt[key] = body[key]
    if "language" in body:
        nxt["language"] = body["language"] if body["language"] in LANGUAGES else "en"  # languageOf()
    for key in ("lastContactedAt", "followUpAt"):  # null/"" clears; absent leaves it
        if key in body:
            _set_or_clear(nxt, key, body[key])
    nxt["updatedAt"] = _ago(seconds=0)
    # lib/prompt.ts resolvePrompts()
    current = customer["prompts"]
    submitted = body.get("prompts")
    rebuilt = _prompts(nxt["profile"].get("name", ""), nxt["agentName"])
    if body.get("regeneratePrompts"):
        nxt["prompts"] = rebuilt
    else:
        typed = None
        if isinstance(submitted, dict):
            typed = {k: submitted.get(k) if submitted.get(k) is not None else current[k]
                     for k in ("live", "backend", "greeting")}
        if typed and any(typed[k] != current[k] for k in typed):
            nxt["prompts"] = {**typed, "edited": True}
        else:
            nxt["prompts"] = current if current.get("edited") else rebuilt
    return nxt


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

    def _customer(self, wanted: str) -> dict | None:
        """The record for <id>, or None after answering 404."""
        match = next((p for p in prospects() if p["id"] == wanted), None)
        if match is None:
            self._send(404, {"error": "Customer not found."})
        return match

    def _handle(self, method: str) -> None:
        global LAST_SESSION_BODY
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

        # Public routes (the promo's middleware only guards /api/admin/*).
        if path == "/api/session" and method == "POST":
            body = self._json_body()
            if body is None:
                return
            LAST_SESSION_BODY = body
            if not body.get("customerId") or not body.get("sdp"):
                self._send(400, {"error": "Missing customerId or sdp."})
                return
            match = next((p for p in prospects() if p["id"] == body["customerId"]), None)
            if match is None:
                self._send(404, {"error": "This demo isn't available."})
            elif not match["active"]:
                self._send(403, {"error": "This demo is paused."})
            elif match["status"] != "ready":
                self._send(409, {"error": "This demo is still being prepared."})
            else:
                self._send(429, {"error": BUSY_EVERYWHERE})
            return
        if path.startswith("/api/calls/") and method == "POST":
            body = self._json_body()
            if body is None:
                return
            call_id = unquote(path[len("/api/calls/"):])
            if not any(c["id"] == call_id for c in harbor_calls()):
                self._send(404, {"error": "Call not found."})
            else:
                self._send(200, {"ok": True, "alreadyReported": True})
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
        if path == "/api/admin/crm" and method == "GET":
            self._send(200, {"customers": prospects(), "feed": activity_feed()})
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
        if path.startswith(prefix):
            parts = [unquote(p) for p in path[len(prefix):].split("/")]
            if len(parts) == 1 and method in ("GET", "PATCH", "DELETE"):
                self._customer_route(method, parts[0])
                return
            if len(parts) == 2 and parts[1] == "research" and method == "POST":
                self._research(parts[0])
                return
            if len(parts) == 2 and parts[1] == "calls" and method in ("GET", "PATCH"):
                self._calls(method, parts[0])
                return
            if len(parts) == 2 and parts[1] == "notes" and method in ("GET", "POST"):
                self._notes(method, parts[0])
                return
        self._send(404, {"error": f"No fake for {method} {path}"})

    def _customer_route(self, method: str, wanted: str) -> None:
        match = self._customer(wanted)
        if match is None:
            return
        if method == "GET":
            detail = detail_for(wanted)
            self._send(200, {"customer": _bare(match), "stats": detail["stats"],
                             "calls": detail["calls"], "events": detail["events"],
                             "notes": detail["notes"]})
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
            self._send(200, {"customer": patched(_bare(match), body)})
        else:
            self._send(200, {"ok": True})

    def _research(self, wanted: str) -> None:
        match = self._customer(wanted)
        if match is None:
            return
        customer = _bare(match)
        try:  # no body is fine: re-research with what is stored
            body = json.loads(self._body_bytes())
            if not isinstance(body, dict):
                body = {}
        except ValueError:
            body = {}
        name = customer["businessName"]
        if str(body.get("businessName") or "").strip():
            name = body["businessName"].strip()
        if not name:
            self._send(400, {"error": "Enter the business name."})
            return
        nxt = dict(customer, businessName=name, status="ready")
        for key in ("websiteUrl", "mapsUrl", "researchNotes"):
            if body.get(key) is not None:
                _set_or_clear(nxt, key, str(body[key]).strip())
        nxt.pop("error", None)
        keep = customer["prompts"].get("edited") and not body.get("regeneratePrompts")
        nxt["prompts"] = customer["prompts"] if keep else _prompts(customer["profile"]["name"],
                                                                   customer["agentName"])
        nxt["researchedAt"] = nxt["updatedAt"] = _ago(seconds=0)
        self._send(200, {"customer": nxt})

    def _notes(self, method: str, wanted: str) -> None:
        """app/api/admin/customers/[id]/notes/route.ts. POST checks the body before the customer,
        as the real route does."""
        if method == "GET":
            if self._customer(wanted) is not None:
                self._send(200, {"notes": detail_for(wanted)["notes"]})
            return
        body = self._json_body()
        if body is None:
            return
        text = str(body.get("text") or "").strip()
        if not text:
            self._send(400, {"error": "Write something first."})
            return
        if self._customer(wanted) is None:
            return
        # Stateless: the note comes back as if it were stored, and isn't.
        self._send(201, {"note": {"id": "note-new", "at": _ago(seconds=0), "text": text}})

    def _calls(self, method: str, wanted: str) -> None:
        if method == "GET":
            if self._customer(wanted) is not None:
                self._send(200, {"calls": harbor_calls() if wanted == "pr0SPct1" else []})
            return
        body = self._json_body()
        if body is None:
            return
        analyze = body.get("analyze") is True
        if not body.get("callId") or (not isinstance(body.get("isTest"), bool) and not analyze):
            self._send(400, {"error": "Send a callId with isTest or analyze."})
            return
        if self._customer(wanted) is None:
            return
        calls = harbor_calls() if wanted == "pr0SPct1" else []
        call = next((c for c in calls if c["id"] == body["callId"]), None)
        if call is None:
            self._send(404, {"error": "Call not found."})
            return
        nxt = dict(call, isTest=body["isTest"]) if isinstance(body.get("isTest"), bool) else call
        if analyze and "review" not in nxt:
            callers = [e for e in nxt["transcript"] if e["speaker"] == "caller" and e["text"].strip()]
            if len(callers) < MIN_CALLER_LINES:
                self._send(400, {"error": "This call is too short to say anything about."})
                return
            nxt = dict(nxt, review=_review([SHARED_GAP], _ago(seconds=0)))
        self._send(200, {"call": nxt})

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
