"""Check Gemini transcription + extraction on a local .wav (no email, no Sheets).

    python scripts/checks/verify_extract.py path/to/voicemail.wav

Reads the file straight off disk and runs the exact one Gemini call the pipeline uses, then
prints the transcript Gemini heard plus the structured fields it pulled out. Use this to
sanity-check transcription accuracy and extraction quality on real voicemail audio before (or
instead of) a full pipeline run — it only needs GEMINI_API_KEY, not the mailbox or the sheet.
"""

from __future__ import annotations

import sys
from pathlib import Path

from transcribe_app.config import Config
from transcribe_app.tools import Extractor, WavAttachment


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: python scripts/checks/verify_extract.py <path-to.wav>")
        return 2
    wav_path = Path(sys.argv[1])
    if not wav_path.is_file():
        print(f"extract: FAIL — no such file: {wav_path}")
        return 1

    cfg = Config.load()
    if not cfg.gemini_api_key:
        print("extract: not configured — set GEMINI_API_KEY in .env.")
        return 1

    att = WavAttachment(filename=wav_path.name, data=wav_path.read_bytes())
    print(f"sending {wav_path.name} ({len(att.data):,} bytes) to {cfg.extract_model} ...")
    try:
        info = Extractor(cfg).extract(att)
    except Exception as exc:  # noqa: BLE001 — surface the API error plainly
        print(f"extract: FAIL — {exc}")
        return 1

    print("extract: ok\n")
    print(f"  transcript      : {info.transcript or '(empty)'}")
    print(f"  caller_name     : {info.caller_name}")
    print(f"  phone_number    : {info.phone_number}")
    print(f"  email           : {info.email}")
    print(f"  requested_time  : {info.requested_time}")
    print(f"  callback_wanted : {info.callback_requested}")
    print(f"  summary         : {info.summary}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
