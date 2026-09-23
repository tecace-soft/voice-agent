"""Deterministic, stateless stand-in for transcribe-backend, for dashboard regression runs.

Every route the dashboard calls answers with fixed data shaped like src/api/types.ts. Nothing is
stored: a POST that would change state answers as if it worked and forgets it, so two runs in a row
(old app, then new app) see exactly the same backend.

That includes the Demo tabs' /demo/* routes, at the bottom of this file: they used to be a second
fake standing in for voiceagent_promo, and folded in here when the demo records moved into
transcribe-db behind this API's own admin session."""

from __future__ import annotations

import json
import re
import threading
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

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


# --- The Demo tabs: /demo/* -----------------------------------------------------------------------
#
# Folded in from the retired fake_promo.py. The Demo screens used to read voiceagent_promo through a
# /promo-api proxy with the promo's own httpOnly cookie; they now read transcribe-backend's /demo/*
# routes with the dashboard's bearer token, so the fake promo moved in here — the same fixtures
# (Harbor Dental, Cedar Bakery) and the same response bodies, on the new paths and behind this
# fake's admin token.
#
# The record shapes are the promo's lib/types.ts (Customer, CustomerWithStats, CallLog,
# TranscriptEntry, CallReview, TrackEvent, CrmNote) and lib/analytics.ts (Kpis, DayBucket,
# computeStats), which src/routes/demo.ts answers with unchanged:
# - every /demo/* route needs an admin token: none -> 401 {error:"unauthorized", message:…},
#   a signed-in non-admin -> 403 {error:"forbidden", message:"Only an admin can read the demo data."}
#   (auth/guard.ts authenticateAdmin)
# - GET /demo/analytics?days=N[&includeTests=1] -> {kpis, window, callsPerDay, topCustomers,
#   recentCalls, realCallCount, testCallCount, includeTests} (N outside 7/30/90 -> 30, as the route).
#   testCallCount counts the window's test calls whether or not includeTests=1, as the route's
#   `testCalls(windowRaw)` does (the Overview only shows it when test calls are left out)
# - GET /demo/customers -> {customers: CustomerWithStats[]} (Harbor Dental: ready, live, hot;
#   Cedar Bakery: researching, paused, cold, no profile name yet)
# - POST /demo/customers -> 201 {customer} at status "researching", as the route answers it: the
#   run is fired in the background there, so the record the dialog gets back is always mid-research;
#   no businessName -> 400 "Enter the business name."; a website without http(s):// -> 400; a
#   mapsUrl that isn't a Google Maps link -> 400
# - POST /demo/customers/<id>/research -> {customer}: the finished run (researched(), below) —
#   status "ready", a real profile/dossier/sources, prompts rebuilt unless they were edited by hand
#   and the body didn't ask for a rebuild. The body is optional as a whole ("re-research with what
#   is stored"), and each of its four inputs replaces what the record holds. No business name at all
#   -> 400 "Enter the business name.". **A run can be staged to fail**: research notes containing
#   RESEARCH_FAIL_MARKER answer the route's 502 with RESEARCH_FAILURE, the message a deployment with
#   no OPENAI_API_KEY gets — see the note on the marker.
# - GET /demo/customers/<id> -> {customer, stats, calls, events, notes}. Harbor Dental has four
#   calls (newest first: a test call; two reviewed customer calls whose reviews share the gap "No
#   price list for implants"; one unreviewed), 14 page views from 4 visitors and one CRM note —
#   `stats` is computeStats() of exactly these, so the list, analytics and detail all agree.
#   Cedar Bakery has none.
# - PATCH /demo/customers/<id> -> {customer}: the route's merge (trimmed strings, "" clears,
#   null/"" dates clear) and resolvePrompts() (a changed prompt text -> prompts.edited true;
#   regeneratePrompts -> rebuilt). A voice not in LIVE_VOICES -> 400 "Unknown voice."; a stage not
#   in CUSTOMER_STAGES -> 400 "Unknown stage."; an `addDemoMinutes` that is not a positive finite
#   number -> 400 "Minutes to add must be positive." (judged before anything is written, as the
#   route does). A valid `addDemoMinutes` is the "Add time" menu: it is added to the *stored*
#   minutes (see DEMO_MINUTES below), and a `demoMinutes` sent alongside it is ignored, exactly as
#   db/demoWrite.ts does it. `demoMinutes` on its own is the Share tab's number field and sets the
#   total outright.
# - DELETE /demo/customers/<id> -> {ok: true}
# - GET /demo/customers/<id>/calls -> {calls}; PATCH …/calls {callId, isTest | analyze: true}
#   -> {call}; neither -> 400 "Send a callId with isTest or analyze."; unknown call -> 404 "Call not
#   found.". `analyze` is accepted and answers with the call unchanged, as the backend does now that
#   the promo's review pipeline is retired.
# - GET /demo/crm -> {customers, feed}: the same two CustomerWithStats records the list route serves
#   (so the board's stage counts and heat agree), and activityFeed() over the same call / event /
#   note table the detail route reads — Harbor's calls, views and note plus Cedar's note, newest
#   first, each row carrying customerId/customerName (and callId on a call row). Harbor is stage
#   "interested"; Cedar is "contacted" with a followUpAt a day old, so the page's "Due now" section
#   has exactly one entry.
# - GET /demo/customers/<id>/notes -> {notes}; POST -> 201 {note} ({id, at, text}, not stored);
#   blank/whitespace text -> 400 "Write something first." (checked before the customer, as the
#   route does)
# - an unknown <id> on any /demo/customers/<id> route -> 404 {error: "Customer not found."}
# - POST /demo/session {customerId, sdp, isTest?, timeZone?} -> {callId, sessionId, sdp, greeting,
#   maxSec}: the test call. `maxSec` is how long this one call may run, which the browser enforces
#   itself (hooks/useLiveCall.ts reads it as callLimitSec(data.maxSec)). It is always CALL_MAX_SEC
#   here: every call through this admin route is an operator test call, which skips the prospect's
#   allowance, so the ten-minute ceiling is the whole answer.
#   Missing customerId/sdp -> 400 "Missing customerId or sdp."; unknown customer ->
#   404 "This demo isn't available."; paused -> 403 "This demo is paused."; not ready -> 409 "This
#   demo is still being prepared.". Otherwise it grants: `callId` is always SESSION_CALL_ID (the
#   fake stores nothing, so there is one), and `sdp` is an SDP **answer** built from the browser's
#   own offer by sdp_answer() — the real route's answer comes from OpenAI, which this fake cannot
#   mint, so it writes one the browser will take. The route's per-IP 429 ("Too many calls in a row.
#   Wait a minute and try again.") is not modelled: it is state, and demos_e2e.py stages it itself
#   with page.route when it wants to see a refused dial.
# - POST /demo/calls/<callId> {customerId, status, durationSec, endReason, transcript} ->
#   {ok: true, reviewed: false}; an unknown callId -> 404 "Call not found.". The report is not
#   stored, so SESSION_CALL_ID never joins the four fixture calls and the Activity tab reads the
#   same table before and after a test call.
#
# STATELESS, like the rest of this fake: writes answer as if they worked and change nothing, so
# every run starts from the same records. The one exception is a demo's minutes (DEMO_MINUTES),
# and it is there because `addDemoMinutes` cannot be modelled without it — see the note on it.
#
# Timestamps here are relative to the moment of the request (the promo's records are), not the
# pinned NOW the transcribe fixtures use: demos_e2e.py doesn't pin the clock, and "researching"
# vs "stalled" and "due now" are read off the wall clock.

