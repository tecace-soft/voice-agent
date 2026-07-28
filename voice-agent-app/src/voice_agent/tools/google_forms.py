"""Google Forms — source the agent's questions and detect new submissions.

Reads the form definition (the questions) and its responses via the Google Forms
API, authenticating as the SAME service account used for Sheets: sign a JWT with
the account's private key, exchange it for an access token, call the REST API
over urllib. No googleapiclient dependency.

Setup (one-time): enable the Google Forms API in the Cloud project, and share
the form with GOOGLE_API_EMAIL. Two read-only scopes are requested —
forms.body.readonly (structure) and forms.responses.readonly (submissions).

`fields()` yields the IntakeField list the agent asks from;
`record_from_response()` maps a submission to (record, phone).
"""

from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import TYPE_CHECKING, Any

import jwt  # PyJWT

from ..config import Config
from .sheets import normalize_private_key

if TYPE_CHECKING:
    from ..agent import IntakeField

_TOKEN_URI = "https://oauth2.googleapis.com/token"
_FORMS_ROOT = "https://forms.googleapis.com/v1/forms"
_SCOPE = (
    "https://www.googleapis.com/auth/forms.body.readonly "
    "https://www.googleapis.com/auth/forms.responses.readonly"
)


class GoogleFormsError(RuntimeError):
    """The form could not be fetched, or auth/permission failed."""


class GoogleFormsClient:
    def __init__(self, cfg: Config) -> None:
        if not cfg.google_api_email or not cfg.google_sheets_key:
            raise GoogleFormsError("GOOGLE_API_EMAIL / GOOGLE_API_SHEETS_KEY not set in .env.")
        if not cfg.google_form_id:
            raise GoogleFormsError("GOOGLE_FORM_ID is not set in .env.")
        self._cfg = cfg
        self._email = cfg.google_api_email
        self._key = normalize_private_key(cfg.google_sheets_key)
        self._form_id = cfg.google_form_id
        self._token: str | None = None
        self._token_exp = 0.0

    # -- auth ------------------------------------------------------------

    def _access_token(self) -> str:
        if self._token and time.time() < self._token_exp - 60:
            return self._token
        now = int(time.time())
        assertion = jwt.encode(
            {
                "iss": self._email,
                "scope": _SCOPE,
                "aud": _TOKEN_URI,
                "iat": now,
                "exp": now + 3600,
            },
            self._key,
            algorithm="RS256",
        )
        data = urllib.parse.urlencode(
            {"grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer", "assertion": assertion}
        ).encode()
        try:
            with urllib.request.urlopen(
                urllib.request.Request(_TOKEN_URI, data=data), timeout=self._cfg.request_timeout
            ) as response:
                payload = json.load(response)
        except urllib.error.HTTPError as exc:
            raise GoogleFormsError(
                f"token request failed [{exc.code}]: {exc.read()[:200]!r}"
            ) from exc
        self._token = payload["access_token"]
        self._token_exp = time.time() + payload.get("expires_in", 3600)
        return self._token

    # -- transport -------------------------------------------------------

    def _get(self, path: str) -> Any:
        request = urllib.request.Request(
            f"{_FORMS_ROOT}/{self._form_id}{path}",
            headers={"Authorization": f"Bearer {self._access_token()}"},
        )
        try:
            with urllib.request.urlopen(request, timeout=self._cfg.request_timeout) as response:
                return json.load(response)
        except urllib.error.HTTPError as exc:
            detail = exc.read()[:300].decode("utf-8", "replace")
            if exc.code in (401, 403):
                raise GoogleFormsError(
                    f"access denied [{exc.code}]. Enable the Google Forms API and share "
                    f"the form with {self._email}."
                ) from exc
            if exc.code == 404:
                raise GoogleFormsError(f"form {self._form_id!r} not found (404).") from exc
            raise GoogleFormsError(f"Forms API error [{exc.code}]: {detail}") from exc

    # -- public API ------------------------------------------------------

    def form(self) -> dict[str, Any]:
        """Raw form definition."""
        return self._get("")

    def question_defs(self) -> list[dict[str, Any]]:
        """Flat list of question defs {questionId, title, type, required, choices}."""
        return _question_defs(self.form())

    def fields(self) -> list[IntakeField]:
        """Map the form's questions to IntakeFields, in document order."""
        defs = self.question_defs()
        if not defs:
            title = self.form().get("info", {}).get("title", self._form_id)
            raise GoogleFormsError(
                f"form {title!r} has no questions. Add questions in the Google Forms editor."
            )
        return [_to_intake_field(d) for d in defs]

    def responses(self, since: str | None = None) -> list[dict[str, Any]]:
        """Submitted responses, optionally only those newer than `since` (RFC3339)."""
        path = "/responses"
        if since:
            path += "?filter=" + urllib.parse.quote(f"timestamp > {since}")
        return self._get(path).get("responses", [])


