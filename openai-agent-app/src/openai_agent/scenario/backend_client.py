"""transcribe-backend's runner routes: the next job, a sandbox tool call, a run's result."""

from __future__ import annotations

import logging

import httpx

log = logging.getLogger(__name__)

# A sandbox tool call is quick work while the live session waits on it; the client's 90 s default
# is for posting a result, which waits on the judge.
TOOL_TIMEOUT = 15.0


class BackendClient:
    def __init__(self, base_url: str, key: str, timeout: float = 90.0) -> None:
        # 90 s: posting a result waits for the judge (up to 45 s) on a serverless backend.
        self._client = httpx.AsyncClient(base_url=base_url, headers={"x-runner-key": key}, timeout=timeout)
        self.tool_failed = False

    async def __aenter__(self) -> "BackendClient":
        return self

    async def __aexit__(self, *exc) -> None:
        await self._client.aclose()

    async def next_job(self, pass_id: str) -> dict:
        resp = await self._client.get(f"/internal/scenario-passes/{pass_id}/next")
        resp.raise_for_status()
        return resp.json()

    async def tool(self, run_id: str, name: str, args: dict) -> dict:
        """The sandbox's answer. A sandbox failure is remembered: the run is then a run error."""
        try:
            resp = await self._client.post(
                f"/internal/scenario-runs/{run_id}/tool", json={"name": name, "args": args}, timeout=TOOL_TIMEOUT
            )
        except httpx.HTTPError as exc:
            self.tool_failed = True
            return {"error": f"the sandbox could not be reached: {type(exc).__name__}: {exc}"}
        if resp.status_code != 200:
            self.tool_failed = True
            return {"error": f"the sandbox answered {resp.status_code}"}
        try:
            body = resp.json()
        except ValueError:
            self.tool_failed = True
            return {"error": "the sandbox answered with something other than JSON"}
        output = body.get("output") if isinstance(body, dict) else None
        return output if isinstance(output, dict) else {}

    async def post_result(self, run_id: str, result: dict) -> None:
        resp = await self._client.post(f"/internal/scenario-runs/{run_id}/result", json=result)
        if resp.status_code == 409:
            # Already reported or closed (e.g. the pass was stopped): not a reason to stop the pass.
            log.warning("scenario run %s: result already recorded (409)", run_id)
            return
        resp.raise_for_status()