DEMO_IS_ADMIN = "Only an admin can read the demo data."
# auth/guard.ts: UNAUTHORIZED, and the denial authenticateAdmin() builds for a non-admin.
DEMO_UNAUTHORIZED = {"error": "unauthorized", "message": "Sign in to continue."}
DEMO_FORBIDDEN = {"error": "forbidden", "message": DEMO_IS_ADMIN}

# demo/types.ts LIVE_VOICES and CUSTOMER_STAGES, which PATCH validates against.
LIVE_VOICES = ("gleam", "meridian", "delta", "cinder", "quartz", "ripple", "vesper", "willow",
               "stone", "beacon", "bossa", "tempo")
CUSTOMER_STAGES = ("new", "contacted", "interested", "won", "lost")
LANGUAGES = ("en", "ko", "es", "zh", "ja", "vi", "fr", "de", "pt", "ru")
MAPS_SHORT_HOSTS = ("maps.app.goo.gl", "goo.gl", "g.co")

# demo/types.ts DEFAULT_DEMO_MINUTES: what a prospect has when nothing is stored.
DEFAULT_DEMO_MINUTES = 10
# demo/callLimits.ts CALL_MAX_SEC: the ceiling on one call, which POST /demo/session tells the
# browser so it can hang up on its own.
CALL_MAX_SEC = 10 * 60