# -- form structure -> question defs --------------------------------------

def _question_defs(form: dict[str, Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for item in form.get("items", []):
        title = (item.get("title") or "").strip()
        question_item = item.get("questionItem")
        if question_item:
            out.append(_def_from_question(question_item.get("question", {}), title))
            continue
        # A grid/group holds several sub-questions under one item title.
        group = item.get("questionGroupItem")
        if group:
            for question in group.get("questions", []):
                row = (question.get("rowQuestion") or {}).get("title", "")
                label = f"{title} - {row}".strip(" -") if row else title
                out.append(_def_from_question(question, label))
    return out


def _def_from_question(question: dict[str, Any], title: str) -> dict[str, Any]:
    qtype = "text"
    choices: tuple[str, ...] = ()
    if "choiceQuestion" in question:
        choice = question["choiceQuestion"]
        qtype = (choice.get("type") or "choice").lower()
        choices = tuple(o.get("value", "") for o in choice.get("options", []) if o.get("value"))
    elif "textQuestion" in question:
        qtype = "paragraph" if question["textQuestion"].get("paragraph") else "text"
    elif "scaleQuestion" in question:
        qtype = "scale"
    elif "dateQuestion" in question:
        qtype = "date"
    elif "timeQuestion" in question:
        qtype = "time"
    return {
        "questionId": question.get("questionId", ""),
        "title": title,
        "type": qtype,
        "required": bool(question.get("required", False)),
        "choices": choices,
    }


def _to_intake_field(qdef: dict[str, Any]) -> IntakeField:
    from ..agent import IntakeField  # lazy: avoids a tools<->agent import cycle

    title = qdef["title"]
    return IntakeField(
        name=_field_name(title),
        description=f"answer to the question: {title}",
        required=qdef["required"],
        question=title,
        choices=qdef["choices"],
    )


# -- submission -> record --------------------------------------------------

def record_from_response(
    response: dict[str, Any], question_defs: list[dict[str, Any]]
) -> tuple[dict[str, str], str]:
    """Turn a Forms API response into (record, phone_number).

    `record` is keyed the same way `fields()` names the questions (so scheduling
    reads timeframe/name/language straight from it); `phone` is the number to
    call back, or "" if the form has no phone answer.
    """
    id_to_title = {d["questionId"]: d["title"] for d in question_defs}
    record: dict[str, str] = {}
    for qid, answer in (response.get("answers") or {}).items():
        values = [
            a.get("value", "")
            for a in (answer.get("textAnswers") or {}).get("answers", [])
        ]
        value = ", ".join(v for v in values if v)
        if not value:
            continue
        title = id_to_title.get(qid, qid)
        record[_field_name(title)] = value
    from ..agent.scheduler import phone_from  # lazy: avoids an import cycle

    return record, phone_from(record)


# -- naming (snake_case keys from question titles) ------------------------

# Filler words dropped when slugging a question title into a field key.
_STOPWORDS = {
    "please", "give", "me", "us", "my", "your", "you", "the", "a", "an", "of",
    "for", "to", "and", "so", "that", "this", "is", "are", "what", "which",
    "can", "could", "would", "will", "i", "we", "do", "does", "may", "with",
    "on", "in", "at", "kindly", "provide", "enter",
}


def _field_name(title: str) -> str:
    """A stable, readable snake_case key from a question title.

    Recognises common single-value questions (email/phone) by keyword so their
    keys stay predictable; otherwise a short slug of the title.
    """
    low = title.lower()
    if "email" in low:
        return "email"
    if "phone" in low or "mobile" in low or "cell" in low:
        return "phone"
    return _short_slug(title) or "field"


def _short_slug(title: str, max_words: int = 3) -> str:
    """A compact snake_case key from a title, dropping filler words."""
    words = re.sub(r"[^a-z0-9]+", " ", title.lower()).split()
    meaningful = [w for w in words if w not in _STOPWORDS] or words
    return "_".join(meaningful[:max_words])[:40]
