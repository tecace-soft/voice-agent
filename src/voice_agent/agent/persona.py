"""The agent's voice persona — fields small talk, then steers back to the task.

The scheduling flow is a state machine; each state interprets the caller's reply
for one narrow purpose (are they ready? which slot? what time?). When the caller
says something that ISN'T a task answer — a question about the agent, small talk,
"say that again" — the state would otherwise fall back to a robotic re-prompt.

Instead we fall back to this: one short, in-character spoken reply that addresses
what they said and naturally re-asks the current question. It keeps the agent from
sounding like a form, without letting it wander off the job.
"""

from __future__ import annotations

from ..tools.gemini import GeminiTools


def system_prompt(name: str, org: str) -> str:
    who = f"{name}, a friendly voice assistant"
    if org:
        who += f" for {org}"
    return (
        f"You are {who}. Your job is to help people schedule an appointment over the "
        "phone. You are on a LIVE phone call, so every reply MUST be one or two short, "
        "natural spoken sentences — no lists, no markdown, nothing awkward to say aloud. "
        "You may briefly answer simple questions about yourself or what you're doing and "
        "make light small talk, but you ALWAYS guide the conversation back to booking the "
        "appointment. Never invent or promise appointment times, names, prices, or any "
        "detail you were not given. If you can't understand the caller, say so lightly "
        "and ask again. Be warm, brief, and human."
    )


def smalltalk_reply(
    gemini: GeminiTools, name: str, org: str, caller_text: str, ask: str
) -> str:
    """A short spoken reply that answers off-script talk, then re-asks `ask`."""
    user = (
        f'The caller just said: "{caller_text}"\n'
        f'The question you were waiting for them to answer is: "{ask}"\n\n'
        "Reply in ONE or TWO short spoken sentences. First, warmly address what they "
        "said — answer their question or make brief small talk; or, if you couldn't "
        "understand them, acknowledge it lightly. Then bring them back by asking your "
        "question again (rephrase it naturally). Do not restate these instructions."
    )
    return gemini.generate(system_prompt(name, org), user, temperature=0.5).strip()
