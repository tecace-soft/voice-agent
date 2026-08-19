"""Check the IMAP connection and see how many voicemails are visible.

    python scripts/checks/verify_imap.py

Connects with the IMAP_* settings in .env, logs in, and reports how many messages carry a
.wav attachment. Use this to confirm the host/username/password (an app password is usually
required for accounts with 2FA) before running the full pipeline.
"""

from __future__ import annotations

import sys

from transcribe_app.config import Config
from transcribe_app.tools import EmailSource


def main() -> int:
    cfg = Config.load()
    gaps = [g for g in cfg.missing() if g.startswith(("IMAP", "IMAP_HOST"))]
    if gaps:
        print("imap: not configured — missing " + ", ".join(gaps))
        return 1
    print(f"connecting to {cfg.imap_host}:{cfg.imap_port} as {cfg.imap_username} ...")
    try:
        voicemails = EmailSource(cfg).fetch_voicemails()
    except Exception as exc:  # noqa: BLE001 — surface the login/connection error plainly
        print(f"imap: FAIL — {exc}")
        return 1
    total_audio = sum(len(v.attachments) for v in voicemails)
    print(f"imap: ok — {len(voicemails)} voicemail email(s), {total_audio} audio attachment(s).")
    for v in voicemails[:5]:
        kinds = ", ".join(a.content_type for a in v.attachments) or "no audio"
        print(f"  - {v.from_addr}: {v.subject or '(no subject)'} [{kinds}]")
    return 0


if __name__ == "__main__":
    sys.exit(main())
