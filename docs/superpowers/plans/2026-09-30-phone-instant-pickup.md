# Phone instant pickup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A caller to a published business number hears ringing, then the pre-rendered greeting immediately — including on the first call after a deploy — and every inbound call logs a pickup timeline.

**Architecture:** Rendered greetings get a disk layer (Docker volume) under the existing in-memory cache, plus `await_ready` (wait for an in-flight render) and `render` (render and wait). The server warms every Twilio number's greeting at startup and every 10 minutes, and `/incoming` holds its TwiML response (≤ `PICKUP_HOLD_SECONDS`) until the greeting is ready, so the caller hears ringing instead of silence. A small `pickup` module carries a per-`CallSid` timeline from `/incoming` into the GPT-Live bridge, which logs one summary line per call.

**Tech Stack:** Python 3.12 (container) / 3.14 (local `.venv`), FastAPI, asyncio, Twilio Python SDK, httpx. Spec: `docs/superpowers/specs/2026-09-30-phone-instant-pickup-design.md`.

**Conventions for this repo (read first):**
- All paths below are relative to `openai-agent-app/` unless they start with `docs/` or `HISTORY.md` (repo root).
- There is no pytest suite. Checks are standalone scripts in `scripts/checks/` that print `ok`/`FAIL` lines and end with `PASS`/exit 1. Run them with the app's venv: `.venv/Scripts/python.exe scripts/checks/<name>.py` (Windows) — from inside `openai-agent-app/`.
- **Do NOT commit or push.** The user does all git writes. Where a task ends, stop and report which files changed.
- Comments in this codebase explain *why* at length, in full sentences. Match that density in new code; don't strip existing comments.
- Only the GPT-Live bridge (`realtime/live_bridge.py`) is in scope. Do not touch `realtime/bridge.py` (Realtime engine).

---

## File structure

| File | Change | Responsibility |
|---|---|---|
| `src/openai_agent/config/settings.py` | modify | 3 new settings: `pickup_hold_seconds`, `greeting_cache_dir`, `greeting_warm_interval` |
| `src/openai_agent/realtime/greeting_audio.py` | modify | disk layer, `await_ready`, `render` |
| `src/openai_agent/realtime/pickup.py` | create | `expected_opening` (shared greeting text), per-call timeline `note`/`take`/`summary` |
| `src/openai_agent/tools/business_config.py` | modify | `quiet=` flag so the background warm-up doesn't log like a live call |
| `src/openai_agent/telephony/server.py` | modify | ring hold in `/incoming`, startup/periodic warm-up via lifespan |
| `src/openai_agent/realtime/live_bridge.py` | modify | wait briefly for an in-flight render; record + log the timeline |
| `scripts/checks/verify_greeting_cache.py` | create | offline checks for all of the above |
| `docker-compose.yml`, `.env.example`, `README.md`, `../HISTORY.md` | modify | volume, env docs, team sync |

---

### Task 1: Settings

**Files:**
- Modify: `src/openai_agent/config/settings.py` (dataclass fields after `prerendered_greeting: bool` ~line 51; `load()` after the `prerendered_greeting=` entry ~line 168-169)
- Modify: `.env.example` (after `PRERENDERED_GREETING=true`, ~line 34)

- [ ] **Step 1: Add the dataclass fields**

In `class Config`, directly after the line `    prerendered_greeting: bool`, insert:

```python
    # How long /incoming may wait for the business lookup and the rendered greeting before it
    # answers. Twilio keeps the caller hearing RINGING until our TwiML arrives, so time spent here
    # is ringing rather than an answered line with nobody on it — the phone's version of the
    # dashboard test call's ringtone. 0 = answer at once, as before.
    pickup_hold_seconds: float
    # Where rendered greetings are kept, so a deploy or restart does not send every business's
    # next call back to the model's ~2.5s cold greeting. A Docker volume in production. An
    # unwritable directory degrades to memory only.
    greeting_cache_dir: str
    # Seconds between passes that render every Twilio number's greeting before anyone calls it.
    # The pass also picks up a greeting changed in the dashboard. 0 = once at startup only.
    greeting_warm_interval: float
```

- [ ] **Step 2: Load them**

In `Config.load()`, directly after the two lines

```python
            prerendered_greeting=_optional("PRERENDERED_GREETING", "true").lower()
            not in ("false", "0", "no"),
```

insert:

```python
            pickup_hold_seconds=max(0.0, float(_optional("PICKUP_HOLD_SECONDS", "3.0"))),
            greeting_cache_dir=_optional("GREETING_CACHE_DIR", "/data/greetings"),
            greeting_warm_interval=max(0.0, float(_optional("GREETING_WARM_INTERVAL", "600"))),
```

- [ ] **Step 3: Document them in `.env.example`**

Directly after the line `PRERENDERED_GREETING=true`, insert:

```
# How long the phone keeps RINGING while the business and its rendered greeting are fetched,
# before the call is answered. With the greeting ready the caller hears it the instant the line
# opens; without this they would sit on an answered, silent line. 0 = answer at once.
PICKUP_HOLD_SECONDS=3.0
# Rendered greetings survive restarts here (docker-compose mounts a volume at this path).
GREETING_CACHE_DIR=/data/greetings
# Every N seconds, render the greeting of every number on the Twilio account ahead of its calls.
# 0 = only at startup.
GREETING_WARM_INTERVAL=600
```

