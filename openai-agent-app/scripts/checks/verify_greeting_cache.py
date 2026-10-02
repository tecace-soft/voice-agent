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
    check("the render is written to disk",
          greeting_audio._disk_file(cfg, greeting_audio._key(cfg, "Hello, Acme.")).is_file())
    greeting_audio._cache.clear()  # what a restart does to memory
    again, source = await greeting_audio.await_ready(cfg, "Hello, Acme.", timeout=0)
    check("after a restart the greeting is read back from disk",
          again == AUDIO and source == "disk", source)
    # await_ready promoted the file into memory; clear it again so warm() has to take its disk branch.
    greeting_audio._cache.clear()
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
    await asyncio.sleep(1.0)
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

    check("an int timestamp is not shown as missing",
          "hold=500ms" in pickup.summary({"incoming_at": 0, "twiml_at": 0.5}),
          pickup.summary({"incoming_at": 0, "twiml_at": 0.5}))

    # Parity: expected_opening is what /incoming and the warm-up render, so it must be EXACTLY what
    # the bridge plays. Built from the same fixture verify_composed_session.py uses.
    from openai_agent.realtime.composed import composed_call
    from openai_agent.realtime.instructions_inbound import spoken_greeting

    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import verify_composed_session as fixture

    disclosing = replace(Config.load(), disclose_recording=True)
    composed_biz = fixture.business(fixture.SESSION)
    expected = pickup.expected_opening(disclosing, composed_biz)
    played = composed_call(disclosing, composed_biz, caller="", returning=False).opening
    check("a composed session's pre-render is what the bridge plays", expected == played,
          f"{expected!r} != {played!r}")
    check("the composed opening carries the recording notice", "recorded" in expected, expected)

    legacy = fixture.business(None)
    expected = pickup.expected_opening(disclosing, legacy)
    played = spoken_greeting(
        greeting=legacy.greeting or disclosing.greeting,
        business_name=legacy.business_name,
        agent_name=legacy.agent_name or disclosing.agent_name,
        disclose_recording=True,
    )
    check("a legacy business's pre-render is what the bridge plays", expected == played,
          f"{expected!r} != {played!r}")
    check("the legacy opening carries the recording notice", "recorded" in expected, expected)


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
        server.cfg = replace(base_cfg(tmp), pickup_hold_seconds=hold, validate_twilio_signature=False,
                             openai_live_model="gpt-live-1", prerendered_greeting=True)
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

    # Nothing plays the rendered greeting first on the Realtime engine or with PRERENDERED_GREETING
    # off, so a hold there would only add ringing: /incoming must answer at once, hold configured.
    for sid, why, extra in (("CAnolive", "no GPT-Live model", {"openai_live_model": ""}),
                            ("CAnopre", "prerendered greeting off",
                             {"openai_live_model": "gpt-live-1", "prerendered_greeting": False})):
        server.cfg = replace(base_cfg(tmp), pickup_hold_seconds=0.3, validate_twilio_signature=False,
                             **{"prerendered_greeting": True, **extra})
        began = time.monotonic()
        resp = client.post("/incoming", data={"From": "+14255550100", "To": "+14255550199", "CallSid": sid})
        took = time.monotonic() - began
        check(f"/incoming with {why} skips the hold (answers inside 0.3s)",
              resp.status_code == 200 and "<Stream" in resp.text and took < 0.3,
              f"{resp.status_code} after {took:.2f}s")
        check(f"{why}: no hold source", "hold_source" not in pickup.take(sid))

    # A faster pickup is never worth failing the call: a 500 here sends the caller to
    # /incoming-fallback, so whatever the lookup does, /incoming must still answer with a stream.
    async def raising_lookup(cfg: Config, dialled: str, **_kw: object):
        raise RuntimeError("business lookup blew up")

    async def slow_lookup(cfg: Config, dialled: str, **_kw: object):
        await asyncio.sleep(2)
        return business

    server.cfg = replace(base_cfg(tmp), pickup_hold_seconds=0.3, validate_twilio_signature=False,
                         openai_live_model="gpt-live-1", prerendered_greeting=True)
    for sid, lookup, want, limit in (("CAraise", raising_lookup, "error", 1.0),
                                     ("CAslow", slow_lookup, "timeout", 1.0)):
        server.fetch_business_config = lookup
        began = time.monotonic()
        resp = client.post("/incoming", data={"From": "+14255550100", "To": "+14255550199", "CallSid": sid})
        took = time.monotonic() - began
        check(f"a {want} lookup still answers with a stream inside {limit}s",
              resp.status_code == 200 and "<Stream" in resp.text and took < limit,
              f"{resp.status_code} after {took:.2f}s")
        check(f"a {want} lookup is logged as {want}", pickup.take(sid).get("hold_source") == want)
    server.fetch_business_config = fake_lookup


def warm_pass(tmp: str) -> None:
    from types import SimpleNamespace

    from openai_agent.telephony import server

    fresh()
    server.cfg = base_cfg(tmp)

    def biz(line: str):
        return SimpleNamespace(session={"greetingLine": line}, greeting="", business_name="X", agent_name="T")

    owners = {"+1001": biz("Thanks for calling Alpha."), "+1002": None, "+1003": RuntimeError("down"),
              "+1004": biz("Thanks for calling Bravo.")}
    quiet_flags: list[object] = []

    async def lookup(cfg: Config, dialled: str, **kw: object):
        quiet_flags.append(kw.get("quiet"))
        owner = owners[dialled]
        if isinstance(owner, Exception):
            raise owner
        return owner

    server._our_numbers = lambda: list(owners)
    server.fetch_business_config = lookup
    greeting_audio._synthesise, calls = fake_synth(0.0)
    first = asyncio.run(server._warm_all_greetings())
    check("the warm pass renders the two businesses despite a failing number", first[0] == 2, str(first))
    check("the warm pass counts the failing number", first[1] == 1, str(first))
    check("every warm-up lookup is quiet", len(quiet_flags) == 4 and all(q is True for q in quiet_flags),
          str(quiet_flags))
    check("exactly two renders", len(calls) == 2, str(calls))
    second = asyncio.run(server._warm_all_greetings())
    check("a second pass renders nothing new", len(calls) == 2, str(calls))
    check("a second pass still reports the two greetings ready", second[0] == 2, str(second))


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        print("greeting cache")
        asyncio.run(disk_round_trip(str(Path(tmp) / "cache")))
        asyncio.run(waiting(str(Path(tmp) / "cache")))
        asyncio.run(unwritable(tmp))
        print("pickup timeline")
        timeline()
        print("ring hold")
        ring_hold(str(Path(tmp) / "cache"))
        print("warm pass")
        warm_pass(str(Path(tmp) / "cache2"))
    print("FAIL" if failures else "PASS")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
