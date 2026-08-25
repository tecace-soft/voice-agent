"""Forget which voicemails have already been transcribed, so the next run treats them all as new.

    python scripts/reset_state.py --dry-run   # show what's remembered, forget nothing
    python scripts/reset_state.py             # forget it all

The poller skips anything recorded in the state file (STATE_FILE, default `.processed.json`), keyed
by Message-ID + attachment name. Clearing it is how you get a full fresh pass over the mailbox —
useful when you want current voicemails to flow through a new backend or dashboard setup.

It reads STATE_FILE from your .env the same way the app does, so it clears the file the poller
actually uses rather than a guess at the path.

WHAT THIS COSTS, because it isn't obvious:
  - Every voicemail still in the IMAP window gets transcribed AGAIN, so each one appends a FRESH
    ROW to the Google Sheet. Clear the sheet too (or point SHEET_RANGE at a test tab) if you want a
    clean result rather than duplicates.
  - Each re-transcription is another Gemini call.
  - Only voicemails newer than IMAP_SINCE_DAYS are visible at all — raise it first if "current
    voicemails" means further back than that.

This never touches the mailbox: nothing is deleted, moved, or marked read on the mail server.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from transcribe_app.config import Config  # noqa: E402


def main() -> int:
    dry_run = "--dry-run" in sys.argv[1:]

    cfg = Config.load()
    path = Path(cfg.state_file)

    if not path.is_file():
        print(f"No state file at {path} — nothing is remembered, so the next run is already a full pass.")
        return 0

    try:
        keys = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001 — a corrupt file is still worth removing
        print(f"State file at {path} could not be read ({exc}); it will be treated as unreadable.")
        keys = []

    print(f"State file: {path}")
    print(f"Remembers {len(keys)} already-transcribed voicemail attachment(s).")
    for key in keys[:5]:
        print(f"  {key}")
    if len(keys) > 5:
        print(f"  ... and {len(keys) - 5} more")

    if dry_run:
        print("\n--dry-run: nothing was cleared.")
        return 0

    path.unlink()
    print(
        f"\nCleared. The next run will re-transcribe every voicemail within IMAP_SINCE_DAYS "
        f"({cfg.imap_since_days} days) and append a fresh row per voicemail to the sheet."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
