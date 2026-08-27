"""Run the pipeline against a SCRATCH Google Sheet, without touching the client's setup.

    python scripts/run_test.py --dry-run   # show what it would use; no mail, no Gemini calls
    python scripts/run_test.py             # one real pass into the test sheet

Every pass re-transcribes every voicemail in the window, so each run costs a Gemini call per
voicemail and appends a fresh set of rows. Keep IMAP_SINCE_DAYS small in `.env.test`.

The poller is live for a client now, so changes have to be provable before they're deployed. This
runs the same `Pipeline` the poller runs — same IMAP fetch, same Gemini call, same row builder — but
redirected at a sheet of your own, so you can look at real output without writing into the client's
spreadsheet or disturbing what their poller has already done.

Settings come from `.env` with `.env.test` layered on top, so `.env.test` only holds what differs —
your mailbox and your sheet. See `.env.test.example`.

FOUR THINGS ARE ISOLATED, and most of them are not obvious:

  1. The mailbox. Refuses to start if it's the client's, because their voicemails are real callers:
     running against them copies those people's names, numbers and transcripts into your test sheet.
     `--client-mailbox` overrides it for reproducing a bug against real audio. Reading is otherwise
     harmless — `EmailSource` selects readonly=True, so no flags, no deletions, and the poller sees
     the mailbox exactly as it was.

  2. The sheet. Refuses to start if the test sheet id equals the one in `.env`.

  3. The state file — `.processed.test.json`, never the poller's. This is the sharp edge: the
     production state file is how the poller remembers what it has already transcribed. A test run
     sharing it would mark the client's voicemails as done, and their poller would then skip them
     forever. Those voicemails would never reach their sheet and nothing would look broken.

     Test runs ALWAYS re-transcribe everything they find — there is no flag to turn that off. A
     test that skipped work because a previous test had done it would be testing the state file
     rather than the change you just made. The file still gets written; nothing ever reads it.

  4. Dashboard reporting, off unless you pass --report. Otherwise test passes would land in the
     client's Transcriptions tab as their own traffic.

SEEDING THE TEST MAILBOX

The pipeline only requires that a message carries an audio attachment — the sender and subject are
irrelevant once VOICEMAIL_FROM / VOICEMAIL_SUBJECT are cleared. Options, best first:

  1. Add the test address as a SECOND destination on the client's voicemail-to-email, so real
     voicemails arrive in both mailboxes independently. Nothing is forwarded, so the message is
     byte-identical to what production sees, including its Date header. Best fidelity.

  2. Forward a real voicemail email to the test address. Use a PLAIN forward, not "forward as
     attachment": a plain forward keeps the original audio as an attachment, while forward-as-
     attachment nests the whole message and stamps a new Date, which becomes the sheet's Received
     time. Note this puts a real caller's details in your test sheet.

  3. Email yourself any .wav. Exercises the whole path end to end and involves nobody's data. The
     transcript will be whatever you recorded, so it proves the plumbing rather than the output.

  4. `scripts/ingest_file.py <file.wav>` — skips IMAP entirely. Use when the mail side is already
     proven and you only want to re-check extraction or the sheet columns.
"""

from __future__ import annotations

import argparse
import dataclasses
import logging
import sys
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from transcribe_app.config import Config  # noqa: E402 — importing loads .env
from transcribe_app.pipeline import Pipeline  # noqa: E402
from transcribe_app.reporter import report_run  # noqa: E402
from transcribe_app.tools import EmailSource, SheetWriter  # noqa: E402

ENV_TEST = ROOT / ".env.test"
TEST_STATE = ROOT / ".processed.test.json"


def _load_test_config() -> tuple[Config, Config]:
    """(production config, test config). Production is read FIRST, before .env.test overrides it,
    because the guards below need to compare the two."""
    production = Config.load()
    load_dotenv(ENV_TEST, override=True)
    return production, Config.load()


