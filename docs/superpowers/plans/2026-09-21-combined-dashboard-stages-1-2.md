# Combined dashboard — stages 1–2 implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the transcribe dashboard into `tecace-voice-agent-dashboard/` unchanged (stage 1), then add Tailwind v4 + the promo's shadcn theme in a way that provably changes nothing on the transcribe screens (stage 2).

**Architecture:** Stage 1 is a straight copy, proved identical by a Playwright harness that renders every view × role × scope of the original and the copy against one fake backend and compares text, computed styles and console errors. Stage 2 wraps the transcribe CSS in a `legacy` cascade layer, drops Tailwind's global reset in favour of one scoped to a `.tw` wrapper (`@scope (.tw)`, layer order `theme, legacy, base, components, utilities`), prefixes every promo theme variable with `--ui-`, and makes the theme hook drive both `data-theme` and `.dark`. The same harness must still report zero differences, and a probe checks the Tailwind half works inside `.tw`.

**Tech Stack:** React 19, Vite 8, TypeScript 5, Tailwind CSS 4.3 via `@tailwindcss/postcss`, `tw-animate-css`, Vitest 5, Python 3.14 + Playwright (driving the installed Microsoft Edge).

**Spec:** `docs/superpowers/specs/2026-09-21-combined-dashboard-design.md`

**Git:** do **not** commit. The user handles all git operations. Where a step would normally commit, stop at "files ready for review" instead.

**Paths:** all paths are relative to the repo root `voice-agent/` unless stated. `APP` = `tecace-voice-agent-dashboard`. `OLD` = `transcribe-dashboard-app`. Shell is Git Bash on Windows.

---

## File map

