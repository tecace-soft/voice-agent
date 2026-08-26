"""Check the Google Sheets connection (read-only — nothing is written).

    python scripts/checks/verify_sheets.py

Loads the service-account key, opens the sheet, prints its title, and confirms the tab named in
SHEET_RANGE exists. That covers the four things that usually block Sheets access: the credentials
file exists and is valid, the sheet has been shared with the service account's email as an Editor,
GOOGLE_SHEET_ID is right, and the tab is really called what SHEET_RANGE says.

The tab check earns its place: without it this script passed on a sheet whose tab didn't exist,
and the failure surfaced later as a cryptic "Unable to parse range: Voicemail2026!A1:A1" from the
first real run. A setup check that says ok and then lets the run fail is worse than no check.
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
    writer = SheetWriter(cfg)
    try:
        title = writer.check()
        tabs = writer.tabs()
    except Exception as exc:  # noqa: BLE001 — 403 usually means the sheet isn't shared with the SA
        print(f"sheets: FAIL — {exc}")
        print("(a 403 usually means the sheet isn't shared with the service account's email "
              "as an Editor.)")
        return 1

    want = writer.tab_name()
    if want not in tabs:
        print(f"sheets: FAIL — opened '{title}', but it has no tab named {want!r}.")
        print(f"  SHEET_RANGE = {cfg.sheet_range}")
        print("  tabs in this sheet: " + (", ".join(repr(t) for t in tabs) or "(none)"))
        near = [t for t in tabs if t.strip().lower() == want.strip().lower()]
        if near:
            print(f"  -> {near[0]!r} differs only by case or spacing. Match it exactly.")
        else:
            print("  -> rename the tab, or point SHEET_RANGE at one of the names above.")
        print("     A tab name with a space needs quotes: SHEET_RANGE='Voicemail 2026'!A1")
        return 1

    print(f"sheets: ok — opened '{title}', tab {want!r} exists. "
          f"Rows will append to {cfg.sheet_range}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
