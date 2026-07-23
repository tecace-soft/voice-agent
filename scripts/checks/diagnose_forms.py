"""One-shot health check for the Google Forms -> callback pipeline.

    python scripts/checks/diagnose_forms.py

Read-only: places NO calls. Run it on the box to see exactly which link is
broken — config, Forms API access, responses, the phone number, the poll state,
or the Twilio/telephony settings.
"""

from __future__ import annotations

import json
import sys

from voice_agent.config import Config, ConfigError, PROJECT_ROOT

sys.stdout.reconfigure(encoding="utf-8")  # Korean/emoji-safe on Windows

OK, BAD, WARN = "OK  ", "FAIL", "warn"


def line(tag: str, msg: str) -> None:
    print(f"  [{tag}] {msg}")


def main() -> int:
    print("=== Google Forms -> callback diagnostic ===\n")

    try:
        cfg = Config.load()
    except ConfigError as exc:
        line(BAD, f"config: {exc}")
        return 1

    print("config:")
    line(OK if cfg.google_form_id else BAD, f"GOOGLE_FORM_ID = {cfg.google_form_id or '(EMPTY — not set on this box)'}")
    line(OK if cfg.google_api_email else BAD, f"service account = {cfg.google_api_email or '(missing)'}")
    tw = bool(cfg.twilio_account_sid and cfg.twilio_auth_token and cfg.twilio_phone_number)
    line(OK if tw else BAD, f"Twilio creds = {'present' if tw else 'MISSING (ACCOUNT_SID / TWILIO_AUTH_TOKEN / PHONE_NUMBER)'}")
    line(OK if cfg.public_base_url else BAD, f"PUBLIC_BASE_URL = {cfg.public_base_url or '(EMPTY — Twilio cannot reach this server)'}")
    line(OK, f"from number = {cfg.twilio_phone_number or '(none)'}")
    print()

    # -- Forms API: structure + responses --------------------------------
    from voice_agent.tools.google_forms import GoogleFormsClient, GoogleFormsError

    print("google forms:")
    try:
        client = GoogleFormsClient(cfg)
        defs = client.question_defs()
        line(OK, f"read form structure: {len(defs)} question(s)")
    except GoogleFormsError as exc:
        line(BAD, f"cannot read form: {exc}")
        return 1

    try:
        responses = client.responses()
        line(OK, f"read responses: {len(responses)} submission(s) total")
    except GoogleFormsError as exc:
        line(BAD, f"cannot read responses: {exc}")
        return 1
    print()

    if not responses:
        line(WARN, "no submissions on the form yet — submit it, then re-run this.")
        return 0

    # -- latest submission: parse + phone --------------------------------
    from voice_agent.tools.google_forms import record_from_response
    from voice_agent.telephony.server import _e164

    latest = sorted(responses, key=lambda r: r.get("lastSubmittedTime", ""))[-1]
    rid = latest.get("responseId", "")
    record, phone = record_from_response(latest, defs)
    print("latest submission:")
    line(OK, f"submitted {latest.get('lastSubmittedTime')}  id {rid[:16]}")
    line(OK, f"record = {record}")
    if phone:
        line(OK, f"phone = {phone!r}  ->  Twilio dials {_e164(phone)!r}")
    else:
        line(BAD, "no phone number found in this submission — nothing to call")
    print()

    # -- poll state: would the poller act on it? -------------------------
    state_path = PROJECT_ROOT / "data" / "forms_poll.json"
    print("poll state:")
    try:
        state = json.loads(state_path.read_text())
        seen = state.get("seen", [])
        line(OK, f"{state_path} exists — since={state.get('since')}, {len(seen)} seen")
        if rid in seen:
            line(WARN, "this submission is ALREADY marked seen — poller will NOT re-call it.")
            line(WARN, "to retry: delete data/forms_poll.json (or re-submit the form).")
        else:
            line(OK, "latest submission is NOT yet seen — poller should call it on the next tick.")
    except FileNotFoundError:
        line(OK, f"no state file yet — first poll will process all {len(responses)} submission(s).")
    except ValueError:
        line(WARN, f"{state_path} is corrupt — delete it to reset.")
    print()

    verdict = "Pipeline looks healthy." if (phone and tw and cfg.public_base_url) else "Something above is FAIL — fix that first."
    print(f"=> {verdict}")
    print("   If all OK but no call arrives, the running server is likely OLD code —")
    print("   restart it:  pkill -9 -f run_phone; nohup python scripts/run_phone.py --poll > ~/server.log 2>&1 &")
    return 0


if __name__ == "__main__":
    sys.exit(main())