Stage 1
- Replace `APP/src/**` with a copy of `OLD/src/**`.
- Replace `APP/index.html` (copy of OLD's, keeps APP's `<title>`).
- Modify `APP/.env.example` (points at transcribe-backend, as OLD's does).
- Create `APP/scripts/regression/fake_backend.py` — deterministic, stateless fake of every transcribe-backend route the dashboard calls.
- Create `APP/scripts/regression/compare.py` — builds both apps, serves them, captures every view, diffs.
- Create `APP/scripts/regression/README.md` — how to run it.
- Modify `APP/.gitignore` (regression output dir).

Stage 2
- Create `APP/postcss.config.mjs`.
- Create `APP/scripts/build-scoped-preflight.mjs` and its output `APP/src/styles/ui-preflight.css`.
- Move `APP/src/index.css` → `APP/src/styles/legacy.css` (font/token imports removed from its top).
- Create `APP/src/styles/ui-theme.css` — promo theme, `--ui-` prefixed, `.tw`-scoped base + type scale.
- Create `APP/src/styles/index.css` — the entry: layer order + imports.
- Modify `APP/src/main.tsx` (import path).
- Create `APP/src/themeCore.ts`, `APP/tests/themeCore.test.ts`; modify `APP/src/theme.tsx`, `APP/index.html`.
- Create `APP/vitest.config.ts`; modify `APP/package.json`, `APP/tsconfig.json`.
- Create `APP/scripts/tw-probe.html` and `APP/scripts/regression/tw_probe.py`.
- Modify `APP/CLAUDE.md`, `APP/README.md`.

---

# Stage 1 — transcribe dashboard in

### Task 1: Copy the transcribe dashboard into the project

**Files:**
- Replace: `APP/src/**`, `APP/index.html`
- Modify: `APP/.env.example`

- [ ] **Step 1: Confirm the scaffold holds nothing worth keeping**

Run:
```bash
cd tecace-voice-agent-dashboard && find src -type f | sort && diff -q src/tecace/fig-tokens.css ../transcribe-dashboard-app/src/tecace/fig-tokens.css && diff -q src/tecace/typography.css ../transcribe-dashboard-app/src/tecace/typography.css && diff tsconfig.json ../transcribe-dashboard-app/tsconfig.json && echo SAME
```
Expected: the seven scaffold files (`src/App.tsx`, `src/api/backend.ts`, `src/index.css`, `src/main.tsx`, `src/tecace/fig-tokens.css`, `src/tecace/typography.css`, `src/theme.tsx`), then `SAME`. If anything else is listed, stop and ask the user before deleting it.

- [ ] **Step 2: Replace `src/` with the transcribe dashboard's**

Run:
```bash
cd tecace-voice-agent-dashboard && rm -rf src dist && cp -r ../transcribe-dashboard-app/src ./src && find src -type f | wc -l
```
Expected: `48` (the transcribe app's file count; compare with `find ../transcribe-dashboard-app/src -type f | wc -l`).

- [ ] **Step 3: Replace `index.html`, keeping this project's title**

Overwrite `APP/index.html` with:
```html
<!doctype html>
<html lang="en" data-mode="desktop" data-theme="light">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>TecAce — Voice Agent Dashboard</title>
    <!-- Apply the saved theme before first paint so there's no flash of the wrong theme. -->
    <script>
      try {
        var t = localStorage.getItem("theme");
        if (t === "dark" || t === "light") document.documentElement.setAttribute("data-theme", t);
      } catch (e) {}
    </script>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```
(This is byte-identical to the scaffold's current file and to OLD's except the title — keep it as shown.)

- [ ] **Step 4: Point `.env.example` at transcribe-backend**

Overwrite `APP/.env.example` with:
```bash
# TecAce voice agent dashboard configuration (template).
# Copy to .env and fill in per machine — .env is git-ignored and does not travel with `git pull`.
# Vite only exposes vars prefixed with VITE_ to the browser.

# Base URL of transcribe-backend (no trailing slash). It serves sign-in, /transcribe/*, /business/*,
# /calls, /usage/*, /feedback and /api-keys — everything the transcribe screens read.
VITE_BACKEND_URL=http://localhost:8001
```

- [ ] **Step 5: Build**

Run: `cd tecace-voice-agent-dashboard && npm run build`
Expected: `tsc --noEmit` prints nothing, then Vite reports `✓ built in …` with `dist/index.html`, one CSS and one JS asset. No errors.

- [ ] **Step 6: Files ready for review** (no commit — the user handles git)

---

### Task 2: Fake transcribe-backend for regression runs

**Files:**
- Create: `APP/scripts/regression/fake_backend.py`

The fake is **stateless**: every response is a pure function of the request, so the old app's run can't change what the new app's run sees (e.g. opening Failed runs POSTs an acknowledge; the fake answers but remembers nothing). Tokens decide the role: `tok-admin` → admin, `tok-user` → user. All times are fixed strings around `NOW = 2026-09-15T18:00:00Z`, which the harness also pins the browser clock to.

- [ ] **Step 1: Write the fake**

Create `APP/scripts/regression/fake_backend.py`:
```python
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


def start(port: int = 8899) -> ThreadingHTTPServer:
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


if __name__ == "__main__":
    srv = start()
    print("fake transcribe-backend on http://127.0.0.1:8899 — Ctrl+C to stop")
    try:
        threading.Event().wait()
    except KeyboardInterrupt:
        srv.shutdown()
```

- [ ] **Step 2: Smoke-test the fake**

Run:
```bash
cd tecace-voice-agent-dashboard/scripts/regression && python -c "
import fake_backend, urllib.request, json
s = fake_backend.start()
def get(p, tok=None):
    r = urllib.request.Request('http://127.0.0.1:8899' + p, headers={'authorization': 'Bearer ' + tok} if tok else {})
    try: return urllib.request.urlopen(r).status
    except urllib.error.HTTPError as e: return e.code
print(get('/auth/me'), get('/auth/me', 'tok-admin'), get('/transcribe/stats', 'tok-user'), get('/auth/users', 'tok-user'), get('/nope', 'tok-admin'))
s.shutdown()"
```
Expected: `401 200 200 403 404`

- [ ] **Step 3: Files ready for review** (no commit)

---

### Task 3: Regression harness — old app vs new app

**Files:**
- Create: `APP/scripts/regression/compare.py`
- Create: `APP/scripts/regression/README.md`
- Modify: `APP/.gitignore`

What it does: builds each app with `VITE_BACKEND_URL=http://127.0.0.1:8899` into a temp dir (production build, so the real CSS pipeline is what gets tested), serves it with `vite preview`, and for each capture signs in by seeding `localStorage["transcribe.token"]`, pins the browser clock to `NOW`, opens the hash URL, waits for fonts + network, and records:
- `text`: `main.content` innerText (or `body` innerText when there's no `main`, i.e. the sign-in screen),
- `styles`: for every element under `<body>`, a path key and a fixed list of computed properties,
- `errors`: console errors and page errors.

It then diffs old vs new per capture and exits 1 on any difference.

- [ ] **Step 1: Write the harness**

Create `APP/scripts/regression/compare.py`:
```python
"""Render every transcribe view in two builds of the dashboard and report any difference.

Usage (from tecace-voice-agent-dashboard/):
    python scripts/regression/compare.py                       # OLD=../transcribe-dashboard-app vs NEW=.
    python scripts/regression/compare.py --old <dir> --new <dir>
    python scripts/regression/compare.py --only admin:overview:light

Needs: Python Playwright (no bundled browser needed — it drives the installed Edge), npm deps
installed in both apps. Exit code 0 = identical, 1 = differences (listed), 2 = harness failure.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

import fake_backend

HERE = Path(__file__).resolve().parent
APP_ROOT = HERE.parent.parent
BACKEND = "http://127.0.0.1:8899"
OUT_DIR = APP_ROOT / ".regression"

ADMIN_VIEWS = ["overview", "analytics", "people", "activity", "runs", "failed", "feedback",
               "allFeedback", "calls", "business", "numbers", "apiKeys", "accounts"]
SCOPED_VIEWS = ["overview", "analytics", "activity", "runs", "failed", "calls", "business"]
USER_VIEWS = ["overview", "analytics", "activity", "runs", "feedback", "calls", "business"]

# NOTE: `apiKeys` is missing from routing.ts's VIEWS list in the original app (known bug, fixed in
# stage 3). Both builds therefore land on Overview for #/apiKeys — identical, which is what stage
# 1–2 must prove. Stage 3 adds it to the expected-difference list when it fixes the router.


def captures() -> list[dict]:
    caps = [{"id": "signin:light", "token": None, "hash": "", "theme": "light"},
            {"id": "signin:dark", "token": None, "hash": "", "theme": "dark"}]
    for v in ADMIN_VIEWS:
        caps.append({"id": f"admin:{v}:light", "token": "tok-admin", "hash": f"#/{v}", "theme": "light"})
    for v in SCOPED_VIEWS:
        caps.append({"id": f"admin-scoped:{v}:light", "token": "tok-admin",
                     "hash": f"#/{v}?mailbox=sam%40tecace.com", "theme": "light"})
    for v in USER_VIEWS:
        caps.append({"id": f"user:{v}:light", "token": "tok-user", "hash": f"#/{v}", "theme": "light"})
    for v in ["overview", "failed", "business", "accounts"]:
        caps.append({"id": f"admin:{v}:dark", "token": "tok-admin", "hash": f"#/{v}", "theme": "dark"})
    caps.append({"id": "user:overview:dark", "token": "tok-user", "hash": "#/overview", "theme": "dark"})
    return caps


STYLE_PROPS = [
    "display", "position", "color", "background-color", "background-image", "border-top-width",
    "border-top-style", "border-top-color", "border-right-width", "border-bottom-width",
    "border-bottom-color", "border-left-width", "border-radius", "box-shadow", "font-family",
    "font-size", "font-weight", "line-height", "letter-spacing", "text-transform", "text-decoration-line",
    "margin-top", "margin-right", "margin-bottom", "margin-left", "padding-top", "padding-right",
    "padding-bottom", "padding-left", "opacity", "outline-style", "list-style-type", "text-align",
    "vertical-align", "white-space", "gap", "width", "height",
]

FINGERPRINT_JS = """
(props) => {
  const out = {};
  const walk = (el, path) => {
    const cs = getComputedStyle(el);
    const rec = {};
    for (const p of props) rec[p] = cs.getPropertyValue(p);
    out[path] = rec;
    const counts = {};
    for (const child of el.children) {
      const cls = typeof child.className === "string" ? child.className.trim().split(/\\s+/).filter(Boolean).join(".") : "";
      const key = child.tagName.toLowerCase() + (cls ? "." + cls : "");
      counts[key] = (counts[key] || 0) + 1;
      walk(child, path + ">" + key + "[" + counts[key] + "]");
    }
  };
  walk(document.body, "body");
  return out;
}
"""


def npx() -> str:
    exe = shutil.which("npx.cmd") or shutil.which("npx")
    if not exe:
        sys.exit("npx not found on PATH")
    return exe


def build(app_dir: Path, out: Path) -> None:
    env = {**os.environ, "VITE_BACKEND_URL": BACKEND}
    print(f"  building {app_dir.name} -> {out}")
    subprocess.run([npx(), "vite", "build", "--outDir", str(out), "--emptyOutDir"],
                   cwd=app_dir, env=env, check=True, stdout=subprocess.DEVNULL)


def serve(app_dir: Path, out: Path, port: int) -> subprocess.Popen:
    proc = subprocess.Popen(
        [npx(), "vite", "preview", "--outDir", str(out), "--port", str(port), "--host", "127.0.0.1",
         "--strictPort"],
        cwd=app_dir, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    url = f"http://127.0.0.1:{port}/"
    for _ in range(100):
        try:
            urllib.request.urlopen(url, timeout=1)
            return proc
        except OSError:
            time.sleep(0.2)
    stop(proc)
    raise RuntimeError(f"vite preview for {app_dir.name} never answered on {url}")


def stop(proc: subprocess.Popen) -> None:
    # vite runs under a cmd/node tree on Windows; kill the whole tree.
    subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def capture_all(base_url: str, caps: list[dict]) -> dict:
    results = {}
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="msedge")
        for cap in caps:
            ctx = browser.new_context(viewport={"width": 1440, "height": 900})
            init = ["try { localStorage.clear(); } catch (e) {}"]
            if cap["token"]:
                init.append(f"localStorage.setItem('transcribe.token', '{cap['token']}');")
            init.append(f"localStorage.setItem('theme', '{cap['theme']}');")
            ctx.add_init_script("\n".join(init))
            page = ctx.new_page()
            page.clock.set_fixed_time(fake_backend.NOW)
            errors: list[str] = []
            page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}") if m.type == "error" else None)
            page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
            page.goto(base_url + cap["hash"])
            page.wait_for_load_state("networkidle")
            page.evaluate("document.fonts.ready")
            page.wait_for_timeout(300)
            text = page.evaluate(
                "(document.querySelector('main.content') || document.body).innerText")
            styles = page.evaluate(FINGERPRINT_JS, STYLE_PROPS)
            results[cap["id"]] = {"text": text, "styles": styles, "errors": sorted(errors)}
            ctx.close()
        browser.close()
    return results


def diff(old: dict, new: dict) -> list[str]:
    problems: list[str] = []
    for cid in old:
        a, b = old[cid], new.get(cid)
        if b is None:
            problems.append(f"[{cid}] missing from new run")
            continue
        if a["text"] != b["text"]:
            problems.append(f"[{cid}] text differs")
        if a["errors"] != b["errors"]:
            problems.append(f"[{cid}] errors differ: old={a['errors']} new={b['errors']}")
        only_old = sorted(set(a["styles"]) - set(b["styles"]))
        only_new = sorted(set(b["styles"]) - set(a["styles"]))
        for path in only_old[:5]:
            problems.append(f"[{cid}] element only in old: {path}")
        for path in only_new[:5]:
            problems.append(f"[{cid}] element only in new: {path}")
        shown = 0
        for path in sorted(set(a["styles"]) & set(b["styles"])):
            for prop, val in a["styles"][path].items():
                if b["styles"][path].get(prop) != val and shown < 15:
                    problems.append(f"[{cid}] {path} {prop}: {val!r} -> {b['styles'][path].get(prop)!r}")
                    shown += 1
    return problems


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--old", default=str(APP_ROOT.parent / "transcribe-dashboard-app"))
    ap.add_argument("--new", default=str(APP_ROOT))
    ap.add_argument("--only", help="run a single capture id, e.g. admin:overview:light")
    args = ap.parse_args()

    caps = [c for c in captures() if not args.only or c["id"] == args.only]
    if not caps:
        print(f"no capture called {args.only!r}")
        return 2
    OUT_DIR.mkdir(exist_ok=True)
    server = fake_backend.start()
    runs = {}
    try:
        with tempfile.TemporaryDirectory(prefix="dash-regression-") as tmp:
            for label, app_dir, port in (("old", Path(args.old), 5198), ("new", Path(args.new), 5199)):
                out = Path(tmp) / label
                build(app_dir, out)
                proc = serve(app_dir, out, port)
                try:
                    print(f"  capturing {len(caps)} views from {label}")
                    runs[label] = capture_all(f"http://127.0.0.1:{port}/", caps)
                finally:
                    stop(proc)
                (OUT_DIR / f"{label}.json").write_text(json.dumps(runs[label], indent=1), encoding="utf-8")
    finally:
        server.shutdown()

    problems = diff(runs["old"], runs["new"])
    total_errors = sum(len(r["errors"]) for r in runs["new"].values())
    print(f"\n{len(caps)} captures compared; {total_errors} console/page errors in new "
          f"(identical to old unless listed below).")
    if problems:
        print(f"{len(problems)} DIFFERENCES:")
        for line in problems:
            print("  " + line)
        return 1
    print("IDENTICAL")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: Ignore the harness output**

Append to `APP/.gitignore`:
```
# Regression harness output (scripts/regression/compare.py)
.regression/
```

- [ ] **Step 3: Write the harness README**

Create `APP/scripts/regression/README.md`:
```markdown
# Regression harness

Proves a change to this app left the transcribe screens exactly as they were.

    cd tecace-voice-agent-dashboard
    python scripts/regression/compare.py

It builds `../transcribe-dashboard-app` (the original) and this app against `fake_backend.py`,
renders every view × role × mailbox scope (+ dark variants) in Edge with the clock pinned, and
compares each view's text, the computed styles of every element, and console errors. Prints
`IDENTICAL` and exits 0, or lists each difference and exits 1. Raw captures land in `.regression/`.

- Needs Python Playwright (`pip install playwright`); it uses the installed Microsoft Edge
  (`channel="msedge"`), so no `playwright install` is needed.
- `npm install` must have been run in both apps.
- One capture: `--only admin:overview:light`.
- `tw_probe.py` (stage 2) checks the Tailwind side inside a `.tw` wrapper.
```

- [ ] **Step 4: Prove the harness can see a difference (the "failing test")**

Temporarily break the copy: in `APP/src/index.css`, change the `.muted` rule's `color: var(--muted);` to `color: red;`. Then run:
```bash
cd tecace-voice-agent-dashboard && python scripts/regression/compare.py --only admin:overview:light
```
Expected: exit code 1, with lines like `[admin:overview:light] body>…span.muted… color: 'rgba(…)' -> 'rgb(255, 0, 0)'`.
Then undo the break by re-copying the original: `cp ../transcribe-dashboard-app/src/index.css src/index.css` (the project is untracked, so `git checkout` can't restore it).

- [ ] **Step 5: Run the full comparison on the untouched copy**

Run: `cd tecace-voice-agent-dashboard && python scripts/regression/compare.py`
Expected: `34 captures compared; …` then `IDENTICAL`, exit 0.

If it reports differences, they must be explained before moving on — the copy is byte-identical apart from `index.html`'s `<title>`, so a difference means the harness is non-deterministic (fix the harness, e.g. a wait) rather than the app. Re-run twice to confirm stability.

- [ ] **Step 6: Files ready for review** (no commit) — **Stage 1 done.**

---

# Stage 2 — Tailwind + shadcn theme, scoped

### Task 4: Vitest and a tested theme core

**Files:**
- Create: `APP/vitest.config.ts`, `APP/src/themeCore.ts`, `APP/tests/themeCore.test.ts`
- Modify: `APP/package.json`, `APP/tsconfig.json`, `APP/src/theme.tsx`, `APP/index.html`

The combined app needs one toggle that sets `data-theme` (what the transcribe CSS and design-system tokens read) **and** the `.dark` class (what Tailwind's `dark:` variant and the promo theme read). The DOM-touching part is a pure function over a minimal element interface, so it's unit-testable with no DOM.

- [ ] **Step 1: Install Vitest**

Run: `cd tecace-voice-agent-dashboard && npm install -D vitest@^5.0.1`
Expected: added packages, no peer-dependency errors (vitest 5 accepts vite ^8).

- [ ] **Step 2: Add the config and script**

Create `APP/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

// Unit tests only: pure modules, no DOM, no network — the whole suite should stay well under a
// second. Logic a component needs tested goes into a pure module (see src/themeCore.ts).
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
```
In `APP/package.json` `"scripts"`, add after `"typecheck"`:
```json
    "test": "vitest run"
```
(remember the comma after the `typecheck` line).
In `APP/tsconfig.json`, change the `include` line to:
```json
  "include": ["src", "tests", "vite.config.ts", "vitest.config.ts"]
```

- [ ] **Step 3: Write the failing test**

Create `APP/tests/themeCore.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { applyTheme, readTheme, type ThemeTarget } from "../src/themeCore";

function fakeRoot(attr: string | null = null, dark = false) {
  const classes = new Set<string>(dark ? ["dark"] : []);
  const attrs = new Map<string, string>(attr ? [["data-theme", attr]] : []);
  const target: ThemeTarget = {
    getAttribute: (name) => attrs.get(name) ?? null,
    setAttribute: (name, value) => void attrs.set(name, value),
    classList: { toggle: (name, force) => (force ? classes.add(name) : classes.delete(name), !!force) },
  };
  return { target, classes, attrs };
}

describe("applyTheme", () => {
  it("sets data-theme and adds .dark for dark", () => {
    const { target, classes, attrs } = fakeRoot();
    applyTheme(target, "dark");
    expect(attrs.get("data-theme")).toBe("dark");
    expect(classes.has("dark")).toBe(true);
  });

  it("sets data-theme and removes .dark for light", () => {
    const { target, classes, attrs } = fakeRoot("dark", true);
    applyTheme(target, "light");
    expect(attrs.get("data-theme")).toBe("light");
    expect(classes.has("dark")).toBe(false);
  });
});

describe("readTheme", () => {
  it("reads dark from data-theme", () => {
    expect(readTheme(fakeRoot("dark").target)).toBe("dark");
  });

  it("treats anything else as light", () => {
    expect(readTheme(fakeRoot().target)).toBe("light");
    expect(readTheme(fakeRoot("sepia").target)).toBe("light");
  });
});
```

- [ ] **Step 4: Run it to see it fail**

Run: `cd tecace-voice-agent-dashboard && npx vitest run`
Expected: FAIL — `Failed to resolve import "../src/themeCore"`.

- [ ] **Step 5: Implement the theme core**

Create `APP/src/themeCore.ts`:
```ts
// The theme lives in two places on <html>, because two stylesheets read it: the transcribe CSS and
// the design-system tokens read `data-theme`, while Tailwind's `dark:` variant and the promo theme
// read the `.dark` class. Setting them in one function is what keeps them from disagreeing.
export type Theme = "light" | "dark";

/** The slice of an Element this needs — so it can be tested without a DOM. */
export interface ThemeTarget {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  classList: { toggle(name: string, force?: boolean): boolean };
}

export function readTheme(root: ThemeTarget): Theme {
  return root.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

export function applyTheme(root: ThemeTarget, theme: Theme): void {
  root.setAttribute("data-theme", theme);
  root.classList.toggle("dark", theme === "dark");
}
```

- [ ] **Step 6: Run it to see it pass**

Run: `cd tecace-voice-agent-dashboard && npx vitest run`
Expected: `Test Files  1 passed (1)`, `Tests  4 passed (4)`.

- [ ] **Step 7: Use it in the theme hook**

Replace the `useTheme` function in `APP/src/theme.tsx` (keep the imports' `IconMoon, IconSun` line and the `ThemeToggle` component unchanged) so the file reads:
```tsx
import { useEffect, useState } from "react";
import { IconMoon, IconSun } from "./icons";
import { applyTheme, readTheme, type Theme } from "./themeCore";

// Light/dark theme, applied to <html> as both `data-theme` and the `.dark` class (see themeCore)
// and persisted so it survives reloads (index.html also applies the saved value before first paint
// to avoid a flash).
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => readTheme(document.documentElement));
  useEffect(() => {
    applyTheme(document.documentElement, theme);
    try {
      localStorage.setItem("theme", theme);
    } catch {
      /* localStorage unavailable — theme just won't persist */
    }
  }, [theme]);
  return [theme, () => setTheme((t) => (t === "dark" ? "light" : "dark"))];
}

// The toggle itself, so the sign-in screen and the dashboard header share one control.
export function ThemeToggle() {
  const [theme, toggle] = useTheme();
  return (
    <button
      type="button"
      className="icon-btn"
      onClick={toggle}
      aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      title={theme === "dark" ? "Light theme" : "Dark theme"}
    >
      {theme === "dark" ? <IconSun size={16} /> : <IconMoon size={16} />}
    </button>
  );
}
```

- [ ] **Step 8: Pre-paint script sets the class too**

In `APP/index.html`, replace the line
```js
        if (t === "dark" || t === "light") document.documentElement.setAttribute("data-theme", t);
```
with
```js
        if (t === "dark" || t === "light") {
          document.documentElement.setAttribute("data-theme", t);
          document.documentElement.classList.toggle("dark", t === "dark");
        }
```

- [ ] **Step 9: Build and re-run the regression**

Run: `cd tecace-voice-agent-dashboard && npm run build && python scripts/regression/compare.py`
Expected: build clean; `IDENTICAL`. (`fig-tokens.css` already treats `.dark` exactly like `[data-theme="dark"]` — line 495 — so adding the class changes nothing on transcribe screens. The dark captures prove it.)

- [ ] **Step 10: Files ready for review** (no commit)

---

### Task 5: Install Tailwind and generate the scoped reset

**Files:**
- Modify: `APP/package.json` (deps)
- Create: `APP/postcss.config.mjs`, `APP/scripts/build-scoped-preflight.mjs`, `APP/src/styles/ui-preflight.css`

Tailwind's reset (`preflight.css`) is global: it zeroes heading sizes, margins, button styles and list bullets that parts of the transcribe CSS rely on. It is therefore **not** imported globally. Instead a script wraps it in `@scope (.tw) { … }` so it only applies inside promo screens, and appends rules that undo the transcribe CSS's bare-element rules (`a:hover`, `code`, `table`, `th`, `td`, `:focus-visible`) inside `.tw`, restoring what the promo had (preflight + browser defaults). Layer order puts `base` **after** `legacy`, so inside `.tw` these win over the transcribe rules; outside `.tw` they match nothing.

- [ ] **Step 1: Install**

Run: `cd tecace-voice-agent-dashboard && npm install -D tailwindcss@^4.3.3 @tailwindcss/postcss@^4.3.3 && npm install tw-animate-css@^1.4.0`
Expected: packages added, no errors.

- [ ] **Step 2: Confirm the Tailwind entry points this plan relies on**

Run:
```bash
cd tecace-voice-agent-dashboard && ls node_modules/tailwindcss/theme.css node_modules/tailwindcss/preflight.css node_modules/tailwindcss/utilities.css && cat node_modules/tailwindcss/index.css && grep -c "@layer" node_modules/tailwindcss/preflight.css
```
Expected: the three files exist; `index.css` shows `@layer theme, base, components, utilities;` and imports `./theme.css` layer(theme), `./preflight.css` layer(base), `./utilities.css` layer(utilities); the grep prints `0` (preflight has no `@layer` of its own, so wrapping it in `@scope` is valid). If any of this differs, stop and re-check the Tailwind docs for "disabling preflight" before continuing.

- [ ] **Step 3: PostCSS config**

Create `APP/postcss.config.mjs`:
```js
// Tailwind v4 runs as a PostCSS plugin (the same setup the promo app uses). Vite picks this file up
// on its own.
export default {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
```

- [ ] **Step 4: The generator script**

Create `APP/scripts/build-scoped-preflight.mjs`:
```js
// Writes src/styles/ui-preflight.css: Tailwind's reset, scoped to `.tw` subtrees.
//
// Run after upgrading tailwindcss:  node scripts/build-scoped-preflight.mjs
//
// Why scoped: the transcribe screens were written against browser defaults, and a global reset
// changes them (heading sizes, margins, buttons, list bullets). Promo screens were written against
// the reset. Wrapping it in @scope (.tw) gives each side the ground it was built on.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const preflightPath = require.resolve("tailwindcss/preflight.css", { paths: [root] });
const version = JSON.parse(
  readFileSync(require.resolve("tailwindcss/package.json", { paths: [root] }), "utf8"),
).version;
const preflight = readFileSync(preflightPath, "utf8");

const header = `/* GENERATED by scripts/build-scoped-preflight.mjs from tailwindcss@${version} preflight.css.
   Do not edit by hand — re-run the script instead.

   Imported into @layer base, which sits AFTER @layer legacy (the transcribe CSS). So inside a .tw
   subtree this reset beats the transcribe rules; outside one it matches nothing. */
`;

// html/:host/body rules in preflight can't match inside a scope; :scope stands in for them.
const rootRules = `
  :scope {
    line-height: 1.5;
    -webkit-text-size-adjust: 100%;
    tab-size: 4;
    font-family: var(--ui-font-sans);
    font-feature-settings: normal;
    font-variation-settings: normal;
    -webkit-tap-highlight-color: transparent;
  }
`;

// The transcribe CSS styles some elements with bare selectors (a:hover, code, table, th, td,
// :focus-visible). preflight doesn't set every one of those properties, so without this they would
// leak into promo screens. Properties preflight sets get preflight's value; the rest go back to the
// browser default with \`revert\` — which is exactly what the promo app had.
const undoLegacy = `
  a:hover { text-decoration: inherit; }
  code {
    font-size: 1em;
    background: revert;
    color: revert;
    padding: 0;
    border-radius: revert;
  }
  table { width: revert; }
  th, td {
    text-align: revert;
    padding: 0;
    height: revert;
    border-top: 0 solid;
    vertical-align: revert;
    white-space: revert;
    color: revert;
    font-weight: revert;
    font-size: revert;
    line-height: revert;
    letter-spacing: revert;
    background: revert;
    font-variant-numeric: revert;
  }
  :where(button, a, input, select):focus-visible {
    outline: revert;
    outline-offset: revert;
  }
`;

const out = `${header}@scope (.tw) {${rootRules}\n${preflight}\n${undoLegacy}}\n`;
writeFileSync(join(root, "src", "styles", "ui-preflight.css"), out);
console.log(`wrote src/styles/ui-preflight.css (tailwindcss@${version}, ${out.length} bytes)`);
```

- [ ] **Step 5: Generate**

Run: `cd tecace-voice-agent-dashboard && mkdir -p src/styles && node scripts/build-scoped-preflight.mjs && head -12 src/styles/ui-preflight.css && tail -5 src/styles/ui-preflight.css`
Expected: `wrote src/styles/ui-preflight.css (tailwindcss@4.3.3, …)`; the head shows the GENERATED header and `@scope (.tw) {`; the tail ends with the `:focus-visible` rule and a closing `}`.

- [ ] **Step 6: Files ready for review** (no commit)

---

### Task 6: Layer the stylesheets and add the promo theme

**Files:**
- Move: `APP/src/index.css` → `APP/src/styles/legacy.css`
- Create: `APP/src/styles/ui-theme.css`, `APP/src/styles/index.css`
- Modify: `APP/src/main.tsx`

- [ ] **Step 1: Move the transcribe stylesheet and strip its imports**

Run:
```bash
cd tecace-voice-agent-dashboard && mv src/index.css src/styles/legacy.css && sed -n '1,12p' src/styles/legacy.css
```
Lines 8–11 are the four `@import` lines (Pretendard, Poppins, `./tecace/fig-tokens.css`, `./tecace/typography.css`). Delete exactly those four lines from `src/styles/legacy.css` — they move to the entry file, because `@import` must come before every other rule and the token files must be imported into the same layer. Also replace the first comment line
```css
/* Transcribe dashboard — styled with the TecAce Dashboard UI system (.claude/skills/tecace-dashboard-ui).
```
with
```css
/* Transcribe screens (imported into @layer legacy by styles/index.css) — styled with the TecAce Dashboard UI system (.claude/skills/tecace-dashboard-ui).
```
Verify: `grep -c "@import" src/styles/legacy.css` prints `0`.

- [ ] **Step 2: Write the promo theme, prefixed and scoped**

Create `APP/src/styles/ui-theme.css`. It is the promo's `app/globals.css` (voiceagent_promo @ f482848, lines 25–242) with: every custom property declared in `:root` / `.dark` renamed `--x` → `--ui-x`; `@theme inline` pointing at the `--ui-` names; the `@layer base` block scoped to `.tw`; the `.ta-*` scale scoped to `.tw` and left unlayered (in the promo it was unlayered, so it beat utilities — kept that way); the Tailwind and font imports removed (the entry does those).
```css
/* Promo screens' theme — TecAce Dashboard Theme for shadcn/ui (Tailwind v4), from voiceagent_promo
   app/globals.css @ f482848. Source of truth: TECACE DESIGN SYSTEM_JULY.fig. Brand #116DFF.

   Differences from the promo's file, all so it can share a page with the transcribe CSS:
   - Every variable is prefixed --ui- (the transcribe CSS and design-system tokens use --primary,
     --muted, --border, --label-strong, --font-sans … with different meanings).
   - The base rules and the .ta-* scale apply only inside a .tw subtree.
   Tailwind utility names are unchanged: bg-primary still means brand blue. */

@custom-variant dark (&:is(.dark *));

/* ================= LIGHT ================= */
:root {
  --ui-background: #ffffff;
  --ui-foreground: #171717;
  --ui-card: #ffffff;
  --ui-card-foreground: #171717;
  --ui-popover: #ffffff;
  --ui-popover-foreground: #171717;
  --ui-primary: #116dff;
  --ui-primary-foreground: #ffffff;
  --ui-secondary: rgba(112, 115, 124, 0.08);
  --ui-secondary-foreground: #171717;
  --ui-muted: rgba(112, 115, 124, 0.05);
  --ui-muted-foreground: rgba(55, 56, 60, 0.61);
  --ui-accent: rgba(112, 115, 124, 0.05);
  --ui-accent-foreground: #171717;
  --ui-destructive: #e83034;
  --ui-destructive-foreground: #ffffff;
  --ui-border: rgba(112, 115, 124, 0.16);
  --ui-input: rgba(112, 115, 124, 0.16);
  --ui-ring: #116dff;
  --ui-chart-1: #116dff;
  --ui-chart-2: #00b9dc;
  --ui-chart-3: #7038e1;
  --ui-chart-4: #f532a8;
  --ui-chart-5: #66bc12;
  --ui-chart-6: #5860d5;
  --ui-chart-7: #eb4e1c;
  --ui-sidebar: #f7f7f8;
  --ui-sidebar-foreground: #171717;
  --ui-sidebar-primary: #116dff;
  --ui-sidebar-primary-foreground: #ffffff;
  --ui-sidebar-accent: rgba(112, 115, 124, 0.08);
  --ui-sidebar-accent-foreground: #171717;
  --ui-sidebar-border: rgba(112, 115, 124, 0.16);
  --ui-sidebar-ring: #116dff;

  --ui-success: #0abe5c;
  --ui-success-foreground: #ffffff;
  --ui-warning: #e18a0f;
  --ui-warning-foreground: #ffffff;
  --ui-primary-strong: #0e64e6;
  --ui-primary-heavy: #0b55cc;
  --ui-label-strong: #000000;
  --ui-label-neutral: rgba(46, 47, 51, 0.88);
  --ui-label-assistive: rgba(55, 56, 60, 0.28);
  --ui-label-disable: rgba(55, 56, 60, 0.16);
  --ui-fill-strong: rgba(112, 115, 124, 0.16);

  --ui-font-sans: "Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --ui-font-display: Poppins, "Pretendard Variable", Pretendard, sans-serif;
  --ui-font-mono: "SF Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;

  --ui-radius: 0.75rem;

  --ui-shadow-2xs: 0 1px 2px 0 rgba(0, 0, 0, 0.03);
  --ui-shadow-xs: 0 1px 2px 0 rgba(0, 0, 0, 0.03);
  --ui-shadow-sm: 0 1px 2px 0 rgba(23, 23, 25, 0.06);
  --ui-shadow: 0 2px 8px 0 rgba(23, 23, 25, 0.08);
  --ui-shadow-md: 0 4px 12px 0 rgba(23, 23, 25, 0.1);
  --ui-shadow-lg: 0 8px 24px 0 rgba(23, 23, 25, 0.12);
  --ui-shadow-xl: 0 12px 32px 0 rgba(23, 23, 25, 0.14);
  --ui-shadow-2xl: 0 16px 48px 0 rgba(23, 23, 25, 0.16);
}

/* ================= DARK ================= */
.dark {
  --ui-background: #1b1c1e;
  --ui-foreground: #f7f7f7;
  --ui-card: #212225;
  --ui-card-foreground: #f7f7f7;
  --ui-popover: #212225;
  --ui-popover-foreground: #f7f7f7;
  --ui-primary: #5b84ff;
  --ui-primary-foreground: #ffffff;
  --ui-secondary: rgba(112, 115, 124, 0.22);
  --ui-secondary-foreground: #f7f7f7;
  --ui-muted: rgba(112, 115, 124, 0.12);
  --ui-muted-foreground: rgba(174, 176, 182, 0.61);
  --ui-accent: rgba(112, 115, 124, 0.12);
  --ui-accent-foreground: #f7f7f7;
  --ui-destructive: #f05555;
  --ui-destructive-foreground: #ffffff;
  --ui-border: rgba(112, 115, 124, 0.28);
  --ui-input: rgba(112, 115, 124, 0.28);
  --ui-ring: #5b84ff;
  --ui-chart-1: #5b84ff;
  --ui-chart-2: #28cdeb;
  --ui-chart-3: #8e5aeb;
  --ui-chart-4: #f85fb9;
  --ui-chart-5: #87d237;
  --ui-chart-6: #787fde;
  --ui-chart-7: #f27041;
  --ui-sidebar: #171719;
  --ui-sidebar-foreground: #f7f7f7;
  --ui-sidebar-primary: #5b84ff;
  --ui-sidebar-primary-foreground: #ffffff;
  --ui-sidebar-accent: rgba(112, 115, 124, 0.22);
  --ui-sidebar-accent-foreground: #f7f7f7;
  --ui-sidebar-border: rgba(112, 115, 124, 0.22);
  --ui-sidebar-ring: #5b84ff;

  --ui-success: #37d278;
  --ui-success-foreground: #0c1126;
  --ui-warning: #eea832;
  --ui-warning-foreground: #0c1126;
  --ui-primary-strong: #3383ff;
  --ui-primary-heavy: #116dff;
  --ui-label-strong: #ffffff;
  --ui-label-neutral: rgba(219, 220, 223, 0.88);
  --ui-label-assistive: rgba(174, 176, 182, 0.28);
  --ui-label-disable: rgba(174, 176, 182, 0.16);
  --ui-fill-strong: rgba(112, 115, 124, 0.28);
}

/* ============ Tailwind v4 theme mapping ============
   `inline` makes utilities use these values directly rather than var(--radius-sm) etc., so the
   transcribe CSS's own --radius-sm / --font-sans can never leak into a utility. */
@theme inline {
  --color-background: var(--ui-background);
  --color-foreground: var(--ui-foreground);
  --color-card: var(--ui-card);
  --color-card-foreground: var(--ui-card-foreground);
  --color-popover: var(--ui-popover);
  --color-popover-foreground: var(--ui-popover-foreground);
  --color-primary: var(--ui-primary);
  --color-primary-foreground: var(--ui-primary-foreground);
  --color-secondary: var(--ui-secondary);
  --color-secondary-foreground: var(--ui-secondary-foreground);
  --color-muted: var(--ui-muted);
  --color-muted-foreground: var(--ui-muted-foreground);
  --color-accent: var(--ui-accent);
  --color-accent-foreground: var(--ui-accent-foreground);
  --color-destructive: var(--ui-destructive);
  --color-destructive-foreground: var(--ui-destructive-foreground);
  --color-border: var(--ui-border);
  --color-input: var(--ui-input);
  --color-ring: var(--ui-ring);
  --color-chart-1: var(--ui-chart-1);
  --color-chart-2: var(--ui-chart-2);
  --color-chart-3: var(--ui-chart-3);
  --color-chart-4: var(--ui-chart-4);
  --color-chart-5: var(--ui-chart-5);
  --color-chart-6: var(--ui-chart-6);
  --color-chart-7: var(--ui-chart-7);
  --color-sidebar: var(--ui-sidebar);
  --color-sidebar-foreground: var(--ui-sidebar-foreground);
  --color-sidebar-primary: var(--ui-sidebar-primary);
  --color-sidebar-primary-foreground: var(--ui-sidebar-primary-foreground);
  --color-sidebar-accent: var(--ui-sidebar-accent);
  --color-sidebar-accent-foreground: var(--ui-sidebar-accent-foreground);
  --color-sidebar-border: var(--ui-sidebar-border);
  --color-sidebar-ring: var(--ui-sidebar-ring);
  --color-success: var(--ui-success);
  --color-success-foreground: var(--ui-success-foreground);
  --color-warning: var(--ui-warning);
  --color-warning-foreground: var(--ui-warning-foreground);
  --color-primary-strong: var(--ui-primary-strong);

  --font-sans: var(--ui-font-sans);
  --font-display: var(--ui-font-display);
  --font-mono: var(--ui-font-mono);

  --radius-sm: calc(var(--ui-radius) - 4px);
  --radius-md: calc(var(--ui-radius) - 2px);
  --radius-lg: var(--ui-radius);
  --radius-xl: calc(var(--ui-radius) + 4px);
  --radius-2xl: calc(var(--ui-radius) + 8px);

  --shadow-2xs: var(--ui-shadow-2xs);
  --shadow-xs: var(--ui-shadow-xs);
  --shadow-sm: var(--ui-shadow-sm);
  --shadow: var(--ui-shadow);
  --shadow-md: var(--ui-shadow-md);
  --shadow-lg: var(--ui-shadow-lg);
  --shadow-xl: var(--ui-shadow-xl);
  --shadow-2xl: var(--ui-shadow-2xl);
}

/* The promo's base rules, applied to .tw subtrees only. `:scope` stands in for the promo's body. */
@layer base {
  @scope (.tw) {
    * {
      @apply border-border outline-ring/50;
    }
    :scope {
      @apply bg-background text-foreground;
      font-family: var(--ui-font-sans);
      font-weight: 500;
      -webkit-font-smoothing: antialiased;
    }
    ::placeholder {
      color: var(--ui-label-assistive);
    }
  }
}

/* ============ TecAce type scale (19 styles), .tw subtrees only ============
   Unlayered on purpose: in the promo these beat Tailwind utilities, and promo markup relies on it
   (e.g. `ta-caption-1 font-semibold` renders at 500). The transcribe screens keep their own copy in
   tecace/typography.css inside @layer legacy. */
@scope (.tw) {
  .ta-display-1{font-family:var(--ui-font-sans);font-weight:700;font-size:56px;line-height:72px;letter-spacing:-0.0319em}
  .ta-display-2{font-family:var(--ui-font-sans);font-weight:700;font-size:40px;line-height:52px;letter-spacing:-0.0282em}
  .ta-display-3{font-family:var(--ui-font-sans);font-weight:700;font-size:36px;line-height:48px;letter-spacing:-0.027em}
  .ta-title-1{font-family:var(--ui-font-sans);font-weight:700;font-size:32px;line-height:44px;letter-spacing:-0.0253em}
  .ta-title-2{font-family:var(--ui-font-sans);font-weight:700;font-size:28px;line-height:38px;letter-spacing:-0.0236em}
  .ta-title-3{font-family:var(--ui-font-sans);font-weight:700;font-size:24px;line-height:32px;letter-spacing:-0.023em}
  .ta-heading-1{font-family:var(--ui-font-sans);font-weight:600;font-size:22px;line-height:30px;letter-spacing:-0.0194em}
  .ta-heading-2{font-family:var(--ui-font-sans);font-weight:600;font-size:20px;line-height:28px;letter-spacing:-0.012em}
  .ta-headline-1{font-family:var(--ui-font-sans);font-weight:600;font-size:18px;line-height:26px;letter-spacing:-0.002em}
  .ta-headline-2{font-family:var(--ui-font-sans);font-weight:600;font-size:17px;line-height:24px;letter-spacing:0}
  .ta-body-1{font-family:var(--ui-font-sans);font-weight:500;font-size:16px;line-height:24px;letter-spacing:0.0057em}
  .ta-body-1-reading{font-family:var(--ui-font-sans);font-weight:500;font-size:16px;line-height:26px;letter-spacing:0.0057em}
  .ta-body-2{font-family:var(--ui-font-sans);font-weight:500;font-size:15px;line-height:22px;letter-spacing:0.0096em}
  .ta-body-2-reading{font-family:var(--ui-font-sans);font-weight:500;font-size:15px;line-height:24px;letter-spacing:0.0096em}
  .ta-label-1{font-family:var(--ui-font-sans);font-weight:500;font-size:14px;line-height:20px;letter-spacing:0.0145em}
  .ta-label-1-reading{font-family:var(--ui-font-sans);font-weight:500;font-size:14px;line-height:22px;letter-spacing:0.0145em}
  .ta-label-2{font-family:var(--ui-font-sans);font-weight:500;font-size:13px;line-height:18px;letter-spacing:0.0194em}
  .ta-caption-1{font-family:var(--ui-font-sans);font-weight:500;font-size:12px;line-height:16px;letter-spacing:0.0252em}
  .ta-caption-2{font-family:var(--ui-font-sans);font-weight:500;font-size:11px;line-height:14px;letter-spacing:0.0311em}
  .ta-numeric{font-family:var(--ui-font-display);font-variant-numeric:tabular-nums;font-weight:600}
}
```
Before saving, diff the variable list against the promo file to be sure none was dropped:
```bash
P="/c/Users/Michael Knutsen/Documents/projects/test_demo/voiceagent_promo/app/globals.css"
diff <(sed -n '28,94p' "$P" | grep -oE '^\s*--[a-z0-9-]+' | tr -d ' ' | sort -u) \
     <(grep -oE '^\s*--ui-[a-z0-9-]+' tecace-voice-agent-dashboard/src/styles/ui-theme.css | tr -d ' ' | sed 's/--ui-/--/' | sort -u) && echo "ALL VARS PRESENT"
```
Expected: `ALL VARS PRESENT`.

- [ ] **Step 3: Write the entry stylesheet**

Create `APP/src/styles/index.css`:
```css
/* Stylesheet entry. Two styling systems share this app, kept apart by cascade layers:

   theme      Tailwind's default theme variables (lowest — anything below overrides them)
   legacy     the transcribe screens: design-system tokens + type scale + their component CSS,
              written against browser defaults, unchanged
   base       Tailwind's reset + the promo base rules, scoped to .tw subtrees (ui-preflight.css,
              ui-theme.css). After legacy, so inside .tw they win over legacy's bare element rules;
              outside .tw they match nothing
   components (unused)
   utilities  Tailwind utilities — used only by promo markup

   Unlayered: ui-theme.css's --ui-* variables and its .tw-scoped type scale.
   Promo screens render inside an element with class "tw". Nothing outside one is affected. */
@layer theme, legacy, base, components, utilities;

@import url("https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css");
@import url("https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css");
@import url("https://fonts.googleapis.com/css2?family=Poppins:wght@500;600;700&display=swap");

@import "tailwindcss/theme.css" layer(theme);

@import "../tecace/fig-tokens.css" layer(legacy);
@import "../tecace/typography.css" layer(legacy);
@import "./legacy.css" layer(legacy);

@import "./ui-preflight.css" layer(base);

@import "tailwindcss/utilities.css" layer(utilities);
@import "tw-animate-css";

@import "./ui-theme.css";
```
(Poppins stays at the transcribe app's 500–700: loading another weight could change how transcribe text renders without changing any computed style, which the harness can't see. Stage 4 adds 400 only if a promo screen needs it. The Pretendard *variable* font is a separate family name — the transcribe stack names only "Pretendard" — so it can't affect transcribe screens.)

- [ ] **Step 4: Point `main.tsx` at the entry**

In `APP/src/main.tsx` replace `import "./index.css";` with `import "./styles/index.css";`.

- [ ] **Step 5: Build and inspect the output CSS**

Run:
```bash
cd tecace-voice-agent-dashboard && npm run build && CSS=$(ls dist/assets/*.css) && echo "size: $(wc -c < $CSS)" && grep -o "@layer theme,legacy,base,components,utilities" $CSS | head -1 && grep -c "@scope" $CSS && grep -o "\-\-ui-primary:#116dff" $CSS | head -1
```
Expected: build clean; the layer-order statement is present (minified, no spaces); `@scope` count ≥ 3; `--ui-primary:#116dff` present. If `@scope` is missing, the minifier dropped it — stop and report (the fallback is to prefix selectors with `:where(.tw)` instead, which needs a plan change).

- [ ] **Step 6: Regression**

Run: `cd tecace-voice-agent-dashboard && python scripts/regression/compare.py`
Expected: `IDENTICAL`.
If differences appear, read the property and path: a legacy variable overridden by an unlayered `:root` rule means a name was missed in the `--ui-` rename; a transcribe element changed by a Tailwind default means some `theme`-layer variable the transcribe CSS references without defining (check `grep -o "var(--[a-z0-9-]*" src/styles/legacy.css | sort -u` against what legacy + fig-tokens define). Fix and re-run until `IDENTICAL`.

- [ ] **Step 7: Files ready for review** (no commit)

---

### Task 7: Probe — Tailwind works inside `.tw` and nowhere else

**Files:**
- Create: `APP/scripts/tw-probe.html`, `APP/scripts/regression/tw_probe.py`

Tailwind only generates classes it finds in project files, so the probe markup lives in a project file (Tailwind's automatic source detection scans `scripts/`). It is injected into the running app and computed styles are asserted.

- [ ] **Step 1: The probe markup**

Create `APP/scripts/tw-probe.html`:
```html
<!-- Markup for scripts/regression/tw_probe.py. Kept in the project so Tailwind's source scan
     generates these classes. Not loaded by the app. -->
<div id="probe" class="tw">
  <div id="p-bg" class="bg-background">Surface</div>
  <button id="p-btn" class="bg-primary text-primary-foreground rounded-xl border px-3">Probe</button>
  <h1 id="p-h1">Heading</h1>
  <a id="p-a" href="#">Link</a>
  <span id="p-ta" class="ta-caption-1 font-bold">Caption</span>
  <table><tbody><tr><td id="p-td">Cell</td></tr></tbody></table>
</div>
<a id="p-outside-a" href="#">Outside link</a>
<h1 id="p-outside-h1">Outside heading</h1>
<svg><line id="p-outside-grid" class="grid" x1="0" y1="0" x2="10" y2="0" /></svg>
<span id="p-outside-sr" class="sr-only">Outside sr-only</span>
```

- [ ] **Step 2: The probe script (write it; run it next step to see it pass or fail)**

Create `APP/scripts/regression/tw_probe.py`:
```python
"""Checks the Tailwind half of the stylesheet: utilities and the scoped reset work inside .tw,
and nothing inside .tw leaks out. Run from tecace-voice-agent-dashboard/ after a build:

    python scripts/regression/tw_probe.py

Exit 0 = all checks pass, 1 = failures listed.
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

from playwright.sync_api import sync_playwright

import fake_backend
from compare import APP_ROOT, build, serve, stop

PROBE = (APP_ROOT / "scripts" / "tw-probe.html").read_text(encoding="utf-8")

STYLE_OF = """
([id, prop]) => getComputedStyle(document.getElementById(id)).getPropertyValue(prop)
"""

LIGHT = [
    ("probe", "background-color", "rgba(0, 0, 0, 0)"),  # the .tw root paints no background (sits on the canvas)
    ("probe", "color", "rgb(23, 23, 23)"),
    ("p-bg", "background-color", "rgb(255, 255, 255)"),
    ("p-btn", "background-color", "rgb(17, 109, 255)"),
    ("p-btn", "border-top-left-radius", "16px"),
    ("p-btn", "border-top-style", "solid"),
    ("p-btn", "border-top-color", "rgba(112, 115, 124, 0.16)"),
    ("p-h1", "margin-top", "0px"),                  # scoped preflight reset the heading
    ("p-h1", "font-size", "16px"),                  # ...and its size (inherits)
    ("p-a", "color", "rgb(23, 23, 23)"),            # preflight beats legacy `a { color: primary }`
    ("p-ta", "font-weight", "500"),                 # scoped .ta-* beats the font-bold utility
    ("p-td", "padding-left", "0px"),                # legacy th/td padding undone inside .tw
    ("p-td", "border-top-width", "0px"),            # legacy th/td top border undone inside .tw
    ("p-outside-a", "color", "rgb(17, 109, 255)"),  # outside .tw the transcribe rule still applies
    ("p-outside-h1", "margin-top", "21.44px"),      # outside .tw the browser default h1 margin
    ("p-outside-grid", "display", "inline"),        # utilities are scoped: transcribe `grid` stays an SVG line
    ("p-outside-sr", "clip-path", "none"),          # ...and Tailwind's sr-only never reaches a transcribe element
]
DARK = [
    ("p-bg", "background-color", "rgb(27, 28, 30)"),
    ("p-btn", "background-color", "rgb(91, 132, 255)"),
]


def main() -> int:
    failures: list[str] = []
    server = fake_backend.start()
    try:
        with tempfile.TemporaryDirectory(prefix="tw-probe-") as tmp:
            build(APP_ROOT, Path(tmp))
            proc = serve(APP_ROOT, Path(tmp), 5199)
            try:
                with sync_playwright() as p:
                    browser = p.chromium.launch(channel="msedge")
                    page = browser.new_page(viewport={"width": 1440, "height": 900})
                    page.goto("http://127.0.0.1:5199/")
                    page.wait_for_load_state("networkidle")
                    page.evaluate("(html) => document.body.insertAdjacentHTML('beforeend', html)", PROBE)
                    for theme, checks in (("light", LIGHT), ("dark", DARK)):
                        page.evaluate(
                            "(t) => { document.documentElement.setAttribute('data-theme', t);"
                            " document.documentElement.classList.toggle('dark', t === 'dark'); }", theme)
                        for el, prop, want in checks:
                            got = page.evaluate(STYLE_OF, [el, prop])
                            status = "ok  " if got == want else "FAIL"
                            print(f"  {status} [{theme}] #{el} {prop}: {got!r}" + ("" if got == want else f" (want {want!r})"))
                            if got != want:
                                failures.append(f"[{theme}] #{el} {prop}")
                    browser.close()
            finally:
                stop(proc)
    finally:
        server.shutdown()
    print(f"\n{len(failures)} failing checks" if failures else "\nALL PROBE CHECKS PASS")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 3: Run the probe**

Run: `cd tecace-voice-agent-dashboard && python scripts/regression/tw_probe.py`
Expected: every line `ok`, then `ALL PROBE CHECKS PASS`.
Notes if something fails:
- `#p-outside-h1 margin-top` — 21.44px is Edge's default `h1` margin (0.67em × 32px). If the transcribe CSS sets a body font-size the number differs; the point of the check is only that it is **not** `0px`. Adjust the expected value to what Edge reports as long as it isn't `0px`, and note it in the file.
- Any `#p-btn` failure means utilities aren't generated: check `grep -c "bg-primary" dist/assets/*.css` — if 0, Tailwind isn't scanning `scripts/`; add `@source "../../scripts/tw-probe.html";` after the utilities import in `src/styles/index.css`.

- [ ] **Step 4: Files ready for review** (no commit)

---

### Task 8: Document the new styling rules

**Files:**
- Modify: `APP/CLAUDE.md`, `APP/README.md`

- [ ] **Step 1: Rewrite `CLAUDE.md`**

Overwrite `APP/CLAUDE.md` with:
```markdown
# TecAce voice agent dashboard — UI conventions

This app combines two front ends (spec: `docs/superpowers/specs/2026-09-21-combined-dashboard-design.md`):
the **transcribe screens** (from `transcribe-dashboard-app`) and, from stage 3 on, the **promo
screens** (from the separate `voiceagent_promo` repo @ f482848). **All UI / styling / chart work
MUST follow the `tecace-dashboard-ui` skill** — invoke it before writing styles or charts.

## Two styling systems, kept apart by cascade layers

See the header of `src/styles/index.css` for the layer order and why.

- **Transcribe screens: plain React + hand-rolled CSS** in `src/styles/legacy.css`, on the
  design-system tokens in `src/tecace/{fig-tokens,typography}.css`. Do not add Tailwind classes to
  them and do not migrate them to shadcn/Tailwind unless explicitly asked.
- **Promo screens: Tailwind v4 + shadcn/ui (on Base UI)**. Every promo screen renders inside an
  element with class **`tw`** — Tailwind's reset and the promo base rules only apply inside one
  (`src/styles/ui-preflight.css`, generated; `src/styles/ui-theme.css`). Markup outside `.tw` gets
  no reset.
- Promo theme variables are prefixed **`--ui-`**. Utility names are unchanged (`bg-primary`).
- `src/styles/ui-preflight.css` is generated — re-run `node scripts/build-scoped-preflight.mjs`
  after upgrading tailwindcss, never edit it.
- Theme: `src/themeCore.ts` sets `data-theme` **and** `.dark` on `<html>` together. Chart.js charts
  remount on theme change (`key={theme}`).
- Never hardcode a hex — reference a token (`var(--…)` in legacy CSS, a utility in promo markup).

## Proving nothing broke

`python scripts/regression/compare.py` renders every transcribe view in the original app and in
this one and must print `IDENTICAL`. `python scripts/regression/tw_probe.py` checks the Tailwind
side. `npm test` runs the unit tests. Run all three after any styling change.

## Hard rules (from the skill)
- Brand blue **#116DFF** only — never `#3366FF` or `#2AA25F`.
- Body text **weight 500** (not 400).
- **Sentence case** — no ALL CAPS / `text-transform: uppercase` for emphasis; write `TecAce` exactly.
- **Outlined cards at radius 16** — never both border and shadow; shadows ambient only.
- Header is a **plain 1px hairline** — no gradient strip, no blur.
- Spacing on the **4px grid**; motion is **.15s ease** fades only.
- The chart accent palette (`--chart-1…7` / `--ui-chart-1…7`) is for data-viz only, never controls.
```

- [ ] **Step 2: Rewrite `README.md`**

Overwrite `APP/README.md` with:
```markdown
# tecace-voice-agent-dashboard

The TecAce voice agent dashboard — one front end combining the transcribe dashboard
(`../transcribe-dashboard-app`) and, in later stages, the prospect demo tool (`voiceagent_promo`).
React + Vite + TypeScript. Styling rules: `CLAUDE.md`. Design: 
`../docs/superpowers/specs/2026-09-21-combined-dashboard-design.md`.

## Run

```sh
cp .env.example .env   # set VITE_BACKEND_URL to transcribe-backend
npm install
npm run dev            # http://localhost:5175
```

- `npm run build` — type-check and build to `dist/`. `vercel.json` rewrites all routes to
  `index.html` for SPA deploys.
- `npm test` — unit tests (Vitest).
- `python scripts/regression/compare.py` — proves the transcribe screens match the original app
  (see `scripts/regression/README.md`).
```

- [ ] **Step 3: Final checks**

Run: `cd tecace-voice-agent-dashboard && npm test && npm run build && python scripts/regression/compare.py && python scripts/regression/tw_probe.py`
Expected: `4 passed`; build clean; `IDENTICAL`; `ALL PROBE CHECKS PASS`.

- [ ] **Step 4: Files ready for review** (no commit) — **Stage 2 done.** Hand back to the user with the list of new/changed files so they can review and commit.
