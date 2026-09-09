"""Write the messages the voice agent took into the TEST spreadsheet, continuously.

A caller who asked for an appointment and could not be put through to a person leaves the assistant
with the same thing a voicemail leaves: a name, a number, and something that needs doing. Those
rows belong in the same sheet, in the same columns, so the front desk works one list.

    python scripts/write_agent_messages.py                # one pass, then exit
    python scripts/write_agent_messages.py --watch        # run forever, checking every 30s
    python scripts/write_agent_messages.py --dry-run      # show the rows, write nothing

WHERE IT WRITES, AND WHY IT CANNOT BE THE CLIENT'S SHEET.

Every setting that decides WHERE data goes must be present in `.env.test` itself. It is not layered
on top of `.env` the way run_test.py does it — a missing key there would silently inherit the
client's value, which is exactly the bleed this script must not have. If one of those keys is
absent from `.env.test`, this refuses to start rather than falling back to something that works.

`.env` is still read, but ONLY as a blocklist: to know which sheet id and which backend must be
refused. No value from it is ever used to do work. Everything else — the Google credentials above
all — is shared on purpose: it is the same service account either way, and duplicating a file path
would add ceremony without adding safety. The run prints where each setting came from, so this is
checkable rather than merely claimed.

ORDERING. A row is written first and marked written second. If the mark fails, the row exists and
the next pass writes a duplicate someone can delete; the opposite order would lose a caller nobody
rings back. That is not a close call.
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
import time
from pathlib import Path

from dotenv import dotenv_values, load_dotenv

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from transcribe_app import agent_messages  # noqa: E402
from transcribe_app.config import Config  # noqa: E402 — importing loads .env
from transcribe_app.tools.sheets import SheetWriter  # noqa: E402

ENV_LIVE = ROOT / ".env"
ENV_TEST = ROOT / ".env.test"

log = logging.getLogger("write-agent-messages")

# The settings that decide WHERE data lands. Each must be set in .env.test, by .env.test.
DESTINATION_KEYS = ("GOOGLE_SHEET_ID", "SHEET_RANGE", "BACKEND_URL", "AGENT_CONFIG_KEY")


def _load_isolated_config() -> tuple[Config, list[str]]:
    """Build the config with `.env.test` authoritative for every destination setting.

    Returns (config, problems). A non-empty `problems` means do not run: either a destination key
    is missing from `.env.test`, or it matches the live value and would send a caller's details to
    the client's spreadsheet.
    """
    test = dotenv_values(ENV_TEST) if ENV_TEST.exists() else {}
    problems: list[str] = []

    # Without .env there is nothing to compare against, and the "is this the client's sheet?" check
    # below would quietly pass everything. A safety check that stops checking without saying so is
    # worse than not having one, so this is a refusal rather than a warning. In a container, mount
    # .env read-only alongside .env.test — it is never used to do work, only to be refused.
    if not ENV_LIVE.exists():
        problems.append(
            f".env is not present at {ENV_LIVE}, so there is no live configuration to check "
            f"against. Mount it read-only; it is read ONLY to know which values to refuse."
        )
        return Config.load(), problems

    live = dotenv_values(ENV_LIVE)

    for key in DESTINATION_KEYS:
        value = (test.get(key) or "").strip()
        if not value:
            problems.append(
                f"{key} is not set in .env.test. It must be set THERE — inheriting it from .env "
                f"is how a test run reaches the client's data."
            )
            # Remove it outright so nothing downstream can quietly pick up the live value.
            os.environ.pop(key, None)
            continue
        if value == (live.get(key) or "").strip():
            problems.append(
                f"{key} in .env.test is identical to the one in .env:\n"
                f"      {value}\n"
                f"      That is the live value. Give the test run its own."
            )
        # .env.test wins, explicitly — not by override ordering that a missing key can defeat.
        os.environ[key] = value

    # Everything else (credentials, timezone) may come from .env; see the module docstring.
    load_dotenv(ENV_TEST, override=True)
    return Config.load(), problems


def _run_once(cfg: Config, *, dry_run: bool) -> tuple[int, int]:
    """One pass. Returns (written, failed). Never raises — a bad pass must not end the service."""
    try:
        pending = agent_messages.fetch_pending(cfg)
    except Exception as exc:  # noqa: BLE001 — the next pass will try again
        log.warning("could not fetch messages: %s", exc)
        return 0, 0
    if not pending:
        return 0, 0

    log.info("%d message(s) waiting", len(pending))
    writer = None if dry_run else SheetWriter(cfg)
    written = failed = 0

    for msg in pending:
        row = agent_messages.build_row(msg, cfg.timezone)
        who = msg.caller_name or "(no name)"
        if dry_run:
            log.info("would write: %s | %s | %s | %s", row[0], who, msg.phone, msg.summary)
            continue
        try:
            writer.append_row(row)
        except Exception as exc:  # noqa: BLE001 — one bad row must not strand the others
            failed += 1
            log.warning("failed to write the row for %s: %s", who, exc)
            continue
        # Written first, marked second — see the module docstring on which way to fail.
        agent_messages.mark_written(cfg, msg.id)
        written += 1
        log.info("wrote: %s | %s | %s", row[0], who, msg.phone)

    return written, failed


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Write the voice agent's taken messages into the test sheet.",
    )
    parser.add_argument(
        "--watch",
        action="store_true",
        help="Keep running, checking for new messages on an interval. This is how it runs "
        "alongside a live agent.",
    )
    parser.add_argument(
        "--interval", type=int, default=30,
        help="Seconds between checks in --watch mode (default 30).",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Print the rows that would be written and stop. Nothing is written and nothing is "
        "marked, so a dry run can be repeated.",
    )
    args = parser.parse_args()
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s",
    )

    if not ENV_TEST.exists():
        log.error("No .env.test found at %s", ENV_TEST)
        log.error("Copy .env.test.example to .env.test and give it its own sheet id.")
        return 1

    cfg, problems = _load_isolated_config()
    if problems:
        log.error("REFUSING TO RUN — the test configuration is not isolated:")
        for problem in problems:
            log.error("  - %s", problem)
        return 1

    log.info("sheet   : %s (%s) — from .env.test", cfg.google_sheet_id, cfg.sheet_range)
    log.info("backend : %s — from .env.test", cfg.backend_url)
    log.info("timezone: %s", cfg.timezone)
    if args.dry_run:
        log.info("dry run — nothing will be written")

    if not args.watch:
        written, failed = _run_once(cfg, dry_run=args.dry_run)
        if not written and not failed:
            log.info("no messages waiting")
        return 1 if failed else 0

    log.info("watching for new messages every %ds — ctrl-c to stop", args.interval)
    try:
        while True:
            _run_once(cfg, dry_run=args.dry_run)
            time.sleep(args.interval)
    except KeyboardInterrupt:
        log.info("stopped")
        return 0


if __name__ == "__main__":
    sys.exit(main())
