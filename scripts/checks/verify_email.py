"""Send a test post-call email to confirm the SMTP / NOTIFY_EMAIL setup.

    python scripts/checks/verify_email.py

Uses the SMTP_* + NOTIFY_EMAIL settings in .env. If they're not configured, it
says so (the app just skips the email in that case).
"""

from __future__ import annotations

import sys

from voice_agent.config import Config, ConfigError
from voice_agent.tools.notify import EmailNotifier


def main() -> int:
    try:
        cfg = Config.load()
    except ConfigError as exc:
        print(f"config: FAIL — {exc}")
        return 1

    notifier = EmailNotifier(cfg)
    if not notifier.configured:
        print("email: not configured — set SMTP_HOST / SMTP_USERNAME / SMTP_PASSWORD "
              "/ NOTIFY_EMAIL in .env to enable the post-call CRM push.")
        return 0

    print(f"sending a test email from {cfg.smtp_from} to {cfg.notify_email} "
          f"via {cfg.smtp_host}:{cfg.smtp_port} ...")
    ok = notifier.send(
        "Voice agent — test email",
        "This is a test of the post-call CRM email. If you can read this, it works.",
    )
    print("email: ok — sent." if ok else "email: FAIL — see the logged error above.")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
