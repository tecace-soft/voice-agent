"""End-to-end proof that we can talk to the Hermes agent.

    python scripts/checks/verify_hermes.py

Checks, in order: gateway status, cookie login, that an LLM is attached, and
finally a live chat round-trip over the WebSocket. Exits non-zero on the first
failure with a specific message.
"""

from __future__ import annotations

import sys

from voice_agent.config import Config, ConfigError
from voice_agent.tools.hermes import HermesAuthError, HermesChat, HermesSession, status


def main() -> int:
    try:
        cfg = Config.load()
    except ConfigError as exc:
        print(f"config: FAIL — {exc}")
        return 1
    print(f"server: {cfg.hermes_server_url}")

    try:
        st = status(cfg)
        print(f"status: ok — v{st.get('version')}, gateway_running={st.get('gateway_running')}")
    except Exception as exc:
        print(f"status: FAIL — {type(exc).__name__}: {exc}")
        return 1

    session = HermesSession(cfg)
    try:
        session.login()
        print("login : ok — session cookie acquired")
    except HermesAuthError as exc:
        print(f"login : FAIL — {exc}")
        return 1

    try:
        info = session.model_info()
        model, provider = info.get("model"), info.get("provider")
        if not model or not provider:
            print("model : FAIL — no LLM attached (model/provider empty). Configure one in the Hermes dashboard.")
            return 1
        print(f"model : ok — {model} via {provider}")
    except Exception as exc:
        print(f"model : FAIL — {type(exc).__name__}: {exc}")
        return 1

    try:
        reply = HermesChat(session).ask(
            "Reply with a single short sentence confirming you can hear me.",
            timeout=90,
        )
        print(f"chat  : ok — agent replied: {reply.strip()[:200]!r}")
    except Exception as exc:
        print(f"chat  : FAIL — {type(exc).__name__}: {exc}")
        return 1

    print("\nAll checks passed — the Hermes agent is reachable and responding.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
