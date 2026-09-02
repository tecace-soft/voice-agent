"""Best-effort reporting of a run's summary to the backend for the dashboard's Transcriptions tab.

Uses the standard library (urllib) so there's no new dependency. Any failure here is logged and
swallowed — reporting metrics must never affect the actual voicemail run.
"""

from __future__ import annotations

import json
import socket
import logging
import urllib.request

from .config import Config

log = logging.getLogger(__name__)

# None = not tried yet, True = last beat landed, False = last beat failed (already warned).
_heartbeat_ok: bool | None = None


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


def send_heartbeat(cfg: Config, *, ok: bool, detail: str = "") -> None:
    """Tell the backend this poller is alive, whatever the cycle did.

    Sent EVERY cycle, including empty ones and ones that errored — the point is proof of life, and a
    poller with nothing to report is otherwise indistinguishable from a poller that has died. That
    is the opposite of report_run, which deliberately skips quiet cycles so the dashboard isn't
    buried in "nothing happened" rows.

    The poll interval travels with it so the backend can decide what "late" means from what this
    poller actually does, rather than from a constant that drifts the moment anyone retunes it.

    Best-effort and silent on failure: an unreachable backend must never take down transcription,
    and a warning every 5 minutes would train everyone to ignore the log.
    """
    if not cfg.backend_url:
        return
    url = cfg.backend_url.rstrip("/") + "/transcribe/heartbeat"
    payload = {
        "intervalSeconds": int(cfg.poll_interval_seconds),
        "lastCycleOk": ok,
        "detail": detail[:500],
        "host": socket.gethostname()[:200],
    }
    mailbox = cfg.mailbox_email()
    if mailbox:
        payload["mailboxEmail"] = mailbox
    req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), method="POST")
    req.add_header("Content-Type", "application/json")
    if cfg.transcribe_ingest_key:
        req.add_header("x-transcribe-key", cfg.transcribe_ingest_key)
    global _heartbeat_ok
    try:
        with urllib.request.urlopen(req, timeout=cfg.request_timeout) as resp:
            resp.read()
        if not _heartbeat_ok:
            log.info("heartbeat delivered to %s", url)
            _heartbeat_ok = True
    except Exception as exc:  # noqa: BLE001 — never let the monitor break the thing it monitors
        # Loud ONCE, then silent until it recovers. Swallowing this entirely (it was at debug) made
        # a mis-set BACKEND_URL indistinguishable from a working one: the dashboard just stayed
        # grey with nothing in the log to explain it. Repeating it every cycle would be its own
        # kind of useless — 288 identical warnings a day is noise nobody reads.
        if _heartbeat_ok is not False:
            log.warning(
                "heartbeat NOT delivered to %s: %s — the dashboard's poller status will stay grey. "
                "Check BACKEND_URL and TRANSCRIBE_INGEST_KEY, and that the backend is deployed.",
                url, exc,
            )
            _heartbeat_ok = False
