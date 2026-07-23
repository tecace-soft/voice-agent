"""Show the questions the agent will ask, sourced from the Google Form.

    python scripts/show_form.py

Fetches the configured Google Form and prints each mapped question. Use it to
confirm the Forms integration (API enabled, form shared with the service
account) and to see what the agent will ask before running an intake.
"""

from __future__ import annotations

import sys

from voice_agent.config import Config, ConfigError
from voice_agent.tools.google_forms import GoogleFormsClient, GoogleFormsError


def main() -> int:
    try:
        cfg = Config.load()
    except ConfigError as exc:
        print(f"config: FAIL — {exc}")
        return 1

    try:
        client = GoogleFormsClient(cfg)
        form = client.form()
    except GoogleFormsError as exc:
        print(f"google forms: FAIL — {exc}")
        return 1

    info = form.get("info", {})
    print(f"form  : {info.get('title')!r} (id {cfg.google_form_id})")
    print(f"raw   : {len(form.get('items', []))} item(s) on the form")

    try:
        fields = client.fields()
    except GoogleFormsError as exc:
        print(f"\ngoogle forms: {exc}")
        return 1

    print(f"questions: {len(fields)}\n")
    for i, f in enumerate(fields, 1):
        req = "required" if f.required else "optional"
        print(f"  {i}. [{f.name}] ({req})")
        print(f"     Q: {f.question}")
        if f.choices:
            print(f"     choices: {', '.join(f.choices)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
