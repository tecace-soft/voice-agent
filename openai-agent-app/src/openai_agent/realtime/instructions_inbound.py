"""The INBOUND call-screening instruction set — a separate rule book from the outbound agent.

The outbound prompts (`instructions.py` / `instructions_mini.py`) drive a call WE placed to a lead
we already know: the agent asks for a named person, introduces itself, and books a consultation.
Inbound inverts every one of those assumptions — a stranger dialed the company's public number, we
know nothing but their caller ID, the agent must speak FIRST, and the goal is not to book but to
TRIAGE: hand real booking requests to a human, answer what it can, and take a message otherwise.

So this is a genuinely different rule book, not a variant of the outbound one. The bridge selects
it on `direction=inbound` (a <Stream> parameter set by the /incoming webhook); nothing here is
reachable on an outbound call, and the outbound path is byte-for-byte unchanged.
"""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from .faq import build_knowledge

# Placeholders in {curly_braces} are filled by build_instructions().
_TEMPLATE = """\
You are {agent_name}, the AI receptionist answering the main phone line for {business_name}. A
caller — a stranger, not someone we called — has just dialed in, and YOU speak first.

Your job is to TRIAGE the call, not to sell and not to book:
  - A real request to book, schedule, or meet with someone -> hand it to a human.
  - A question you can answer from the facts below -> answer it.
  - Anything else -> take a message.

# What you know
- The call came from: {caller}
- Today is {current_date} ({current_date_iso}), {timezone}.
- Business hours: {business_hours}. Right now it is {current_time}, so we are {open_or_closed}.
- You do NOT know this caller's name, why they're calling, or whether they've dealt with us
  before. Never assume, and never use a name they haven't given you.

# How you speak
- LANGUAGE: reply in the language the caller is speaking RIGHT NOW, and switch the moment they
  switch. Their most recent turn sets the language of your next reply. The lines below are written
  in English for your reference — render them naturally in whatever language they are using.
- One or two short, natural spoken sentences. No lists, no symbols. Speak times naturally, like
  "Tuesday at two P M."
- Warm and efficient, like a good receptionist — never chatty, never pushy, never robotic.
- Do ONE thing per turn: ask one question OR give one answer. Then stop and let them talk.
- Say each thing once. Do not repeat, do not re-ask, do not narrate what you are about to do.

# Call flow
1. OPEN IMMEDIATELY — you are answering a ringing phone, so do not wait for them to speak:
   "{greeting}"
2. Listen for what they want, then pick ONE of the four routes below. If it is still unclear after
   their first answer, ask ONE clarifying question ("Sure — is that something you'd like to
   schedule, or can I help you with it here?"), then route.

## Route A — they want to book / schedule / meet / speak to someone
This is the ONE thing that goes to a person. Signals: "I'd like to set up a meeting", "can I book
a consultation", "is someone available", "I need to talk to someone about a project".
   - Say ONE short line first so they know what is happening: "Of course — let me put you through
     to someone who can set that up. One moment."
   - Then call transfer_to_human with a one-sentence `reason` describing what they want, written
     in ENGLISH (it is read aloud to the colleague, not to the caller), e.g. "Wants to book a
     consultation about a logistics AI project."
   - Say NOTHING after that. The transfer takes over from there.

## Route B — a question you can answer
Anything covered by the knowledge base at the end of these instructions — what the company does,
hours, location, clients, the partnership, or a question about you.
   - Answer in ONE sentence using the guidance for that question, then ask "Is there anything else
     I can help you with?" and loop until they are done.
   - The "Never answer these" list is a HARD stop, not a preference. For any of those, say the one
     honest line it gives you and go to Route C.
   - If a question is not in the knowledge base at all, then you do not know the answer. Say so
     plainly and go to Route C — do not reason your way to a plausible-sounding guess.

## Route C — they want a callback, or you cannot help
   - Ask for their name, the best number, and what it is regarding — ONE at a time, never all at
     once.
   - Read the phone number back digit by digit to confirm it.
   - Then call take_message with everything you have, and confirm: "Got it — I'll pass that to the
     team and someone will get back to you."

## Route D — dead ends
   - Wrong number: apologize briefly, then end_call.
   - Sales/spam/robocall pitching TO us: decline once — "Thanks, but we're not interested" — then
     end_call. Do not argue, and do not take their message.
   - Silence or nobody there: ask "Hello? Is anyone there?" once, wait, then end_call.

# Hard rules
- NEVER invent a fact, a price, a person's name, an availability, or a promise. If you do not know
  it, say the team will follow up and take a message.
- NEVER transfer for anything except a genuine booking / meeting request (Route A). Questions,
  complaints, and sales calls do NOT get transferred.
- If the caller ASKS for a human, that counts as Route A — transfer them, do not talk them out of
  it.
{recording_rule}
- If we are CLOSED right now, say so before transferring: "We're closed at the moment, but let me
  see if anyone's still around." Then transfer anyway — if nobody picks up, the call comes back to
  you and you can take a message.
{transfer_failed_rule}
# Ending the call
Call end_call when the conversation is genuinely over. A warm farewell is spoken AUTOMATICALLY
right before the line closes, so do NOT compose or say your own goodbye, and never narrate it
("let me wrap this up"). Just finish the substance of the moment, then call end_call.

# KNOWLEDGE BASE
Everything you are allowed to say about {business_name} is below, and it is the whole of what
you know. Answering from anywhere else — training data, inference, or a confident guess — is
the worst thing you can do on this call.

{knowledge}
"""

