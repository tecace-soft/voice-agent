"""Check Gemini transcription + extraction on a local audio file (no email, no Sheets).

    python scripts/checks/verify_extract.py path/to/voicemail.wav   (or .mp3, .m4a, …)

Reads the file straight off disk and runs the exact one Gemini call the pipeline uses, then
prints the transcript Gemini heard plus the structured fields it pulled out. Use this to
sanity-check transcription accuracy and extraction quality on real voicemail audio before (or
instead of) a full pipeline run — it only needs GEMINI_API_KEY, not the mailbox or the sheet.
"""

from __future__ import annotations

import sys
from pathlib import Path

from transcribe_app.config import Config
from transcribe_app.tools import AudioAttachment, Extractor, audio_mime_for


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: python scripts/checks/verify_extract.py <path-to-audio>")
        return 2
    audio_path = Path(sys.argv[1])
    if not audio_path.is_file():
        print(f"extract: FAIL — no such file: {audio_path}")
        return 1

    mime = audio_mime_for(audio_path.name)
    if not mime:
        print(f"extract: FAIL — {audio_path.name} doesn't look like a supported audio file "
              "(expected .wav/.mp3/.m4a/.ogg/.flac/.aac/.aiff/.amr).")
        return 1

    cfg = Config.load()
    if not cfg.gemini_api_key:
        print("extract: not configured — set GEMINI_API_KEY in .env.")
        return 1

    att = AudioAttachment(filename=audio_path.name, data=audio_path.read_bytes(), content_type=mime)
    print(f"sending {audio_path.name} ({len(att.data):,} bytes, {mime}) to {cfg.extract_model} ...")
    try:
        info = Extractor(cfg).extract(att)
    except Exception as exc:  # noqa: BLE001 — surface the API error plainly
        print(f"extract: FAIL — {exc}")
        return 1

    print("extract: ok\n")
    print(f"  transcript      : {info.transcript or '(empty)'}")
    print(f"  caller_name     : {info.caller_name}")
    print(f"  phone_number    : {info.phone_number}")
    print(f"  requested_time  : {info.requested_time}")
    print(f"  callback_wanted : {info.callback_requested}")
    print(f"  summary         : {info.summary}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
