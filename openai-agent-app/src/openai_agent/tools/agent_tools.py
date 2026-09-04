"""The agent's tools — the same shared backend `/agent/*` endpoints the Retell agent calls.

`TOOL_SCHEMAS` are the function definitions the Realtime model sees. `ToolExecutor` runs a
requested call against the backend, injecting the lead's `intake_id` from the call context
(never from the model, so it can't be guessed wrong — the same reliability lesson as the Retell
`const {{intake_id}}` binding). Each handler returns a JSON string the model reads back.
"""

from __future__ import annotations

import json
import logging

import httpx

from ..config import Config

log = logging.getLogger(__name__)

# Function definitions for the Realtime session. Mirror the Retell functions; the model supplies
# the spoken details (a time, a day, an outcome), and the executor adds intake_id + the header.
TOOL_SCHEMAS: list[dict] = [
    {
        "type": "function",
        "name": "check_availability",
        "description": "Check whether a specific date and time is open for a 30-minute "
        "consultation. Call before confirming a time with the lead.",
        "parameters": {
            "type": "object",
            "properties": {
                "dateTime": {
                    "type": "string",
                    "description": "The time to check, ISO 8601. Resolve the spoken time against "
                    "today's date (Pacific); for a relative day like 'tomorrow' or 'next Monday', "
                    "use that day's actual future date, NOT today's.",
                }
            },
            "required": ["dateTime"],
        },
    },
    {
        "type": "function",
        "name": "get_openings",
        "description": "List a few open times on a day, ordered around the time the lead cares "
        "about. Use when they want to see options or gave an approximate time.",
        "parameters": {
            "type": "object",
            "properties": {
                "dateTime": {
                    "type": "string",
                    "description": "The day to list, ISO 8601, INCLUDING the approximate time the "
                    "lead mentioned so the openings come back around it — e.g. 'around 3 PM "
                    "tomorrow' -> that day at 15:00. If they named only a day with no time, use "
                    "12:00 (noon) of that day. Resolve relative days ('tomorrow', 'next Monday') "
                    "to their actual future date (Pacific), not today.",
                }
            },
            "required": ["dateTime"],
        },
    },
    {
        "type": "function",
        "name": "book_appointment",
        "description": "Book the consultation once the lead has agreed to a specific time.",
        "parameters": {
            "type": "object",
            "properties": {
                "dateTime": {"type": "string", "description": "The agreed slot, ISO 8601."}
            },
            "required": ["dateTime"],
        },
    },
    {
        "type": "function",
        "name": "schedule_callback",
        "description": "Record when to call the lead back (they answered but can't talk now). "
        "Use callback_in_minutes for relative times ('in 10 minutes'), else callback_after.",
        "parameters": {
            "type": "object",
            "properties": {
                "callback_in_minutes": {
                    "type": "number",
                    "description": "Minutes from now to call back, for relative requests.",
                },
                "callback_after": {
                    "type": "string",
                    "description": "Absolute time to call back, ISO 8601.",
                },
            },
        },
    },
    {
        "type": "function",
        "name": "mark_outcome",
        "description": "Record a dead-end outcome so we stop calling this lead: a wrong number "
        "or a decline.",
        "parameters": {
            "type": "object",
            "properties": {
                "outcome": {
                    "type": "string",
                    "enum": ["wrong_number", "declined", "unreachable"],
                    "description": "What happened.",
                }
            },
            "required": ["outcome"],
        },
    },
    {
        "type": "function",
        "name": "end_call",
        "description": "Hang up the phone. Call this ONLY after you've said your final words — a "
        "farewell once the lead is done, or your brief sign-off for a wrong number, voicemail, or "
        "decline. Saying goodbye does not hang up by itself; this is what actually ends the call.",
        "parameters": {"type": "object", "properties": {}},
    },
]


# The INBOUND screening agent gets a different tool set, not a superset. A receptionist answering a
# stranger has no lead to book against, no callback to schedule and no lead status to mark — it
# hands off, takes a message, or hangs up. Sharing one list would offer the model five tools it can
# never legitimately use on an inbound call, which is how agents end up booking phantom leads.
INBOUND_TOOL_SCHEMAS: list[dict] = [
    {
        "type": "function",
        "name": "transfer_to_human",
        "description": "Hand this caller to a real person. Use ONLY for a genuine request to "
        "book, schedule, or meet with someone, or when the caller directly asks for a human. "
        "Never for a general question, a complaint, or a sales call.",
        "parameters": {
            "type": "object",
            "properties": {
                "reason": {
                    "type": "string",
                    "description": "One sentence, in ENGLISH, describing what the caller wants. "
                    "It is read aloud to the colleague before they accept the call, so make it "
                    "specific — e.g. 'Wants to book a consultation about a logistics AI project.'",
                }
            },
            "required": ["reason"],
        },
    },
    {
        "type": "function",
        "name": "take_message",
        "description": "Record a message for the team when the caller wants a callback, or when "
        "you could not help them and no transfer is appropriate.",
        "parameters": {
            "type": "object",
            "properties": {
                "caller_name": {"type": "string", "description": "The caller's name, as given."},
                "callback_number": {
                    "type": "string",
                    "description": "The number to call back, digits only. Read it back to the "
                    "caller to confirm before recording it.",
                },
                "message": {
                    "type": "string",
                    "description": "What the call is regarding, in one or two sentences.",
                },
            },
            "required": ["message"],
        },
    },
    # Same contract as the outbound agent: the bridge speaks the farewell and closes the line.
    {
        "type": "function",
        "name": "end_call",
        "description": "Hang up the phone. Call this once the conversation is genuinely over — "
        "the caller is done, it was a wrong number, or it was a sales call you declined. A warm "
        "farewell is spoken automatically, so do not say goodbye yourself first.",
        "parameters": {"type": "object", "properties": {}},
    },
]


