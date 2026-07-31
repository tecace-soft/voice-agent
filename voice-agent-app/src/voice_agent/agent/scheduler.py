"""Interactive scheduling: offer real openings from the backend and let the caller pick.

After the intake questions are answered, the agent asks the shared backend for open
slots (its schedule grid), reads back a few concrete choices, interprets which one the
caller picked (via Gemini), and books it on the backend — updating the lead's record to
the chosen time. Migrated from Cal.com to the backend API; the public interface is
unchanged, so `call_session.py` uses it the same way.
"""

from __future__ import annotations

import datetime
import json
import logging
import re
from dataclasses import dataclass
from zoneinfo import ZoneInfo

from ..config import Config
from ..tools.backend import BackendClient, BackendError
from ..tools.gemini import GeminiTools

log = logging.getLogger(__name__)

# The timezone spoken times are interpreted in ("tomorrow at 2"). Keep it matching the
# backend's SCHEDULE_TIMEZONE so the instants the agent resolves line up with its slots.
DEFAULT_TIMEZONE = "America/Los_Angeles"


@dataclass
class Offer:
    message: str            # what the agent says (the choices, read out)
    options: list[str]      # ISO start times backing each choice, in order


@dataclass
class Decision:
    """What the caller wants, in response to offered times."""

    action: str             # "pick" | "request" | "others" | "decline" | "unclear"
    slot: str = ""          # for "pick": the chosen ISO start
    requested: str = ""     # for "request": the asked-for time as ISO start


