"""Interactive scheduling: offer real Cal.com slots and let the caller pick.

After the intake questions are answered, the agent uses the caller's timeframe
answer (Today / This Week / This Month) to fetch live openings from Cal.com,
reads back a few concrete choices, interprets which one the caller picked
(via Gemini), and books it.
"""

from __future__ import annotations

import datetime
import json
import logging
import re
from dataclasses import dataclass
from zoneinfo import ZoneInfo

from ..config import Config
from ..tools.cal import CalClient
from ..tools.gemini import GeminiTools

log = logging.getLogger(__name__)

DEFAULT_TIMEZONE = "America/Los_Angeles"
# Only offer slots that start within business hours, Mon–Fri. A slot's start
# hour must be in [START, END): 8 AM up to (but not including) 5 PM.
BUSINESS_START_HOUR = 8
BUSINESS_END_HOUR = 17


@dataclass
class Offer:
    message: str            # what the agent says (the choices, read out)
    options: list[str]      # ISO start times backing each choice, in order


@dataclass
class Decision:
    """What the caller wants, in response to offered times."""

    action: str             # "pick" | "request" | "decline" | "unclear"
    slot: str = ""          # for "pick": the chosen ISO start
    requested: str = ""     # for "request": the asked-for time as ISO start


class Scheduler:
    def __init__(
        self,
        cfg: Config,
        event_type_id: int,
        *,
        timezone: str = DEFAULT_TIMEZONE,
        max_options: int = 3,
        business_hours: tuple[int, int] = (BUSINESS_START_HOUR, BUSINESS_END_HOUR),
    ) -> None:
        self._cfg = cfg
        self._cal = CalClient(cfg)
        self._gemini = GeminiTools(cfg)
        self._event_type_id = event_type_id
        self._tz = timezone
        self._max_options = max_options
        self._biz_start, self._biz_end = business_hours

    def offer(self, timeframe: str | None) -> Offer:
        """Fetch openings in `timeframe` and phrase a pick-one question."""
        start, end = _window(timeframe)
        slots = self._cal.slots(self._event_type_id, start, end, time_zone=self._tz)
        slots = _business_hours_only(slots, self._biz_start, self._biz_end)
        options = _pick_diverse(slots, self._max_options)
        if not options:
            return Offer(
                "I'm sorry, I don't see any open times in that range. "
                "Would a different timeframe work?",
                [],
            )
        labels = [_friendly(o) for o in options]
        if len(labels) == 1:
            body = labels[0]
        else:
            body = ", ".join(labels[:-1]) + f", or {labels[-1]}"
        return Offer(f"I have a few openings: {body}. Which works best for you?", options)

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
        except Exception as exc:
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

        Both are ISO starts; exact is "" if that time isn't open, nearest is ""
        if nothing suitable is around it.
        """
        try:
            req = datetime.datetime.fromisoformat(requested_iso)
        except ValueError:
            return "", ""
        local = req.astimezone(ZoneInfo(self._tz))
        win_start = local.replace(hour=0, minute=0, second=0, microsecond=0)
        win_end = win_start + datetime.timedelta(days=2)
        fmt = "%Y-%m-%dT%H:%M:%SZ"
        slots = self._cal.slots(
            self._event_type_id,
            win_start.astimezone(datetime.timezone.utc).strftime(fmt),
            win_end.astimezone(datetime.timezone.utc).strftime(fmt),
            time_zone=self._tz,
        )
        slots = _business_hours_only(slots, self._biz_start, self._biz_end)
        starts = [s["start"] for day in sorted(slots) for s in slots[day]]
        if not starts:
            return "", ""
        exact, nearest, best = "", "", None
        for start in starts:
            diff = abs((datetime.datetime.fromisoformat(start) - req).total_seconds())
            if diff < 60:
                exact = start
            if best is None or diff < best:
                best, nearest = diff, start
        return exact, nearest

    def day_offer(self, day_iso: str, exclude: tuple[str, ...] = ()) -> Offer:
        """A spread of free slots on the same day as `day_iso` (excluding some).

        Empty options mean there are no other openings that day.
        """
        try:
            day = datetime.datetime.fromisoformat(day_iso).astimezone(ZoneInfo(self._tz))
        except ValueError:
            return Offer("", [])
        win_start = day.replace(hour=0, minute=0, second=0, microsecond=0)
        win_end = win_start + datetime.timedelta(days=1)
        fmt = "%Y-%m-%dT%H:%M:%SZ"
        slots = self._cal.slots(
            self._event_type_id,
            win_start.astimezone(datetime.timezone.utc).strftime(fmt),
            win_end.astimezone(datetime.timezone.utc).strftime(fmt),
            time_zone=self._tz,
        )
        slots = _business_hours_only(slots, self._biz_start, self._biz_end)
        excluded = set(exclude)
        starts = [
            s["start"] for d in sorted(slots) for s in slots[d] if s["start"] not in excluded
        ]
        if not starts:
            return Offer("", [])
        picked = _spread(starts, self._max_options)
        labels = [_friendly(o) for o in picked]
        body = labels[0] if len(labels) == 1 else ", ".join(labels[:-1]) + f", or {labels[-1]}"
        return Offer(f"That day I also have {body}. Which of those works?", picked)

    def book(self, iso_start: str, record: dict[str, str]) -> dict:
        email = record.get("email", "")
        if not email:
            raise RuntimeError("cannot book without an email address in the record")
        return self._cal.create_booking(
            self._event_type_id, iso_start, name=attendee_name(record), email=email,
            time_zone=self._tz,
        )

    @staticmethod
    def friendly(iso_start: str) -> str:
        return _friendly(iso_start)

    @staticmethod
    def day_label(iso_start: str) -> str:
        try:
            return datetime.datetime.fromisoformat(iso_start).strftime("%A, %B %d")
        except ValueError:
            return "that day"


def _loads_json(raw: str) -> dict:
    """Parse a JSON object out of an LLM reply (tolerating code fences/extra text)."""
    match = re.search(r"\{.*\}", raw, re.DOTALL)
    return json.loads(match.group(0)) if match else {}


def _spread(items: list[str], n: int) -> list[str]:
    """Pick up to n items evenly spaced across the list (e.g. morning/midday/late)."""
    if len(items) <= n:
        return items
    if n == 1:
        return [items[0]]
    step = (len(items) - 1) / (n - 1)
    return [items[round(i * step)] for i in range(n)]


_SPEECH_LOCALES = {"korean": "ko-KR", "english": "en-US"}


def language_from(record: dict[str, str]) -> str:
    """Detect the caller's chosen language from the record (default English)."""
    for value in record.values():
        if isinstance(value, str) and ("korea" in value.lower() or "한국" in value):
            return "Korean"
    return "English"