def diagnose_empty(cfg: Config) -> None:
    """Say why a pass found nothing, instead of leaving "0 voicemails" to be interpreted.

    Three causes look identical from the outside — the filters excluded everything, the date window
    was too narrow, or the mailbox genuinely holds no audio. Re-running the search with the filters
    off and the window wide tells them apart, which is worth one extra IMAP round trip on what is
    already a failed run.
    """
    print()
    print("Nothing was found. Working out why:")
    print(f"  mailbox        : {cfg.imap_username} / {cfg.imap_mailbox}")
    print(f"  window         : last {cfg.imap_since_days} day(s)")
    print(f"  VOICEMAIL_FROM : {cfg.voicemail_from or '(empty - not filtering)'}")
    print(f"  VOICEMAIL_SUBJ : {cfg.voicemail_subject or '(empty - not filtering)'}")

    wide = dataclasses.replace(cfg, voicemail_from="", voicemail_subject="", imap_since_days=60)
    try:
        found = EmailSource(wide).fetch_voicemails()
    except Exception as exc:  # noqa: BLE001 — this is already the failure path
        print()
        print(f"  (couldn't re-check with the filters off: {exc})")
        return

    print()
    if found:
        print(f"  -> With no filters and a 60-day window there ARE {len(found)} message(s) with")
        print("     audio. The mail is there; something above is excluding it.")
        if cfg.voicemail_from or cfg.voicemail_subject:
            print("     Clear VOICEMAIL_FROM / VOICEMAIL_SUBJECT in .env.test — those are the")
            print("     client's filters, inherited from .env, and they don't match your mailbox.")
        else:
            print(f"     Raise IMAP_SINCE_DAYS in .env.test (currently {cfg.imap_since_days}).")
        for vm in found[:3]:
            print(f"       - {vm.from_addr}: {vm.subject or '(no subject)'} [{vm.date}]")
        return

    print("  -> Even with no filters and a 60-day window, no message in this mailbox carries an")
    print("     audio attachment. The mailbox is the problem, not the settings — put a voicemail")
    print("     in it (see 'Seeding the test mailbox' in this script's docstring).")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Run the pipeline against a scratch sheet, isolated from the client's setup.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the resolved settings, confirm the test sheet opens, then stop. No mailbox is "
        "read and no Gemini calls are made.",
    )
    parser.add_argument(
        "--report",
        action="store_true",
        help="Also report this run to the dashboard. Off by default so test passes don't show up "
        "as the client's traffic.",
    )
    parser.add_argument(
        "--client-mailbox",
        action="store_true",
        help="Allow reading the CLIENT's mailbox instead of your test one. Reading is harmless to "
        "them (we open it read-only), but their callers' names, numbers and transcripts then land "
        "in your test sheet — so this is opt-in, for reproducing a bug against real audio.",
    )
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    if not ENV_TEST.is_file():
        print(f"No {ENV_TEST.name} found at {ENV_TEST}.")
        print("Copy .env.test.example to .env.test and put your own sheet id in it.")
        print("Only the settings that DIFFER from .env belong there.")
        return 2

    production, cfg = _load_test_config()

    # --- Guard 1: a test sheet that isn't the client's ------------------------------------------
    if not cfg.google_sheet_id:
        print("GOOGLE_SHEET_ID is not set. Put your own sheet's id in .env.test.")
        return 1
    if cfg.google_sheet_id == production.google_sheet_id:
        print("REFUSING TO RUN — .env.test points at the same sheet as .env:")
        print(f"  {cfg.google_sheet_id}")
        print("That is the client's spreadsheet. Create your own and put its id in .env.test.")
        return 1

    # --- Guard 2: a test mailbox that isn't the client's ----------------------------------------
    # Reading theirs is technically safe (read-only, no flags touched), but every voicemail it finds
    # is a real caller whose name, number and transcript would be copied into your test sheet. That
    # is the client's callers' data sitting somewhere it was never meant to be, so it takes a flag.
    using_client_mailbox = cfg.imap_username == production.imap_username
    if using_client_mailbox and not args.client_mailbox:
        print("REFUSING TO RUN — .env.test uses the same mailbox as .env:")
        print(f"  {cfg.imap_username}")
        print("Those are the client's callers. Their names, numbers and transcripts would be")
        print("copied into your test sheet.")
        print()
        print("Set IMAP_USERNAME / IMAP_PASSWORD in .env.test to a mailbox of your own, and")
        print("clear VOICEMAIL_FROM / VOICEMAIL_SUBJECT there (see .env.test.example) — the")
        print("client's filters won't match anything in your mailbox.")
        print()
        print("To read theirs anyway — reproducing a bug against real audio — pass --client-mailbox.")
        return 1

    # --- Guard 3: never share the poller's memory of what's done --------------------------------
    state_file = cfg.state_file
    if Path(state_file) == Path(production.state_file):
        state_file = str(TEST_STATE)

    # --- Guard 4: keep test passes out of the client's dashboard --------------------------------
    cfg = dataclasses.replace(
        cfg,
        state_file=state_file,
        backend_url=cfg.backend_url if args.report else "",
    )

    gaps = cfg.missing()
    if gaps:
        print("Missing required settings:")
        for g in gaps:
            print(f"  - {g}")
        return 1

    filters = ", ".join(
        f for f in (cfg.voicemail_from, cfg.voicemail_subject) if f
    ) or "none (every message with audio)"

    print("Test run — isolated from the client's setup")
    print(f"  mailbox     : {cfg.imap_username} (read-only, {cfg.imap_since_days}d window)")
    print(f"  filters     : {filters}")
    print(f"  sheet       : {cfg.google_sheet_id}")
    print(f"  range       : {cfg.sheet_range}")
    print(f"  state file  : {cfg.state_file} (written, never read)")
    print(f"  reporting   : {'ON — ' + cfg.backend_url if cfg.backend_url else 'off'}")
    print("  re-process  : ALWAYS - every voicemail in the window, every pass")
    print("  client's    : "
          f"mailbox {production.imap_username or '(unset)'} · "
          f"sheet {production.google_sheet_id or '(unset)'}")
    if using_client_mailbox:
        print()
        print("  !! --client-mailbox: reading the CLIENT's mailbox. Real callers' details will be")
        print("     written into the test sheet above. Delete those rows when you're done.")
    print()

    # Confirm the tab exists before spending a single Gemini call. The pipeline only touches the
    # sheet AFTER transcribing, so without this a wrong SHEET_RANGE burns the whole batch first and
    # then fails — which is exactly how this went wrong in production.
    try:
        writer = SheetWriter(cfg)
        title, tabs = writer.check(), writer.tabs()
    except Exception as exc:  # noqa: BLE001 — a 403 here means the sheet isn't shared with the SA
        print(f"sheet: FAIL — {exc}")
        print("(a 403 usually means the test sheet isn't shared with the service account's email "
              "as an Editor — the same step the client's sheet needed.)")
        return 1

    want = writer.tab_name()
    if want not in tabs:
        print(f"sheet: FAIL — opened '{title}', but it has no tab named {want!r}.")
        print("  tabs in this sheet: " + (", ".join(repr(t) for t in tabs) or "(none)"))
        return 1
    print(f"sheet: ok — '{title}', tab {want!r}\n")

    if args.dry_run:
        print("--dry-run: stopping here. No voicemails fetched, nothing transcribed or written.")
        return 0

    summary = Pipeline(cfg, reprocess=True).run()
    print(
        f"\nDone: {summary.processed} written, {summary.skipped} skipped, {summary.failed} failed, "
        f"across {summary.voicemails} voicemail email(s)."
    )
    if summary.voicemails == 0:
        diagnose_empty(cfg)
    else:
        print(f"Check the rows: https://docs.google.com/spreadsheets/d/{cfg.google_sheet_id}/edit")

    if args.report:
        report_run(
            cfg,
            voicemails=summary.voicemails,
            processed=summary.processed,
            skipped=summary.skipped,
            failed=summary.failed,
        )

    return 1 if summary.failed else 0


if __name__ == "__main__":
    sys.exit(main())
