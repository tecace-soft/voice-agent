"""The runner's HTTP side: transcribe-backend wakes it for one pass, and it works through the runs.

One pass at a time, in this process. A second wake-up while one is running is refused (409); the
backend refuses a second pass before it gets here, so this is only the belt to its braces.
"""

from __future__ import annotations

import asyncio
import hmac
import logging

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse

from ..config import Config
from .backend_client import BackendClient
from .run_one import run_scenario
from .settings import RunnerSettings

log = logging.getLogger(__name__)


async def drive_pass(cfg: Config, rs: RunnerSettings, pass_id: str) -> None:
    """Every run of a pass, one after another, until the backend says it is done or stopped."""
    async with BackendClient(rs.backend_url, rs.key) as backend:
        while True:
            job = await backend.next_job(pass_id)
            if job.get("done"):
                log.info("scenario pass %s finished", pass_id)
                return
            run_id = job.get("runId")
            if not run_id:
                # Nowhere to report a result, so nothing to run: the backend sent a broken job.
                raise RuntimeError(f"pass {pass_id}: the backend sent a job without a runId")
            log.info("scenario run %s: %s", run_id, job.get("title"))
            result = await run_scenario(cfg, rs, backend, job)
            await backend.post_result(run_id, result)


def build_app(cfg: Config, rs: RunnerSettings) -> FastAPI:
    app = FastAPI()
    state: dict = {"active": None, "tasks": set()}

    @app.get("/scenarios/health")
    async def health() -> dict:
        return {"ok": True, "enabled": rs.enabled}

    @app.post("/scenarios/passes/{pass_id}")
    async def start(pass_id: str, x_runner_key: str = Header(default="")) -> JSONResponse:
        if not rs.key or not hmac.compare_digest(x_runner_key.encode(), rs.key.encode()):
            raise HTTPException(status_code=401, detail="bad runner key")
        if not rs.enabled:
            raise HTTPException(status_code=503, detail="the scenario runner is switched off")
        if state["active"]:
            raise HTTPException(status_code=409, detail="a pass is already running")
        state["active"] = pass_id

        async def work() -> None:
            try:
                await drive_pass(cfg, rs, pass_id)
            except Exception:  # noqa: BLE001 — the pass shows as interrupted; the process stays up
                log.exception("scenario pass %s stopped", pass_id)
            finally:
                state["active"] = None

        task = asyncio.create_task(work())
        state["tasks"].add(task)
        task.add_done_callback(state["tasks"].discard)
        return JSONResponse({"accepted": True}, status_code=202)

    return app
