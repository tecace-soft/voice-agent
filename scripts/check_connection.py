"""Verify each part of the stack independently.

    python scripts/check_connection.py

Gemini is exercised for real. Hermes is checked as far as it can be today:
gateway status (no auth) and cookie login (if credentials are set). The native
chat endpoint is wired separately once scripts/discover_hermes.py reveals it.
"""

from __future__ import annotations

import sys

from voice_agent.config import Config, ConfigError
from voice_agent.tools.gemini import GeminiTools
from voice_agent.tools.hermes import HermesAuthError, HermesSession, status


def main() -> int:
    try:
        cfg = Config.load()
    except ConfigError as exc:
        print(f"config: FAIL — {exc}")
        return 1
    print(f"config: ok — app port {cfg.port}")
    print(f"        hermes @ {cfg.hermes_api_base}")
    print(f"        gemini {cfg.gemini_model}")

    try:
        result = GeminiTools(cfg).extract_fields(
            "uh yeah it's Dana Whitfield, dana at example dot com, I'm in Portland",
            [
                {"name": "full_name", "description": "The caller's full name"},
                {"name": "email", "description": "Email address"},
                {"name": "phone", "description": "Phone number"},
            ],
        )
        print(f"gemini: ok — extracted {result['values']}, missing {result['missing']}")
    except Exception as exc:
        print(f"gemini: FAIL — {type(exc).__name__}: {exc}")
        return 1

    try:
        st = status(cfg)
        print(
            f"hermes: reachable — v{st.get('version')}, "
            f"gateway_running={st.get('gateway_running')}, active_agents={st.get('active_agents')}"
        )
    except Exception as exc:
        print(f"hermes: FAIL — {type(exc).__name__}: {exc}")
        return 1

    if cfg.hermes_username and cfg.hermes_password:
        try:
            HermesSession(cfg).login()
            print("hermes: login ok — session cookie acquired")
        except HermesAuthError as exc:
            print(f"hermes: login FAIL — {exc}")
            return 1
    else:
        print("hermes: login skipped — set HERMES_USERNAME / HERMES_PASSWORD to test it")

    return 0


if __name__ == "__main__":
    sys.exit(main())
