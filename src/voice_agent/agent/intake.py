"""The intake agent — we drive the conversation; Gemini and Hermes assist.

Topology (option a): our code owns the loop and the state. Each caller turn is
run through Gemini `extract_fields` to update what we've captured, and Gemini
phrases the next question. Hermes is called only for one bounded sub-task — the
closing confirmation — and never on the critical path: if it is slow, errors, or
wanders off using its tools, we fall back to a plain template so the intake
still completes.

The field list is passed in (it will come from the Typeform definition later);
nothing here is hard-coded to a particular form.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

from ..config import Config
from ..tools.gemini import GeminiTools
from ..tools.hermes import HermesChat, HermesSession

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class IntakeField:
    name: str
    description: str
    required: bool = True
    question: str = ""                    # exact wording to ask (e.g. from Typeform)
    choices: tuple[str, ...] = ()         # options for choice questions


@dataclass
class IntakeResult:
    """The outcome of one caller turn."""

    agent_message: str          # what the agent should say next (spoken aloud)
    done: bool                  # True once every required field is captured
    record: dict[str, str] = field(default_factory=dict)   # captured so far / final
    missing: list[str] = field(default_factory=list)       # required fields still needed


# How many times a required-but-unanswered question is re-asked before the
# agent moves on (prevents an unanswered required field from looping forever).
MAX_ASKS_REQUIRED = 3

_QUESTION_SYSTEM = (
    "You are a warm, efficient phone intake agent. Ask for ONE missing item in a "
    "single short sentence that sounds natural spoken aloud. Do not greet the "
    "caller again mid-conversation, and do not list multiple questions."
)


class IntakeAgent:
    """Collect a set of fields from a caller over a multi-turn conversation."""

    def __init__(
        self,
        cfg: Config,
        fields: list[IntakeField],
        *,
        use_hermes_closing: bool = True,
        emit_closing: bool = True,
    ) -> None:
        if not fields:
            raise ValueError("IntakeAgent needs at least one field to collect")
        self._cfg = cfg
        self._fields = fields
        self._gemini = GeminiTools(cfg)
        self._use_hermes_closing = use_hermes_closing
        # When a scheduling phase follows, the driver handles the goodbye, so the
        # intake shouldn't say one when the last form question is answered.
        self._emit_closing = emit_closing
        self._transcript: list[str] = []
        self._captured: dict[str, str] = {}
        self._ask_counts: dict[str, int] = {}

    # -- public API ------------------------------------------------------

    def greeting(self) -> str:
        return "Hi, thanks for calling. " + self._pose(self._fields[0])

    def handle(self, user_text: str) -> IntakeResult:
        """Process one caller utterance and return the agent's next move."""
        self._transcript.append(user_text)

        extraction = self._gemini.extract_fields(
            " ".join(self._transcript), self._field_specs()
        )
        self._captured = extraction["values"]

        nxt = self._next_field()
        if nxt is not None:
            return IntakeResult(
                self._pose(nxt), False, dict(self._captured), self._required_missing()
            )

        closing = self._closing_message() if self._emit_closing else ""
        return IntakeResult(closing, True, dict(self._captured), self._required_missing())

    # -- internals -------------------------------------------------------

    def _next_field(self) -> IntakeField | None:
        """The next question to ask, walking the form in order.

        Every field is asked; a field drops out once it's answered, once an
        optional field has been asked, or once a required field has been asked
        MAX_ASKS_REQUIRED times (so an unanswered required question can't loop).
        Returns None when there is nothing left to ask.
        """
        for f in self._fields:
            if self._captured.get(f.name):
                continue
            asked = self._ask_counts.get(f.name, 0)
            if f.required and asked < MAX_ASKS_REQUIRED:
                return f
            if not f.required and asked == 0:
                return f
        return None

    def _required_missing(self) -> list[str]:
        return [f.name for f in self._fields if f.required and not self._captured.get(f.name)]

    def _field_specs(self) -> list[dict[str, str]]:
        specs = []
        for f in self._fields:
            desc = f.description or f.question
            if f.choices:
                desc = f"{desc} (must be one of: {', '.join(f.choices)})"
            specs.append({"name": f.name, "description": desc})
        return specs

    def _pose(self, field_obj: IntakeField) -> str:
        """Ask a field and record that we asked it."""
        self._ask_counts[field_obj.name] = self._ask_counts.get(field_obj.name, 0) + 1
        return self._ask(field_obj)

    def _ask(self, field_obj: IntakeField) -> str:
        """Phrase a spoken question for one field, grounded in its exact wording."""
        if field_obj.question:
            grounding = f'Ask this question naturally, out loud: "{field_obj.question}"'
        else:
            grounding = f"Ask the caller for their {_spoken(field_obj.name)} ({field_obj.description})."
        if field_obj.choices:
            grounding += f" The options to read out are: {', '.join(field_obj.choices)}."
        prompt = f"Captured so far: {self._captured or 'nothing yet'}.\n{grounding}"
        try:
            return self._gemini.generate(_QUESTION_SYSTEM, prompt)
        except Exception as exc:  # never let phrasing failure stall the intake
            log.warning("question phrasing failed (%s); using template", exc)
            return field_obj.question or f"Could I get your {_spoken(field_obj.name)}?"

    def _closing_message(self) -> str:
        readback = ", ".join(f"{_spoken(k)}: {v}" for k, v in self._captured.items())
        fallback = f"Great, I have everything I need — {readback}. Thank you, goodbye!"
        if not self._use_hermes_closing:
            return fallback
        return self._hermes_closing(readback, fallback)

    def _hermes_closing(self, readback: str, fallback: str) -> str:
        """Bounded Hermes sub-task: a warm spoken sign-off. Degrades to template."""
        prompt = (
            "You are wrapping up a phone intake call. In ONE short, warm sentence, "
            "confirm you've recorded the caller's details and say goodbye. Reply "
            "with plain text only — do not use any tools or write any files.\n\n"
            f"Details on file: {readback}"
        )
        try:
            session = HermesSession(self._cfg)
            reply = HermesChat(session).ask(prompt, timeout=30).strip()
            # Guard against the agent returning tool-error chatter instead of a sign-off.
            if reply and "error" not in reply.lower():
                return reply
            log.warning("Hermes closing looked unusable (%r); using template", reply[:80])
        except Exception as exc:
            log.warning("Hermes closing failed (%s); using template", exc)
        return fallback


def _spoken(field_name: str) -> str:
    """Turn a field key like 'full_name' into spoken 'full name'."""
    return field_name.replace("_", " ")