- [ ] **Step 4: Verify config still loads**

Run: `.venv/Scripts/python.exe -c "import sys; sys.path.insert(0,'src'); from openai_agent.config import Config; c=Config.load(); print(c.pickup_hold_seconds, c.greeting_cache_dir, c.greeting_warm_interval)"`
Expected: `3.0 /data/greetings 600.0`

---

### Task 2: Persistent greeting cache, `await_ready`, `render`

**Files:**
- Create: `scripts/checks/verify_greeting_cache.py`
- Modify: `src/openai_agent/realtime/greeting_audio.py`

- [ ] **Step 1: Write the failing check script**

Create `scripts/checks/verify_greeting_cache.py`:

```python
"""Check instant pickup: the greeting cache on disk, waiting for a render, and the ring hold.

    python scripts/checks/verify_greeting_cache.py

No network and no keys: the speech request and the business lookup are replaced with local fakes.
Checks that
  * a rendered greeting survives a restart (memory cleared, read back from disk), and warming a
    greeting that is on disk does not render it again,
  * the cache key changes with the voice and with the text,
  * await_ready returns a render that finishes inside its timeout, gives up on one that doesn't —
    without cancelling it — and misses at once when nothing is rendering,
  * an unwritable cache directory degrades to memory only, without raising,
  * the pickup timeline is taken once, pruned when stale, and summarised,
  * /incoming answers within PICKUP_HOLD_SECONDS when the render is slow, and at once when the
    hold is off.

Run it after editing greeting_audio.py, pickup.py or the /incoming handler in server.py.
"""

from __future__ import annotations

import asyncio
import sys
import tempfile
import time
from dataclasses import replace
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from openai_agent.config import Config  # noqa: E402
from openai_agent.realtime import greeting_audio  # noqa: E402

AUDIO = b"\x7f" * 8000  # one second of μ-law

failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'} {name}" + ("" if ok else f"   -- {detail}"))
    if not ok:
        failures.append(name)


def fake_synth(delay: float):
    """A stand-in for the speech request: returns AUDIO after `delay`, and records each call."""
    calls: list[str] = []

    async def synth(cfg: Config, text: str) -> bytes | None:
        calls.append(text)
        await asyncio.sleep(delay)
        return AUDIO

    return synth, calls


def fresh() -> None:
    greeting_audio._cache.clear()
    greeting_audio._pending.clear()


def base_cfg(cache_dir: str) -> Config:
    return replace(Config.load(), greeting_cache_dir=cache_dir, openai_voice="alloy")


async def disk_round_trip(tmp: str) -> None:
    fresh()
    cfg = base_cfg(tmp)
    synth, calls = fake_synth(0.0)
    greeting_audio._synthesise = synth
    audio = await greeting_audio.render(cfg, "Hello, Acme.")
    check("render returns the audio", audio == AUDIO)
    greeting_audio._cache.clear()  # what a restart does to memory
    again, source = await greeting_audio.await_ready(cfg, "Hello, Acme.", timeout=0)
    check("after a restart the greeting is read back from disk",
          again == AUDIO and source == "disk", source)
    greeting_audio.warm(cfg, "Hello, Acme.")
    check("warming a greeting already on disk does not render it again", len(calls) == 1, str(calls))
    check("the key changes with the voice",
          greeting_audio._key(cfg, "x") != greeting_audio._key(replace(cfg, openai_voice="marin"), "x"))
    check("the key changes with the text", greeting_audio._key(cfg, "x") != greeting_audio._key(cfg, "y"))


async def waiting(tmp: str) -> None:
    fresh()
    cfg = base_cfg(tmp)
    greeting_audio._synthesise, _ = fake_synth(0.2)
    greeting_audio.warm(cfg, "Quick one.")
    audio, source = await greeting_audio.await_ready(cfg, "Quick one.", timeout=1.0)
    check("a render finishing inside the timeout is waited for",
          audio == AUDIO and source == "waited", source)

    greeting_audio._synthesise, _ = fake_synth(0.5)
    greeting_audio.warm(cfg, "Slow one.")
    audio, source = await greeting_audio.await_ready(cfg, "Slow one.", timeout=0.05)
    check("a render slower than the timeout is a miss", audio is None and source == "miss", source)
    await asyncio.sleep(0.6)
    check("giving up on a render does not cancel it", greeting_audio.ready(cfg, "Slow one.") == AUDIO)

    audio, source = await greeting_audio.await_ready(cfg, "Never warmed.", timeout=1.0)
    check("nothing rendering is a miss at once", audio is None and source == "miss", source)


async def unwritable(tmp: str) -> None:
    fresh()
    blocker = Path(tmp) / "not-a-dir"
    blocker.write_text("a file where the cache directory should be")
    cfg = base_cfg(str(blocker))
    greeting_audio._synthesise, _ = fake_synth(0.0)
    try:
        audio = await greeting_audio.render(cfg, "Memory only.")
        check("an unwritable cache dir still renders, in memory", audio == AUDIO)
    except Exception as exc:  # noqa: BLE001 — the point is that it must not raise
        check("an unwritable cache dir still renders, in memory", False, repr(exc))


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        print("greeting cache")
        asyncio.run(disk_round_trip(str(Path(tmp) / "cache")))
        asyncio.run(waiting(str(Path(tmp) / "cache")))
        asyncio.run(unwritable(tmp))
    print("FAIL" if failures else "PASS")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run it to verify it fails**

Run: `.venv/Scripts/python.exe scripts/checks/verify_greeting_cache.py`
Expected: `AttributeError: module 'openai_agent.realtime.greeting_audio' has no attribute 'render'`

- [ ] **Step 3: Implement the disk layer and the two new functions**

In `src/openai_agent/realtime/greeting_audio.py`:

(a) Add to the imports (keep alphabetical with the existing ones):

```python
import os
from pathlib import Path
```

(b) Update the module docstring's "WHAT IT COSTS" paragraph — replace the sentence
`kept in memory for the life of the process. A cold cache is not a problem worth solving: the`
through
`before it lands simply greets the old way.`
with:

```
kept in memory and on disk (GREETING_CACHE_DIR, a Docker volume), so a deploy does not throw
them away. The server renders every number's greeting at startup and every
GREETING_WARM_INTERVAL seconds, /incoming renders the dialled one while the phone is still
ringing, and a call that arrives before any of that lands simply greets the old way.
```

(c) Directly after the `_pending: dict[str, asyncio.Task] = {}` line, add:

```python
# Said once per process: an unwritable cache directory is a deployment fault worth one line, not
# one line per call.
_disk_warned = False
```

(d) Directly after the `_key` function, add:

```python
def _disk_file(cfg: Config, key: str) -> Path | None:
    if not cfg.greeting_cache_dir:
        return None
    return Path(cfg.greeting_cache_dir) / f"{key}.ulaw"