class Scheduler:
    def __init__(
        self,
        cfg: Config,
        event_type_id: int | None = None,   # vestigial (Cal.com) — ignored, kept for callers
        *,
        timezone: str = DEFAULT_TIMEZONE,
        max_options: int = 3,
    ) -> None:
        self._cfg = cfg
        self._backend = BackendClient(cfg)
        self._gemini = GeminiTools(cfg)
        self._tz = timezone
        self._max_options = max_options

    def offer(self, timeframe: str | None) -> Offer:
        """Fetch openings in `timeframe` and phrase a pick-one question."""
        from_date, to_date = _window_dates(timeframe)
        try:
            starts = _future(self._backend.available_slots(from_date, to_date))
        except BackendError as exc:  # network/backend failure -> caller layer degrades
            log.warning("could not fetch openings: %s", exc)
            starts = []
        options = _pick_across_days(starts, self._max_options)
        if not options:
            return Offer(
                "I'm sorry, I don't see any open times in that range. "
                "Would a different timeframe work?",
                [],
            )
        return Offer(f"I have a few openings: {_join(options)}. Which works best for you?", options)

    def interpret(self, user_text: str, options: list[str]) -> str | None:
        """Map the caller's reply to one of the offered ISO options, or None."""
        if not options:
            return None
        numbered = "\n".join(f"{i + 1}. {_friendly(o)}" for i, o in enumerate(options))
        labels = [str(i + 1) for i in range(len(options))] + ["none"]
        prompt = (
            f"Offered appointment times:\n{numbered}\n\n"
            f'The caller replied: "{user_text}"\n'
            "Which option number did they choose? Answer 'none' if unclear or none fit."
        )
        try:
            choice = self._gemini.classify(prompt, labels)["label"]
        except Exception as exc:  # noqa: BLE001
            log.warning("slot interpretation failed: %s", exc)
            return None
        if choice == "none":
            return None
        return options[int(choice) - 1]

    def decide(self, user_text: str, options: list[str]) -> Decision:
        """Interpret a scheduling reply: pick an option, request a specific time,
        decline, or unclear. Requested times are resolved to ISO relative to now."""
        now = datetime.datetime.now(ZoneInfo(self._tz))
        numbered = "\n".join(f"{i + 1}. {_friendly(o)}" for i, o in enumerate(options)) or "(none)"
        system = (
            "You interpret a caller's reply while scheduling a phone appointment. "
            "Output ONLY compact JSON, no prose."
        )
        user = (
            f"Right now it is {now.strftime('%A, %B %d, %Y, %I:%M %p')} ({self._tz}).\n"
            f"Times already offered:\n{numbered}\n\n"
            f'The caller said: "{user_text}"\n\n'
            'Return ONLY JSON like {"action": "...", "option_number": null, "requested_datetime": null}.\n'
            '"action" is exactly one of:\n'
            '- "pick": they accept or choose one of the offered times. Examples: "the first one", '
            '"Friday works", "yes", "sure, that one", "let\'s do that". Set option_number (1-based).\n'
            '- "request": they name a DIFFERENT specific time to check. Examples: "how about Tuesday '
            'at 2", "can I do 3pm instead", "what about tomorrow morning". Set requested_datetime to '
            'ISO 8601 with the ' + self._tz + ' UTC offset, resolved from now.\n'
            '- "others": they do NOT want the offered time and want to hear OTHER available options '
            'without naming a specific one. Examples: "that time does not work for me, are there other '
            'available slots?", "that does not work, what else do you have?", "any other times?", '
            '"something else that day", "none of those, what else". If they express dissatisfaction '
            'AND ask for alternatives, use "others".\n'
            '- "decline": a plain no with no follow-up. Examples: "no", "that will not work", "none of those".\n'
            '- "unclear": you genuinely cannot tell.'
        )
        try:
            data = _loads_json(self._gemini.generate(system, user, temperature=0))
        except Exception as exc:  # noqa: BLE001
            log.warning("scheduling interpretation failed: %s", exc)
            return Decision("unclear")

        action = str(data.get("action", "unclear"))
        if action == "pick":
            num = data.get("option_number")
            if isinstance(num, int) and 1 <= num <= len(options):
                return Decision("pick", slot=options[num - 1])
            return Decision("unclear")
        if action == "request" and data.get("requested_datetime"):
            return Decision("request", requested=str(data["requested_datetime"]))
        if action == "others":
            return Decision("others")
        if action == "decline":
            return Decision("decline")
        return Decision("unclear")

    def check_time(self, requested_iso: str) -> tuple[str, str]:
        """Is `requested_iso` an open slot? Returns (exact_match, nearest_open).

        Both are ISO starts; exact is "" if that time isn't open, nearest is "" if
        nothing suitable is around it. Availability + suggestions come from the backend.
        """
        try:
            avail = self._backend.availability(requested_iso)
        except BackendError as exc:  # noqa: BLE001 — availability failure -> nothing
            log.warning("availability check failed: %s", exc)
            return "", ""
        if avail.get("available"):
            return requested_iso, ""
        try:
            nearby = self._backend.suggestions(requested_iso, limit=1)
        except BackendError as exc:  # noqa: BLE001
            log.warning("suggestions lookup failed: %s", exc)
            return "", ""
        nearest = nearby[0]["start"] if nearby else ""
        return "", nearest

    def day_offer(self, day_iso: str, exclude: tuple[str, ...] = ()) -> Offer:
        """A spread of free slots on the same day as `day_iso` (excluding some).

        Empty options mean there are no other openings that day.
        """
        date = _date_of(day_iso)
        if not date:
            return Offer("", [])
        try:
            starts = _future(self._backend.available_slots(date, date))
        except BackendError as exc:  # noqa: BLE001
            log.warning("could not fetch day openings: %s", exc)
            return Offer("", [])
        excluded = set(exclude)
        starts = [s for s in starts if s not in excluded]
        if not starts:
            return Offer("", [])
        picked = _spread(starts, self._max_options)
        return Offer(f"That day I also have {_join(picked)}. Which of those works?", picked)

    def book(self, iso_start: str, record: dict[str, str], *, language: str = "English") -> dict:
        """Book the caller's lead at the chosen slot on the backend (the authoritative
        booking + conflict check). The backend also creates the Cal.com meeting (calendar
        invite + join link) as part of confirming the booking, so nothing Cal.com-related
        happens here.

        An OUTBOUND lead already has a backend intake id; an INBOUND caller does not, so
        we create their intake first (from the details captured on the call).

        Raises BackendError on conflict / past / not found (caught by the call flow),
        or RuntimeError if a backend intake id can't be obtained.
        """
        intake_id = self.ensure_intake(record, iso_start, language=language)
        if not intake_id:
            raise RuntimeError("cannot book: could not obtain a backend intake id")
        return self._backend.book(intake_id, iso_start)

    def ensure_intake(
        self, record: dict[str, str], iso_start: str, *, language: str = "English"
    ) -> str:
        """Return the record's backend intake id, creating a new intake if it has none.

        Outbound leads arrive with `_intake_id` already set (from the poller); inbound
        callers don't, so we create the lead from the details gathered on the call, at the
        slot they chose. The new id is stored back on the record so the rest of the call
        flow (status/notes tracking) can find it.
        """
        intake_id = intake_id_from(record)
        if intake_id:
            return intake_id
        created = self._backend.create_intake(
            language=language or "English",
            name=attendee_name(record),
            email=record.get("email", ""),
            phone_number=phone_from(record),
            purpose=purpose_from(record) or record.get("reason", "") or "Inbound call",
            date_time=iso_start,
        )
        intake_id = str(created.get("id", ""))
        if intake_id:
            record["_intake_id"] = intake_id
        return intake_id

    @staticmethod
    def friendly(iso_start: str) -> str:
        return _friendly(iso_start)

    @staticmethod
    def day_label(iso_start: str) -> str:
        try:
            dt = datetime.datetime.fromisoformat(iso_start)
        except ValueError:
            return "that day"
        if dt.tzinfo is not None:
            dt = dt.astimezone(ZoneInfo(DEFAULT_TIMEZONE))
        return dt.strftime("%A, %B %d")


