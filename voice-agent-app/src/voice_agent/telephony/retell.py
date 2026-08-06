"""Retell outbound calling — trigger a Retell voice agent to call a lead.

Retell owns the whole voice layer (telephony, speech-to-text, text-to-speech, turn-taking,
and the conversational LLM), replacing the old Twilio + CallSession + Hermes stack. This
module is the thin bridge: given a lead, POST Retell's create-phone-call API so its agent
calls them, passing the lead's details as dynamic variables the agent's prompt/flow uses
(and its custom functions call our backend tools to check availability + book).

Plain urllib (no new deps), same style as the other tools. Config comes from RETELL_* in
.env. See backend-app/docs/retell-agent.md for the agent + node setup.
"""

from __future__ import annotations

import datetime
import json
import urllib.error
import urllib.request
from typing import Any, Callable
from zoneinfo import ZoneInfo

from ..config import Config

_API_ROOT = "https://api.retellai.com"
DEFAULT_TIMEZONE = "America/Los_Angeles"


class RetellError(RuntimeError):
    """The Retell API rejected a request or was unreachable."""


class RetellClient:
    def __init__(self, cfg: Config) -> None:
        if not cfg.retell_api_key:
            raise RetellError("RETELL_API_KEY is not set in .env.")
        if not cfg.retell_from_number:
            raise RetellError("RETELL_FROM_NUMBER (or PHONE_NUMBER) is not set in .env.")
        self._cfg = cfg

    def create_phone_call(
        self,
        to_number: str,
        *,
        dynamic_variables: dict[str, Any] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> str:
        """Place an outbound call via Retell. Returns the Retell call id."""
        body: dict[str, Any] = {
            "from_number": _to_e164(self._cfg.retell_from_number),
            "to_number": _to_e164(to_number),
        }
        if self._cfg.retell_agent_id:
            body["override_agent_id"] = self._cfg.retell_agent_id
        if dynamic_variables:
            # Retell requires string values for dynamic variables.
            body["retell_llm_dynamic_variables"] = {
                k: str(v) for k, v in dynamic_variables.items()
            }
        if metadata:
            body["metadata"] = metadata
        data = self._call("/v2/create-phone-call", method="POST", body=body)
        return str(data.get("call_id", ""))

    def _call(self, path: str, *, method: str = "GET", body: Any = None) -> Any:
        headers = {
            "Authorization": f"Bearer {self._cfg.retell_api_key}",
            "Accept": "application/json",
        }
        data = None
        if body is not None:
            data = json.dumps(body).encode()
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(
            f"{_API_ROOT}{path}", data=data, method=method, headers=headers
        )
        try:
            with urllib.request.urlopen(req, timeout=self._cfg.request_timeout) as resp:
                text = resp.read().decode("utf-8", "replace")
                return json.loads(text) if text else {}
        except urllib.error.HTTPError as exc:
            detail = exc.read()[:300].decode("utf-8", "replace")
            raise RetellError(f"Retell API error [{exc.code}] on {path}: {detail}") from exc
        except urllib.error.URLError as exc:
            raise RetellError(f"could not reach Retell at {_API_ROOT}: {exc.reason}") from exc


def make_retell_trigger(cfg: Config) -> Callable[[dict[str, str], str], str]:
    """Build the poller's `trigger(record, phone) -> call_id`: place a Retell call for a
    lead, passing its details as dynamic variables the agent's flow consumes."""
    client = RetellClient(cfg)

    def trigger(record: dict[str, str], phone: str) -> str:
        iso = record.get("desired_time", "")
        variables = {
            "intake_id": record.get("_intake_id", ""),
            "lead_name": record.get("name", ""),
            "email": record.get("email", ""),
            "language": record.get("language", "") or "English",
            # dateTime drives the tools (ISO); desired_time is the spoken version the agent
            # reads back. Both point at the same requested slot.
            "dateTime": iso,
            "desired_time": _spoken_time(iso) if iso else "",
            "current_date": _today_pacific(),
            "current_time_zone": DEFAULT_TIMEZONE,
        }
        return client.create_phone_call(
            phone, dynamic_variables=variables, metadata={"intake_id": variables["intake_id"]}
        )

    return trigger


def _to_e164(number: str, default_country_code: str = "1") -> str:
    """Best-effort E.164 normalization. Retell rejects anything not in +<countrycode><number>
    form, but leads often arrive as bare 10-digit US numbers ("4254787534") from the form.
    An already-`+`-prefixed number is kept (formatting stripped); a bare 10-digit number gets
    the default country code; "1XXXXXXXXXX" gets a leading `+`. Blank passes through unchanged
    so the caller's own validation still applies."""
    s = number.strip()
    if not s:
        return s
    if s.startswith("+"):
        return "+" + "".join(ch for ch in s[1:] if ch.isdigit())
    digits = "".join(ch for ch in s if ch.isdigit())
    if len(digits) == 10:
        return f"+{default_country_code}{digits}"
    if len(digits) == 11 and digits.startswith("1"):
        return f"+{digits}"
    # Already has some country code (or is unusual) — prefix `+` and let Retell validate.
    return f"+{digits}" if digits else s


def _today_pacific() -> str:
    return datetime.datetime.now(ZoneInfo(DEFAULT_TIMEZONE)).strftime("%Y-%m-%d")


def _spoken_time(iso: str) -> str:
    """An ISO instant as a spoken-friendly time in the business timezone, e.g.
    'Thursday, July 30 at 8 AM'."""
    try:
        dt = datetime.datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except ValueError:
        return iso
    if dt.tzinfo is not None:
        dt = dt.astimezone(ZoneInfo(DEFAULT_TIMEZONE))
    hour12 = dt.hour % 12 or 12
    ampm = "AM" if dt.hour < 12 else "PM"
    clock = f"{hour12} {ampm}" if dt.minute == 0 else f"{hour12}:{dt.minute:02d} {ampm}"
    return f"{dt.strftime('%A, %B')} {dt.day} at {clock}"