# The one thing this fake remembers, keyed by prospect id.
#
# `addDemoMinutes` exists because the new total is worked out from the *stored* minutes and never
# from the figure the browser happened to be showing — that is the whole point of the field, and a
# stateless answer could not show it: adding 30 to a fixture that always reads 10 gives 40 whether
# the 10 came from the record or from the request. Keeping the total here makes the addition
# visible (a second top-up compounds) and keeps every screen agreeing with it, because prospects()
# serves it. It resets with the process, so a run still starts from the fixtures, and none of the
# fixtures sets it: the column is null until someone does, and the client falls back to
# DEFAULT_DEMO_MINUTES.
DEMO_MINUTES: dict[str, int] = {}


def extend_demo_minutes(current: int | None, add, fallback: int) -> int | None:
    """demo/analytics.ts extendDemoMinutes(): the new total, or None when `add` is not a positive
    finite number (a bool is not a number in TypeScript either)."""
    if isinstance(add, bool) or not isinstance(add, (int, float)):
        return None
    if add != add or add in (float("inf"), float("-inf")) or add <= 0:  # NaN, ±Infinity, <= 0
        return None
    return max(0, round((fallback if current is None else current) + add))


def _iso_ms(dt: datetime) -> str:
    """The promo's timestamps: `new Date().toISOString()` (UTC, milliseconds, `Z`)."""
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def _ago(**delta: float) -> str:
    return _iso_ms(datetime.now(timezone.utc) - timedelta(**delta))


def _prompts(name: str, agent: str) -> dict:
    """Stands in for the promo's lib/prompt.ts buildPrompts()."""
    who = name or "the business"
    return {
        "live": f"You are {agent}, the receptionist at {who}. Answer callers warmly.",
        "backend": f"Facts about {who} for the receptionist.",
        "greeting": f"Thanks for calling {name or 'us'}, this is {agent}. How can I help?",
        "edited": False,
        "version": 1,
    }


def _empty_profile(name: str) -> dict:
    return {"name": name, "category": "", "address": "", "hours": [], "services": [],
            "highlights": [], "policies": {}, "faqs": []}


def _empty_stats() -> dict:
    """demo/analytics.ts emptyStats()."""
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
    """Harbor Dental's CallLogs, newest first (db/demoRead.ts listCalls order)."""
    calls = []
    for i, (call_id, days, sec, turns, is_test, gaps) in enumerate(CALL_SPECS):
        started = datetime.now(timezone.utc) - timedelta(days=days, minutes=30 + 60 * i)
        ended = started + timedelta(seconds=sec)
        call = {
            "id": call_id, "customerId": "pr0SPct1", "liveSessionId": f"sess_{call_id}",
            "startedAt": _iso_ms(started), "endedAt": _iso_ms(ended), "durationSec": sec,
            "status": "completed", "endReason": "caller_hung_up", "turns": turns,
            "transcript": _transcript(call_id, turns), "visitorId": VISITORS[0], "isTest": is_test,
        }
        if gaps is not None:
            call["review"] = _review(gaps, _iso_ms(ended))
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
    """demo/analytics.ts computeStats(): only real, finished calls count."""
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
    """demo/analytics.ts formatDuration()."""
    if not seconds or seconds < 1:
        return "0:00"
    return f"{seconds // 60}:{round(seconds % 60):02d}"


