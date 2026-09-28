"""Check booking on inbound calls: the rule book, the tools, and where the tools are answered.

    python scripts/checks/verify_booking.py

No network and no keys: a local fake stands in for transcribe-backend. Checks that
  * without booking the inbound rule book is exactly what it was (the bridge matches its lines),
  * with booking every "you cannot book" line is gone, the booking route and the business's
    Appointments section are in, for a line with a person to reach and for one without,
  * the call gets check_availability / book_appointment, with transfer_to_human reworded,
  * those two tools go to /business/calendar/agent-tool with the agent key, the dialled number and
    the caller's number — and an outbound lead's tools still go to backend-app.

Run it after editing instructions_inbound.py, booking_inbound.py or agent_tools.py.
"""

from __future__ import annotations

import asyncio
import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from openai_agent.realtime.booking_inbound import (  # noqa: E402
    BOOKING_TOOL_NAMES,
    apply_booking,
    tools_with_booking,
)
from openai_agent.realtime.instructions_inbound import build_instructions  # noqa: E402
from openai_agent.tools.agent_tools import INBOUND_TOOL_SCHEMAS, ToolExecutor  # noqa: E402

BOOKING = {
    "providerName": "Google Calendar",
    "kind": "calendar",
    "title": "Consultation",
    "durationMinutes": 45,
    "horizonDays": 30,
    "instructions": "Ask whether it's their first visit.",
}

failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'} {name}" + ("" if ok else f"   -- {detail}"))
    if not ok:
        failures.append(name)


def flat(text: str) -> str:
    return " ".join(text.split())


def prompts() -> None:
    for label, kwargs in [
        ("with a person to reach", {"can_transfer": True}),
        ("with nobody to reach", {"can_transfer": False}),
        ("on a returning leg", {"can_transfer": True, "transfer_failed": True}),
    ]:
        base = build_instructions(business_name="Glow Clinic", default_facts=False, **kwargs)
        reachable = kwargs["can_transfer"] and not kwargs.get("transfer_failed", False)
        booked = flat(apply_booking(base, BOOKING, reachable=reachable))
        plain = flat(base)
        check(f"{label}: without booking the rule book still says it cannot book",
              "You are NOT the booking system" in plain and "BOOKING A NEW APPOINTMENT" not in plain)
        for gone in ("You are NOT the booking system", "not to sell and not to book",
                     "You cannot see the calendar", "I can't book that myself", "I can't book it myself",
                     "NEVER state or guess availability — whether a time is free"):
            check(f"{label}: booking removes {gone!r}", gone not in booked)
        for there in ("You CAN book a NEW appointment", "BOOKING A NEW APPOINTMENT IS YOURS TO DO",
                      "call check_availability", "book_appointment", "# Appointments",
                      "You can book: Consultation.", "Each one is 45 minutes.", "Google Calendar",
                      "Ask whether it's their first visit.", "# Ending the call"):
            check(f"{label}: booking adds {there!r}", there in booked)
        check(f"{label}: the Appointments section sits before the ending rules",
              booked.index("# Appointments") < booked.index("# Ending the call"))
        fallback = "offer to put them through, or take a message" if reachable else "take a message (Route C)"
        check(f"{label}: nothing fits -> {fallback}", f"would rather speak to someone: {fallback}" in booked)


def tools() -> None:
    with_booking = tools_with_booking(INBOUND_TOOL_SCHEMAS)
    names = [t["name"] for t in with_booking]
    check("tools: booking adds the two tools once", sorted(n for n in names if n in BOOKING_TOOL_NAMES)
          == ["book_appointment", "check_availability"], str(names))
    transfer = next(t for t in with_booking if t["name"] == "transfer_to_human")
    check("tools: transfer_to_human no longer claims every booking", "booking, rescheduling" not in transfer["description"])
    original = next(t for t in INBOUND_TOOL_SCHEMAS if t["name"] == "transfer_to_human")
    check("tools: the shared schema list is left untouched", "booking, rescheduling" in original["description"])


class _Fake(BaseHTTPRequestHandler):
    seen: list[tuple[str, dict, dict]] = []

    def do_POST(self):  # noqa: N802
        body = json.loads(self.rfile.read(int(self.headers.get("content-length") or 0)) or b"{}")
        _Fake.seen.append((self.path, dict(self.headers), body))
        answer = {"available": True, "openings": [{"start": "2026-10-06T14:30:00-07:00", "spoken": "Tuesday at 2:30 PM"}]}
        payload = json.dumps(answer).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *_a):
        pass


class _Cfg:
    def __init__(self, url: str) -> None:
        self.business_config_url = url
        self.agent_config_key = "agent-key-123"
        self.backend_url = url + "/backend-app"
        self.agent_tools_secret = "tools-secret"
        self.request_timeout = 5.0


def executor() -> None:
    server = HTTPServer(("127.0.0.1", 0), _Fake)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    cfg = _Cfg(f"http://127.0.0.1:{server.server_port}")
    try:
        inbound = ToolExecutor(cfg, intake_id="", booking_line="+12065550100", caller="+12065550199")
        out = json.loads(asyncio.run(inbound.run("check_availability", {"date": "2026-10-06"})))
        path, headers, body = _Fake.seen[-1]
        check("executor: inbound booking goes to /business/calendar/agent-tool", path == "/business/calendar/agent-tool", path)
        check("executor: with the agent key", headers.get("x-agent-key") == "agent-key-123", str(headers))
        check("executor: with the dialled line, the tool, its args and the caller",
              body == {"to": "+12065550100", "name": "check_availability", "args": {"date": "2026-10-06"},
                       "callerNumber": "+12065550199"}, str(body))
        check("executor: the backend's answer reaches the model as it came", out.get("openings", [{}])[0].get("spoken") == "Tuesday at 2:30 PM")

        outbound = ToolExecutor(cfg, intake_id="lead-1")
        asyncio.run(outbound.run("check_availability", {"dateTime": "2026-10-06T14:30"}))
        path, headers, body = _Fake.seen[-1]
        check("executor: an outbound lead still books through backend-app",
              path == "/backend-app/agent/check-availability" and headers.get("x-agent-secret") == "tools-secret", path)
    finally:
        server.shutdown()


def main() -> int:
    prompts()
    tools()
    executor()
    print("PASS" if not failures else f"FAIL ({len(failures)})")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
