"""The poller's notification endpoint — how the backend says "there is work now".

Why this lives in the POLLER container and not the media-stream server. The server process relays
live call audio on an asyncio event loop; `place_call` uses the blocking Twilio SDK, so dialing
work on that loop would stall every in-progress call's audio. The two workloads are already
isolated into separate containers, and this keeps them that way: notifications arrive here, the
poll loop dials, and nothing about it can touch a live call.

What it replaces. The poller used to ask the backend "anything new?" on a fixed drumbeat, which
woke the Neon compute every cycle forever — 24 hours of billed compute a day to run a handful of
trivial SELECTs. Now the backend, which already had to touch the database to insert the lead,
tells us on the way past. The notification rides on a wake that had to happen anyway, so an idle
night costs nothing.

The periodic poll is NOT removed, only slowed. A notification can be lost — this container
restarting, a deploy, a network blip — and a lead that nobody ever calls is a much worse failure
than a slightly stale one. The safety interval is the backstop that makes losing one survivable.

    POST /poller/lead-due
    x-agent-secret: <AGENT_TOOLS_SECRET>
    {"intakeId": "...", "notBefore": "2026-09-01T18:30:00Z"}   # notBefore optional

`notBefore` in the future arms a timer instead of dialing now; that is what makes "call me back in
ten minutes" land on time rather than whenever the safety poll next runs.
"""

from __future__ import annotations

import datetime
import hmac
import logging

from fastapi import FastAPI, Request, Response

from ..config import Config
from .poller import LeadPoller

log = logging.getLogger(__name__)


def _parse_when(raw: str) -> datetime.datetime | None:
    """An ISO instant from the backend, as an aware UTC datetime. Returns None if unusable — the
    caller then treats the lead as due now, which is the safe direction to fail: a lead called a
    little early is recoverable, one never called is not."""
    if not raw:
        return None
    try:
        when = datetime.datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        log.warning("unparseable notBefore %r — treating the lead as due now", raw)
        return None
    if when.tzinfo is None:
        when = when.replace(tzinfo=datetime.timezone.utc)
    return when


def build_app(cfg: Config, poller: LeadPoller) -> FastAPI:
    """The notification app, bound to the poller it wakes."""
    app = FastAPI(title="openai-agent-app poller notifications")

    def _authorized(request: Request) -> bool:
        # Same shared secret the agent already uses for the backend's /agent/* tools, compared in
        # constant time. Unlike the Twilio webhooks there is no signature to verify here: this is
        # our own backend calling us, so a bearer secret is the right shape.
        expected = cfg.agent_tools_secret
        if not expected:
            log.warning("notification received but AGENT_TOOLS_SECRET is unset — rejecting")
            return False
        return hmac.compare_digest(request.headers.get("x-agent-secret", ""), expected)

    @app.get("/poller/health")
    async def health() -> dict:
        # `wakes` is the number that matters when checking whether push works: submit the form,
        # re-read this, and see whether it moved. The lead gets called either way thanks to the
        # safety poll, so receiving the call proves nothing on its own.
        return {"ok": True, "notifications_enabled": bool(cfg.agent_tools_secret), **poller.stats()}

    # response_model=None: the handler returns either a plain dict or a Response (403), and
    # FastAPI cannot build a response model from that union — without this it raises at import
    # time, which would take the poller down on startup rather than at request time.
    @app.post("/poller/lead-due", response_model=None)
    async def lead_due(request: Request) -> Response | dict:
        if not _authorized(request):
            return Response(content="forbidden", status_code=403, media_type="text/plain")
        try:
            body = await request.json()
        except Exception:  # noqa: BLE001 — a malformed body must not take the poller down
            body = {}
        intake_id = str(body.get("intakeId") or body.get("intake_id") or "")
        when = _parse_when(str(body.get("notBefore") or body.get("not_before") or ""))

        if when is not None and intake_id:
            # Deferred: arm a timer for that moment rather than dialing now.
            poller.schedule_wake(intake_id, when, reason="callback")
            return {"ok": True, "scheduled_for": when.isoformat()}

        # Due now. We deliberately do NOT pass the intake id through to the dialer: the poll loop
        # re-reads the queue and picks the oldest due lead itself, so a notification can never jump
        # the queue or dial a lead the backend has since resolved. The notification is a hint that
        # work exists, not an instruction about which work.
        poller.wake(f"lead {intake_id or '(unspecified)'} due")
        return {"ok": True}

    return app
