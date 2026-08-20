"""Manually transcribe local voicemail audio files into the sheet — no email/IMAP needed.

    python scripts/ingest_file.py path/to/voicemail.mp3 [more.mp3 ...]

For each file: transcribe + extract with Gemini and append a row to the Google Sheet. Since these
are local files (no source email), the row has the transcript + caller details but no "Open email"
link — for a one-off transcript. Needs GEMINI_API_KEY + the Google Sheets service account; does
NOT need the IMAP settings.
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path

from transcribe_app.config import Config
from transcribe_app.pipeline import build_row
from transcribe_app.tools import (
    AudioAttachment,
    Extractor,
    SheetWriter,
    VoicemailEmail,
    audio_mime_for,
)


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    paths = sys.argv[1:]
    if not paths:
        print("usage: python scripts/ingest_file.py <audio-file> [more ...]")
        return 2

    cfg = Config.load()
    # IMAP isn't used here, so only require the model + destination settings.
    gaps = [g for g in cfg.missing() if not g.startswith("IMAP")]
    if gaps:
        print("Missing required settings:")
        for g in gaps:
            print(f"  - {g}")
        return 1

    extractor = Extractor(cfg)
    sheet = SheetWriter(cfg)

    done = 0
    for raw in paths:
        path = Path(raw)
        mime = audio_mime_for(path.name)
        if not path.is_file():
            print(f"skip {raw}: no such file")
            continue
        if not mime:
            print(f"skip {path.name}: not a recognized audio file")
            continue
        try:
            att = AudioAttachment(filename=path.name, data=path.read_bytes(), content_type=mime)
            info = extractor.extract(att)
            # No email envelope for a manual upload — label the source so the row is still traceable.
            vm = VoicemailEmail(message_id=f"manual:{path.name}", from_addr="(manual upload)",
                                subject="", date="")
            sheet.append_row(build_row(vm, att, info))
        except Exception as exc:  # noqa: BLE001 — one bad file shouldn't stop the batch
            print(f"FAILED {path.name}: {exc}")
            continue
        print(f"added {path.name}: {info.caller_name or '(no name)'}")
        done += 1

    print(f"done: {done}/{len(paths)} ingested")
    return 0 if done else 1


if __name__ == "__main__":
    sys.exit(main())
