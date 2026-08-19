"""Tie the steps together: read voicemail emails -> transcribe + extract each .wav (one Gemini
call) -> append a row to the sheet. One .wav is one Gemini call and one row.

Idempotency is a local JSON state file of processed keys (Message-ID + attachment name). We
never touch the mailbox, so re-running only ever processes voicemails we haven't seen before —
safe to run on a cron or by hand.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from .config import Config
from .tools import (
    EmailSource,
    Extractor,
    SheetWriter,
    VoicemailEmail,
    VoicemailInfo,
    AudioAttachment,
)

log = logging.getLogger(__name__)


@dataclass
class RunSummary:
    voicemails: int = 0  # messages with at least one .wav
    processed: int = 0  # attachments transcribed + uploaded this run
    skipped: int = 0  # attachments already in the state file
    failed: int = 0  # attachments that errored (left unprocessed for a retry)


class ProcessedStore:
    """A tiny persistent set of keys we've already handled. Loaded once, saved after each
    success so a crash mid-run doesn't reprocess what already reached the sheet."""

    def __init__(self, path: str) -> None:
        self._path = Path(path)
        self._keys: set[str] = set()
        if self._path.is_file():
            try:
                self._keys = set(json.loads(self._path.read_text(encoding="utf-8")))
            except Exception:  # noqa: BLE001 — a corrupt state file shouldn't block a run
                log.warning("could not read state file %s; starting fresh", self._path)

    def has(self, key: str) -> bool:
        return key in self._keys

    def add(self, key: str) -> None:
        self._keys.add(key)
        self._path.write_text(json.dumps(sorted(self._keys), indent=0), encoding="utf-8")


def _key(vm: VoicemailEmail, att: AudioAttachment) -> str:
    return f"{vm.message_id}::{att.filename}"


def build_row(vm: VoicemailEmail, att: AudioAttachment, info: VoicemailInfo) -> list[str]:
    """One spreadsheet row — column order must match sheets.HEADER."""
    return [
        datetime.now(timezone.utc).isoformat(timespec="seconds"),
        vm.from_addr,
        info.caller_name or "",
        info.phone_number or "",
        info.email or "",
        info.requested_time or "",
        "yes" if info.callback_requested else "no",
        info.summary,
        info.transcript,
        att.filename,
    ]


class Pipeline:
    def __init__(self, cfg: Config) -> None:
        self._cfg = cfg
        self._source = EmailSource(cfg)
        self._extractor = Extractor(cfg)
        self._sheet = SheetWriter(cfg)
        self._store = ProcessedStore(cfg.state_file)

    def run(self) -> RunSummary:
        summary = RunSummary()
        voicemails = self._source.fetch_voicemails()
        summary.voicemails = len(voicemails)
        for vm in voicemails:
            for att in vm.attachments:
                key = _key(vm, att)
                if self._store.has(key):
                    summary.skipped += 1
                    continue
                try:
                    self._handle(vm, att)
                except Exception as exc:  # noqa: BLE001 — one bad file shouldn't stop the batch
                    summary.failed += 1
                    log.error("failed on %s from %s: %s", att.filename, vm.from_addr, exc)
                    continue
                self._store.add(key)  # only mark done after the row is safely in the sheet
                summary.processed += 1
        return summary

    def _handle(self, vm: VoicemailEmail, att: AudioAttachment) -> None:
        info = self._extractor.extract(att)  # transcribe + extract in one Gemini call
        self._sheet.append_row(build_row(vm, att, info))
        log.info("uploaded voicemail from %s (%s)", info.caller_name or vm.from_addr, att.filename)
