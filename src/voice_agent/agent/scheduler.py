"""Interactive scheduling: offer real Cal.com slots and let the caller pick.

After the intake questions are answered, the agent uses the caller's timeframe
answer (Today / This Week / This Month) to fetch live openings from Cal.com,
reads back a few concrete choices, interprets which one the caller picked
(via Gemini), and books it.
"""

from __future__ import annotations

import datetime
import logging
from dataclasses import dataclass

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