def _load_disk(cfg: Config, key: str) -> bytes | None:
    path = _disk_file(cfg, key)
    if path is None:
        return None
    try:
        return path.read_bytes() or None
    except OSError:
        return None  # not rendered yet, or no usable directory — either way, not on disk


def _save_disk(cfg: Config, key: str, audio: bytes) -> None:
    """Keep a render across restarts. Written aside and renamed, so a crash mid-write can never
    leave a truncated greeting for the next call to play."""
    global _disk_warned
    path = _disk_file(cfg, key)
    if path is None:
        return
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_bytes(audio)
        os.replace(tmp, path)
    except OSError as exc:
        if not _disk_warned:
            _disk_warned = True
            log.warning("greeting cache %s is not writable (%s) — greetings are kept in memory only",
                        cfg.greeting_cache_dir, exc)


def _lookup(cfg: Config, key: str) -> tuple[bytes | None, str]:
    """Memory first, then disk (promoted into memory). The source is for the pickup log."""
    audio = _cache.get(key)
    if audio:
        return audio, "memory"
    audio = _load_disk(cfg, key)
    if audio:
        _cache[key] = audio
        return audio, "disk"
    return None, "miss"
```

(e) In `warm()`, replace

```python
    key = _key(cfg, text)
    if key in _cache or key in _pending:
        return

    async def run() -> None:
        audio = await _synthesise(cfg, text)
        if audio:
            _cache[key] = audio
            log.info("greeting pre-rendered (%.1fs of audio) and cached", len(audio) / SAMPLE_RATE)
```

with

```python
    key = _key(cfg, text)
    if key in _cache or key in _pending or _lookup(cfg, key)[0]:
        return

    async def run() -> None:
        audio = await _synthesise(cfg, text)
        if audio:
            _cache[key] = audio
            await asyncio.to_thread(_save_disk, cfg, key, audio)
            log.info("greeting pre-rendered (%.1fs of audio) and cached", len(audio) / SAMPLE_RATE)
```

(f) Replace the body of `ready()` so it also reads disk:

```python
def ready(cfg: Config, text: str) -> bytes | None:
    """The rendered greeting audio, or None if it has not been rendered (yet, or at all)."""
    if not text.strip():
        return None
    return _lookup(cfg, _key(cfg, text))[0]
```

(g) Directly after `ready()`, add:

```python
async def await_ready(cfg: Config, text: str, timeout: float) -> tuple[bytes | None, str]:
    """The greeting, waiting up to `timeout` for a render already under way.

    Returns (audio, source): source is "memory" or "disk" for a greeting that was already there,
    "waited" for one that finished while we waited, "miss" otherwise. Never cancels the render —
    a call that could not wait for it still leaves it cached for the next one.
    """
    if not text.strip():
        return None, "miss"
    key = _key(cfg, text)
    audio, source = _lookup(cfg, key)
    if audio:
        return audio, source
    task = _pending.get(key)
    if task is None or timeout <= 0:
        return None, "miss"
    await asyncio.wait({task}, timeout=timeout)  # asyncio.wait never cancels what it waits on
    audio = _cache.get(key)
    return (audio, "waited") if audio else (None, "miss")


async def render(cfg: Config, text: str) -> bytes | None:
    """Render a greeting (unless it is already cached) and wait for it. For the warm-up pass,
    which renders one greeting at a time so a startup with many numbers does not burst the
    speech API."""
    if not text.strip():
        return None
    warm(cfg, text)
    key = _key(cfg, text)
    task = _pending.get(key)
    if task is not None:
        await asyncio.wait({task})
    return _lookup(cfg, key)[0]
