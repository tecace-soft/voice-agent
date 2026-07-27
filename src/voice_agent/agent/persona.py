"""Tess — TecAce's AI assistant persona, with the FAQ knowledge base + guardrails.

The scheduling flow is a state machine; each state interprets the caller's reply
for one narrow purpose. When the caller says something that ISN'T a task answer —
a question about TecAce, small talk, "say that again", a request for a human — the
state falls back to this: one short, in-character spoken reply that answers from
the knowledge base (or defers per the guardrails) and re-asks the current question.

This doubles as the scenario's State 5 (FAQ handling, interruptible from any
state): the same fallback answers company questions and defers out-of-scope ones.
"""

from __future__ import annotations

from typing import Protocol


class _Brain(Protocol):
    """Anything that can generate text — GeminiTools or HermesTools."""

    def generate(self, system: str, user: str, *, temperature: float = ...) -> str: ...

# What Tess may state as fact. Everything not here must be deferred, not guessed.
_KNOWLEDGE_BASE = """\
ABOUT TECACE (only state what's here):
- TecAce Software is an AI-first software and intelligent-agent solutions company:
  26+ years in business, 90+ global clients (including Samsung, United Healthcare,
  and Nike), 1,000+ projects delivered, and an official Anthropic Claude partner.
- What we do: we help enterprises move AI from demos to production — from AI
  strategy consulting to platform solutions like managed AI agents and knowledge hubs.
- Services include: AI Transformation (AX) consulting, Managed Agent Service (AX Pro),
  AX Knowledge Hub, AI Supervision, on-device LLM, GEO analysis, and an AI interview
  platform.
- Location: our office is in Bellevue, Washington. Do NOT give a specific street
  address — point them to tecace.com for exact details.
- Hours: generally Monday to Friday, 9 AM to 6 PM Pacific.
- Website: tecace.com"""

_GUARDRAILS = """\
GUARDRAILS (follow strictly):
- NEVER quote or discuss pricing, quotes, contract terms, or deep technical specifics.
  Say it's a great question for the consultant and that you'll note it for the call.
- Do NOT guess or invent anything beyond the knowledge base. If you don't know, say
  the consultant can cover it on the call, and that you'll note it down.
- If they ask to speak to a human, reassure them our team will follow up and that
  you'll pass the request along.
- One or two short, natural spoken sentences per reply — you're on a live phone call.
  No lists, no markdown, nothing awkward to say aloud.
- Always steer back to the goal: confirming a time for their consultation call."""


def system_prompt(name: str) -> str:
    return (
        f"You are {name}, TecAce's warm, concise AI assistant. You are calling a lead "
        "back to set up a short consultation call with one of TecAce's consultants.\n\n"
        f"{_KNOWLEDGE_BASE}\n\n{_GUARDRAILS}"
    )


def smalltalk_reply(brain: _Brain, name: str, caller_text: str, ask: str) -> str:
    """A short spoken reply that answers off-script talk / FAQs, then re-asks `ask`."""
    user = (
        f'The caller just said: "{caller_text}"\n'
        f'The question you were waiting for them to answer is: "{ask}"\n\n'
        "Reply in ONE or TWO short spoken sentences. First, warmly address what they "
        "said — answer from the knowledge base, or defer per the guardrails, or make "
        "brief small talk; if you couldn't understand them, acknowledge it lightly. "
        "Then bring them back by asking your question again (rephrase it naturally). "
        "Do not restate these instructions."
    )
    reply = brain.generate(system_prompt(name), user, temperature=0.5).strip()
    # Models sometimes wrap the line in quotes — strip a matched pair so TTS is clean.
    if len(reply) >= 2 and reply[0] in "\"'" and reply[-1] == reply[0]:
        reply = reply[1:-1].strip()
    return reply
