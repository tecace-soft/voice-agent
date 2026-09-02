"""Append one row per voicemail to a Google Sheet, using a service account.

A service account is the right fit for an unattended batch job: no browser login, no token to
refresh by hand. Create one in Google Cloud, download its JSON key (GOOGLE_CREDENTIALS_FILE),
and share the target sheet with the service account's email as an Editor. On the first run we
write a header row if the sheet is empty.
"""

from __future__ import annotations

import logging

from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build

from ..config import Config
from ..timefmt import timezone_label
from .google_auth import load_service_credentials

log = logging.getLogger(__name__)


class SheetLayoutError(RuntimeError):
    """The tab's header row doesn't match the columns this build writes."""


def _col_index(letters: str) -> int:
    """"A" -> 1, "C" -> 3, "AA" -> 27."""
    n = 0
    for ch in letters.upper():
        n = n * 26 + (ord(ch) - 64)
    return n


def _col_letter(index: int) -> str:
    """1 -> "A", 27 -> "AA". The inverse of _col_index."""
    letters = ""
    while index > 0:
        index, rem = divmod(index - 1, 26)
        letters = chr(65 + rem) + letters
    return letters

_SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]

# Column order for every appended row — keep in sync with pipeline.build_row(). The first column's
# label gets the timezone appended (see _header), so nobody has to guess what "11:22" means.
HEADER = [
    "Received",
    "Caller name",
    "Phone",
    "Requested time",
    "Callback requested",
    "Summary",
    "Transcript",
    "Audio file",
    "Open email",
]


