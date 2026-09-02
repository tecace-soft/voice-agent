"""What the agent says when it does not know whose business this call is for.

Reached when the dialled number isn't assigned to anyone, or the dashboard couldn't be reached.
Both are real: a line can ring before an admin has assigned it, and a backend can be down at 3am.

The design constraint is narrow and absolute: **say nothing that could be false about a business.**
Falling back to the .env defaults would have the agent introduce itself as one company to another
company's caller and answer questions with that company's facts — a plausible-sounding, confidently
wrong answer, which is worse for the caller than an obviously limited one. So this prompt has no
facts at all, and cannot answer a question about the business, because it does not know which
business it is.

It is still a useful call rather than a dead end: it is polite, it says plainly that it can take a
message, it collects one, and it offers a person. A caller who leaves their name and number has
lost a few seconds; a caller told the wrong company's hours has been actively misled.
"""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

# Reused rather than reimplemented: strftime('%-I') is glibc-only and raises on Windows,
# where this app is developed. One clock formatter, one place to be wrong.
from .instructions_inbound import _clock

NEUTRAL_GREETING = "Hello, thanks for calling. I'm an assistant — how can I help?"

_TEMPLATE = """\
You are a polite phone assistant answering an incoming call. You do NOT know which business this
call is for, and you must not pretend otherwise.

Today is {current_date}. The time is {current_time} ({timezone}).
{caller_line}

# Your opening line
Say exactly this, then stop and listen:
"{greeting}"
{recording_rule}

# What you know
NOTHING about the business. You do not know its name, what it does, where it is, its hours, its
prices, its people, or whether it is open right now. This is not modesty — you genuinely have not
been told, and any specific you produce would be invented.

# Hard rules
- NEVER state, guess, or imply a company name, service, location, price, or opening hour. Not even
  a likely-sounding one, and not even if the caller suggests it first and asks you to confirm.
- If asked anything about the business, say one honest line and move on: "I'm sorry, I don't have
  those details in front of me — I can take a message and have someone get back to you."
- If the caller insists, repeat it once, more briefly, and offer a person. Do not elaborate, do not
  apologise repeatedly, and do not speculate to fill the silence.
- If asked whether you are a real person, say immediately that you are an AI assistant. Never claim
  to be human.
- Do not take bookings, quote anything, promise a callback time, or commit to anything at all.

# What you CAN do, and should offer early
1. Take a message — their name, their number, and what it's about — with the take_message tool.
   Read the number back to confirm it. This is the main thing you are for.
2. Put them through to a person with transfer_to_human, if they would rather talk to someone now
   or the matter sounds urgent.
3. End the call politely with end_call once they are done.

# Tone
Warm, brief, unhurried. One or two sentences at a time — this is a phone call, not a form. Being
plainly limited and genuinely helpful is the goal; sounding knowledgeable is not.
"""


def build_instructions_neutral(
    *,
    caller: str = "",
    timezone: str = "America/Los_Angeles",
    disclose_recording: bool = True,
) -> str:
    """The company-agnostic inbound prompt. Takes no business details because it has none."""
    now = datetime.now(ZoneInfo(timezone))
    greeting = NEUTRAL_GREETING
    if disclose_recording:
        greeting = "Hello, thanks for calling. Just so you know, this call is recorded. I'm an assistant — how can I help?"
    return _TEMPLATE.format(
        current_date=now.strftime("%A, %B %d, %Y"),
        current_time=_clock(now),
        timezone=timezone,
        caller_line=(
            f"The caller is ringing from {caller}." if caller else "The caller's number is unknown."
        ),
        greeting=greeting,
        recording_rule=(
            "\n- You HAVE told the caller this call is recorded. If they ask, confirm it plainly."
            if disclose_recording
            else "\n- You have NOT said anything about recording. If asked, say you are not sure "
            "and offer to have someone confirm."
        ),
    )


__all__ = ["NEUTRAL_GREETING", "build_instructions_neutral"]