def _loads_json(raw: str) -> dict:
    """Parse a JSON object out of an LLM reply (tolerating code fences/extra text)."""
    match = re.search(r"\{.*\}", raw, re.DOTALL)
    return json.loads(match.group(0)) if match else {}


def _join(options: list[str]) -> str:
    """Phrase a list of ISO starts as 'A, B, or C' (friendly, spoken)."""
    labels = [_friendly(o) for o in options]
    if len(labels) == 1:
        return labels[0]
    return ", ".join(labels[:-1]) + f", or {labels[-1]}"


def _spread(items: list[str], n: int) -> list[str]:
    """Pick up to n items evenly spaced across the list (e.g. morning/midday/late)."""
    if len(items) <= n:
        return items
    if n == 1:
        return [items[0]]
    step = (len(items) - 1) / (n - 1)
    return [items[round(i * step)] for i in range(n)]


def _pick_across_days(starts: list[str], n: int) -> list[str]:
    """Prefer the first opening on each of the first n days; then fill in from each day.

    `starts` are chronologically ordered ISO instants (as the backend returns them).
    """
    by_day: dict[str, list[str]] = {}
    for start in starts:
        by_day.setdefault(start[:10], []).append(start)  # group by the ISO date prefix
    picked: list[str] = []
    for day in sorted(by_day):
        picked.append(by_day[day][0])
        if len(picked) >= n:
            return picked
    for day in sorted(by_day):
        for start in by_day[day][1:]:
            picked.append(start)
            if len(picked) >= n:
                return picked
    return picked


def _future(starts: list[str]) -> list[str]:
    """Drop any slot that has already started (the grid marks taken-ness, not past-ness)."""
    now = datetime.datetime.now(datetime.timezone.utc)
    kept: list[str] = []
    for start in starts:
        try:
            if datetime.datetime.fromisoformat(start) > now:
                kept.append(start)
        except ValueError:
            continue
    return kept


def _window_dates(timeframe: str | None) -> tuple[str, str]:
    """Map a spoken timeframe to a (from, to) date range (YYYY-MM-DD) for the grid."""
    today = datetime.datetime.now(datetime.timezone.utc).date()
    label = (timeframe or "").strip().lower()
    if "today" in label:
        end = today
    elif "week" in label:
        end = today + datetime.timedelta(days=7)
    elif "month" in label:
        end = today + datetime.timedelta(days=30)
    else:
        end = today + datetime.timedelta(days=14)
    return today.isoformat(), end.isoformat()


def _date_of(iso_start: str) -> str:
    """The calendar date (YYYY-MM-DD, UTC) of an ISO instant, or '' if unparseable."""
    try:
        dt = datetime.datetime.fromisoformat(iso_start)
    except ValueError:
        return ""
    return dt.astimezone(datetime.timezone.utc).date().isoformat()


