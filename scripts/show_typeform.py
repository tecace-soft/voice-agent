"""Show the questions the agent will ask, sourced from the Typeform form.

    python scripts/show_typeform.py

Fetches the configured form and prints each mapped question. Use it to confirm
the Typeform integration and to see what the agent will ask before running an
intake.
"""

from __future__ import annotations

import sys

from voice_agent.config import Config, ConfigError
from voice_agent.tools.typeform import TypeformClient, TypeformError


def main() -> int:
    try:
        cfg = Config.load()
    except ConfigError as exc:
        print(f"config: FAIL — {exc}")
        return 1

    client = TypeformClient(cfg)
    try:
        form = client.form()
    except TypeformError as exc:
        print(f"typeform: FAIL — {exc}")
        return 1

    published = form.get("settings", {}).get("is_public", True)
    print(f"form  : {form.get('title')!r} (id {cfg.typeform_form_id}, type {form.get('type')})")
    print(f"state : {'published' if published else 'NOT PUBLISHED — publish it so questions reach the API'}")
    print(f"raw   : {len(form.get('fields', []))} top-level field(s), "
          f"{len(form.get('thankyou_screens', []))} ending screen(s)")

    try:
        fields = client.fields()
    except TypeformError as exc:
        print(f"\ntypeform: {exc}")
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