```

(h) Extend `__all__`:

```python
__all__ = [
    "ALREADY_GREETED", "already_greeted", "await_ready", "frames", "pcm24_to_ulaw8", "ready",
    "render", "warm",
]
```

- [ ] **Step 4: Run the check to verify it passes**

Run: `.venv/Scripts/python.exe scripts/checks/verify_greeting_cache.py`
Expected: every line `ok`, last line `PASS`. (One `greeting cache ... is not writable` warning in the output from the `unwritable` case is expected.)

- [ ] **Step 5: Stop — no commit.** Report changed files: `greeting_audio.py`, `verify_greeting_cache.py`.

---

### Task 3: `pickup` module (shared opening line + timeline)

**Files:**
- Create: `src/openai_agent/realtime/pickup.py`
- Modify: `scripts/checks/verify_greeting_cache.py`

- [ ] **Step 1: Add the failing checks**

In `scripts/checks/verify_greeting_cache.py`, add after the `unwritable` function:

```python
def timeline() -> None:
    from openai_agent.realtime import pickup

    pickup._pending.clear()
    pickup.note("CAone", incoming_at=1.0)
    pickup.note("CAone", twiml_at=1.2, hold_source="disk")
    got = pickup.take("CAone")
    check("notes on one call are merged", got.get("incoming_at") == 1.0 and got.get("hold_source") == "disk",
          str(got))
    check("a timeline is taken once", pickup.take("CAone") == {})
    check("no CallSid, no timeline", pickup.take("") == {})

    pickup._pending["CAold"] = {"created": time.monotonic() - 120}
    pickup.note("CAnew", incoming_at=2.0)
    check("an unanswered call's timeline is pruned", "CAold" not in pickup._pending)

    line = pickup.summary({
        "greeting_source": "disk", "hold_source": "memory", "incoming_at": 1.0, "twiml_at": 1.2,
        "stream_start_at": 1.8, "first_audio_at": 1.81,
    })
    check("the summary reads the timeline",
          "greeting=disk" in line and "held=memory" in line and "hold=200ms" in line
          and "answer->stream=600ms" in line and "stream->first audio=10ms" in line
          and "stream->model audio=?" in line, line)

    business = type("B", (), {})()
    business.session = None
    business.greeting = ""
    business.business_name = "Acme Dental"
    business.agent_name = "Tess"
    cfg = replace(Config.load(), disclose_recording=False, greeting="")
    opening = pickup.expected_opening(cfg, business)
    check("the legacy opening names the business", "Acme Dental" in opening, opening)
    business.session = {"greetingLine": "Thanks for calling Acme Dental, this is Tess!"}
    check("a composed session's opening is its greetingLine",
          pickup.expected_opening(cfg, business) == "Thanks for calling Acme Dental, this is Tess!",
          pickup.expected_opening(cfg, business))
```

and in `main()`, after `asyncio.run(unwritable(tmp))`, add:

```python
        print("pickup timeline")
        timeline()
```

- [ ] **Step 2: Run it to verify it fails**

Run: `.venv/Scripts/python.exe scripts/checks/verify_greeting_cache.py`
Expected: `ImportError: cannot import name 'pickup' from 'openai_agent.realtime'` (the cache section still prints `ok`).

- [ ] **Step 3: Create `src/openai_agent/realtime/pickup.py`**

```python
"""How long a caller waited from ringing to hearing the agent — and the line they heard first.

WHY. Pickup is split across two places that never share a call object: the /incoming webhook
(which decides when Twilio answers) and the media-stream bridge (which plays the greeting). The
timeline is noted by CallSid in the first and taken by the second, which logs one line per call:

    pickup: greeting=disk held=memory hold=180ms answer->stream=640ms stream->first audio=12ms ...

`greeting` is where the bridge found the rendered opening ("memory", "disk", "waited" for a render
that landed just in time, "miss" — the model greets, ~2.5s — or "off"); `held` is what /incoming
found while the phone was still ringing ("timeout" if the business lookup itself ran out of time,
"none" if the number belongs to no business). Both processes are one uvicorn worker, so monotonic
times compare directly.

expected_opening lives here because /incoming, the warm-up pass and the bridge must all render
EXACTLY the same text — a greeting rendered from different words is a cache miss on every call.
"""

from __future__ import annotations

import time

from ..config import Config
from .composed import opening_line
from .instructions_inbound import spoken_greeting

# A call whose stream never opened (the caller hung up while it rang) leaves its notes behind.
_KEEP_SECONDS = 60.0
_pending: dict[str, dict] = {}


def expected_opening(cfg: Config, business) -> str:
    """The line the caller hears first: the dashboard's composed greeting where there is one."""
    if business.session:
        return opening_line(cfg, business)
    return spoken_greeting(
        greeting=business.greeting or cfg.greeting,
        business_name=business.business_name,
        agent_name=business.agent_name or cfg.agent_name,
        disclose_recording=cfg.disclose_recording,
    )


def note(call_sid: str, **fields: object) -> None:
    """Record timeline fields for a call that is still ringing."""
    if not call_sid:
        return
    now = time.monotonic()
    for sid in [s for s, t in _pending.items() if now - t.get("created", now) > _KEEP_SECONDS]:
        del _pending[sid]
    _pending.setdefault(call_sid, {"created": now}).update(fields)


