"""Best-effort reporting of a run's summary to the backend for the dashboard's Transcriptions tab.

Uses the standard library (urllib) so there's no new dependency. Any failure here is logged and
swallowed — reporting metrics must never affect the actual voicemail run.
"""

from __future__ import annotations

import json
import logging
import urllib.request

from .config import Config

log = logging.getLogger(__name__)


def report_run(
    cfg: Config,
    *,
    voicemails: int,
    processed: int,
    skipped: int,
    failed: int,
    failures: list | None = None,
) -> None:
    """POST the run counts to <BACKEND_URL>/transcribe/runs, if BACKEND_URL is configured.

    The mailbox we fetched from travels with the counts: the dashboard attributes voicemail data to
    that address, and shows a person only the mailbox matching their own account email.
    """
    if not cfg.backend_url:
        return
    url = cfg.backend_url.rstrip("/") + "/transcribe/runs"
    payload = {
        "voicemails": voicemails,
        "processed": processed,
        "skipped": skipped,
        "failed": failed,
    }
    # Sent only when there are any, so a healthy run's payload is unchanged and an older backend
    # that doesn't know the field still accepts every normal report.
    if failures:
        payload["failures"] = [
            {"filename": f.filename, "fromAddr": f.fromAddr, "error": f.error} for f in failures
        ]
    mailbox = cfg.mailbox_email()
    if mailbox:
        payload["mailboxEmail"] = mailbox
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Content-Type", "application/json")
    if cfg.transcribe_ingest_key:
        req.add_header("x-transcribe-key", cfg.transcribe_ingest_key)
    try:
        with urllib.request.urlopen(req, timeout=cfg.request_timeout) as resp:
            resp.read()
        log.info("reported run to backend: %d processed, %d failed", processed, failed)
    except Exception as exc:  # noqa: BLE001 — reporting is best-effort; never fail the run
        log.warning("could not report run to backend: %s", exc)