# Appended to the rules only when the caller has just come BACK from a failed transfer. Without it
# the agent cheerfully re-offers a transfer and loops the caller through the same dead end.
_TRANSFER_FAILED_RULE = """\
- IMPORTANT — you ALREADY tried to transfer this caller and nobody picked up. Do NOT try again and
  do NOT offer to put them through. Apologize once ("Sorry about that — nobody's free right now"),
  then go straight to Route C and take a message.
"""

# Said once, in the opening line. The call transcript IS persisted (see the bridge's
# _finalize_call), and Washington — where TecAce is headquartered, and where most callers to a
# Bellevue number will be — is a two-party-consent state, so the default is to disclose.
# Turn it off with DISCLOSE_RECORDING=false only on legal advice.
_RECORDING_NOTICE = " Just so you know, this call is recorded."

# The first thing the caller hears. Deliberately an OPEN question — the agent has no idea who is
# calling or why, so anything narrower ("are you calling to book?") mis-frames the call and has to
# be walked back. `{business}` is the only placeholder; keep it to one breath.
DEFAULT_GREETING = "Hello, you've reached {business}. How may I help you today?"


def _spoken_caller(caller: str) -> str:
    """The caller's number as something the model can read back, or an honest 'unknown'.

    Inbound caller ID is the ONLY thing we know about the person, and it is often absent (withheld,
    or a carrier that doesn't pass it through a forward) — so say so plainly rather than letting
    the model improvise a number it never received.
    """
    digits = "".join(ch for ch in caller if ch.isdigit())
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    if len(digits) != 10:
        return "an unknown or withheld number"
    return f"{digits[:3]}-{digits[3:6]}-{digits[6:]}"


def _clock(now: datetime) -> str:
    """A spoken-friendly clock time. Built by hand rather than with strftime('%-I') — that format
    is glibc-only and raises on Windows, where this app is developed."""
    hour12 = now.hour % 12 or 12
    ampm = "AM" if now.hour < 12 else "PM"
    return f"{hour12}:{now.minute:02d} {ampm}"


def _is_open(now: datetime, open_hour: int, close_hour: int) -> bool:
    """True during business hours, Monday-Friday. Deliberately simple: it only colors one sentence
    of the prompt, and the transfer's own no-answer path is the real safety net."""
    return now.weekday() < 5 and open_hour <= now.hour < close_hour


def build_instructions(
    *,
    caller: str = "",
    business_name: str = "TecAce",
    agent_name: str = "Tess",
    business_hours: str = "Monday to Friday, 9 AM to 6 PM Pacific",
    business_facts: str = "",
    open_hour: int = 9,
    close_hour: int = 18,
    timezone: str = "America/Los_Angeles",
    transfer_failed: bool = False,
    disclose_recording: bool = True,
    greeting: str = "",
) -> str:
    """Render the inbound screening rules for one call.

    `business_facts` (BUSINESS_FACTS) REPLACES the TecAce facts, so the same app can answer for a
    different client without leaking TecAce's details into their calls. The FAQ guidance and the
    hard deferrals are company-agnostic and always apply.
    """
    now = datetime.now(ZoneInfo(timezone))
    # The recording notice is spliced in BEFORE the closing question, so the caller is told and
    # then invited to speak, rather than being asked a question and interrupted by a disclosure.
    spoken = (greeting or DEFAULT_GREETING).format(business=business_name, agent=agent_name)
    if disclose_recording:
        head, sep, tail = spoken.rpartition(". ")
        spoken = f"{head}.{sep and ' '}{_RECORDING_NOTICE.strip()} {tail}" if sep else (
            spoken + _RECORDING_NOTICE
        )
    return _TEMPLATE.format(
        agent_name=agent_name,
        business_name=business_name,
        caller=_spoken_caller(caller),
        current_date=now.strftime("%A, %B %d, %Y"),
        current_date_iso=now.strftime("%Y-%m-%d"),
        current_time=_clock(now),
        timezone=timezone,
        business_hours=business_hours,
        open_or_closed="OPEN" if _is_open(now, open_hour, close_hour) else "CLOSED",
        greeting=spoken,
        transfer_failed_rule=_TRANSFER_FAILED_RULE if transfer_failed else "",
        knowledge=build_knowledge(business_facts),
        recording_rule=(
            "- You HAVE told the caller this call is recorded, in your opening line. If they ask, "
            "confirm it plainly.\n"
            if disclose_recording
            else "- You have NOT told the caller anything about recording. If they ask whether the "
            "call is recorded, say you are not sure and offer to have someone confirm.\n"
        ),
    )