def take(call_sid: str) -> dict:
    """Hand a call's timeline to its bridge. Empty for an outbound call or an unknown CallSid."""
    return _pending.pop(call_sid, {}) if call_sid else {}


def _ms(later: object, earlier: object) -> str:
    if not isinstance(later, float) or not isinstance(earlier, float):
        return "?"
    return f"{(later - earlier) * 1000:.0f}ms"


def summary(t: dict) -> str:
    """One log line. ASCII only: it goes to docker logs and to a Windows console alike."""
    return (
        f"pickup: greeting={t.get('greeting_source', '?')} held={t.get('hold_source', '-')} "
        f"hold={_ms(t.get('twiml_at'), t.get('incoming_at'))} "
        f"answer->stream={_ms(t.get('stream_start_at'), t.get('twiml_at'))} "
        f"stream->first audio={_ms(t.get('first_audio_at'), t.get('stream_start_at'))} "
        f"stream->model audio={_ms(t.get('model_first_audio_at'), t.get('stream_start_at'))}"
    )


__all__ = ["expected_opening", "note", "summary", "take"]
```

- [ ] **Step 4: Run the check to verify it passes**

Run: `.venv/Scripts/python.exe scripts/checks/verify_greeting_cache.py`
Expected: all `ok`, `PASS`.

If "the legacy opening names the business" fails, print `opening` and read `spoken_greeting` in `realtime/instructions_inbound.py` — with `greeting=""` it uses the default `"Hello, you've reached {business}, this is {agent}. …"`; adjust the check only if the default template changed, never the template.

- [ ] **Step 5: Stop — no commit.** Report: `pickup.py` created, check script extended.

---

### Task 4: Quiet business lookups for the warm-up

The warm-up looks up every number every 10 minutes. `fetch_business_config` logs an unassigned number as a WARNING that says "a real caller just reached a line nobody owns" — false and noisy from a background pass.

**Files:**
- Modify: `src/openai_agent/tools/business_config.py` (`fetch_business_config`, lines ~100-186)

- [ ] **Step 1: Add the `quiet` parameter**

Change the signature and add two loggers at the top of the body:

```python
async def fetch_business_config(cfg: Config, dialled: str, *, quiet: bool = False) -> BusinessConfig | None:
    """Look up the owner of the number that was dialled, or None if there isn't one.

    ... (keep the existing docstring text) ...

    `quiet` is for the greeting warm-up, which looks up every number with no caller on the line:
    it logs at DEBUG, so an unassigned number is not reported as a caller reaching it.
    """
    warn = log.debug if quiet else log.warning
    info = log.debug if quiet else log.info
