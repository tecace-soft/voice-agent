"""Check the Google Sheets connection (read-only — nothing is written).

    python scripts/checks/verify_sheets.py

Loads the service-account key, opens the sheet, and prints its title. This confirms the three
things that usually block Sheets access: the credentials file exists and is valid, the sheet
has been shared with the service account's email as an Editor, and GOOGLE_SHEET_ID is right.
"""

from __future__ import annotations

import sys
from pathlib import Path

from transcribe_app.config import Config
from transcribe_app.tools import SheetWriter


def main() -> int:
    cfg = Config.load()
    if not cfg.google_sheet_id:
        print("sheets: not configured — set GOOGLE_SHEET_ID in .env.")
        return 1
    has_key = (
        (cfg.google_private_key and cfg.google_client_email)
        or cfg.google_credentials_json
        or Path(cfg.google_credentials_file).is_file()
    )
    if not has_key:
        print("sheets: FAIL — no service-account key. Set GOOGLE_PRIVATE_KEY + "
              "GOOGLE_CLIENT_EMAIL, or GOOGLE_CREDENTIALS_JSON, or a key file at "
              f"{cfg.google_credentials_file}.")
        return 1
    print(f"opening sheet {cfg.google_sheet_id} ...")
    try:
        title = SheetWriter(cfg).check()
    except Exception as exc:  # noqa: BLE001 — 403 usually means the sheet isn't shared with the SA
        print(f"sheets: FAIL — {exc}")
        print("(a 403 usually means the sheet isn't shared with the service account's email "
              "as an Editor.)")
        return 1
    print(f"sheets: ok — opened '{title}'. Rows will append to {cfg.sheet_range}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