class SheetWriter:
    def __init__(self, cfg: Config) -> None:
        self._cfg = cfg
        self._service = None  # lazily built (googleapiclient Resource)
        self._header_checked = False

    def _credentials(self) -> Credentials:
        return load_service_credentials(self._cfg, _SCOPES)

    def _sheets(self):
        if self._service is None:
            creds = self._credentials()
            # cache_discovery=False avoids a noisy warning and a file-cache write we don't need.
            self._service = build("sheets", "v4", credentials=creds, cache_discovery=False)
        return self._service

    def tab_name(self) -> str:
        """The sheet/tab name from SHEET_RANGE ("Voicemails!A1" -> "Voicemails").

        Surrounding quotes are dropped: a tab whose name has a space has to be written
        `'Voicemail 2026'!A1` in the range, but the bare name is what the tab list holds.
        """
        rng = self._cfg.sheet_range
        tab = (rng.split("!", 1)[0] if "!" in rng else rng).strip()
        if len(tab) >= 2 and tab.startswith("'") and tab.endswith("'"):
            # Quoted form: drop the wrapper and undo A1 notation's doubled inner quotes, so a tab
            # really called "Bob's" comes back as Bob's rather than Bob''s.
            tab = tab[1:-1].replace("''", "'")
        return tab

    def _tab(self) -> str:
        """The tab name quoted for use in an A1 range.

        Always quoted, not just when the name has a space: quoting is harmless for a plain name
        and required for anything with a space or punctuation, so there is no case worth
        distinguishing. Internal single quotes double, per A1 notation.
        """
        return "'" + self.tab_name().replace("'", "''") + "'"

    def tabs(self) -> list[str]:
        """Every tab name in the spreadsheet, in sheet order."""
        meta = (
            self._sheets()
            .spreadsheets()
            .get(spreadsheetId=self._cfg.google_sheet_id, fields="sheets.properties.title")
            .execute()
        )
        return [s["properties"]["title"] for s in meta.get("sheets", [])]

    def _header(self) -> list[str]:
        """HEADER with the timezone named on the Received column, e.g. "Received (Pacific)"."""
        label = timezone_label(self._cfg.business_timezone)
        return [f"{HEADER[0]} ({label})", *HEADER[1:]]

    def _read_header(self) -> list[str]:
        """The tab's whole first row, as written."""
        got = (
            self._sheets()
            .spreadsheets()
            .values()
            .get(spreadsheetId=self._cfg.google_sheet_id, range=f"{self._tab()}!1:1")
            .execute()
            .get("values", [])
        )
        return [str(c).strip() for c in (got[0] if got else [])]

    def _match(self, wanted: str, header: list[str]) -> int:
        """1-based column index of `wanted` in `header`, or 0 if it isn't there.

        Matching is case-insensitive, and the first column is matched on the part before "(" so a
        change of BUSINESS_TIMEZONE — "Received (Pacific)" becoming "Received (Eastern)" — finds
        the existing column rather than adding a second one beside it.
        """
        target = wanted.casefold()
        for i, name in enumerate(header, 1):
            if name.casefold() == target:
                return i
        stem = wanted.split(" (")[0].casefold()
        for i, name in enumerate(header, 1):
            if name.split(" (")[0].casefold() == stem:
                return i
        return 0

    def _columns(self) -> dict[str, int]:
        """Which column each of our fields belongs in, adding any that the sheet doesn't have yet.

        Written by NAME rather than by position, so the sheet belongs to the client: they can add
        their own columns, reorder ours, or leave a gap between them, and each value still lands
        under its own heading. Anything we don't recognise is simply never touched — a "Follow-up"
        or "Assigned to" column they maintain by hand keeps whatever they put in it.

        Columns of ours that are missing are appended after the last used one, so introducing a new
        field (Caller ID, say) adds a heading rather than silently shifting everything right of it.
        """
        expected = self._header()
        header = self._read_header()

        if not header:
            self._sheets().spreadsheets().values().update(
                spreadsheetId=self._cfg.google_sheet_id,
                range=f"{self._tab()}!{self._anchor_column()}1",
                valueInputOption="USER_ENTERED",
                body={"values": [expected]},
            ).execute()
            log.info("wrote header row to %s", self.tab_name())
            start = _col_index(self._anchor_column())
            return {name: start + i for i, name in enumerate(expected)}

        mapping = {name: self._match(name, header) for name in expected}
        missing = [name for name in expected if not mapping[name]]
        if not missing:
            return mapping

        # A new field of ours goes IMMEDIATELY AFTER our existing columns, by inserting a column
        # rather than claiming the next free one at the far right. The client keeps their own
        # section at the end of the sheet — "booked", notes, whatever they work from — and appending
        # there would both split our block across theirs and, if any of their columns has data but
        # no heading, write our values straight into it. Inserting shifts their section one to the
        # right with its contents intact, which is what Sheets' insertDimension is for.
        # Where our block ends today. When NONE of our headings are present — a tab holding only
        # the client's own columns, or a stray value left in row 1 — there is no block yet, so we
        # start at the anchor column and push whatever is there to the right.
        found = [col for col in mapping.values() if col]
        last_ours = max(found) if found else _col_index(self._anchor_column()) - 1

        inserted, filled = [], []
        for name in missing:
            at = last_ours + 1
            # Prefer empty space over an insert. Inserting shifts every column to the right by one,
            # so doing it when the next column is already blank moves the client's section for no
            # reason — and doing it once per new field moves it once per field. A column that is
            # genuinely empty is just claimed, and nothing downstream of it moves at all.
            if self._column_free(at):
                self._sheets().spreadsheets().values().update(
                    spreadsheetId=self._cfg.google_sheet_id,
                    range=f"{self._tab()}!{_col_letter(at)}1",
                    valueInputOption="USER_ENTERED",
                    body={"values": [[name]]},
                ).execute()
                filled.append(f"{name} -> {_col_letter(at)}")
            else:
                self._insert_column(at, name)
                inserted.append(f"{name} -> {_col_letter(at)}")
            mapping[name] = at
            last_ours = at

        if filled:
            log.info("filled empty column(s) in %s: %s", self.tab_name(), ", ".join(filled))
        if inserted:
            log.info(
                "inserted column(s) into %s, shifting later columns right: %s",
                self.tab_name(), ", ".join(inserted),
            )
        return mapping

    def _column_free(self, index: int) -> bool:
        """True when column `index` holds nothing at all — no heading and no data below it.

        The heading row alone isn't enough to judge by: a client column can carry values with no
        title (and the API trims trailing empties, so it may not even appear in the header row).
        Claiming such a column would write our values straight into their data.
        """
        letter = _col_letter(index)
        got = (
            self._sheets()
            .spreadsheets()
            .values()
            .get(
                spreadsheetId=self._cfg.google_sheet_id,
                range=f"{self._tab()}!{letter}:{letter}",
                majorDimension="COLUMNS",
            )
            .execute()
            .get("values", [])
        )
        cells = got[0] if got else []
        return not any(str(c).strip() for c in cells)

    def _sheet_id(self) -> int:
        """The tab's numeric id. insertDimension addresses sheets by id, not by name."""
        meta = (
            self._sheets()
            .spreadsheets()
            .get(spreadsheetId=self._cfg.google_sheet_id, fields="sheets.properties(sheetId,title)")
            .execute()
        )
        wanted = self.tab_name()
        titles = [s.get("properties", {}).get("title", "") for s in meta.get("sheets", [])]

        # Case-insensitive, because Sheets itself is: `'Voicemails'!A1` resolves happily against a
        # tab called VOICEMAILS, so every read here worked while an exact comparison on the title
        # did not. Matching exactly meant SHEET_RANGE had to agree with the tab's capitalisation
        # even though nothing else in the API cares — a difference invisible to the person who
        # named the tab.
        for sheet in meta.get("sheets", []):
            props = sheet.get("properties", {})
            if str(props.get("title", "")).strip().casefold() == wanted.strip().casefold():
                return int(props["sheetId"])

        raise SheetLayoutError(
            f"No tab named {wanted!r} in this spreadsheet. It has: "
            + (", ".join(repr(t) for t in titles) or "(none)")
        )

    def _insert_column(self, index: int, name: str) -> None:
        """Insert a blank column at 1-based `index`, shifting the rest right, and title it.

        Everything from `index` onward moves right one column, values and formatting intact, and
        Sheets rewrites any formula references to match. Nothing is overwritten.
        """
        self._sheets().spreadsheets().batchUpdate(
            spreadsheetId=self._cfg.google_sheet_id,
            body={
                "requests": [
                    {
                        "insertDimension": {
                            "range": {
                                "sheetId": self._sheet_id(),
                                "dimension": "COLUMNS",
                                # The API is 0-based and end-exclusive: one column at `index`.
                                "startIndex": index - 1,
                                "endIndex": index,
                            },
                            # Only meaningful when there IS a column before to inherit from; the
                            # API rejects the request outright at index 0 rather than ignoring it.
                            "inheritFromBefore": index > 1,
                        }
                    }
                ]
            },
        ).execute()
        self._sheets().spreadsheets().values().update(
            spreadsheetId=self._cfg.google_sheet_id,
            range=f"{self._tab()}!{_col_letter(index)}1",
            valueInputOption="USER_ENTERED",
            body={"values": [[name]]},
        ).execute()

    def check(self) -> str:
        """Read-only reachability check: returns the spreadsheet's title. Confirms in one call
        that the credentials load, the service account can see the sheet (it's been shared),
        and GOOGLE_SHEET_ID is valid. Used by scripts/checks/verify_sheets.py."""
        meta = (
            self._sheets()
            .spreadsheets()
            .get(spreadsheetId=self._cfg.google_sheet_id, fields="properties.title")
            .execute()
        )
        return meta.get("properties", {}).get("title", "")

    def _anchor_column(self) -> str:
        """The column SHEET_RANGE starts at — "Voicemails!C1" -> "C". Defaults to A.

        Our first column is Received, which is never blank, so this column is what tells us how far
        the data actually goes.
        """
        rng = self._cfg.sheet_range
        cell = rng.split("!", 1)[1] if "!" in rng else ""
        letters = "".join(c for c in cell if c.isalpha()).upper()
        return letters or "A"

    def _next_row(self, column: int | None = None) -> int:
        """The first row after the last one we've written, read from our own anchor column.

        Why not let `values.append` decide: it looks for a "table" around the given range and adds
        after the last row of it, and its idea of the table grows to take in any adjacent filled
        cell. So a note typed in a spare column, or a total parked at the bottom, pushes every
        subsequent row down past it and leaves a block of blank rows in the middle of the data.

        Reading the anchor column and writing at the row after its last value puts each row exactly
        where it belongs, regardless of what else is on the sheet. The API trims trailing empties,
        so the length of that column IS the last used row.
        """
        col = _col_letter(column) if column else self._anchor_column()
        values = (
            self._sheets()
            .spreadsheets()
            .values()
            .get(
                spreadsheetId=self._cfg.google_sheet_id,
                range=f"{self._tab()}!{col}:{col}",
                majorDimension="COLUMNS",
            )
            .execute()
            .get("values", [])
        )
        return len((values[0] if values else [])) + 1

    def append_row(self, values: list[str]) -> None:
        """Write one row, each value under its own heading, touching no other column."""
        columns = self._columns()
        names = self._header()
        row = self._next_row(columns[names[0]])

        # Group our columns into contiguous runs, so columns the client owns that sit BETWEEN ours
        # are not included in any range we write. Writing one wide block would overwrite them.
        cells = sorted((columns[name], value) for name, value in zip(names, values))
        runs: list[tuple[int, list[str]]] = []
        for col, value in cells:
            if runs and col == runs[-1][0] + len(runs[-1][1]):
                runs[-1][1].append(value)
            else:
                runs.append((col, [value]))

        self._sheets().spreadsheets().values().batchUpdate(
            spreadsheetId=self._cfg.google_sheet_id,
            body={
                # USER_ENTERED so the "Open email" HYPERLINK stays a formula rather than text.
                "valueInputOption": "USER_ENTERED",
                "data": [
                    {"range": f"{self._tab()}!{_col_letter(start)}{row}", "values": [run]}
                    for start, run in runs
                ],
            },
        ).execute()
        log.debug("wrote row %d across %d range(s)", row, len(runs))
