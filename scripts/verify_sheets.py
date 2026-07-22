"""Verify Google Sheets service-account access — including WRITE permission.

    python scripts/verify_sheets.py

Reads the sheet, then appends a probe row and deletes it, so it confirms the
service account can actually append tracking rows (Editor access), not just read.
If it fails with 403 on write, grant the service account Editor access.
"""

from __future__ import annotations

import re
import sys

from voice_agent.config import Config, ConfigError
from voice_agent.tools.sheets import SheetsClient, SheetsError

TAB = "Sheet1"


def main() -> int:
    try:
        cfg = Config.load()
    except ConfigError as exc:
        print(f"config: FAIL — {exc}")
        return 1

    print(f"service account: {cfg.google_api_email}")
    print(f"sheet id       : {cfg.google_sheets_id}")

    client = SheetsClient(cfg)
    try:
        print(f"auth : ok — token acquired")
        print(f"read : ok — title {client.title()!r}")
    except SheetsError as exc:
        print(f"read : FAIL — {exc}")
        return 1

    # Write probe: append a sentinel row, then remove it.
    try:
        resp = client.append_row(["__voice_agent_probe__"], tab=TAB)
    except SheetsError as exc:
        print(f"write: FAIL — {exc}")
        print(f"\n>>> Grant EDIT access: share the sheet with {cfg.google_api_email} as Editor")
        print("    (or set link sharing to 'Anyone with the link — Editor').")
        return 1

    updated = resp.get("updates", {}).get("updatedRange", "")
    try:
        row = int(re.search(r"!\D*(\d+)", updated).group(1))
        client.delete_row(row, tab=TAB)
        print(f"write: ok — appended a probe row and removed it (cleaned up {updated})")
    except (SheetsError, AttributeError) as exc:
        print(f"write: ok — appended, but could not auto-remove the probe row ({exc}). Delete it manually.")

    print("\nGoogle Sheets is reachable AND writable — tracking will work.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
