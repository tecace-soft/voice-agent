"""Run the phone server that answers Twilio calls.

    python scripts/run_phone.py          # answer calls only
    python scripts/run_phone.py --poll    # also poll Typeform and call submitters back

`--poll` is the no-webhook path: the server checks Typeform for new submissions
every 30s and calls the person back — no public HTTPS endpoint needed. Set
PUBLIC_BASE_URL to how Twilio reaches this server (e.g. http://<box-ip>:3000).
"""

from __future__ import annotations

import sys
import threading

from voice_agent.config import Config, ConfigError
from voice_agent.telephony import create_app
from voice_agent.telephony.poller import TypeformPoller


def main(argv: list[str]) -> int:
    try:
        cfg = Config.load()
    except ConfigError as exc:
        print(f"config error: {exc}")
        return 1

    if not cfg.twilio_phone_number:
        print("warning: no Twilio phone number configured (PHONE_NUMBER in .env)")
    base = cfg.public_base_url or f"http://localhost:{cfg.port}"
    polling = "--poll" in argv
    print(f"phone server on :{cfg.port}")
    print(f"  inbound webhook  -> {base}/voice/incoming   (set this on your Twilio number)")
    print(f"  outbound trigger -> POST {base}/call   (or: python scripts/place_call.py <number>)")
    print(f"  Typeform polling -> {'ON (calls back new submissions)' if polling else 'off (pass --poll)'}")
    print(f"  health           -> {base}/health")
    if not cfg.public_base_url:
        print("  note: PUBLIC_BASE_URL not set — set it to how Twilio reaches this server.")

    app = create_app(cfg)

    # Always place due call-backs (callers who weren't ready earlier).
    threading.Thread(
        target=app.callback_queue.run, args=(app.trigger_callback,), daemon=True  # type: ignore[attr-defined]
    ).start()

    if polling:
        poller = TypeformPoller(cfg, app.trigger_callback)  # type: ignore[attr-defined]
        threading.Thread(target=poller.run, daemon=True).start()

    app.run(host="0.0.0.0", port=cfg.port)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