def activity_feed(limit: int = 40) -> list[dict]:
    """demo/analytics.ts activityFeed(): every prospect's timeline() rows, newest first, each
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
    relative to now, so Cedar Bakery reads as "researching" (not stalled — demo/analytics.ts
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
    # A prospect the "Add time" menu has topped up this run carries the total; the fixtures
    # themselves leave the field out, as the stored column is null until someone sets it.
    for record in (harbor, cedar):
        if record["id"] in DEMO_MINUTES:
            record["demoMinutes"] = DEMO_MINUTES[record["id"]]
    return [harbor, cedar]


def _bare(record: dict) -> dict:
    """A CustomerWithStats as the plain Customer the [id] routes answer with."""
    return {k: v for k, v in record.items() if k not in ("stats", "heat")}


def demo_analytics(days: int, include_tests: bool) -> dict:
    """GET /demo/analytics, shaped as src/routes/demo.ts answers it."""
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
    """routes/demo.ts isMapsUrl(): a URL whose host (minus www.) is a Google short-link host, ends
    with google.com or starts with maps.google. (urlparse stands in for `new URL`, which throws on
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
    """The record POST /demo/customers saves."""
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


# A research run is the one route here that stands in for a *billable model call*, so this fake has
# to be able to play both endings. The marker is in the research notes because that is a field the
# operator already types into (ResearchInputsPanel's "Notes for the research"), which keeps the
# staging inside the product's own flow: no control endpoint, nothing to reset, and the harness
# stages a failure the same way a person would provoke one. The message is the real one a deployment
# without a key gets from demo/openai.ts, which is the failure the audit says to expect.
RESEARCH_FAIL_MARKER = "make the research fail"
RESEARCH_FAILURE = "OPENAI_API_KEY is not set on the server."


def researched(customer: dict, name: str, website: str, maps: str, notes: str,
               regenerate: bool) -> dict:
    """The record a finished run leaves behind: db/demoWrite.ts startResearch() (the four inputs)
    followed by saveResearch() (the profile, dossier, sources, prompts, status and timestamps).

    The profile is written from the researched name rather than copied from a fixture, so a run on
    either prospect answers about the business it was asked about — and so a page that has taken the
    answer is telling them apart on the record's own text."""
    now = _ago(seconds=0)
    nxt = dict(customer)
    nxt["businessName"] = name
    _set_or_clear(nxt, "websiteUrl", website)
    _set_or_clear(nxt, "mapsUrl", maps)
    _set_or_clear(nxt, "researchNotes", notes)
    nxt["profile"] = {
        "name": name,
        "category": "Bakery",
        "address": "8 Mill Lane, Portland, ME",
        "phone": "+1 207 555 0188",
        "website": website or "",
        "hours": [{"day": d, "open": "07:00", "close": "15:00"}
                  for d in ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday")]
        + [{"day": "Saturday", "open": "08:00", "close": "13:00"},
           {"day": "Sunday", "open": "", "close": "", "closed": True}],
        "services": [{"name": "Sourdough", "price": "$8"}],
        "highlights": ["Baked each morning"],
        "policies": {"payment": "Cards and cash."},
        "faqs": [{"q": "Do you take orders ahead?", "a": "Yes, a day's notice."}],
    }
    nxt["dossier"] = (f"## {name}\n\n**The run finished just now.**\n\n"
                      "- Baked each morning\n- Sourdough from $8\n")
    nxt["sources"] = [{"url": "https://cedarbakery.example", "title": name}]
    # saveResearch(): a hand-edited prompt survives a run unless the caller asked for a rebuild.
    keep = bool(customer.get("prompts", {}).get("edited")) and not regenerate
    if not keep:
        nxt["prompts"] = _prompts(name, nxt.get("agentName", "Alex"))
    nxt["status"] = "ready"
    nxt.pop("error", None)
    nxt["researchedAt"] = now
    nxt["updatedAt"] = now
    return nxt


def patched(customer: dict, body: dict) -> dict:
    """PATCH /demo/customers/<id>: the merged record it saves and answers."""
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
    # db/demoWrite.ts: `addDemoMinutes` is the "Add time" menu and adds to the stored total, so a
    # `demoMinutes` arriving in the same body is ignored rather than merged — a page open since
    # yesterday must not be able to undo someone else's top-up. `demoMinutes` on its own is the
    # Share tab's number field and sets the total. The route has already refused an amount
    # extend_demo_minutes() cannot use, so the None below is unreachable through the API.
    if "addDemoMinutes" in body:
        total = extend_demo_minutes(DEMO_MINUTES.get(customer["id"]), body["addDemoMinutes"],
                                    DEFAULT_DEMO_MINUTES)
        if total is not None:
            DEMO_MINUTES[customer["id"]] = total
            nxt["demoMinutes"] = total
    elif isinstance(body.get("demoMinutes"), (int, float)) and not isinstance(body["demoMinutes"], bool):
        DEMO_MINUTES[customer["id"]] = max(0, round(body["demoMinutes"]))
        nxt["demoMinutes"] = DEMO_MINUTES[customer["id"]]
    for key in ("voice", "stage", "callSound", "profile"):
        if body.get(key) is not None:
            nxt[key] = body[key]
    if "language" in body:
        nxt["language"] = body["language"] if body["language"] in LANGUAGES else "en"
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


def _demo_json(raw: bytes) -> dict | None:
    """The request's JSON object, or None for anything else (the caller answers 400)."""
    try:
        body = json.loads(raw)  # an empty body fails too, as Elysia's parse does
    except ValueError:
        return None
    return body if isinstance(body, dict) else None


def _demo_customer(wanted: str) -> dict | None:
    return next((p for p in prospects() if p["id"] == wanted), None)


DEMO_NOT_FOUND = {"error": "Customer not found."}
DEMO_BAD_BODY = {"error": "Invalid request body."}


def demo_route(method: str, path: str, query: dict, raw_body: bytes):
    """One /demo/* request, already known to come from an admin. `path` is what follows /demo."""
    if path == "/analytics" and method == "GET":
        try:
            days = int(query.get("days", ["30"])[0])
        except ValueError:
            days = 30
        return 200, demo_analytics(days, query.get("includeTests", [""])[0] == "1")
    if path == "/crm" and method == "GET":
        return 200, {"customers": prospects(), "feed": activity_feed()}
    if path == "/customers" and method == "GET":
        return 200, {"customers": prospects()}
    if path == "/session" and method == "POST":
        return demo_session_route(raw_body)
    if path.startswith("/calls/") and method == "POST":
        return demo_report_route(unquote(path[len("/calls/"):]), raw_body)
    if path == "/customers" and method == "POST":
        body = _demo_json(raw_body)
        if body is None:
            return 400, DEMO_BAD_BODY
        name = str(body.get("businessName") or "").strip()
        if not name:
            return 400, {"error": "Enter the business name."}
        website = str(body.get("websiteUrl") or "").strip()
        if website and not re.match(r"^https?://", website, re.IGNORECASE):
            return 400, {"error": "The website must start with http:// or https://."}
        maps = str(body.get("mapsUrl") or "").strip()
        if maps and not is_maps_url(maps):
            return 400, {"error": "That does not look like a Google Maps link."}
        return 201, {"customer": new_customer(body, name)}

    prefix = "/customers/"
    if path.startswith(prefix):
        parts = [unquote(p) for p in path[len(prefix):].split("/")]
        if len(parts) == 1 and method in ("GET", "PATCH", "DELETE"):
            return demo_customer_route(method, parts[0], raw_body)
        if len(parts) == 2 and parts[1] == "notes" and method in ("GET", "POST"):
            return demo_notes_route(method, parts[0], raw_body)
        if len(parts) == 2 and parts[1] == "calls" and method in ("GET", "PATCH"):
            return demo_calls_route(method, parts[0], raw_body)
        if len(parts) == 2 and parts[1] == "research" and method == "POST":
            return demo_research_route(parts[0], raw_body)
    return 404, {"error": f"No fake for {method} /demo{path}"}


def demo_research_route(wanted: str, raw_body: bytes):
    """POST /demo/customers/<id>/research, as src/routes/demo.ts answers it.

    The body is optional *as a whole* — "re-research with what is stored" sends none — so an
    unparsable one is treated as absent here rather than answered 400, which is what Elysia's
    `t.Optional(t.Object(...))` does with it."""
    match = _demo_customer(wanted)
    if match is None:
        return 404, DEMO_NOT_FOUND
    customer = _bare(match)
    body = _demo_json(raw_body) or {}

    # The route reads the four inputs off the record and lets the body override them one at a
    # time: a blank businessName is a no-op, the other three take "" as "clear this".
    name = customer.get("businessName", "")
    website = customer.get("websiteUrl", "")
    maps = customer.get("mapsUrl", "")
    notes = customer.get("researchNotes", "")
    if str(body.get("businessName") or "").strip():
        name = body["businessName"].strip()
    if body.get("websiteUrl") is not None:
        website = str(body["websiteUrl"]).strip()
    if body.get("mapsUrl") is not None:
        maps = str(body["mapsUrl"]).strip()
    if body.get("researchNotes") is not None:
        notes = str(body["researchNotes"]).strip()
    if not name:
        return 400, {"error": "Enter the business name."}

    # The staged failure: the route's own 502, carrying the model's message. `failResearch` puts
    # the record at status "error" first, which this fake cannot keep — it stores nothing — so the
    # next GET shows the prospect exactly as the fixtures leave it.
    if RESEARCH_FAIL_MARKER in notes.lower():
        return 502, {"error": RESEARCH_FAILURE}

    return 200, {"customer": researched(customer, name, website, maps, notes,
                                        body.get("regeneratePrompts") is True)}


def demo_customer_route(method: str, wanted: str, raw_body: bytes):
    match = _demo_customer(wanted)
    if match is None:
        return 404, DEMO_NOT_FOUND
    if method == "GET":
        detail = detail_for(wanted)
        return 200, {"customer": _bare(match), "stats": detail["stats"], "calls": detail["calls"],
                     "events": detail["events"], "notes": detail["notes"]}
    if method == "DELETE":
        return 200, {"ok": True}
    body = _demo_json(raw_body)
    if body is None:
        return 400, DEMO_BAD_BODY
    if body.get("voice") and body["voice"] not in LIVE_VOICES:
        return 400, {"error": "Unknown voice."}
    if body.get("stage") and body["stage"] not in CUSTOMER_STAGES:
        return 400, {"error": "Unknown stage."}
    # routes/demo.ts judges the amount out here, before anything is written, by asking
    # extendDemoMinutes with the fallback standing in for the stored value: the refusal is the
    # same whatever the amount would have been added to.
    if "addDemoMinutes" in body and extend_demo_minutes(
            None, body["addDemoMinutes"], DEFAULT_DEMO_MINUTES) is None:
        return 400, {"error": "Minutes to add must be positive."}
    return 200, {"customer": patched(_bare(match), body)}


def demo_notes_route(method: str, wanted: str, raw_body: bytes):
    """The blank-text 400 comes before the 404, as the route does."""
    if method == "GET":
        if _demo_customer(wanted) is None:
            return 404, DEMO_NOT_FOUND
        return 200, {"notes": detail_for(wanted)["notes"]}
    body = _demo_json(raw_body)
    if body is None:
        return 400, DEMO_BAD_BODY
    text = str(body.get("text") or "").strip()
    if not text:
        return 400, {"error": "Write something first."}
    if _demo_customer(wanted) is None:
        return 404, DEMO_NOT_FOUND
    # Stateless: the note comes back as if it were stored, and isn't.
    return 201, {"note": {"id": "note-new", "at": _ago(seconds=0), "text": text}}


def demo_calls_route(method: str, wanted: str, raw_body: bytes):
    if method == "GET":
        if _demo_customer(wanted) is None:
            return 404, DEMO_NOT_FOUND
        return 200, {"calls": harbor_calls() if wanted == "pr0SPct1" else []}
    body = _demo_json(raw_body)
    if body is None:
        return 400, DEMO_BAD_BODY
    analyze = body.get("analyze") is True
    if not body.get("callId") or (not isinstance(body.get("isTest"), bool) and not analyze):
        return 400, {"error": "Send a callId with isTest or analyze."}
    if _demo_customer(wanted) is None:
        return 404, DEMO_NOT_FOUND
    calls = harbor_calls() if wanted == "pr0SPct1" else []
    call = next((c for c in calls if c["id"] == body["callId"]), None)
    if call is None:
        return 404, {"error": "Call not found."}
    if isinstance(body.get("isTest"), bool):
        call = dict(call, isTest=body["isTest"])
    # `analyze` reviews a call that has none, and never redoes one it already has — the route's own
    # rule. Its two refusals (400 for a call with too little caller in it, 502 for a model that
    # can't be read back) aren't modelled: every fixture call is long enough and this fake's
    # "model" always answers.
    if analyze and not call.get("review"):
        call = dict(call, review=_review([], call["endedAt"]))
    return 200, {"call": call}


# The call the fake's POST /demo/session opens. Fixed, because nothing is stored: a second dial
# gets the same id, and the id is deliberately not one of CALL_SPECS', so a test call placed in the
# harness never disturbs the four calls the Activity tab and every count are built from.
SESSION_CALL_ID = "tstCALL00001"
SESSION_ID = "sess_faketestcall"
# 32 bytes, formatted as a DTLS fingerprint. Never verified: the browser only checks it against the
# peer certificate during the DTLS handshake, which this fake never reaches.
FINGERPRINT = "sha-256 " + ":".join(f"{b:02X}" for b in range(32))
ICE_UFRAG = "fake"
ICE_PWD = "fakefakefakefakefakefakefake"


def sdp_answer(offer: str) -> str:
    """An SDP answer the browser will accept for `offer`.

    The real `POST /demo/session` hands the browser's offer to OpenAI and returns OpenAI's answer;
    a fake has no such peer, so it writes the answer itself. `setRemoteDescription` is strict about
    the shape — one answer section per offered section, in order, with the offer's own mids,
    transport protocols and (for audio) a codec the offer listed — so the answer is derived from
    the offer rather than canned. Everything past that point (ICE, DTLS) never happens: nothing is
    listening on the candidate, so the call sits in "Ringing" until it is hung up, which is exactly
    the state the harness wants to drive.
    """
    lines = [ln.strip() for ln in offer.replace("\r\n", "\n").split("\n") if ln.strip()]
    rtpmap = {}
    sections: list[dict] = []
    for line in lines:
        if line.startswith("m="):
            parts = line[2:].split()
            sections.append({"media": parts[0], "proto": parts[2], "fmts": parts[3:], "mid": None,
                             "rtcp_mux": False})
        elif sections and line.startswith("a=mid:"):
            sections[-1]["mid"] = line[len("a=mid:"):]
        elif sections and line == "a=rtcp-mux":
            sections[-1]["rtcp_mux"] = True
        elif line.startswith("a=rtpmap:"):
            payload, _, codec = line[len("a=rtpmap:"):].partition(" ")
            rtpmap[payload] = codec
    mids = [s["mid"] for s in sections if s["mid"] is not None]

    out = ["v=0", "o=- 1 1 IN IP4 127.0.0.1", "s=-", "t=0 0"]
    if any(ln.startswith("a=group:BUNDLE") for ln in lines) and mids:
        out.append("a=group:BUNDLE " + " ".join(mids))
    out.append("a=msid-semantic: WMS")
    for index, section in enumerate(sections):
        if section["media"] == "application":
            out.append(f"m=application 9 {section['proto']} webrtc-datachannel")
        else:
            # The offer's Opus payload number if it offered one, else whatever it listed first.
            payload = next((p for p in section["fmts"]
                            if rtpmap.get(p, "").lower().startswith("opus")),
                           section["fmts"][0] if section["fmts"] else "111")
            out.append(f"m={section['media']} 9 {section['proto']} {payload}")
        out.append("c=IN IP4 0.0.0.0")
        out.append(f"a=mid:{section['mid'] if section['mid'] is not None else index}")
        out += [f"a=ice-ufrag:{ICE_UFRAG}", f"a=ice-pwd:{ICE_PWD}", "a=ice-options:trickle",
                f"a=fingerprint:{FINGERPRINT}",
                # The offer says actpass, so the answer picks a side; "active" means this end would
                # open the DTLS connection, which suits a peer that never arrives.
                "a=setup:active"]
        if section["media"] == "application":
            out += ["a=sctp-port:5000", "a=max-message-size:262144"]
        else:
            out.append("a=rtcp:9 IN IP4 0.0.0.0")
            if section["rtcp_mux"]:
                out.append("a=rtcp-mux")
            # recvonly, not sendrecv: the fake sends no media, and an answer that claimed to would
            # leave the page waiting on a track that never comes.
            out.append("a=recvonly")
            out.append(f"a=rtpmap:{payload} {rtpmap.get(payload, 'opus/48000/2')}")
    return "\r\n".join(out) + "\r\n"


def demo_session_route(raw_body: bytes):
    """POST /demo/session: the test call, in the route's own order of refusals."""
    body = _demo_json(raw_body)
    if body is None:
        return 400, DEMO_BAD_BODY
    if not body.get("customerId") or not body.get("sdp"):
        return 400, {"error": "Missing customerId or sdp."}
    match = _demo_customer(body["customerId"])
    if match is None:
        return 404, {"error": "This demo isn't available."}
    if not match["active"]:
        return 403, {"error": "This demo is paused."}
    if match["status"] != "ready":
        return 409, {"error": "This demo is still being prepared."}
    return 200, {"callId": SESSION_CALL_ID, "sessionId": SESSION_ID,
                 "sdp": sdp_answer(str(body["sdp"])),
                 "greeting": match["prompts"]["greeting"],
                 # How long this one call may run, so the browser can hang up on its own. The promo
                 # narrowed it to what was left of the prospect's allowance for a public call;
                 # every call through this admin route is an operator test call, which skips the
                 # allowance, so the ceiling is the whole answer.
                 "maxSec": CALL_MAX_SEC}


def demo_report_route(call_id: str, raw_body: bytes):
    """POST /demo/calls/<callId>: how a test call ended. Nothing is stored, so the review is
    always `false` — the real route's `reviewed` is whatever its model said about the transcript."""
    body = _demo_json(raw_body)
    if body is None:
        return 400, DEMO_BAD_BODY
    known = call_id == SESSION_CALL_ID or any(c["id"] == call_id for c in harbor_calls())
    if not known:
        return 404, {"error": "Call not found."}
    return 200, {"ok": True, "reviewed": False}


# --- Dispatch -------------------------------------------------------------------------------------

def route(method: str, path: str, query: dict, user: dict | None, body: bytes = b""):
    """Returns (status, body). `user` is None when no/unknown bearer token was sent."""
    if path == "/auth/setup-state":
        return 200, {"needsSetup": False}
    if path == "/auth/login" and method == "POST":
        return 401, {"message": "Wrong email or password."}
    # The Demo tabs, in the backend's own denial shapes (auth/guard.ts), which differ from the
    # transcribe routes' plain {message}: no token is 401 `unauthorized`, a signed-in non-admin
    # is 403 `forbidden` naming what needs the admin.
    if path.startswith("/demo/"):
        if user is None:
            return 401, DEMO_UNAUTHORIZED
        if user["role"] != "admin":
            return 403, DEMO_FORBIDDEN
        return demo_route(method, path[len("/demo"):], query, body)
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
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _handle(self, method: str) -> None:
        url = urlparse(self.path)
        auth = self.headers.get("authorization", "")
        user = TOKENS.get(auth.removeprefix("Bearer ").strip())
        length = int(self.headers.get("content-length") or 0)
        # Read it whatever the route does with it: an unread body would be left in the socket.
        # Only the /demo/* writes look at it; the transcribe fakes ignore theirs.
        raw = self.rfile.read(length) if length else b""
        status, body = route(method, url.path, parse_qs(url.query), user, raw)
        self._send(status, body)

    def do_OPTIONS(self):  # noqa: N802 — BaseHTTPRequestHandler naming
        self._send(204, None)

    def do_GET(self):  # noqa: N802
        self._handle("GET")

    def do_POST(self):  # noqa: N802
        self._handle("POST")

    def do_PATCH(self):  # noqa: N802
        self._handle("PATCH")

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
    print("fake transcribe-backend (transcribe + /demo) on http://127.0.0.1:8899 — Ctrl+C to stop")
    try:
        threading.Event().wait()
    except KeyboardInterrupt:
        srv.shutdown()
