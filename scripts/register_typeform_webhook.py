"""Register (or update) the Typeform webhook that triggers the callback.

    python scripts/register_typeform_webhook.py           # create/enable
    python scripts/register_typeform_webhook.py --delete    # remove it

On form completion, Typeform POSTs to  PUBLIC_BASE_URL/typeform/webhook , and the
running phone server calls the submitter back to finish scheduling.

Requires PUBLIC_BASE_URL (your public https URL) and TYPEFORM_API_KEY in .env.
Set TYPEFORM_WEBHOOK_SECRET too for signature verification.
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request

from voice_agent.config import Config, ConfigError

TAG = "voice-agent-callback"


def _api(cfg: Config, method: str, path: str, body: dict | None = None) -> tuple[int, str]:
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Authorization": f"Bearer {cfg.typeform_api_key}"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(
        f"https://api.typeform.com/forms/{cfg.typeform_form_id}/webhooks/{TAG}",
        data=data, method=method, headers=headers,
    )
    try:
        with urllib.request.urlopen(req, timeout=cfg.request_timeout) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")


def main(argv: list[str]) -> int:
    try:
        cfg = Config.load()
    except ConfigError as exc:
        print(f"config error: {exc}")
        return 1

    if not cfg.typeform_api_key or not cfg.typeform_form_id:
        print("TYPEFORM_API_KEY and TYPEFORM_FORM_ID must be set in .env")
        return 1

    if "--delete" in argv:
        status, _ = _api(cfg, "DELETE", "")
        print("deleted" if status < 300 else f"delete failed [{status}]")
        return 0 if status < 300 else 1

    if not cfg.public_base_url:
        print("PUBLIC_BASE_URL must be set (your public https URL, e.g. the ngrok URL).")
        return 1

    url = f"{cfg.public_base_url}/typeform/webhook"
    body = {"url": url, "enabled": True, "verify_ssl": True}
    if cfg.typeform_webhook_secret:
        body["secret"] = cfg.typeform_webhook_secret
    else:
        print("note: TYPEFORM_WEBHOOK_SECRET is empty — webhook will not be signature-verified.")

    status, text = _api(cfg, "PUT", "", body)
    if status < 300:
        print(f"webhook registered -> {url}")
        print("Complete the form on the site; the agent will call the phone number given.")
        return 0
    print(f"failed [{status}]: {text[:300]}")
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
