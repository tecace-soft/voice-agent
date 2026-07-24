"""Google Sheets — track collected caller info by appending a row per intake.

Authenticates as a service account: signs a JWT with the account's private key
(PyJWT + cryptography, both already present via google-genai), exchanges it for
an access token, and calls the Sheets REST API over urllib. No googleapiclient
dependency.

The service account's private key is stored in .env as GOOGLE_API_SHEETS_KEY,
base64 body with the PEM header/newlines stripped — normalized back to PEM here.
"""

from __future__ import annotations

import json
import re
import textwrap
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

import jwt  # PyJWT

from ..config import Config

_TOKEN_URI = "https://oauth2.googleapis.com/token"
_SHEETS_ROOT = "https://sheets.googleapis.com/v4/spreadsheets"
_SCOPE = "https://www.googleapis.com/auth/spreadsheets"


class SheetsError(RuntimeError):
    """Auth failed, the sheet is unreachable, or a write was rejected."""


def normalize_private_key(raw: str) -> str:
    """Rebuild a PEM private key from the .env value (stripped/escaped forms)."""
    raw = raw.strip()
    if "\\n" in raw:
        raw = raw.replace("\\n", "\n")
    if "-----BEGIN" in raw:
        return raw if raw.endswith("\n") else raw + "\n"
    body = re.sub(r"\s+", "", raw)
    return (
        "-----BEGIN PRIVATE KEY-----\n"
        + "\n".join(textwrap.wrap(body, 64))
        + "\n-----END PRIVATE KEY-----\n"
    )


class SheetsClient:
    def __init__(self, cfg: Config) -> None:
        if not cfg.google_api_email or not cfg.google_sheets_key:
            raise SheetsError("GOOGLE_API_EMAIL / GOOGLE_API_SHEETS_KEY not set in .env.")
        if not cfg.google_sheets_id:
            raise SheetsError("GOOGLE_SHEETS_ID is not set in .env.")
        self._cfg = cfg
        self._email = cfg.google_api_email
        self._key = normalize_private_key(cfg.google_sheets_key)
        self._sheet_id = cfg.google_sheets_id
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
            raise SheetsError(f"token request failed [{exc.code}]: {exc.read()[:200]!r}") from exc
        self._token = payload["access_token"]
        self._token_exp = time.time() + payload.get("expires_in", 3600)
        return self._token

    # -- transport -------------------------------------------------------

    def _call(self, path: str, *, method: str = "GET", body: Any = None) -> Any:
        url = f"{_SHEETS_ROOT}/{self._sheet_id}{path}"
        data = json.dumps(body).encode() if body is not None else None
        headers = {"Authorization": f"Bearer {self._access_token()}"}
        if data is not None:
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(url, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=self._cfg.request_timeout) as response:
                return json.load(response)
        except urllib.error.HTTPError as exc:
            detail = exc.read()[:300].decode("utf-8", "replace")
            if exc.code == 403:
                raise SheetsError(
                    f"permission denied (403). Share the sheet with {self._email} as Editor."
                ) from exc
            raise SheetsError(f"Sheets API error [{exc.code}]: {detail}") from exc

    # -- public API ------------------------------------------------------

    def title(self) -> str:
        meta = self._call("?fields=properties.title")
        return meta["properties"]["title"]

    def read(self, a1_range: str) -> list[list[str]]:
        result = self._call(f"/values/{urllib.parse.quote(a1_range)}")
        return result.get("values", [])

    def append_row(self, values: list[str], *, tab: str = "Sheet1") -> dict:
        """Append one row to the given tab; returns the API response."""
        path = (
            f"/values/{urllib.parse.quote(tab)}!A1:append"
            "?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS"
        )
        return self._call(path, method="POST", body={"values": [values]})

    def update_range(self, a1: str, values: list[list[str]]) -> None:
        """Write a 2D block of values starting at `a1` (e.g. 'Sheet1!A1:H1')."""
        path = f"/values/{urllib.parse.quote(a1)}?valueInputOption=USER_ENTERED"
        self._call(path, method="PUT", body={"values": values})

    def update_cell(self, a1: str, value: str) -> None:
        """Write a single value to an A1 cell (e.g. 'Sheet1!H7')."""
        self.update_range(a1, [[value]])

    def ensure_header(self, header: list[str], *, tab: str = "Sheet1") -> None:
        """Ensure row 1 is exactly `header` — the current record layout.

        Writes it when the tab is empty or the header row differs (e.g. a newly
        added `summary` column), so the labels always match what `track()` writes.
        Only the first `len(header)` cells are touched; data rows below and any
        extra columns you've added beyond the schema are left alone.
        """
        rows = self.read(f"{tab}!1:1")
        current = rows[0] if rows else []
        if current[: len(header)] == header:
            return
        last = _col_letter(len(header))
        self.update_range(f"{tab}!A1:{last}1", [header])

    def tab_gid(self, tab: str = "Sheet1") -> int:
        """Numeric sheetId of a tab (needed for structural edits like row delete)."""
        meta = self._call("?fields=sheets.properties.title,sheets.properties.sheetId")
        for sheet in meta.get("sheets", []):
            props = sheet["properties"]
            if props["title"] == tab:
                return props["sheetId"]
        raise SheetsError(f"tab {tab!r} not found")

    def delete_row(self, row_index_1based: int, *, tab: str = "Sheet1") -> None:
        """Delete a single 1-based row from a tab."""
        gid = self.tab_gid(tab)
        self._call(
            ":batchUpdate",
            method="POST",
            body={
                "requests": [
                    {
                        "deleteDimension": {
                            "range": {
                                "sheetId": gid,
                                "dimension": "ROWS",
                                "startIndex": row_index_1based - 1,
                                "endIndex": row_index_1based,
                            }
                        }
                    }
                ]
            },
        )


def _col_letter(n: int) -> str:
    """1-based column number -> A1 letter (1->A, 8->H, 27->AA)."""
    letters = ""
    while n > 0:
        n, remainder = divmod(n - 1, 26)
        letters = chr(65 + remainder) + letters
    return letters
