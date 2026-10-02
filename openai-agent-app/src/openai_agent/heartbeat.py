"""Proof of life: every long-running process tells transcribe-backend it is up, once a minute.

    POST {BUSINESS_CONFIG_URL}/agent/heartbeat   (header x-agent-key: AGENT_CONFIG_KEY)

The dashboard shows an admin whether each of `server`, `poller` and `scenarios` is alive. A process
with nothing to do is otherwise indistinguishable from one that has died, so this is sent every tick
whatever the process is doing.

Best-effort by design: a heartbeat must never raise into the process it monitors, and a backend that
is down must not fill the log (the same rule as transcribe-app's reporter.send_heartbeat): the first
failure is logged at warning level, an identical repeat is silent until a beat lands again.
"""

from __future__ import annotations

import asyncio
import datetime
import logging
import os
import socket
import threading
from typing import Callable

import httpx

from .config import Config

log = logging.getLogger(__name__)


def _interval() -> int:
    try:
        return max(1, int(os.getenv("HEARTBEAT_SECONDS", "60")))
    except ValueError:
        return 60


HEARTBEAT_SECONDS = _interval()
_TIMEOUT = 10.0

# What a status function returns: (ok, detail — empty when fine, small metrics dict).
Status = Callable[[], "tuple[bool, str, dict]"]

# Captured once, at import: the process start, not the time of the latest beat.
_STARTED_AT = datetime.datetime.now(datetime.timezone.utc).isoformat()

# service -> True (last beat landed) / False (last beat failed, already warned); absent = not tried.
_delivered: dict[str, bool] = {}
_warned_unconfigured = False


def _configured(cfg: Config) -> bool:
    """False (logging once) when there is nowhere to send, or no key to send with."""
    global _warned_unconfigured
    if cfg.business_config_url and cfg.agent_config_key:
        return True
    if not _warned_unconfigured:
        log.info("heartbeat off — it needs BUSINESS_CONFIG_URL and AGENT_CONFIG_KEY")
        _warned_unconfigured = True
    return False


def build_request(cfg: Config, service: str, status_fn: Status) -> tuple[str, dict, dict]:
    """(url, headers, body) for one beat. A throwing status function is itself the news, and goes
    out as ok:false."""
    try:
        ok, detail, metrics = status_fn()
    except Exception as exc:  # noqa: BLE001 — see the docstring
        ok, detail, metrics = False, f"status check failed: {exc}", {}
    body = {
        "service": service,
        "intervalSeconds": HEARTBEAT_SECONDS,
        "ok": bool(ok),
        "detail": (detail or "")[:300],
        "startedAt": _STARTED_AT,
        "host": socket.gethostname()[:200],
        "metrics": metrics or {},
    }
    url = cfg.business_config_url.rstrip("/") + "/agent/heartbeat"
    return url, {"x-agent-key": cfg.agent_config_key}, body


def _landed(service: str, url: str) -> None:
    if not _delivered.get(service):
        log.info("heartbeat (%s) delivered to %s", service, url)
        _delivered[service] = True


def _failed(service: str, url: str, why: object) -> None:
    # Loud once, then silent until it recovers — see the module docstring.
    if _delivered.get(service) is not False:
        log.warning(
            "heartbeat (%s) NOT delivered to %s: %s — the dashboard will show it as down. "
            "Check BUSINESS_CONFIG_URL and AGENT_CONFIG_KEY, and that the backend is deployed.",
            service, url, why,
        )
        _delivered[service] = False


def _check(resp: httpx.Response) -> None:
    if resp.status_code == 401:
        raise RuntimeError("401 — AGENT_CONFIG_KEY is wrong")
    resp.raise_for_status()


def send_once(cfg: Config, service: str, status_fn: Status, client: httpx.Client | None = None) -> bool:
    """One beat, synchronously. True when the backend accepted it. Never raises."""
    if not _configured(cfg):
        return False
    url = ""
    try:
        url, headers, body = build_request(cfg, service, status_fn)
        if client is None:
            with httpx.Client(timeout=_TIMEOUT) as own:
                _check(own.post(url, json=body, headers=headers))
        else:
            _check(client.post(url, json=body, headers=headers))
    except Exception as exc:  # noqa: BLE001 — never let the monitor break the thing it monitors
        _failed(service, url, exc)
        return False
    _landed(service, url)
    return True


async def send_once_async(
    cfg: Config, service: str, status_fn: Status, client: httpx.AsyncClient | None = None
) -> bool:
    """One beat from an asyncio process. True when the backend accepted it. Never raises."""
    if not _configured(cfg):
        return False
    url = ""
    try:
        url, headers, body = build_request(cfg, service, status_fn)
        if client is None:
            async with httpx.AsyncClient(timeout=_TIMEOUT) as own:
                _check(await own.post(url, json=body, headers=headers))
        else:
            _check(await client.post(url, json=body, headers=headers))
    except asyncio.CancelledError:
        raise
    except Exception as exc:  # noqa: BLE001
        _failed(service, url, exc)
        return False
    _landed(service, url)
    return True


async def heartbeat_loop(cfg: Config, service: str, status_fn: Status) -> None:
    """Beat at start, then every HEARTBEAT_SECONDS, until cancelled."""
    if not _configured(cfg):
        return
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        while True:
            await send_once_async(cfg, service, status_fn, client)
            await asyncio.sleep(HEARTBEAT_SECONDS)


def start_heartbeat_thread(cfg: Config, service: str, status_fn: Status) -> threading.Thread | None:
    """The same loop on a daemon thread, for the poller (a synchronous process)."""
    if not _configured(cfg):
        return None

    def run() -> None:
        stop = threading.Event()  # never set: a daemon thread just dies with the process
        with httpx.Client(timeout=_TIMEOUT) as client:
            while True:
                send_once(cfg, service, status_fn, client)
                stop.wait(HEARTBEAT_SECONDS)

    thread = threading.Thread(target=run, name=f"heartbeat-{service}", daemon=True)
    thread.start()
    return thread