def speech_locale(language: str) -> str:
    """Twilio speech-recognition locale for a language (e.g. Korean -> ko-KR)."""
    return _SPEECH_LOCALES.get(language.lower(), "en-US")


def timeframe_from(record: dict[str, str]) -> str | None:
    """Find the caller's timeframe answer without hardcoding the field name."""
    for value in record.values():
        if isinstance(value, str) and any(
            w in value.lower() for w in ("today", "tomorrow", "week", "month")
        ):
            return value
    return None


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


def _window(timeframe: str | None) -> tuple[str, str]:
    """Map a spoken timeframe to an ISO (start, end) search window in UTC."""
    now = datetime.datetime.now(datetime.timezone.utc)
    label = (timeframe or "").strip().lower()
    if "today" in label:
        end = now.replace(hour=23, minute=59, second=0, microsecond=0)
    elif "week" in label:
        end = now + datetime.timedelta(days=7)
    elif "month" in label:
        end = now + datetime.timedelta(days=30)
    else:
        end = now + datetime.timedelta(days=14)
    fmt = "%Y-%m-%dT%H:%M:%SZ"
    return now.strftime(fmt), end.strftime(fmt)


def _business_hours_only(slots: dict, start_hour: int, end_hour: int) -> dict:
    """Drop weekend days and any slot starting outside [start_hour, end_hour)."""
    kept: dict[str, list] = {}
    for day, entries in slots.items():
        good = [e for e in entries if _in_business_hours(e.get("start", ""), start_hour, end_hour)]
        if good:
            kept[day] = good
    return kept


def _in_business_hours(iso_start: str, start_hour: int, end_hour: int) -> bool:
    try:
        dt = datetime.datetime.fromisoformat(iso_start)
    except ValueError:
        return False
    if dt.weekday() >= 5:  # Saturday=5, Sunday=6
        return False
    return start_hour <= dt.hour < end_hour


def _pick_diverse(slots: dict, n: int) -> list[str]:
    """Prefer the first opening on each of the first n days; then fill in."""
    picked: list[str] = []
    for day in sorted(slots):
        entries = slots[day]
        if isinstance(entries, list) and entries:
            picked.append(entries[0]["start"])
        if len(picked) >= n:
            return picked
    for day in sorted(slots):  # not enough distinct days — take more from each
        for entry in slots.get(day, [])[1:]:
            picked.append(entry["start"])
            if len(picked) >= n:
                return picked
    return picked


def _friendly(iso_start: str) -> str:
    """'2026-07-22T12:15:00.000-07:00' -> 'Wednesday, July 22 at 12:15 PM'."""
    dt = datetime.datetime.fromisoformat(iso_start)
    hour12 = dt.hour % 12 or 12
    ampm = "AM" if dt.hour < 12 else "PM"
    return f"{dt.strftime('%A, %B')} {dt.day} at {hour12}:{dt.minute:02d} {ampm}"
