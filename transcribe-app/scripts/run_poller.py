"""Run the transcribe pipeline forever, every POLL_INTERVAL_SECONDS (default 300s / 5 min).

Each cycle does one `Pipeline.run()` — find new voicemails, transcribe + write them to the sheet —
then sleeps until the next cycle. Already-handled voicemails are skipped via the state file
(`.processed.json`, keyed by Message-ID + attachment name), so a voicemail is only EVER processed
once no matter how often the poller runs — no duplicate rows for the client.

A failing cycle is logged and the loop keeps going, so a transient IMAP/Gemini hiccup doesn't stop
the service. Run it under a process manager (systemd — see deploy/transcribe-poller.service, or
Docker) so it restarts on crash and comes back after a reboot.

    python scripts/run_poller.py
"""

from __future__ import annotations

import logging
import signal
import sys
import time
from types import FrameType

from transcribe_app.config import Config
from transcribe_app.pipeline import Pipeline
from transcribe_app.reporter import report_run

log = logging.getLogger(__name__)

# Never poll faster than this, whatever POLL_INTERVAL_SECONDS says — a floor so a misconfiguration
# can't hammer the mailbox / Gemini.
MIN_INTERVAL = 30.0

_stop = False


def _handle_signal(signum: int, _frame: FrameType | None) -> None:
    """Ask the loop to stop after the current cycle (systemd/Ctrl-C send SIGTERM/SIGINT)."""
    global _stop
    _stop = True
    log.info("received signal %d — stopping after this cycle", signum)


def _sleep(seconds: float) -> None:
    """Sleep in short slices so a stop signal is honored promptly."""
    slept = 0.0
    while not _stop and slept < seconds:
        step = min(2.0, seconds - slept)
        time.sleep(step)
        slept += step


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    signal.signal(signal.SIGINT, _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)

    cfg = Config.load()
    gaps = cfg.missing()
    if gaps:
        print("Missing required settings:")
        for g in gaps:
            print(f"  - {g}")
        print("Fill these in .env (see .env.example) and re-run.")
        return 1

    interval = max(MIN_INTERVAL, cfg.poll_interval_seconds)
    # Built once and reused across cycles: the Gemini/Sheets clients and the processed-state set are
    # kept warm, and dedup carries over between passes. reprocess defaults to False → already-seen
    # voicemails are skipped.
    pipeline = Pipeline(cfg)
    log.info(
        "transcribe poller started — every %.0fs; already-processed voicemails are skipped",
        interval,
    )

    while not _stop:
        try:
            summary = pipeline.run()
            log.info(
                "cycle done: %d processed, %d skipped, %d failed, across %d voicemail email(s)",
                summary.processed, summary.skipped, summary.failed, summary.voicemails,
            )
            # Report only cycles that actually did something — otherwise the poller would record a
            # ~288-rows/day stream of empty passes into the dashboard.
            if summary.processed or summary.failed:
                report_run(
                    cfg,
                    voicemails=summary.voicemails,
                    processed=summary.processed,
                    skipped=summary.skipped,
                    failed=summary.failed,
                )
        except Exception as exc:  # noqa: BLE001 — a bad cycle must not kill the poller
            log.warning("cycle error (continuing): %s", exc)

        _sleep(interval)

    log.info("transcribe poller stopped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