class ToolExecutor:
    """Runs a tool call for one lead against the shared backend."""

    def __init__(self, cfg: Config, *, intake_id: str) -> None:
        self._cfg = cfg
        self._intake_id = intake_id

    async def run(self, name: str, args: dict) -> str:
        """Execute the named tool and return a JSON string for the model to read back."""
        try:
            if name == "check_availability":
                return await self._post("/agent/check-availability", {"dateTime": args.get("dateTime", "")})
            if name == "get_openings":
                return await self._post("/agent/openings", {"dateTime": args.get("dateTime", "")})
            if name == "book_appointment":
                return await self._post(
                    "/agent/book", {"dateTime": args.get("dateTime", ""), "intakeId": self._intake_id}
                )
            if name == "schedule_callback":
                body: dict = {"intakeId": self._intake_id}
                if args.get("callback_in_minutes") is not None:
                    body["callbackInMinutes"] = args["callback_in_minutes"]
                if args.get("callback_after"):
                    body["callbackAfter"] = args["callback_after"]
                return await self._post("/agent/callback", body)
            if name == "mark_outcome":
                return await self._post(
                    "/agent/mark-outcome",
                    {"intakeId": self._intake_id, "outcome": args.get("outcome", "unreachable")},
                )
            # Retained so a re-added schema still works, but note_caller is no longer offered:
            # every call cost the caller a turn. The model would speak, call the tool, then start a
            # NEW response after the result — "Hi Michael, let me get oriented" followed by "Hi
            # Michael. What can I help you with?". The name is now read off the transcript instead,
            # which costs nothing and produces the sentence the caller should have heard first.
            if name == "note_caller":
                # Purely local, like take_message: nothing to post anywhere, it just needs to reach
                # the bridge's state so the finished call carries a name. Kept OUT of take_message
                # because a caller giving their name is not the same event as leaving a message —
                # most callers do the first and never the second.
                return json.dumps({"recorded": True})
            if name == "take_message":
                # Inbound only. There is no intake to attach this to (a stranger called us), so the
                # message rides out on the call log the bridge already persists at call end — see
                # `messages` in the bridge state. Returning it lets the model read the confirmation
                # back rather than inventing one.
                return json.dumps(
                    {
                        "recorded": True,
                        "message": "Message recorded — the team will follow up.",
                    }
                )
            if name in ("end_call", "transfer_to_human"):
                # Both are handled by the bridge, which owns the call's plumbing: end_call drains
                # the audio and closes the stream; transfer_to_human redirects the live call out of
                # the stream entirely (a `<Connect>` cannot be escaped from in-band). This branch is
                # only a safety net so neither tool ever looks "unknown" to the model.
                return json.dumps({"ok": True})
            return json.dumps({"error": f"unknown tool {name}"})
        except Exception as exc:  # noqa: BLE001 — a tool failure must not drop the call
            log.warning("tool %s failed: %s", name, exc)
            return json.dumps({"error": "That didn't go through — let's try again."})

    async def record_call_log(self, transcript: str, summary: str) -> None:
        """Persist the finished call's transcript (+ one-line summary) to the backend. Best-effort
        — a logging failure must never affect the call, which is already over by the time we post."""
        if not self._intake_id:
            return  # a test call with no lead id — nothing to attach it to
        try:
            await self._post(
                "/agent/call-log",
                {"intakeId": self._intake_id, "transcript": transcript, "summary": summary},
            )
        except Exception as exc:  # noqa: BLE001
            log.warning("could not save call log: %s", exc)

    async def _post(self, path: str, body: dict) -> str:
        headers = {"Content-Type": "application/json"}
        if self._cfg.agent_tools_secret:
            headers["x-agent-secret"] = self._cfg.agent_tools_secret
        async with httpx.AsyncClient(timeout=self._cfg.request_timeout) as client:
            resp = await client.post(f"{self._cfg.backend_url}{path}", json=body, headers=headers)
        log.info("tool %s -> %s", path, resp.status_code)
        # Return the backend's JSON body verbatim; it carries a speakable `message` plus fields.
        return resp.text or json.dumps({"ok": resp.is_success})