_SPEECH_LOCALES = {"korean": "ko-KR", "english": "en-US"}


def intake_id_from(record: dict[str, str]) -> str:
    """The backend intake id the poller stashed on the record (for status/booking)."""
    return record.get("_intake_id", "")


def language_from(record: dict[str, str]) -> str:
    """Detect the caller's chosen language from the record (default English)."""
    for value in record.values():
        if isinstance(value, str) and ("korea" in value.lower() or "한국" in value):
            return "Korean"
    return "English"


def speech_locale(language: str) -> str:
    """Twilio speech-recognition locale for a language (e.g. Korean -> ko-KR)."""
    return _SPEECH_LOCALES.get(language.lower(), "en-US")


def parse_time(gemini: GeminiTools, text: str, tz: str = DEFAULT_TIMEZONE) -> str:
    """Resolve a spoken time ("tomorrow at 2", "Friday morning") to an ISO datetime."""
    now = datetime.datetime.now(ZoneInfo(tz))
    system = (
        "Extract the single future date and time the caller wants. Output ONLY an "
        "ISO 8601 datetime with the UTC offset, resolved from now, or the word none."
    )
    user = (
        f"Right now it is {now.strftime('%A, %B %d, %Y, %I:%M %p')} ({tz}). "
        f'The caller said: "{text}"'
    )
    try:
        raw = gemini.generate(system, user, temperature=0).strip()
    except Exception:  # noqa: BLE001
        return ""
    match = re.search(r"\d{4}-\d{2}-\d{2}T[\d:.+\-]+", raw)
    if not match:
        return ""
    try:
        datetime.datetime.fromisoformat(match.group(0))
        return match.group(0)
    except ValueError:
        return ""


def phone_from(record: dict[str, str]) -> str:
    """Find the phone number in a record (a `phone` field, or a phone-shaped value)."""
    for key, value in record.items():
        if "phone" in key and value:
            return value
    for value in record.values():
        if isinstance(value, str) and re.fullmatch(r"\+?[0-9][0-9\s\-().]{6,}", value):
            return value
    return ""


def timeframe_from(record: dict[str, str]) -> str | None:
    """Find the caller's timeframe answer without hardcoding the field name."""
    for value in record.values():
        if isinstance(value, str) and any(
            w in value.lower() for w in ("today", "tomorrow", "week", "month")
        ):
            return value
    return None


def purpose_from(record: dict[str, str]) -> str:
    """The lead's stated interest/purpose, if the form captured one."""
    for key, value in record.items():
        if "purpose" in key and value:
            return value
    return ""


def desired_time_from(record: dict[str, str]) -> str:
    """The specific time the lead asked for on the form (free text), if any."""
    for key, value in record.items():
        if ("desired" in key or "preferred" in key) and value:
            return value
    return ""


def attendee_name(record: dict[str, str]) -> str:
    """Best-effort caller name across form shapes (first/last, full_name, etc.)."""
    parts = [record.get("first_name", ""), record.get("last_name", "")]
    combined = " ".join(p for p in parts if p).strip()
    if combined:
        return combined
    for key, value in record.items():
        if "name" in key and value:
            return value
    return "Caller"


def _friendly(iso_start: str) -> str:
    """A spoken-friendly time in the business timezone: on the hour drops the minutes.

    Backend slots are UTC instants ('...T15:00:00.000Z'), so convert to the schedule
    timezone first — '...T15:00Z' (8 AM Pacific) -> 'Thursday, July 30 at 8 AM'.
    """
    dt = datetime.datetime.fromisoformat(iso_start)
    if dt.tzinfo is not None:
        dt = dt.astimezone(ZoneInfo(DEFAULT_TIMEZONE))
    hour12 = dt.hour % 12 or 12
    ampm = "AM" if dt.hour < 12 else "PM"
    clock = f"{hour12} {ampm}" if dt.minute == 0 else f"{hour12}:{dt.minute:02d} {ampm}"
    return f"{dt.strftime('%A, %B')} {dt.day} at {clock}"
