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

import asyncio
import logging
import time
from dataclasses import dataclass
from urllib.parse import quote

import httpx

from ..config import Config

log = logging.getLogger(__name__)

# The lookup is one HTTPS round trip to the dashboard, and on an inbound call it happens while the
# caller listens to silence — nothing can be said until we know whose business this is. Two things
# keep it off the critical path:
#
#   * /incoming knows the dialled number a fraction of a second before the media stream connects,
#     and calls prefetch_business_config() there, so the answer is usually already in hand.
#   * the answer is cached briefly, so a second call to the same number skips the trip entirely.
#
# The TTL is short on purpose: a customer who edits their profile expects the next call to reflect
# it, and a minute of staleness is the most this may cost them. Only successful lookups are cached
# — caching "we could not tell" would turn one blip into a minute of neutral answering.
_CACHE_SECONDS = 60.0
_cache: dict[str, tuple[float, "BusinessConfig"]] = {}


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
    # What this customer wants the assistant called, and the exact line it opens with. Both empty
    # when they haven't chosen, which the prompt builder reads as "use the default".
    agent_name: str
    greeting: str
    # What this business wants put through to a person, beyond the standard appointment rules.
    transfer_topics: str


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

    cached = _cache.get(dialled)
    if cached and time.monotonic() - cached[0] < _CACHE_SECONDS:
        log.info("business config for %s served from the last %.0fs — no lookup", dialled, _CACHE_SECONDS)
        return cached[1]

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

    business = BusinessConfig(
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
        agent_name=str(biz.get("agentName") or ""),
        greeting=str(biz.get("greeting") or ""),
        transfer_topics=str(biz.get("transferTopics") or ""),
    )
    _cache[dialled] = (time.monotonic(), business)
    return business


def prefetch_business_config(cfg: Config, dialled: str) -> None:
    """Start the lookup for a number that is ringing right now, and don't wait for it.

    Called from the /incoming webhook, which knows the dialled number a moment before Twilio opens
    the media stream. By the time the bridge asks, the answer is normally cached and the caller's
    silence is that much shorter. Every failure mode is already "answer neutrally", so this is
    fire-and-forget: it never blocks the webhook and never fails it.
    """
    if not dialled or not cfg.business_config_url or not cfg.agent_config_key:
        return
    cached = _cache.get(dialled)
    if cached and time.monotonic() - cached[0] < _CACHE_SECONDS:
        return
    task = asyncio.create_task(fetch_business_config(cfg, dialled))
    # Held only so the task is not garbage-collected mid-flight; the result is read from the cache.
    _prefetching.add(task)
    task.add_done_callback(_prefetching.discard)


_prefetching: set[asyncio.Task] = set()


async def post_call_minutes(cfg: Config, seconds: int, agent_number: str = "") -> None:
    """Add one finished session's length to its business's call minutes for the month.

    Every session counts — inbound and outbound, with or without a transcript — because every one
    used the minutes. `agent_number` is the agent's own number on the call, and the dashboard works
    out whose business that is the same way the config lookup does; missing or unowned, the minutes
    go to its unassigned bucket. Best-effort and never raised: the call is already over.
    """
    if not cfg.business_config_url or not cfg.agent_config_key or seconds <= 0:
        return
    url = f"{cfg.business_config_url.rstrip('/')}/usage/minutes"
    # The backend refuses anything over a day, which would only ever be a bug.
    payload: dict = {"durationSeconds": min(seconds, 86400)}
    if agent_number:
        payload["agentNumber"] = agent_number
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(url, json=payload, headers={"x-agent-key": cfg.agent_config_key})
        if resp.status_code >= 300:
            log.warning("could not add the call to this month's minutes: HTTP %s", resp.status_code)
        else:
            log.info("added %ds to this month's call minutes for %s", seconds, agent_number or "an unknown number")
    except Exception as exc:  # noqa: BLE001 — the call is over; this must not surface anywhere
        log.warning("could not add the call to this month's minutes: %s", exc)


async def post_inbound_call(cfg: Config, payload: dict) -> None:
    """Send a finished call to the dashboard, so the customer can read it back.

    Best-effort and never raised: the call is already over and the caller already helped. Losing the
    record to a network blip is bad, but taking down the next call to complain about it is worse.

    Sent to the same service as the config lookup, with the same key — it is the same dashboard,
    and one credential per service is easier to reason about than one per endpoint.
    """
    if not cfg.business_config_url or not cfg.agent_config_key:
        return
    url = f"{cfg.business_config_url.rstrip('/')}/calls"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(url, json=payload, headers={"x-agent-key": cfg.agent_config_key})
        if resp.status_code >= 300:
            log.warning("could not record the call for the dashboard: HTTP %s", resp.status_code)
        else:
            log.info("recorded the call for %s", payload.get("dialled"))
    except Exception as exc:  # noqa: BLE001 — the call is over; this must not surface anywhere
        log.warning("could not record the call for the dashboard: %s", exc)
