"""Typeform — source the questions the agent asks from a published form.

Fetches a form definition via the Typeform API and maps its fields to the
IntakeField list the agent drives from. Kept lightweight (urllib), matching the
other tools. No answers are submitted back here; this only reads the questions.
"""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.request
from typing import TYPE_CHECKING, Any

from ..config import Config

if TYPE_CHECKING:
    from ..agent import IntakeField

_API_ROOT = "https://api.typeform.com"

# Typeform field types that show text but collect no answer we can map.
_SKIP_TYPES = {"statement", "welcome_screen", "thankyou_screen"}
_CHOICE_TYPES = {"multiple_choice", "dropdown", "picture_choice", "ranking"}


class TypeformError(RuntimeError):
    """The form could not be fetched or has no usable questions."""


class TypeformClient:
    def __init__(self, cfg: Config) -> None:
        if not cfg.typeform_api_key:
            raise TypeformError("TYPEFORM_API_KEY is not set in .env.")
        if not cfg.typeform_form_id:
            raise TypeformError("TYPEFORM_FORM_ID is not set in .env.")
        self._cfg = cfg
        self._key = cfg.typeform_api_key
        self._form_id = cfg.typeform_form_id

    def _get(self, path: str) -> Any:
        request = urllib.request.Request(
            f"{_API_ROOT}{path}", headers={"Authorization": f"Bearer {self._key}"}
        )
        try:
            with urllib.request.urlopen(request, timeout=self._cfg.request_timeout) as response:
                return json.loads(response.read())
        except urllib.error.HTTPError as exc:
            detail = exc.read()[:200].decode("utf-8", "replace")
            if exc.code == 401:
                raise TypeformError("TYPEFORM_API_KEY rejected (401).") from exc
            if exc.code == 404:
                raise TypeformError(f"form {self._form_id!r} not found (404).") from exc
            raise TypeformError(f"Typeform API error [{exc.code}]: {detail}") from exc

    def form(self) -> dict[str, Any]:
        """Raw form definition."""
        return self._get(f"/forms/{self._form_id}")

    def fields(self) -> list[IntakeField]:
        """Map the form's answerable questions to IntakeFields, in order.

        Walks the whole form: top-level `fields`, plus any `pages` (newer
        multi-page forms) and nested containers, flattened in document order.
        """
        form = self.form()
        collected: list[IntakeField] = []
        _walk_fields(_all_field_nodes(form), collected)  # noqa: type — filled below
        if not collected:
            published = form.get("settings", {}).get("is_public", True)
            hint = (
                "The form is not published — publish it in the Typeform editor so "
                "your questions reach the API."
                if not published
                else "Add questions with titles in the Typeform editor."
            )
            raise TypeformError(
                f"form {form.get('title', self._form_id)!r} has no answerable "
                f"questions. {hint}"
            )
        return collected


def _all_field_nodes(form: dict[str, Any]) -> list[dict[str, Any]]:
    """Collect field lists from top-level `fields` and any `pages`, in order."""
    nodes: list[dict[str, Any]] = list(form.get("fields", []))
    for page in form.get("pages", []) or []:
        # A page may hold its questions directly or under properties.fields.
        nodes.extend(page.get("fields", []))
        nodes.extend(page.get("properties", {}).get("fields", []))
    return nodes


def _walk_fields(raw_fields: list[dict[str, Any]], out: list[IntakeField]) -> None:
    for field in raw_fields:
        ftype = field.get("type", "")
        # Any node that nests its own field list is a container (group, page,
        # or a type we don't know by name) — recurse rather than treat as a Q.
        nested = field.get("properties", {}).get("fields")
        if isinstance(nested, list) and nested:
            _walk_fields(nested, out)
            continue
        if ftype in _SKIP_TYPES:
            continue
        title = (field.get("title") or "").strip()
        if not title:
            continue  # untitled placeholder — nothing to ask
        out.append(_to_intake_field(field, title))


def _to_intake_field(field: dict[str, Any], title: str) -> IntakeField:
    from ..agent import IntakeField  # lazy: avoids a tools<->agent import cycle

    ftype = field.get("type", "")
    choices: tuple[str, ...] = ()
    if ftype in _CHOICE_TYPES:
        choices = tuple(
            c.get("label", "")
            for c in field.get("properties", {}).get("choices", [])
            if c.get("label")
        )
    return IntakeField(
        name=_field_name(field, title),
        description=f"answer to the {ftype.replace('_', ' ')} question: {title}",
        required=bool(field.get("validations", {}).get("required", False)),
        question=title,
        choices=choices,
    )


# Clean names for common single-value field types when the ref is auto-generated.
_TYPE_NAMES = {"email": "email", "phone_number": "phone", "website": "website"}


def _field_name(field: dict[str, Any], title: str) -> str:
    """A stable, readable snake_case key.

    Prefers an author-set ref; if the ref is an auto-generated UUID/ULID, uses a
    clean name from the field type (email/phone) or a short slug of the title.
    """
    ref = field.get("ref", "")
    if ref and not _is_auto_ref(ref):
        return re.sub(r"[^a-z0-9]+", "_", ref.lower()).strip("_")
    ftype = field.get("type", "")
    if ftype in _TYPE_NAMES:
        return _TYPE_NAMES[ftype]
    return _short_slug(title) or field.get("id", "field")


def _is_auto_ref(ref: str) -> bool:
    """True if the ref looks machine-generated (UUID, ULID, or long hex)."""
    r = ref.strip()
    uuid = r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
    return bool(
        re.fullmatch(uuid, r)
        or re.fullmatch(r"[0-9A-Z]{26}", r)      # ULID
        or re.fullmatch(r"[0-9a-fA-F]{20,}", r)  # long hex blob
    )


def _short_slug(title: str, max_words: int = 4) -> str:
    """A compact snake_case key from a question title (first few words)."""
    words = re.sub(r"[^a-z0-9]+", " ", title.lower()).split()
    return "_".join(words[:max_words])[:40]