```

Then, inside the function body only, replace:
- `log.info(\n        "call to %s is for %r (%s <%s>)",` → `info(\n        "call to %s is for %r (%s <%s>)",`
- `log.info("business config for %s served from the last %.0fs — no lookup", …)` → `info(…)`
- the three `log.warning(` calls (non-200 status, the `except` branch, the not-assigned branch) → `warn(`

Leave `log.debug("business config not configured; …")` and `log.warning("no dialled number on this call — …")` as they are (the warm-up never reaches them: it checks config first and always passes a number).

- [ ] **Step 2: Verify nothing else broke**

Run: `.venv/Scripts/python.exe scripts/checks/verify_composed_session.py`
Expected: last line `OK` (it exercises the business-config parsing offline).

Run: `.venv/Scripts/python.exe scripts/checks/verify_booking.py`
Expected: `PASS`.

- [ ] **Step 3: Stop — no commit.**

---

### Task 5: Hold the ring in `/incoming`

**Files:**
- Modify: `src/openai_agent/telephony/server.py` (imports ~line 36-56; `_warm_for_call` ~148-170; `incoming` ~173-231)
- Modify: `scripts/checks/verify_greeting_cache.py`

- [ ] **Step 1: Add the failing checks**

In `scripts/checks/verify_greeting_cache.py`, add after `timeline()`:

```python
def ring_hold(tmp: str) -> None:
    from types import SimpleNamespace

    from fastapi.testclient import TestClient

    from openai_agent.realtime import pickup
    from openai_agent.telephony import server

    fresh()
    business = SimpleNamespace(
        session={"greetingLine": "Thanks for calling Acme, this is Tess."},
        greeting="", business_name="Acme", agent_name="Tess",
    )

    async def fake_lookup(cfg: Config, dialled: str, **_kw: object):
        return business

    server.fetch_business_config = fake_lookup
    # Slower than any hold: the check is that /incoming answers anyway.
    greeting_audio._synthesise, _ = fake_synth(5.0)
    # No `with`: entering the client would run the startup warm-up against real Twilio.
    client = TestClient(server.app)
    for sid, hold, limit in (("CAhold", 0.3, 1.0), ("CAnohold", 0.0, 0.3)):
        server.cfg = replace(base_cfg(tmp), pickup_hold_seconds=hold, validate_twilio_signature=False)
        began = time.monotonic()
        resp = client.post("/incoming", data={"From": "+14255550100", "To": "+14255550199", "CallSid": sid})
        took = time.monotonic() - began
        check(f"/incoming with a {hold}s hold answers inside {limit}s",
              resp.status_code == 200 and "<Stream" in resp.text and took < limit,
              f"{resp.status_code} after {took:.2f}s")
    held = pickup.take("CAhold")
    check("a hold that outlasts the render is logged as a miss", held.get("hold_source") == "miss", str(held))
    check("the hold is timed", isinstance(held.get("twiml_at"), float)
          and held["twiml_at"] - held["incoming_at"] >= 0.25, str(held))
    check("no hold, no hold source", "hold_source" not in pickup.take("CAnohold"))
```

and in `main()`, after `timeline()`, add:

```python
        print("ring hold")
        ring_hold(str(Path(tmp) / "cache"))
```

- [ ] **Step 2: Run it to verify it fails**

Run: `.venv/Scripts/python.exe scripts/checks/verify_greeting_cache.py`
Expected: `FAIL a hold that outlasts the render is logged as a miss` (and `the hold is timed`) — `/incoming` does not hold or note anything yet. Warnings like `Task was destroyed but it is pending` at exit are expected (the fake 5 s render outlives the test client's loop).

- [ ] **Step 3: Implement the hold**

In `src/openai_agent/telephony/server.py`:

(a) Imports: add `import time` after `import os`; add `from ..realtime import pickup` after `from ..realtime import greeting_audio`; delete the two now-unused lines

```python
from ..realtime.composed import opening_line
from ..realtime.instructions_inbound import spoken_greeting
```

(b) Replace the body of `_warm_for_call`'s inner `run()` so it uses the shared helper:

```python
    async def run() -> None:
        business = await fetch_business_config(cfg, dialled)
        if business is None:
            return
        greeting_audio.warm(cfg, pickup.expected_opening(cfg, business))
```

(c) Directly after the `_warming: set[asyncio.Task] = set()` line, add:

```python
async def _hold_for_pickup(dialled: str) -> str:
    """Keep the phone ringing until the greeting is ready — or PICKUP_HOLD_SECONDS, whichever is
    first. Returns what it found, for the pickup log.

    Twilio does not answer an inbound call until our TwiML arrives, so every moment spent here is
    ringing. Spent after answering, the same moment is an open line with nobody on it — which is
    what callers heard while the greeting rendered, and what the dashboard's test call hides behind
    its ringtone. With the greeting already rendered this is just the business lookup.
    """
    deadline = time.monotonic() + cfg.pickup_hold_seconds
    try:
        business = await asyncio.wait_for(fetch_business_config(cfg, dialled), cfg.pickup_hold_seconds)
    except asyncio.TimeoutError:
        _warm_for_call(dialled)  # the lookup was cancelled with the wait; start it again unwaited
        return "timeout"
    if business is None:
        return "none"
    text = pickup.expected_opening(cfg, business)
    greeting_audio.warm(cfg, text)
    _audio, source = await greeting_audio.await_ready(
        cfg, text, timeout=max(0.0, deadline - time.monotonic())
    )
    return source
```

(d) In `incoming()`, right after the `log.info("incoming call: …")` call, replace

```python
    # Start the "whose business is this?" lookup now, while Twilio is still setting up the media
    # stream. It used to run when the stream connected, with the caller listening to silence. The
    # greeting audio for that business is rendered in the same breath, so the first words are ready
    # to play the moment the stream opens.
    _warm_for_call(fields.get("To", ""))
```

with

```python
    call_sid = fields.get("CallSid", "")
    dialled = fields.get("To", "")
    pickup.note(call_sid, incoming_at=time.monotonic())
    # "Whose business is this?" and that business's rendered greeting, while the phone still rings
    # (see _hold_for_pickup). With the hold off, the lookup and render still start now, unwaited,
    # so they are ready as early as possible once the stream opens.
    if cfg.pickup_hold_seconds > 0 and dialled:
        pickup.note(call_sid, hold_source=await _hold_for_pickup(dialled))
    else:
        _warm_for_call(dialled)
```

(e) At the end of `incoming()`, replace `    return _xml(str(response))` with:

```python
    pickup.note(call_sid, twiml_at=time.monotonic())
    return _xml(str(response))
```

- [ ] **Step 4: Run the check to verify it passes**

Run: `.venv/Scripts/python.exe scripts/checks/verify_greeting_cache.py`
Expected: all `ok`, `PASS`.

- [ ] **Step 5: Stop — no commit.**

---

### Task 6: Warm every number at startup and every 10 minutes

**Files:**
- Modify: `src/openai_agent/telephony/server.py` (imports; `app = FastAPI(...)` ~line 72; new functions after `_hold_for_pickup`)

- [ ] **Step 1: Add the lifespan and the warm-up loop**

(a) Imports: add `from contextlib import asynccontextmanager` after `import os`, and `from twilio.rest import Client` after the `from twilio.request_validator import RequestValidator` line.

(b) Replace `app = FastAPI(title="openai-agent-app media stream")` with:

```python
@asynccontextmanager
async def _lifespan(_app: FastAPI):
    # Render every number's greeting before anyone calls it — see _keep_greetings_warm.
    warmer = asyncio.create_task(_keep_greetings_warm())
    try:
        yield
    finally:
        warmer.cancel()


app = FastAPI(title="openai-agent-app media stream", lifespan=_lifespan)
```

(c) After `_hold_for_pickup`, add:

```python
def _our_numbers() -> list[str]:
    """Every number on the Twilio account: any of them may be assigned to a business. Blocking —
    the Twilio SDK is synchronous — so it runs on a thread, never on the call loop."""
    client = Client(cfg.twilio_account_sid, cfg.twilio_auth_token)
    return [n.phone_number for n in client.incoming_phone_numbers.list()]


async def _warm_all_greetings() -> int:
    """One pass: render the opening line of every number that belongs to a business.

    One render at a time: a startup with many numbers must not burst the speech API or stack
    conversion threads beside calls in progress. Already-rendered greetings cost a file read.
    """
    rendered = 0
    for number in await asyncio.to_thread(_our_numbers):
        business = await fetch_business_config(cfg, number, quiet=True)
        if business is None:
            continue
        if await greeting_audio.render(cfg, pickup.expected_opening(cfg, business)):
            rendered += 1
    return rendered


async def _keep_greetings_warm() -> None:
    """Why: /incoming renders the dialled number's greeting, but a render takes ~2s and the
    first call to a business after a deploy used to lose that race and greet through the model
    (~2.5s of an answered, silent line). Rendering ahead makes the first call as quick as the rest,
    and re-running picks up a greeting a business changed in the dashboard."""
    if not (cfg.openai_api_key and cfg.twilio_account_sid and cfg.twilio_auth_token
            and cfg.business_config_url and cfg.agent_config_key):
        log.info("greeting warm-up off — it needs OPENAI_API_KEY, Twilio credentials, "
                 "BUSINESS_CONFIG_URL and AGENT_CONFIG_KEY")
        return
    while True:
        try:
            count = await _warm_all_greetings()
            log.info("greeting warm-up: %d business greeting(s) ready", count)
        except Exception as exc:  # noqa: BLE001 — a failed pass must never take the server down
            log.warning("greeting warm-up failed (%s) — trying again next pass", exc)
        if cfg.greeting_warm_interval <= 0:
            return
        await asyncio.sleep(cfg.greeting_warm_interval)
```

- [ ] **Step 2: Verify the checks still pass (they must not trigger the warm-up)**

Run: `.venv/Scripts/python.exe scripts/checks/verify_greeting_cache.py`
Expected: `PASS`, and no `greeting warm-up` log line (the check never enters the client's lifespan).

- [ ] **Step 3: Verify startup locally**

Run (PowerShell, from `openai-agent-app/`):
`$env:GREETING_CACHE_DIR="$env:TEMP\greetings"; .venv/Scripts/python.exe -m uvicorn openai_agent.telephony.server:app --app-dir src --port 5051`
Expected within a few seconds: either `greeting warm-up off — it needs …` (local `.env` lacks some keys) or `greeting warm-up: N business greeting(s) ready`, and no traceback. Stop it with Ctrl+C; shutdown must be clean (no "Task was destroyed" for the warmer).

- [ ] **Step 4: Stop — no commit.**

---

### Task 7: Bridge — wait briefly for an in-flight render; log the timeline

**Files:**
- Modify: `src/openai_agent/realtime/live_bridge.py`

- [ ] **Step 1: Import and constant**

(a) Change `from . import amd, greeting_audio` to `from . import amd, greeting_audio, pickup`.

(b) Directly after `_GREETING_WAIT_SECONDS = 3.0` (line ~96), add:

```python
# How long the bridge waits, at stream start, for a greeting render that is still under way. Short:
# /incoming has usually waited already, and this only catches a render landing a moment late.
# Every bit of it is silence on an answered line, but far less than the model's ~2.5s greeting.
_GREETING_LATE_WAIT = 0.5
```

(c) Add a helper directly before `async def run_live_bridge`:

```python
async def _greeting_for(cfg: Config, opening: str) -> tuple[bytes | None, str]:
    """The rendered opening to play, and where it came from (for the pickup log)."""
    if not cfg.prerendered_greeting:
        return None, "off"
    return await greeting_audio.await_ready(cfg, opening, timeout=_GREETING_LATE_WAIT)
```

- [ ] **Step 2: Take the timeline at stream start**

In `run_live_bridge`, directly after

```python
    stream_sid, call_sid, params = await _await_start(twilio_ws)
```

insert:

```python
    # What /incoming noted while the phone rang (empty for an outbound call) — see pickup.py.
    timeline = pickup.take(call_sid or "")
    timeline["stream_start_at"] = time.monotonic()
    timeline["greeting_source"] = "model"  # until a rendered greeting is found below
```

- [ ] **Step 3: Replace both one-shot `ready()` checks**

There are exactly two lines of the form

```python
            prerendered = greeting_audio.ready(cfg, opening) if cfg.prerendered_greeting else None
```

(one in the `composed is not None` branch, one in the legacy `business is not None` branch). Replace each with:

```python
            prerendered, timeline["greeting_source"] = await _greeting_for(cfg, opening)
```

Verify: `grep -n "greeting_audio.ready" src/openai_agent/realtime/live_bridge.py` prints nothing.

- [ ] **Step 4: Carry the timeline in state and fill it in**

(a) In the `state: dict = {` literal, directly after `"started": time.monotonic(),`, add:

```python
        "pickup": timeline,  # the pickup timeline, logged at the end of the call
```

(b) In `_stream_to_caller`, directly after `state["sent_at"] = now`, add:

```python
        state["pickup"].setdefault("first_audio_at", now)
```

(c) In `_note_agent_audio`, directly after `if not audible or not _has_sound(payload):` / `return`, add:

```python
    state["pickup"].setdefault("model_first_audio_at", now)
```

(`now` is already defined earlier in that function — confirm with `sed -n 909,935p src/openai_agent/realtime/live_bridge.py`; if the local is named differently, use that name.)

(d) In the outer `finally:` of `run_live_bridge` (the one containing `_log_live_cost(state, cfg)`), directly before `_log_live_cost(state, cfg)`, add:

```python
        if is_inbound:
            log.info("%s", pickup.summary(state["pickup"]))
```

- [ ] **Step 5: Verify the module imports and the offline checks pass**

Run: `.venv/Scripts/python.exe -c "import sys; sys.path.insert(0,'src'); import openai_agent.realtime.live_bridge as b; print('ok')"`
Expected: `ok`

Run each: `.venv/Scripts/python.exe scripts/checks/verify_greeting_cache.py`, `verify_composed_session.py`, `verify_booking.py`, `verify_faq.py`, `verify_behaviour_list.py`
Expected: each ends `PASS` (`verify_composed_session.py` ends `OK`). (`verify_business_facts.py` needs real env — skip unless configured.)

- [ ] **Step 6: Stop — no commit.**

---

### Task 8: Deployment wiring and docs

**Files:**
- Modify: `docker-compose.yml`, `README.md`, `../HISTORY.md`

- [ ] **Step 1: Mount the cache volume**

In `docker-compose.yml`, in the `server:` service, directly after `    env_file: .env`, add:

```yaml
    volumes:
      # Rendered greetings (GREETING_CACHE_DIR). A volume so `up -d --build` keeps them: without
      # it every deploy sends each business's next call back to the model's slow greeting.
      - greetings:/data/greetings
```

At the end of the file, after the `networks:` block, add:

```yaml

volumes:
  greetings:
```

Verify: `docker compose config -q` (if Docker is available locally) prints nothing; otherwise check the YAML indentation by eye against the `networks:` block.

- [ ] **Step 2: README**

In `README.md`, directly before `### Why the transfer works the way it does`, add:

```markdown
### Picking up fast

The first thing a caller hears is a greeting rendered ahead of time (`PRERENDERED_GREETING`), not
the model — GPT-Live needs ~2.5s from a cold session to its first word. To make that greeting
ready on every call:

- `/incoming` keeps the phone **ringing** for up to `PICKUP_HOLD_SECONDS` (default 3) while it
  looks up the business and waits for its greeting, then answers. Ringing, not an answered silent
  line — the phone's version of the dashboard test call's ringtone.
- Rendered greetings are kept on disk (`GREETING_CACHE_DIR`, a Docker volume), so a deploy keeps them.
- At startup and every `GREETING_WARM_INTERVAL` seconds the server renders the greeting of every
  number on the Twilio account.

Every inbound call logs one line, e.g.
`pickup: greeting=disk held=memory hold=150ms answer->stream=600ms stream->first audio=10ms …`.
`greeting=miss` means the model greeted (slow); read `held` to see why.
```

- [ ] **Step 3: HISTORY.md entry (repo root, at the top, under the `---` line)**

Use the current time for `HH:MM`:

```markdown
## 2026-09-30 HH:MM · Michael · openai-agent-app (instant pickup on the phone)
- Inbound: `/incoming` now holds its TwiML up to `PICKUP_HOLD_SECONDS` (default 3.0; `0` = old behaviour) until the business's pre-rendered greeting is ready — the caller hears ringing instead of an answered silent line. Rendered greetings persist in `GREETING_CACHE_DIR` (default `/data/greetings`) and are warmed for every Twilio number at startup and every `GREETING_WARM_INTERVAL` s (600).
- New per-call log line `pickup: greeting=… held=… hold=…ms …` (GPT-Live bridge only; logs only, no API change).
- ⚠ Deploy: `docker compose up -d --build` creates the new `greetings` volume on the `server` service; no other service or contract changes.
```

- [ ] **Step 4: Stop — no commit.** Report all changed files to the user for review.

---

### Task 9: Live verification (after the user deploys)

Needs the VPS; the user runs the deploy (`docker compose up -d --build` in `openai-agent-app/` on the VPS).

- [ ] **Step 1: Warm-up ran**

On the VPS: `docker compose logs server | grep -E "greeting warm-up|pre-rendered"`
Expected: `greeting warm-up: N business greeting(s) ready` with N ≥ 1, and a `greeting pre-rendered` line per new greeting.

- [ ] **Step 2: Call a published business number**

Place one real call; then `docker compose logs server | grep "pickup:"`.
Expected: `greeting=disk` or `greeting=memory`, `stream->first audio` ≲ 50ms. By ear: ringing, then the greeting at once — no silent gap after the answer.

- [ ] **Step 3: Restart and call again**

`docker compose up -d --build server`, wait for the warm-up line, call again.
Expected: `greeting=disk` (or `memory` if the warm-up re-read it). This is the case that used to be a `miss`.

- [ ] **Step 4: Confirm the ringing assumption**

On a call where `held=` shows a real wait (e.g. a greeting just changed in the dashboard and not yet warmed), confirm by ear that the caller heard ringing — not silence — during `hold=`. If they heard silence, set `PICKUP_HOLD_SECONDS=0` and report it; the rest of the change still stands.
