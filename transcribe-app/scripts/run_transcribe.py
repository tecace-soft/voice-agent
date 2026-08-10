"""Run the voicemail transcription pipeline once.

    python scripts/run_transcribe.py

Reads voicemail emails over IMAP, transcribes each .wav with Whisper, extracts the details
with Claude, and appends a row per voicemail to the Google Sheet. Idempotent — already-handled
voicemails are skipped — so it's safe to run repeatedly or on a schedule (cron / Task
Scheduler). Requires the settings listed in .env.example (see Config.missing()).
"""

from __future__ import annotations

import logging
import sys

from transcribe_app.config import Config
from transcribe_app.pipeline import Pipeline


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    cfg = Config.load()
    gaps = cfg.missing()
    if gaps:
        print("Missing required settings:")
        for g in gaps:
            print(f"  - {g}")
        print("Fill these in .env (see .env.example) and re-run.")
        return 1

    summary = Pipeline(cfg).run()
    print(
        f"Done: {summary.processed} uploaded, {summary.skipped} already done, "
        f"{summary.failed} failed, across {summary.voicemails} voicemail email(s)."
    )
    return 1 if summary.failed else 0


if __name__ == "__main__":
    sys.exit(main())
