"""Run the scenario runner — scripted test calls against the real GPT-Live receptionist.

    python scripts/run_scenario_runner.py

Idle until transcribe-backend wakes it (POST /scenarios/passes/<id>). Each pass runs every ticked
scenario once and stops. Needs OPENAI_API_KEY, OPENAI_LIVE_MODEL, BUSINESS_CONFIG_URL and
SCENARIO_RUNNER_KEY (see .env.example).
"""

from __future__ import annotations

import logging
import sys

import uvicorn

from openai_agent.config import Config
from openai_agent.scenario.server import build_app
from openai_agent.scenario.settings import RunnerSettings


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    cfg = Config.load()
    rs = RunnerSettings.load()
    gaps = rs.missing()
    if not cfg.openai_api_key:
        gaps.append("OPENAI_API_KEY")
    if not cfg.openai_live_model:
        gaps.append("OPENAI_LIVE_MODEL")
    if gaps:
        print("Missing settings for the scenario runner: " + ", ".join(gaps))
        return 1
    print(f"Scenario runner on :{rs.port} — {'enabled' if rs.enabled else 'SWITCHED OFF (SCENARIO_RUNNER_ENABLED)'}")
    try:
        uvicorn.run(build_app(cfg, rs), host="0.0.0.0", port=rs.port, log_level="warning")
    except KeyboardInterrupt:
        print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
