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

import re
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
{hours_line}
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

## Route A — anything to do with an appointment, or reaching a person
This is what goes to a person. Signals: booking or scheduling ("I'd like to set up a meeting", "can
I book a consultation"), RESCHEDULING or moving an existing appointment ("I need to change my
appointment", "can I move my Tuesday booking"), CANCELLING one ("I need to cancel", "I can't make
it tomorrow"), asking about an appointment they already have, or asking for a person at all ("is
someone available", "I need to talk to someone about a project").

An existing appointment is ALWAYS a person's job. You cannot see the calendar, so you cannot
confirm, move, or cancel anything yourself — attempting to would leave the caller believing
something was done that was not.{transfer_topics}
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
   - Silence or nobody there: ask "Hello? Is anyone there?" once, wait, then end_call. Background
     talk is NOT silence and is NOT someone else's call — if you can hear a room, someone is there.

# Hard rules
- When the caller gives their name, greet them by it ONCE and carry straight on in the same
  sentence: "Hi Michael. What can I help you with today?" Then use it sparingly — repeating it back
  every turn sounds like a script. Never narrate anything about noting, saving, or getting
  oriented; the caller is sitting in silence through every word, and none of those are for them.
- The phone carries the whole ROOM, not just the caller. You will hear other people talking near
  them, a TV, a colleague asking them something, both sides of a conversation you are not part of.
  Only respond to speech that is clearly addressed to YOU. If what you hear is someone talking to
  another person, sounds like it is mid-conversation, or makes no sense as a reply to what you just
  said, stay silent and wait — do not answer it, and do not treat it as the caller's turn.
- NEVER end the call because of speech you are unsure was meant for you. Overheard talk is not the
  caller saying goodbye, not a wrong number, and not proof nobody is there. Before ending a call
  for any of those reasons, ask once, plainly — "Sorry, are you still with me?" — and end it only
  if the answer is clearly yes-they've-gone. When in doubt, stay on the line: hanging up on a
  caller who was briefly distracted is far worse than waiting a few seconds too long.
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
_TRANSFER_FAILED_RULE = """\n- IMPORTANT — this caller has ALREADY been through a failed transfer, and your opening line
  has ALREADY apologised and explained that the lines are busy. Do not apologise again, do not
  explain again, and do not say the same thing in another way. They heard it.
- You ALREADY have their name and their number. Do NOT ask for either one. Asking again is how
  a caller learns that nothing they said was kept.
- There is ONE thing left to get: what they actually want — the booking, the change, the
  cancellation, in enough detail that a person can act on it without ringing back to ask. Get
  that, and when they say so, the day or time they are after.
- Then call take_message with what you have: the name you were given, the number you were
  given, the request, and requested_time if they said one. Confirm it back in one short line
  — "Got it, a body scrub, Tuesday afternoon" — and tell them someone will be in touch.
- After that, offer to help with anything else: "Anything I can answer while I have you?"
  Answer from the facts as normal. The message is already recorded; nothing asked afterwards
  changes it.
"""

# Said once, in the opening line. The call transcript IS persisted (see the bridge's
# _finalize_call), and Washington — where TecAce is headquartered, and where most callers to a
# Bellevue number will be — is a two-party-consent state, so the default is to disclose.
# Turn it off with DISCLOSE_RECORDING=false only on legal advice.
_RECORDING_NOTICE = " Just so you know, this call is recorded."

# The first thing the caller hears. Three jobs in one breath: say where they've reached, give the
# agent a NAME so the caller has something to address (without a name people say "hello? hello?"
# and talk over the agent), and hand the turn back with an OPEN question — anything narrower
# ("are you calling to book?") mis-frames the call and has to be walked back.
#
# The name goes in the SAME clause as the company, not a sentence of its own: the recording notice
# is spliced in before the final sentence, and a standalone "This is Tess." would get shunted
# behind the disclosure and land oddly.
DEFAULT_GREETING = "Hello, you've reached {business}, this is {agent}. How may I help you today?"

# Spoken when a caller comes BACK after a transfer that reached nobody. It replaces the greeting
# rather than following it: they have already been greeted, already said what they want, and
# already waited — being welcomed a second time as if they had just dialled is the moment they
# realise nobody is really listening. This says what happened and moves straight on.
RETURN_GREETING = (
    "Sorry, but all lines are busy. Please give me the reason for the call so our "
    "staff can get back to you."
)


# The last sentence boundary of ANY kind. Matching only ". " was fine while the greeting was ours
# and always contained one, but customers write their own: "Good afternoon, Acme! How can I help?"
# has no ". " at all, and the notice would land after the closing question — the caller asked
# something and then talked over. Greedy, so it finds the LAST boundary rather than the first.
_SENTENCE_BREAK = re.compile(r"^(.*[.!?])\s+(\S.*)$", re.S)


def _splice_notice(spoken: str) -> str:
    """Put the recording notice before the greeting's final sentence.

    The caller should be told, and THEN invited to speak. A greeting of one sentence has nothing to
    splice into, so the notice goes on the end — the only remaining place for it.
    """
    spoken = spoken.strip()
    match = _SENTENCE_BREAK.match(spoken)
    if not match:
        # One sentence, nothing to splice into. If it ENDS in a question — "Acme Dental, how may I
        # direct your call?" is a perfectly ordinary thing to want — the notice cannot go after it:
        # the caller starts answering and gets talked over by a legal disclosure. It goes first
        # instead, which is a touch abrupt but never interrupts anyone.
        if spoken.endswith("?"):
            return f"{_RECORDING_NOTICE.strip()} {spoken}"
        return spoken + _RECORDING_NOTICE
    head, tail = match.group(1), match.group(2)
    return f"{head} {_RECORDING_NOTICE.strip()} {tail}"


def _render_greeting(greeting: str, business_name: str, agent_name: str) -> str:
    """Fill {business} and {agent} into a greeting, and NOTHING else.

    Deliberately str.replace rather than str.format. This text is typed by a customer, and format()
    treats every brace in it as markup: a greeting like "Ask about our {new} menu" raises KeyError,
    and a stray "{" raises ValueError. That exception would land mid-call, on the line the caller
    hears first, for a customer who did nothing worse than use a brace in a sentence. Two literal
    substitutions cannot fail, and any other braces are simply spoken as written.
    """
    return (greeting or DEFAULT_GREETING).replace("{business}", business_name).replace(
        "{agent}", agent_name
    )


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


# When the business has given us nobody to put callers through to. Offering a transfer and then
# failing is worse than never offering: the caller has been told help is coming, waited for it, and
# then been handed back to the same assistant.
def _returning_context(caller_name: str, request: str) -> str:
    """What the agent already learned before it tried to put the caller through.

    The transfer restarts our side of the call, not theirs. From the caller's chair it is one
    conversation: they gave their name, said what they wanted, waited, and are now being spoken to
    again. Asking either question a second time tells them nobody was listening the first time,
    which is a worse impression than the failed transfer itself.
    """
    known = []
    if (caller_name or "").strip():
        known.append(f"- Their name is {caller_name.strip()}. Use it. Do NOT ask who is calling.")
    if (request or "").strip():
        known.append(
            f"- They already told you what they want: {request.strip()} Do NOT ask again what "
            f"the call is about — confirm it back instead, and fill in only what is missing."
        )
    if not known:
        return ""
    header = "\n\n# What you already know about this caller\n"
    return header + "\n".join(known)


def _transfer_topics_line(topics: str) -> str:
    """The customer's own list of what should reach a person, appended to Route A.

    Businesses disagree about this and the disagreement is not cosmetic: a spa wants cancellations
    put straight through, a software company wants them nowhere near a human. Written by the
    customer, so it is stated as an addition to the rules above rather than a replacement — the
    caller-facing guarantees are not theirs to switch off.
    """
    clean = (topics or "").strip()
    if not clean:
        return ""
    return (
        "\n\nAlso put the caller through for any of these, which this business has asked for:\n"
        + clean
    )


_NO_TRANSFER_RULE = """
## You cannot put anyone through on this call
There is no one to transfer to. NEVER offer to put a caller through, connect them, or "get someone
for them" — not even if they ask directly. Say you can't put calls through but you can take a
message and have someone get back to them, then take it. Do not explain why.
"""


def _hours_line(now: datetime, business_hours: str, open_hour: int | None, close_hour: int | None) -> str:
    """The hours line, which has THREE cases rather than open/closed.

    A customer may not have told us their hours, and the agent must not assert one either way when
    it doesn't know — "we're open" spoken to someone standing outside a locked door is exactly the
    kind of confidently-wrong answer this whole design avoids. Unknown hours become an instruction
    to say so, not a coin flip.
    """
    if business_hours and open_hour is not None and close_hour is not None:
        state = "OPEN" if _is_open(now, open_hour, close_hour) else "CLOSED"
        return (
            f"- Business hours: {business_hours}. Right now it is {_clock(now)}, so we are {state}."
        )
    if business_hours:
        # Hours in words but no usable clock boundary: safe to state, not safe to reason from.
        return (
            f"- Business hours: {business_hours}. You have NOT been told whether that means we are "
            "open at this moment — give the hours and let the caller judge; never say open or closed."
        )
    return (
        "- You have NOT been told the business hours. If asked what they are, or whether we are open "
        "right now, say you don't have that in front of you and offer to take a message. Never guess."
    )


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
    open_hour: int | None = 9,
    close_hour: int | None = 18,
    timezone: str = "America/Los_Angeles",
    transfer_failed: bool = False,
    transfer_topics: str = "",
    caller_name: str = "",
    known_request: str = "",
    disclose_recording: bool = True,
    greeting: str = "",
    can_transfer: bool = True,
) -> str:
    """Render the inbound screening rules for one call.

    `business_facts` (BUSINESS_FACTS) REPLACES the TecAce facts, so the same app can answer for a
    different client without leaking TecAce's details into their calls. The FAQ guidance and the
    hard deferrals are company-agnostic and always apply.
    """
    now = datetime.now(ZoneInfo(timezone))
    # The recording notice is spliced in BEFORE the closing question, so the caller is told and
    # then invited to speak, rather than being asked a question and interrupted by a disclosure.
    spoken = _render_greeting(greeting, business_name, agent_name)
    if disclose_recording:
        spoken = _splice_notice(spoken)
    return _TEMPLATE.format(
        agent_name=agent_name,
        business_name=business_name,
        caller=_spoken_caller(caller),
        current_date=now.strftime("%A, %B %d, %Y"),
        current_date_iso=now.strftime("%Y-%m-%d"),
        timezone=timezone,
        hours_line=_hours_line(now, business_hours, open_hour, close_hour),
        greeting=spoken,
        transfer_failed_rule=(
            # A returning caller gets BOTH: the recovery steps, and the flat statement that there
            # is nobody to put them through to. The tool is gone from their session either way, but
            # a model that only lost the tool can still PROMISE a transfer out loud and then fail
            # to make one, which is a worse experience than never offering.
            (_TRANSFER_FAILED_RULE + _NO_TRANSFER_RULE)
            if transfer_failed
            else "" if can_transfer else _NO_TRANSFER_RULE
        ),
        transfer_topics=(
            _transfer_topics_line(transfer_topics)
            + (_returning_context(caller_name, known_request) if transfer_failed else "")
        ),
        knowledge=build_knowledge(business_facts),
        recording_rule=(
            "- You HAVE told the caller this call is recorded, in your opening line. If they ask, "
            "confirm it plainly.\n"
            if disclose_recording
            else "- You have NOT told the caller anything about recording. If they ask whether the "
            "call is recorded, say you are not sure and offer to have someone confirm.\n"
        ),
    )
