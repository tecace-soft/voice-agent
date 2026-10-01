"""Check the scenario runner without a network or keys.

    python scripts/checks/verify_scenario_runner.py

Part 1 checks the turn policy (when the scripted customer speaks, when a run is over).
Part 2 runs one whole two-line scenario against a fake transcribe-backend and a fake GPT-Live
socket, and checks what reaches each — above all that the customer's second line is only spoken
after the agent has said the booking result, which arrives after the backend's response.completed.

Run it after editing anything under src/openai_agent/scenario/.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))
os.environ.setdefault("OPENAI_API_KEY", "sk-test")
os.environ.setdefault("OPENAI_LIVE_MODEL", "gpt-live-1")

from openai_agent.scenario.turns import (  # noqa: E402
    ANSWER_WAIT,
    DELEGATION_STALL,
    DONE_SILENCE,
    FAREWELL_MAX,
    GREETING_WAIT,
    LAST_LINE_MAX,
    Transcript,
    TurnPolicy,
)

import asyncio  # noqa: E402
import base64  # noqa: E402
import json  # noqa: E402
import threading  # noqa: E402
import time  # noqa: E402
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer  # noqa: E402

from websockets.asyncio.server import serve  # noqa: E402

from openai_agent.config import Config  # noqa: E402
from openai_agent.scenario import run_one  # noqa: E402
from openai_agent.scenario.server import drive_pass  # noqa: E402
from openai_agent.scenario.settings import RunnerSettings  # noqa: E402

failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'} {name}" + ("" if ok else f"   -- {detail}"))
    if not ok:
        failures.append(name)


def policy_checks() -> None:
    print("turn policy")
    p = TurnPolicy(lines=2, max_seconds=90, max_turns=8)
    check("waits for the greeting", p.tick(0.5) == "wait")
    p.agent_sound(0.5)
    check("does not talk over the greeting", p.tick(1.0) == "wait")
    check("speaks once the agent is quiet", p.tick(1.8) == "speak")
    p.started_line(1.8, 1.0)
    check("silent while its own line plays", p.tick(2.5) == "wait")
    check("waits for an answer before the next line", p.tick(4.0) == "wait")
    # "Let me check" — sound after the line, before the delegation. It is not the answer.
    p.agent_sound(3.5)
    p.delegation(True, 4.0)
    p.tool_called(4.5)
    check("waits while the backend works", p.tick(6.0) == "wait")
    p.delegation(False, 6.2)  # the response with the function call completes
    check("no speaking while a tool output is owed", p.tick(7.0) == "wait")
    p.delegation(True, 7.2)  # the response the tool output asked for
    check("tool_pending clears when the next response starts", not p.tool_pending)
    check("waits while that response runs", p.tick(7.5) == "wait")
    p.delegation(False, 8.0)
    check("no speaking right after delegation(False)", p.tick(8.1) == "wait")
    check("still no speaking until the agent speaks the result", p.tick(9.5) == "wait")
    p.agent_sound(10.0)  # the voice model speaks the backend's answer
    check("does not talk over the result", p.tick(10.5) == "wait")
    check("speaks the next line after the result", p.tick(11.3) == "speak")
    p.started_line(11.3, 1.0)
    check("agent turns reset when a line starts", p.agent_turns == 0, str(p.agent_turns))
    p.agent_sound(13.0)
    check("not done right after the last answer", p.tick(14.5) == "wait")
    check("done after the customer goes quiet", p.tick(13.0 + DONE_SILENCE) == "close")

    u = TurnPolicy(lines=2, max_seconds=90, max_turns=8)
    u.agent_sound(0.0)
    u.tick(1.5)
    u.started_line(1.5, 1.0)
    u.agent_sound(3.0)
    u.delegation(True, 3.5)
    u.delegation(False, 5.0)
    check("unanswered after a delegation: waits from its end", u.tick(5.0 + ANSWER_WAIT - 0.5) == "wait")
    check("unanswered after a delegation: moves on", u.tick(5.0 + ANSWER_WAIT) == "speak")

    s = TurnPolicy(lines=2, max_seconds=90, max_turns=8)
    s.agent_sound(0.0)
    s.tick(1.5)
    s.started_line(1.5, 1.0)
    s.agent_sound(3.0)
    s.delegation(True, 3.5)
    check("a long delegation holds the customer back", s.tick(3.5 + DELEGATION_STALL - 0.5) == "wait")
    check("a delegation stalled 15 s no longer does", s.tick(3.5 + DELEGATION_STALL) == "speak")

    st = TurnPolicy(lines=2, max_seconds=90, max_turns=8)
    st.agent_sound(0.0)
    st.tick(1.5)
    st.started_line(1.5, 1.0)
    st.tool_called(3.0)
    check("an owed tool output holds the customer back", st.tick(3.0 + DELEGATION_STALL - 0.5) == "wait")
    check("an owed tool output stalled 15 s no longer does", st.tick(3.0 + DELEGATION_STALL) == "speak")

    q = TurnPolicy(lines=1, max_seconds=90, max_turns=8)
    check("speaks first if the agent never greets", q.tick(GREETING_WAIT) == "speak")

    e = TurnPolicy(lines=1, max_seconds=90, max_turns=8)
    e.end_requested(10.0)
    check("after end_call, waits for the goodbye", e.tick(11.0) == "wait")
    e.agent_sound(11.0)
    check("closes once the goodbye is said", e.tick(12.5) == "close")
    f = TurnPolicy(lines=1, max_seconds=90, max_turns=8)
    f.end_requested(10.0)
    check("closes anyway if no goodbye comes", f.tick(10.0 + FAREWELL_MAX) == "close")
    g = TurnPolicy(lines=1, max_seconds=90, max_turns=8)
    g.agent_sound(10.0)  # "Goodbye!" said before end_call, as the composed rules ask
    g.end_requested(10.5)
    check("goodbye before end_call: waits for quiet", g.tick(11.0) == "wait")
    check("goodbye before end_call: closes quickly", g.tick(11.8) == "close")
    h = TurnPolicy(lines=1, max_seconds=90, max_turns=8)
    h.agent_sound(10.0)
    h.end_requested(10.5)
    h.agent_sound(11.5)  # and then it keeps talking
    check("a goodbye after end_call is still waited for", h.tick(12.0) == "wait")
    check("closes once that goodbye ends", h.tick(12.8) == "close")

    check("time limit", TurnPolicy(lines=1, max_seconds=90, max_turns=8).tick(90.0) == "time_limit")
    t = TurnPolicy(lines=3, max_seconds=90, max_turns=2)
    for i in range(3):
        t.agent_sound(i * 5.0)
        t.tick(i * 5.0 + 2.0)
    check("turn limit", t.tick(20.0) == "turn_limit")

    r = TurnPolicy(lines=2, max_seconds=90, max_turns=2)
    r.agent_sound(0.0)
    r.tick(1.5)
    r.started_line(1.5, 1.0)
    for at in (3.0, 5.0):
        r.agent_sound(at)
        r.tick(at + 1.5)
    r.started_line(6.5, 1.0)
    for at in (8.0, 10.0):
        r.agent_sound(at)
        r.tick(at + 1.5)
    check("the turn limit counts per exchange", r.tick(12.0) != "turn_limit", f"turns={r.agent_turns}")

    a = TurnPolicy(lines=2, max_seconds=90, max_turns=8)
    a.agent_sound(0.0)
    a.tick(1.5)
    a.started_line(1.5, 1.0)
    check("unanswered line: wait", a.tick(2.5 + ANSWER_WAIT - 0.5) == "wait")
    check("unanswered line: move on", a.tick(2.5 + ANSWER_WAIT) == "speak")

    m = TurnPolicy(lines=1, max_seconds=90, max_turns=8)
    m.agent_sound(0.0)
    m.tick(1.5)
    m.started_line(1.5, 1.0)  # ends at 2.5
    for at in (4.0, 9.0, 14.0, 19.0, 24.0):  # "Anything else?" every 5 s keeps resetting DONE_SILENCE
        m.agent_sound(at)
        m.tick(at + 1.5)
    check("a chatty agent after the last line: still waiting", m.tick(2.5 + LAST_LINE_MAX - 0.1) == "wait")
    check("LAST_LINE_MAX closes the run as completed", m.tick(2.5 + LAST_LINE_MAX) == "close")

    tr = Transcript()
    tr.agent("Hello, ", 100)
    tr.agent("how can I help?", 300)
    tr.caller("Book me in.", 2000, 3000)
    tr.agent("Sure.", 4000)
    tr.agent("Anything else?", 6000)
    check(
        "transcript joins deltas into turns, and splits on a pause",
        [(e["speaker"], e["text"]) for e in tr.entries]
        == [
            ("receptionist", "Hello, how can I help?"),
            ("caller", "Book me in."),
            ("receptionist", "Sure."),
            ("receptionist", "Anything else?"),
        ],
        str(tr.entries),
    )


# ---------------------------------------------------------------- part 2: one whole run, faked

LOUD = base64.b64encode(b"\x00" * 160).decode("ascii")  # μ-law 0x00 is full scale
LINES = ["Book me for 4 PM tomorrow under Kim Minsu.", "Yes, that's right."]
JOB = {
    "done": False,
    "runId": "r1",
    "title": "Booking",
    "session": {
        "live": "VOICE PROMPT",
        "backend": "BACKEND PROMPT",
        "tools": [
            {"type": "function", "name": "book_appointment", "description": "Book.", "parameters": {"type": "object", "properties": {}}},
            {"type": "function", "name": "end_call", "description": "Hang up.", "parameters": {"type": "object", "properties": {}}},
        ],
        "greeting": "Say hello.",
        "voice": None,
    },
    "customerLines": LINES,
    "language": "en",
    "limits": {"maxSeconds": 60, "maxTurns": 8},
}
seen: dict = {"jobs": 0, "tools": [], "results": [], "keys": set(), "after_end_call": []}


class FakeBackend(BaseHTTPRequestHandler):
    def log_message(self, *args) -> None:  # quiet
        pass

    def _send(self, body: dict) -> None:
        data = json.dumps(body).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:  # noqa: N802
        seen["keys"].add(self.headers.get("x-runner-key"))
        seen["jobs"] += 1
        self._send(JOB if seen["jobs"] == 1 else {"done": True})

    def do_POST(self) -> None:  # noqa: N802
        seen["keys"].add(self.headers.get("x-runner-key"))
        body = json.loads(self.rfile.read(int(self.headers["content-length"])))
        if self.path.endswith("/tool"):
            seen["tools"].append(body)
            self._send({"output": {"booked": True, "when": "Friday at 4:00 PM"} if body["name"] == "book_appointment" else {"ok": True}})
        else:
            seen["results"].append(body)
            self._send({"verdict": "pass"})


async def fake_live(ws) -> None:
    """GPT-Live, scripted. A reader timestamps every loud frame the customer sends, as it arrives."""
    loud_at: list[float] = []
    events: asyncio.Queue = asyncio.Queue()

    async def reader() -> None:
        async for raw in ws:
            evt = json.loads(raw)
            if evt.get("type") == "session.input_audio.append":
                if base64.b64decode(evt["audio"]) == b"\x00" * 160:
                    loud_at.append(time.monotonic())
            else:
                await events.put(evt)
        await events.put({"type": "__closed__"})

    async def speak(text: str) -> None:
        await ws.send(json.dumps({"type": "session.output_transcript.delta", "delta": text}))
        for _ in range(30):
            await ws.send(json.dumps({"type": "session.output_audio.delta", "delta": LOUD}))

    async def next_of(kind: str, log: list | None = None) -> dict:
        while True:
            evt = await events.get()
            if log is not None:
                log.append(evt.get("type"))
            if evt.get("type") == kind:
                return evt
            if evt.get("type") == "__closed__":
                raise RuntimeError(f"socket closed before {kind}")

    async def hear_line(after: float) -> float:
        """Waits for a customer line that starts after `after` and ends; returns when it started."""
        while not any(t > after for t in loud_at):
            await asyncio.sleep(0.02)
        first = next(t for t in loud_at if t > after)
        while time.monotonic() - loud_at[-1] < 0.4:
            await asyncio.sleep(0.02)
        return first

    async def backend(evt: dict) -> None:
        await ws.send(json.dumps({"type": "response.event", "event": evt}))

    seen["session_start"] = json.loads(await ws.recv())
    await ws.send(json.dumps({"type": "session.started", "session": {"id": "sess_fake"}}))
    read_task = asyncio.create_task(reader())
    try:
        await speak("Thanks for calling, how can I help? ")
        await hear_line(0.0)
        line1_heard = time.monotonic()
        await speak("Let me check that for you. ")
        await ws.send(json.dumps({"type": "session.delegation.created", "delegation": {"id": "d1"}}))
        await backend({"type": "response.created"})
        await backend({"type": "response.output_item.done", "item": {
            "type": "function_call", "status": "completed", "call_id": "c1", "name": "book_appointment",
            "arguments": json.dumps({"start": "2026-10-02T16:00:00-07:00", "caller_name": "Kim Minsu"})}})
        await backend({"type": "response.completed", "response": {"usage": {"input_tokens": 1000, "output_tokens": 50}}})
        seen["tool_output"] = await next_of("response.item.create")
        await next_of("response.create")
        await asyncio.sleep(0.3)  # the gap before the next response starts: an output is owed
        await backend({"type": "response.created"})
        # The backend works long enough that "Let me check" is long over (the agent is quiet) ...
        await asyncio.sleep(1.5)
        # ... and then the critical case: its response completes BEFORE the voice model speaks the result.
        await backend({"type": "response.completed", "response": {"usage": {"input_tokens": 1200, "output_tokens": 30}}})
        await asyncio.sleep(0.8)
        seen["booked_spoken_at"] = time.monotonic()
        await speak("You're booked for 4 PM tomorrow. ")
        seen["line2_heard_at"] = await hear_line(line1_heard)
        await backend({"type": "response.created"})
        await backend({"type": "response.output_item.done", "item": {
            "type": "function_call", "status": "completed", "call_id": "c2", "name": "end_call", "arguments": "{}"}})
        await backend({"type": "response.completed", "response": {"usage": {"input_tokens": 1300, "output_tokens": 10}}})
        await next_of("response.item.create")
        await speak("Goodbye!")
        await ws.send(json.dumps({"type": "session.usage.updated", "usage": {"seconds": 12}}))
        await next_of("session.close", seen["after_end_call"])
    finally:
        read_task.cancel()


async def end_to_end() -> None:
    print("one run against fakes")
    http = ThreadingHTTPServer(("127.0.0.1", 0), FakeBackend)
    threading.Thread(target=http.serve_forever, daemon=True).start()

    async def fake_tts(api_key, model, voice, text) -> bytes:
        return b"\x00" * 8000  # one loud second

    run_one.synthesize = fake_tts
    async with serve(fake_live, "127.0.0.1", 0) as server:
        port = server.sockets[0].getsockname()[1]
        rs = RunnerSettings(
            key="k", enabled=True, port=0, backend_url=f"http://127.0.0.1:{http.server_port}",
            tts_model="tts", customer_voice="ash", live_url=f"ws://127.0.0.1:{port}",
        )
        await asyncio.wait_for(drive_pass(Config.load(), rs, "p1"), timeout=60)
    http.shutdown()

    result = seen["results"][0] if seen["results"] else {}
    start = seen.get("session_start", {}).get("session", {})
    check("sends the runner key", seen["keys"] == {"k"}, str(seen["keys"]))
    check("starts the composed session", start.get("instructions", "").startswith("VOICE PROMPT"), str(start)[:200])
    check(
        "puts the tools on the backend",
        [t["name"] for t in start.get("delegation", {}).get("responses", {}).get("tools", [])] == ["book_appointment", "end_call"],
    )
    check("forwards both tool calls to the sandbox", [t["name"] for t in seen["tools"]] == ["book_appointment", "end_call"], str(seen["tools"]))
    check("hands the sandbox's answer back", '"booked": true' in seen.get("tool_output", {}).get("item", {}).get("output", ""))
    booked, line2 = seen.get("booked_spoken_at"), seen.get("line2_heard_at")
    check(
        "the second line starts only after the agent said the booking result",
        booked is not None and line2 is not None and line2 > booked,
        f"booked spoken at {booked}, second line heard from {line2}",
    )
    check(
        "the backend is not resumed after end_call",
        "response.create" not in seen["after_end_call"],
        str(seen["after_end_call"]),
    )
    check("the run completed", result.get("status") == "completed", str(result))
    entries = result.get("transcript", [])
    speakers = [e["speaker"] for e in entries]
    check("transcript has both sides in order", speakers[:3] == ["receptionist", "caller", "receptionist"], str(entries))
    booked_i = next((i for i, e in enumerate(entries) if "booked" in e["text"]), None)
    line2_i = next((i for i, e in enumerate(entries) if e["speaker"] == "caller" and e["text"] == LINES[1]), None)
    check(
        "the transcript has the second line after the booking result",
        booked_i is not None and line2_i is not None and booked_i < line2_i,
        str(entries),
    )
    check("reports a cost", result.get("costUsd", 0) > 0, str(result.get("costUsd")))
    check("reports when the session started", bool(result.get("startedAt")))
    check("asks for the next job and gets done", seen["jobs"] == 2)


def main() -> int:
    policy_checks()
    print()
    asyncio.run(end_to_end())
    print()
    print("FAILED: " + ", ".join(failures) if failures else "all scenario-runner checks passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
