"""Whose business is this call for? Ask the dashboard, keyed by the number that was dialled.

One agent answers for several customers. Twilio tells us which of our numbers rang (`To`), and the
dashboard says who that number belongs to — so the same process can speak for a different company
on the next call without a redeploy.

NOTE this is a DIFFERENT backend from `BACKEND_URL`. That one is backend-app, which serves the
agent's booking tools; this is transcribe-backend, where the dashboard's accounts live. Two URLs,
two keys, on purpose: they are separate services and a credential for one should not open the other.

WHEN IN DOUBT, SAY NOTHING. A lookup that fails — backend down, key wrong, number unassigned —
returns None, and the caller gets the neutral prompt: a polite assistant that takes a message and
never claims to be any particular company. The alternative, falling back to whatever is in .env,
means reading one customer's facts to another customer's caller, which is worse than being vague
and is exactly what this whole mechanism exists to prevent.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from urllib.parse import quote

import httpx

from ..config import Config

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class BusinessConfig:
    """Whose business a dialled number is, and what may be said about it.

    Only ever built when the backend says `assigned: true`, which it only does when there is a live
    profile behind the number. Fields the customer didn't give us stay None and are NEVER filled in
    from this app's .env — substituting one company's hours for another's is the leak the whole
    mechanism exists to prevent, and it would happen precisely where nobody is watching.
    """

    to: str
    user_id: str
    user_email: str
    user_name: str
    business_name: str
    hours_text: str
    open_hour: int | None
    close_hour: int | None
    website: str
    facts: str
    # Where "put me through to a person" goes for THIS customer. Empty means they have nobody to
    # transfer to, and the agent must not offer it — see the bridge.
    transfer_number: str


async def fetch_business_config(cfg: Config, dialled: str) -> BusinessConfig | None:
    """Look up the owner of the number that was dialled, or None if there isn't one.

    None covers every "we don't know" case deliberately: unconfigured, unreachable, unauthorised,
    unknown number, unassigned number. The caller can't act differently on any of them — in all of
    them there is no business to speak for — so collapsing them keeps the decision at the call site
    binary instead of a ladder of half-measures.
    """
    if not cfg.business_config_url or not cfg.agent_config_key:
        log.debug("business config not configured; answering neutrally")
        return None
    if not dialled:
        log.warning("no dialled number on this call — answering neutrally")
        return None

    url = f"{cfg.business_config_url.rstrip('/')}/business/config?to={quote(dialled)}"
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(url, headers={"x-agent-key": cfg.agent_config_key})
        if resp.status_code != 200:
            log.warning(
                "business config lookup for %s returned %s — answering neutrally",
                dialled, resp.status_code,
            )
            return None
        data = resp.json()
    except Exception as exc:  # noqa: BLE001 — a monitor outage must not take the phone line down
        log.warning("business config lookup for %s failed (%s) — answering neutrally", dialled, exc)
        return None

    if not data.get("assigned"):
        # A registered-but-unassigned number, or one we've never seen. Loud, because it means a
        # real caller just reached a line nobody owns and an admin needs to assign it.
        log.warning(
            "number %s is not assigned to anyone — answering neutrally. "
            "Assign it under Agent numbers in the dashboard.",
            data.get("to") or dialled,
        )
        return None

    user = data.get("user") or {}
    biz = data.get("business") or {}
    name = str(biz.get("name") or "")
    log.info(
        "call to %s is for %r (%s <%s>)",
        data.get("to"), name, user.get("name"), user.get("email"),
    )

    def _hour(value: object) -> int | None:
        return value if isinstance(value, int) and 0 <= value <= 23 else None

    return BusinessConfig(
        to=str(data.get("to") or dialled),
        user_id=str(user.get("id") or ""),
        user_email=str(user.get("email") or ""),
        user_name=str(user.get("name") or ""),
        business_name=name,
        # "" rather than None for the strings the prompt interpolates, so a missing value renders as
        # nothing rather than the word "None" being read aloud to a caller.
        hours_text=str(biz.get("hoursText") or ""),
        open_hour=_hour(biz.get("openHour")),
        close_hour=_hour(biz.get("closeHour")),
        website=str(biz.get("website") or ""),
        facts=str(biz.get("facts") or ""),
        transfer_number=str(biz.get("transferNumber") or ""),
    )
