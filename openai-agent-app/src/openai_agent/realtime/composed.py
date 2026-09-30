"""Run a call on the session the dashboard composed for this business.

`GET /business/config` sends `session` for every business with a structured profile: the voice and
backend prompts built by transcribe-backend's `composeSession(channel: "phone")` — the business's
Custom training prompts, knowledge, FAQs, house rules and PUBLISHED call settings, on the same rule
book its in-app test call uses. So what a business tests in the dashboard is what its callers get,
and editing the business in the dashboard changes the next call without a redeploy here.

Only three things are added on this side, because only the phone knows them:
  * "This call": caller ID, the opening line with the recording notice, and — on the leg a caller
    comes back to after a transfer nobody answered — what they already said;
  * which composed session to use: `returnLeg` on that return leg (nobody to reach), else the main one;
  * what a transfer scenario dials (`transfer_call`'s `scenario_id` -> its numbers).

A business without `session` (a profile saved before the structured editor) still gets the
hand-built prompt in instructions_inbound.py; the bridge decides which.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..config import Config
from ..tools.business_config import BusinessConfig
from .instructions_inbound import (
    _MESSAGE_IS_AN_ACTION,
    _TRANSFER_FAILED_RULE,
    RETURN_GREETING,
    _returning_context,
    _splice_notice,
    _spoken_caller,
)


@dataclass(frozen=True)
class ComposedCall:
    live: str
    backend: str
    tools: list[dict]
    opening: str
    voice: str
    # The first number of the first transfer scenario: what a transfer promised but never chosen
    # dials (the bridge's promise rescue), and "" when this leg can reach nobody.
    default_number: str


def opening_line(cfg: Config, business: BusinessConfig, *, returning: bool = False) -> str:
    """Exactly what the caller hears first. Shared with /incoming, which renders it ahead of time."""
    if returning:
        return RETURN_GREETING
    line = str((business.session or {}).get("greetingLine") or "").strip()
    return _splice_notice(line) if cfg.disclose_recording else line


def this_call_block(
    *, caller: str, opening: str, recording_disclosed: bool, returning: bool,
    caller_name: str = "", known_request: str = "",
) -> str:
    """The per-call facts the rule book calls "This call" — the phone's version of blocks.ts's."""
    lines = [
        "# This call",
        f"- The call came from: {_spoken_caller(caller)}.",
        "- You do NOT know this caller's name, why they're calling, or whether they've dealt with us "
        "before. Never assume, and never use a name they haven't given you.",
        f'- Your opening line: "{opening}"',
        "- You HAVE told the caller this call is recorded, in your opening line. If they ask, confirm "
        "it plainly."
        if recording_disclosed
        else "- You have NOT told the caller anything about recording. If they ask whether the call is "
        "recorded, say you are not sure and offer to have someone confirm.",
    ]
    text = "\n".join(lines)
    if returning:
        # The same recovery script the hand-built prompt uses, and the same "don't ask again".
        text += _TRANSFER_FAILED_RULE.format(message_is_an_action=_MESSAGE_IS_AN_ACTION)
        text += _returning_context(caller_name, known_request)
    return text


def composed_call(
    cfg: Config, business: BusinessConfig, *, caller: str, returning: bool,
    caller_name: str = "", known_request: str = "",
) -> ComposedCall:
    session = business.session or {}
    leg = (session.get("returnLeg") or {}) if returning else session
    opening = opening_line(cfg, business, returning=returning)
    block = this_call_block(
        caller=caller,
        opening=opening,
        recording_disclosed=cfg.disclose_recording and not returning,
        returning=returning,
        caller_name=caller_name,
        known_request=known_request,
    )
    return ComposedCall(
        live=f"{leg.get('live') or ''}\n\n{block}",
        backend=f"{leg.get('backend') or ''}\n\n{block}",
        tools=[t for t in (leg.get("tools") or []) if isinstance(t, dict)],
        opening=opening,
        voice=str(session.get("voice") or ""),
        default_number="" if returning else transfer_number(business, ""),
    )


def transfer_number(business: BusinessConfig, scenario_id: str) -> str:
    """The number `transfer_call` dials for a scenario; the first scenario's when the id is unknown.

    Only the first number is dialled: a warm or waterfall scenario is put through cold, to its first
    number, until the phone supports those (a conference with hold music and "press 1").
    """
    transfers = [t for t in (business.session or {}).get("transfers") or [] if isinstance(t, dict)]
    chosen = next((t for t in transfers if t.get("id") == scenario_id), transfers[0] if transfers else None)
    numbers = (chosen or {}).get("numbers") or []
    return str(numbers[0]) if numbers else ""
