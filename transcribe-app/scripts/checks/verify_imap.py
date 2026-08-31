"""Check the IMAP connection and see how many voicemails are visible.

    python scripts/checks/verify_imap.py

Connects with the IMAP_* settings in .env, logs in, and reports how many messages carry a
.wav attachment. Use this to confirm the host/username/password (an app password is usually
required for accounts with 2FA) before running the full pipeline.
"""

from __future__ import annotations

import sys

from transcribe_app.config import Config
from transcribe_app.callerid import parse_caller_id
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
    # Show what the sheet's Caller ID column would get, and from where. The number comes from the
    # attachment filename when the phone system puts it there and the subject otherwise; when
    # neither carries one the column is blank, and this is how you find out which case you are in.
    print()
    for v in voicemails[:5]:
        kinds = ", ".join(a.content_type for a in v.attachments) or "no audio"
        print(f"  - from    : {v.from_addr}")
        print(f"    subject : {v.subject or '(no subject)'}")
        print(f"    audio   : {', '.join(a.filename for a in v.attachments) or '(none)'} [{kinds}]")
        for a in v.attachments:
            from_name = parse_caller_id(a.filename, "")
            from_subj = parse_caller_id("", v.subject or "")
            got = parse_caller_id(a.filename, v.subject or "")
            where = "filename" if from_name else "subject" if from_subj else "NOWHERE"
            print(f"    callerID: {got or '(blank)'}  <- {where}")
        print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
