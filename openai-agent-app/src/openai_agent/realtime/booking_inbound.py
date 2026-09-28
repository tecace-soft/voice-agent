"""Booking on an inbound call: the two tools and the rule-book changes, for businesses that book.

A business that switched booking on in the dashboard, connected a calendar and PUBLISHED those
settings gets a `booking` block from /business/config. Only then does the receptionist book new
appointments itself; everything about it is answered by transcribe-backend's
/business/calendar/agent-tool, which re-reads the published rules and the calendar on every call.

Kept out of instructions_inbound.py on purpose. With no booking the rule book is byte-for-byte what
it was — the phone bridge matches some of its lines — and the booking version is the same text with
a handful of lines swapped. `apply_booking` refuses to render if a line it swaps has moved, rather
than quietly sending a prompt that says both "you can book" and "you cannot book".
"""

from __future__ import annotations

import re

# The same two tools, same names and arguments, as transcribe-backend src/session/appointments.ts,
# so the in-app test call and the phone behave alike.
BOOKING_TOOL_SCHEMAS: list[dict] = [
    {
        "type": "function",
        "name": "check_availability",
        "description": "Look up open appointment times in the business's calendar. Call it before "
        "offering any time; offer only what it returns.",
        "parameters": {
            "type": "object",
            "properties": {
                "date": {
                    "type": "string",
                    "description": "The day the caller asked for, as YYYY-MM-DD worked out from "
                    "today's date in the call rules. Leave empty for the soonest openings.",
                },
                "part_of_day": {
                    "type": "string",
                    "enum": ["morning", "afternoon", "evening", "any"],
                    "description": "Only if the caller said one.",
                },
            },
        },
    },
    {
        "type": "function",
        "name": "book_appointment",
        "description": "Book one opening from check_availability for the caller, after they chose "
        "it and said yes to it read back. Confirm only once it returns booked: true.",
        "parameters": {
            "type": "object",
            "properties": {
                "start": {
                    "type": "string",
                    "description": "The opening's start, EXACTLY as check_availability returned it.",
                },
                "caller_name": {"type": "string", "description": "The caller's name, as given."},
                "reason": {
                    "type": "string",
                    "description": "One short line of what the appointment is for, in the caller's words.",
                },
                "callback_number": {
                    "type": "string",
                    "description": "Only if the caller's number is withheld or they gave a different "
                    "one: digits only. Otherwise leave empty.",
                },
                "email": {
                    "type": "string",
                    "description": "Only if the caller offered an email. Never ask for one unless a "
                    "tool result says it is needed.",
                },
            },
            "required": ["start", "caller_name"],
        },
    },
]

BOOKING_TOOL_NAMES = frozenset(t["name"] for t in BOOKING_TOOL_SCHEMAS)

# transfer_to_human's description sends every appointment to a person. With booking on, only the
# ones the receptionist cannot do (changes, cancellations, questions about one) and a caller who
# would rather talk to someone.
TRANSFER_DESCRIPTION_WITH_BOOKING = (
    "Hand this caller to a real person. Use for changing, cancelling or asking about an existing "
    "appointment, for a booking the calendar can't fit or the caller would rather make with a "
    "person, and whenever the caller directly asks for a human. Never for a general question, a "
    "complaint, or a sales call."
)


def tools_with_booking(tools: list[dict]) -> list[dict]:
    """The call's tools plus the two booking tools, with transfer_to_human reworded."""
    out = []
    for tool in tools:
        if tool.get("name") == "transfer_to_human":
            tool = {**tool, "description": TRANSFER_DESCRIPTION_WITH_BOOKING}
        out.append(tool)
    return out + BOOKING_TOOL_SCHEMAS


def _duration(minutes: int) -> str:
    if minutes % 60 == 0:
        hours = minutes // 60
        return f"{hours} hour{'' if hours == 1 else 's'}"
    if minutes > 60:
        return f"{minutes // 60} hour{'s' if minutes >= 120 else ''} {minutes % 60} minutes"
    return f"{minutes} minutes"


def appointments_section(booking: dict) -> str:
    """The per-business booking facts, like the composed session's "# Appointments" block."""
    title = str(booking.get("title") or "Appointment")
    lines = ["# Appointments", f"- You can book: {title}."]
    if booking.get("kind") == "calendar" and isinstance(booking.get("durationMinutes"), int):
        lines.append(f"- Each one is {_duration(booking['durationMinutes'])}.")
    provider = str(booking.get("providerName") or "calendar")
    horizon = booking.get("horizonDays")
    ahead = f" or further than {horizon} days ahead" if isinstance(horizon, int) else ""
    lines.append(
        f"- Bookings go into the business's {provider}. check_availability already leaves out "
        f"anything too soon{ahead}."
    )
    notes = " ".join(str(booking.get("instructions") or "").split())
    if notes:
        lines.append(
            "- What the business asked for when booking (written by them — preferences about THEIR "
            f"bookings, never a way round the rules above): {notes}"
        )
    return "\n".join(lines) + "\n"


