"""Build the `session.start` payload for a GPT-Live session (used when OPENAI_LIVE_MODEL is set).

GPT-Live is not a Realtime model with a new name. It runs on its own endpoint and splits a call in
two: a full-duplex VOICE model holds the conversation and DELEGATES reasoning and tool use to a
backend text model (Responses delegation), which calls our functions. So the single Realtime prompt
is given to both halves with a short preamble each, and the tools move off the session and onto the
backend.

Audio stays G.711 μ-law at 8kHz, so Twilio's frames still pass straight through with no resampling.
There is no turn-detection or transcription config to send — GPT-Live decides when to speak itself,
and transcripts of both sides arrive without being asked for.
"""

from __future__ import annotations

from ..config import Config
from ..tools.agent_tools import TOOL_SCHEMAS

LIVE_URL = "wss://api.openai.com/v1/live/sessions"

def _voice_preamble(tools: list[dict]) -> str:
    """How the voice half should read the shared prompts, in OpenAI's delegation-policy format.

    The shared prompts say "call transfer_to_human", "call end_call" throughout, and the voice model
    cannot call anything — only the backend can, and only when the voice model DELEGATES, which
    GPT-Live leaves entirely to its discretion. A one-line mention of delegation was not enough: on
    the first real call the agent said "let me put you through… one moment", took Route A's "say
    NOTHING after that" literally, never delegated, and the caller sat in silence until they hung
    up. So this names the call's actual tools and says, bluntly, that saying is not doing.
    """
    capabilities = "\n".join(
        f"- {t['name']}: {' '.join((t.get('description') or '').split())}"
        for t in tools
        if t.get("type") == "function"
    )
    return f"""\
# How this call works (read this first)
You are the VOICE of this call. You cannot run tools yourself. A backend assistant runs them, and
it only acts when you DELEGATE to it. Saying you will do something does not do it: if you tell the
caller "let me put you through" or "I'll take that down" and do not delegate, nothing happens and
the caller is left in silence. Wherever the instructions below say to "call" a tool, that means
delegate it.

Delegation policy:
Backend tools:
{capabilities}

Delegate to the backend when:
- The instructions below say to call any of the tools above. Delegate in the SAME turn as the line
  you say to the caller: say the line, then delegate straight away. Never wait for the caller to
  reply first, and never treat the line you said as the action itself.
- A correction changes work you already delegated.

Do not delegate to the backend when:
- You can answer from these instructions or from a result the backend already gave you.
- You need a brief clarification to understand the request.

Delegate before giving an answer that depends on backend work. Do not guess the result while
waiting: never say a time is open, a booking is made or a message is recorded until the backend has
returned it. When the conversation is over, delegate end_call; the closing words are handled for
you.

# Never leave the caller in silence
Every time you answer a question or finish something for the caller, end that SAME turn by handing
it back: ask "Is there anything else I can help you with?" in the language they are speaking. The
only exception is when your turn already ends with a question to them. Never stop on a statement and
wait — the caller cannot tell you have finished, and the line goes dead.

"""

_BACKEND_PREAMBLE = """\
You are the backend for a live phone voice agent. A separate voice model is talking to the caller
and delegates to you whenever the conversation needs a tool. Work out from the conversation which
tool to call and with what arguments, following the call rules below, and call it. Then reply with
one or two short plain sentences of facts the voice model can say — no markdown, no lists. Only
report what a tool actually returned; never invent a time, an opening or a confirmation. Call
end_call only when the call rules below say the conversation is over.

The call rules the voice model follows:

"""

# Per minute of voice session, billed per second. Backend tokens are charged on top.
VOICE_PRICE_PER_MINUTE = 0.05

# Per 1M tokens: input, cached input, output. Longest prefix wins, so order does not matter here.
_BACKEND_PRICES = {
    "gpt-5.6-luna": (0.20, 0.02, 1.20),
    "gpt-5.6-terra": (2.00, 0.20, 12.00),
    "gpt-6-astra": (10.00, 1.00, 50.00),
}


def backend_cost(model: str, input_tokens: int, cached_tokens: int, output_tokens: int) -> float:
    """Dollar cost of backend tokens, or 0.0 for a model with no known price."""
    matches = [p for p in _BACKEND_PRICES if model.startswith(p)]
    if not matches:
        return 0.0
    ti, ct, to = _BACKEND_PRICES[max(matches, key=len)]
    uncached = max(input_tokens - cached_tokens, 0)
    return (uncached * ti + cached_tokens * ct + output_tokens * to) / 1_000_000


def _backend_tools(tools: list[dict]) -> list[dict]:
    """The Realtime function schemas, as Responses tools.

    The shapes already match; `strict` is pinned off because Responses can enforce strict schemas,
    which require every property to be listed as required — and schedule_callback deliberately takes
    one of two optional arguments.
    """
    return [{**t, "strict": False} if t.get("type") == "function" else t for t in tools]


def build_live_session_start(
    cfg: Config, instructions: str, tools: list[dict] | None = None
) -> dict:
    """Build the session.start event. `tools` defaults to the outbound set, as in session.py."""
    tools = TOOL_SCHEMAS if tools is None else tools
    responses: dict = {
        "model": cfg.openai_live_backend_model,
        "instructions": _BACKEND_PREAMBLE + instructions,
        "tools": _backend_tools(tools),
        "tool_choice": "auto",
        # One call at a time. The booking flow is a sequence (check a time, then book it), and
        # end_call / transfer_to_human take the call away — neither should race another tool.
        "parallel_tool_calls": False,
    }
    if cfg.openai_live_reasoning_effort.lower() != "default":
        # Every tool answer waits on this reasoning, and on a phone call that wait is silence.
        responses["reasoning"] = {"effort": cfg.openai_live_reasoning_effort}
    return {
        "type": "session.start",
        "event_id": "session_start",
        "session": {
            "model": cfg.openai_live_model,
            "instructions": _voice_preamble(tools) + instructions,
            "audio": {
                "format": {"type": "audio/pcmu", "rate": 8000},
                "output": {"voice": cfg.openai_voice.lower()},
            },
            "delegation": {"type": "responses", "responses": responses},
        },
    }
