"""Post-call summary written by the Hermes agent (off the critical path).

After a call ends, we ask the self-hosted Hermes agent for a short, human-readable
note about the call and write it to the tracking sheet. The caller has already
hung up, so Hermes's latency doesn't affect the conversation — this is the one
place the agent earns its keep. Any failure degrades to "" (no note written).
"""

from __future__ import annotations

import logging

from ..config import Config
from ..tools.hermes import HermesChat, HermesSession

log = logging.getLogger(__name__)


def summarize_call(
    cfg: Config,
    record: dict[str, str],
    *,
    booked_at: str = "",
    callback_at: str = "",
    transcript: str = "",
) -> str:
    """One- or two-sentence summary of the call for the tracking sheet ("" on failure)."""
    if booked_at:
        outcome = f"booked an appointment for {booked_at}"
    elif callback_at:
        outcome = f"asked to be called back at {callback_at}"
    else:
        outcome = "did not finish scheduling"
    details = ", ".join(f"{k}: {v}" for k, v in record.items() if v)

    prompt = (
        "You are logging notes after a phone call where a lead was called back to book "
        "a consultation. In ONE to THREE short sentences for the consultant, summarize: "
        "who it was, what they're interested in, the outcome, and — importantly — any "
        "questions or topics they raised that the consultant should follow up on "
        "(pricing, contract, technical details, a request for a human, etc.). If there "
        "are none, don't mention it. Plain text only; do not use any tools or write files.\n\n"
        f"Caller details: {details}\n"
        f"Outcome: the caller {outcome}.\n"
    )
    if transcript:
        prompt += f"\nTranscript:\n{transcript}\n"

    try:
        reply = HermesChat(HermesSession(cfg)).ask(prompt, timeout=30).strip()
        if reply and "error" not in reply.lower():
            return reply
        log.warning("Hermes summary looked unusable (%r)", reply[:80])
    except Exception as exc:  # noqa: BLE001 — off critical path; never raise
        log.warning("Hermes summary failed (%s)", exc)
    return ""
