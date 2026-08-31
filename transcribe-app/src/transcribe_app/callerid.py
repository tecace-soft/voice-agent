"""The caller's number as the phone system recorded it, rather than as the caller spoke it.

Most people don't say their number, so the transcript-derived one is blank far more often than not.
The voicemail system already knows who rang, and puts it in two places:

    attachment: (206)_929 - 8767_2026-07-20_18:08:46.mp3
    subject:    "New voicemail from (206) 929 - 8767"

The filename is preferred: it travels with the audio, so it survives a forward intact, and there is
one per attachment where a subject names only a single number however many recordings the message
carried. The subject is the fallback for systems that don't put it in the filename — which includes,
on the evidence so far, the Comcast VoiceEdge messages that arrive as a bare `voicemail.wav`.

This is deliberately NOT a replacement for what the caller says. Caller ID is where they rang FROM;
a spoken number is usually where they want to be rung BACK ("I'm at the office, try my cell"). They
are different facts and the sheet carries both.
"""

from __future__ import annotations

import re
from urllib.parse import unquote_plus

# A North American number, tolerating the separators these filenames use: "(206)_929 - 8767",
# "206-929-8767", "206.929.8767". A leading country code is allowed and discarded.
# The final separator is OPTIONAL: a phone system may write "2069298767" with no punctuation at
# all, and requiring one silently produced a blank Caller ID for exactly those messages. What keeps
# this from matching any long digit run is the pair of lookarounds — the match must be bounded by
# non-digits, so a 14-digit reference number contains no valid 10-digit match.
_PHONE = re.compile(
    r"(?<!\d)(?:\+?1[\s._-]*)?\(?(\d{3})\)?[\s._-]*(\d{3})[\s._-]*(\d{4})(?!\d)"
)

# The trailing "_2026-07-20_18:08:46" stamp. Removed before the phone search: a run of digits and
# separators is exactly what the phone pattern is looking for, and a date must not be allowed to
# masquerade as a number.
_STAMP = re.compile(r"\d{4}-\d{2}-\d{2}[_\sT]\d{2}[:.]\d{2}[:.]\d{2}")


def _search(text: str) -> str:
    if not text:
        return ""
    decoded = unquote_plus(text)
    match = _PHONE.search(_STAMP.sub(" ", decoded))
    if not match:
        return ""
    area, prefix, line = match.groups()
    return f"({area}) {prefix}-{line}"


def parse_caller_id(filename: str = "", subject: str = "") -> str:
    """The caller's number as `(206) 929-8767`, or "" when neither source carries one.

    Returning "" rather than guessing is the point: a wrong number in a callback column is worse
    than an empty one, because nobody checks a field that looks filled in.
    """
    return _search(filename) or _search(subject)


def normalize_phone(raw: str) -> str:
    """A number a caller spoke, tidied to "(206) 929-8767".

    What Gemini returns is whatever the caller said, which is rarely a formatted number: "two oh
    six nine two nine..." comes back as a run of digits, sometimes with a country code, sometimes
    with the digits spaced apart. Written straight into the sheet that reads as a number too long
    to be one, and nobody can dial it at a glance.

    Anything that isn't recognisable as a North American number is returned as given rather than
    discarded — an international number or an extension is still worth having, and silently dropping
    what the caller actually said would be the worse failure. Text after the number (an extension,
    say) is kept.
    """
    value = (raw or "").strip()
    if not value:
        return ""
    match = _PHONE.search(_STAMP.sub(" ", value))
    if not match:
        # Dictated digits come back spaced one by one - "2 0 6 9 2 9 8 7 6 7" - which the pattern
        # can't see because it needs three together. Collapsing to digits alone catches that, but
        # ONLY when there are no letters: "call the office 206" must stay as the caller said it
        # rather than be mined for something that looks like a number.
        if not any(c.isalpha() for c in value):
            digits = re.sub(r"\D", "", value)
            if len(digits) == 11 and digits.startswith("1"):
                digits = digits[1:]
            if len(digits) == 10:
                return f"({digits[:3]}) {digits[3:6]}-{digits[6:]}"
        return value
    area, prefix, line = match.groups()
    formatted = f"({area}) {prefix}-{line}"
    trailing = (value[match.end():]).strip(" .,-")
    return f"{formatted} {trailing}" if trailing else formatted
