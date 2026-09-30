"""Does a call run on the session the dashboard composed? Offline: no network, no call, no OpenAI.

    python scripts/checks/verify_composed_session.py

Feeds a `/business/config` answer shaped like transcribe-backend's (`session`, from
`composeSession(channel: "phone")`) through the same code a GPT-Live call uses, and checks what
would be sent to OpenAI: the dashboard's prompts verbatim plus this side's "This call", its tools,
its voice, the opening line, and which number `transfer_call` dials for a scenario.

Pass `--live +14255550100` to also fetch the real answer for that number (needs BUSINESS_CONFIG_URL
and AGENT_CONFIG_KEY) and print whether it carries a session.
"""

from __future__ import annotations

import asyncio
import sys
from dataclasses import replace
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from openai_agent.config import Config  # noqa: E402
from openai_agent.realtime.composed import composed_call, opening_line, transfer_number  # noqa: E402
from openai_agent.realtime.live_session import build_composed_session_start  # noqa: E402
from openai_agent.tools.business_config import BusinessConfig, _usable_session, fetch_business_config  # noqa: E402

failures = 0


def check(label: str, ok: bool, detail: object = "") -> None:
    global failures
    print(f"  {'PASS' if ok else 'FAIL'}  {label}" + (f"  ({detail})" if not ok and detail != "" else ""))
    if not ok:
        failures += 1


def _tool(name: str) -> dict:
    return {"type": "function", "name": name, "description": name, "parameters": {"type": "object", "properties": {}}}


SESSION = {
    "live": "VOICE PREAMBLE\n\nRULE BOOK\n\nYou are Mia, the phone receptionist at Acme Dental.\n- Parking: free lot",
    "backend": "BACKEND PREAMBLE\n\nRULE BOOK\n\n# What you know: the full business profile (JSON)",
    "greetingLine": "Thanks for calling Acme Dental, this is Mia. How can I help?",
    "voice": "gleam",
    "language": "en",
    "tools": [_tool("transfer_call"), _tool("take_message"), _tool("end_call")],
    "transfers": [
        {"id": "billing", "name": "Billing", "mode": "warm", "numbers": ["+12535550111", "+12535550112"]},
        {"id": "team", "name": "Front desk", "mode": "cold", "numbers": ["+12535550113"]},
    ],
    "reachable": True,
    "canBook": False,
    "returnLeg": {
        "live": "VOICE PREAMBLE\n\nRULE BOOK (nobody to reach)",
        "backend": "BACKEND PREAMBLE\n\nRULE BOOK (nobody to reach)",
        "tools": [_tool("take_message"), _tool("end_call")],
    },
}


def business(session: dict | None) -> BusinessConfig:
    return BusinessConfig(
        to="+14255550100", user_id="u1", user_email="owner@example.com", user_name="Owner",
        business_name="Acme Dental", hours_text="", open_hour=None, close_hour=None, website="",
        facts="", transfer_number="", agent_name="Mia", greeting="", transfer_topics="",
        house_rules="", booking=None, session=session,
    )


def offline(cfg: Config) -> None:
    biz = business(_usable_session(SESSION))
    print("First leg")
    call = composed_call(cfg, biz, caller="+12065550199", returning=False)
    check("voice prompt is the dashboard's, verbatim", call.live.startswith(SESSION["live"]))
    check("backend prompt is the dashboard's, verbatim", call.backend.startswith(SESSION["backend"]))
    check("'This call' added to both halves", "# This call" in call.live and "# This call" in call.backend)
    check("caller ID read out", "206-555-0199" in call.live, call.live[-400:])
    check("tools are the dashboard's", [t["name"] for t in call.tools] == ["transfer_call", "take_message", "end_call"])
    check("opening line is the dashboard's greeting", call.opening.startswith("Thanks for calling Acme Dental") or "Acme Dental" in call.opening, call.opening)
    check("opening line matches /incoming's pre-render", call.opening == opening_line(cfg, biz))
    check("default transfer goes to the first scenario's first number", call.default_number == "+12535550111", call.default_number)

    start = build_composed_session_start(cfg, call.live, call.backend, call.tools, greet_now="Speak now.", voice=call.voice)
    session = start["session"]
    check("no second preamble on the voice half", session["instructions"].startswith("VOICE PREAMBLE"))
    check("no second preamble on the backend half", session["delegation"]["responses"]["instructions"].startswith("BACKEND PREAMBLE"))
    check("greet-now rides on the voice half", session["instructions"].rstrip().endswith("Speak now."))
    check("business's voice", session["audio"]["output"]["voice"] == "gleam", session["audio"]["output"])

    print("transfer_call")
    check("scenario id -> its first number", transfer_number(biz, "team") == "+12535550113")
    check("unknown id -> the first scenario", transfer_number(biz, "nope") == "+12535550111")
    check("no scenarios -> nothing to dial", transfer_number(business(_usable_session({**SESSION, "transfers": []})), "team") == "")

    print("Return leg (a transfer nobody answered)")
    back = composed_call(cfg, biz, caller="+12065550199", returning=True, caller_name="Sam", known_request="Wants to discuss a bill.")
    check("runs on returnLeg", back.live.startswith(SESSION["returnLeg"]["live"]))
    check("no transfer tool", [t["name"] for t in back.tools] == ["take_message", "end_call"])
    check("nobody to dial", back.default_number == "")
    check("recovery script and what they said", "failed transfer" in back.live and "Sam" in back.live and "discuss a bill" in back.live)

    print("Old profiles")
    check("no session -> None (hand-built prompt)", _usable_session(None) is None)
    check("session without prompts -> None", _usable_session({**SESSION, "live": ""}) is None)
    check("session without returnLeg -> None", _usable_session({k: v for k, v in SESSION.items() if k != "returnLeg"}) is None)


async def live(cfg: Config, number: str) -> None:
    print(f"Live lookup for {number}")
    biz = await fetch_business_config(cfg, number)
    if biz is None:
        print("  no business for that number (see the agent's log line for why)")
        return
    if not biz.session:
        print(f"  {biz.business_name!r}: NO session — this backend predates it, or the profile is unstructured")
        return
    s = biz.session
    print(f"  {biz.business_name!r}: composed session, {len(s['live'])} + {len(s['backend'])} chars")
    print(f"  tools: {[t.get('name') for t in s['tools']]}  voice: {s.get('voice')}  canBook: {s.get('canBook')}")
    print(f"  transfers: {[(t['id'], t['numbers']) for t in s.get('transfers') or []]}")
    print(f"  opening: {opening_line(cfg, biz)!r}")


def main() -> int:
    cfg = Config.load()
    offline(replace(cfg, disclose_recording=True))
    if "--live" in sys.argv:
        idx = sys.argv.index("--live")
        asyncio.run(live(cfg, sys.argv[idx + 1] if idx + 1 < len(sys.argv) else cfg.twilio_from_number))
    print("\nOK" if not failures else f"\n{failures} FAILED")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