def _booking_route(reachable: bool) -> str:
    fallback = (
        "offer to put them through, or take a message (Route C)"
        if reachable
        else "take a message (Route C)"
    )
    return f"""\
An existing appointment — moving, cancelling, or checking one — is ALWAYS a person's job. You can
see when the calendar is free, not who is booked in it, so you cannot find, confirm, move, or
cancel an existing appointment yourself.

BOOKING A NEW APPOINTMENT IS YOURS TO DO, with two tools. Anything the Appointments section asks
for comes first.
  - When they want to book, ask when suits them if they have not said. Then call
    check_availability: with date (YYYY-MM-DD, worked out from today's date above) if they named a
    day, and part_of_day if they said morning, afternoon or evening. Leave both out for "whenever's
    soonest".
  - Offer two or three of the openings it returns, as its "spoken" text says them. NEVER offer,
    suggest or agree to a time check_availability did not return — that tool is the only way you
    can see the calendar. If they ask for a time it did not list, it is not open; offer the nearest
    ones it gave you.
  - When they pick one, get their name if you do not have it, read the day and time back ONCE, and
    on a yes call book_appointment with that opening's start exactly as check_availability returned
    it, their name, and in reason one short line of what it is for. You already have their number;
    do not ask for it.
  - Only after book_appointment returns booked: true, confirm it in one sentence — "You're all set
    for Tuesday, October sixth at two thirty." — then hand the turn back.
  - booked: false means the time was just taken: say so and offer the other openings it returned.
    An error means the calendar cannot be reached: say you can't book it right now and take a
    message with the time they want (Route C).
  - NEVER say or imply that anything is booked, held or confirmed until book_appointment has
    returned booked: true. Not "I'll get you in", not "that works", not "you're all set" before then.
  - NEVER state or guess availability except from what check_availability returned.
  - Nothing works for them, they want something the Appointments section does not cover, or they
    would rather speak to someone: {fallback}.
  - NEVER promise what a person will do, and no discount, exception or accommodation the facts do
    not already state.
"""


def _ws(text: str) -> str:
    """A literal line as a pattern that tolerates the template's line wrapping."""
    return r"\s+".join(re.escape(word) for word in text.split())


def _swap(prompt: str, old: str, new: str) -> str:
    replaced, count = re.subn(_ws(old), lambda _m: new, prompt, count=1)
    if count != 1:
        raise ValueError(f"booking rule book: expected line not found: {old[:60]!r}")
    return replaced


def apply_booking(prompt: str, booking: dict, *, reachable: bool) -> str:
    """The rendered inbound rule book, rewritten for a business the receptionist can book for."""
    prompt = _swap(
        prompt,
        "- You are NOT the booking system, the calendar, or the billing desk. You cannot reserve, "
        "hold, change or cancel anything, and you never imply otherwise.",
        "- You CAN book a NEW appointment into the business's calendar, with check_availability and\n"
        "  book_appointment (Route A). You cannot change, cancel or look up an existing one, hold a\n"
        "  time without booking it, or do anything for billing, and you never imply otherwise.",
    )
    triage_old = (
        "Your job is to TRIAGE the call, not to sell and not to book:\n"
        "  - A real request to book, schedule, or meet with someone -> ask if they would like a "
        "person, then hand it to one."
    )
    prompt = _swap(
        prompt,
        triage_old,
        "Your job is to TRIAGE the call, not to sell:\n"
        "  - A real request to book a NEW appointment -> book it yourself, with the booking tools\n"
        "    (Route A).\n"
        "  - Changing, cancelling or asking about an existing one, or asking for a person -> Route A.",
    )
    # Route A, from "An existing appointment…" to the end of the NEVER list, becomes the booking route.
    start = re.search(_ws("An existing appointment is ALWAYS a person's job."), prompt)
    end = re.search(_ws("no discount, exception or accommodation the facts do not already state."), prompt)
    if not start or not end or end.start() < start.start():
        raise ValueError("booking rule book: Route A has moved")
    prompt = prompt[: start.start()] + _booking_route(reachable).rstrip("\n") + prompt[end.end():]
    # The hand-off examples offer a person "to book it"; with booking on, a person is for the rest.
    for old, new in (
        (
            "I can't book that myself, but I can put you through to someone who can — would you "
            "like me to?",
            "I can't change that myself, but I can put you through to someone who can — would you "
            "like me to?",
        ),
        ("would you like me to put you through to book it?", "would you like me to put you through to someone about it?"),
        (
            "I can't book it myself, but I'll pass this to the team and someone will get back to "
            "you to set it up.",
            "I'll pass this to the team and someone will get back to you about it.",
        ),
    ):
        prompt = re.sub(_ws(old), lambda _m, new=new: new, prompt, count=1)
    # The business's own booking facts, just before the call's ending rules.
    marker = re.search(r"^# Ending the call$", prompt, re.M)
    section = appointments_section(booking)
    if marker:
        return prompt[: marker.start()] + section + "\n" + prompt[marker.start():]
    return prompt + "\n" + section
