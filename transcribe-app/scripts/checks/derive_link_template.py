"""Work out the EMAIL_LINK_TEMPLATE for a provider we haven't set one up for yet.

    1. Open one voicemail in that provider's webmail.
    2. Copy the URL out of the address bar.
    3. python scripts/checks/derive_link_template.py "<the url you copied>"

It pulls the recent voicemails over IMAP, finds the one whose identifiers appear in that URL, and
prints the template with the matching parts swapped for placeholders — ready to paste into .env.

Why a script rather than a documented URL per provider: only Gmail's format is worth writing down,
because `{gm_msgid}` comes from X-GM-MSGID, a Gmail-only IMAP extension. Everyone else has to be
derived from an actual URL, and doing that by eye means URL-decoding things and spotting a UID
inside a long query string — mechanical work that's easy to get subtly wrong.

If nothing in the URL identifies the message — common for single-page webmail that doesn't route
per message — it says so. Leave EMAIL_LINK_TEMPLATE empty; the sheet's "Open email" column is then
blank and everything else works.
"""

from __future__ import annotations

import sys
from urllib.parse import quote, unquote

from transcribe_app.config import Config
from transcribe_app.tools import EmailSource

# Longest first: a UID like "7" would otherwise match inside a Message-ID and mask the better hit.
PLACEHOLDERS = ("message_id", "gm_msgid", "uid", "mailbox")


def _candidates(value: str) -> list[str]:
    """Every form a value might take inside a URL.

    A Message-ID is the awkward one: it arrives as `<abc@host.com>`, and webmail writes it into a
    URL with the brackets gone and the `@` percent-encoded. So the encoded forms have to be tried
    too — matching only the raw value silently finds nothing and reports "no template", which is
    the wrong answer rather than a visible failure.
    """
    if not value:
        return []
    out: list[str] = []
    raw = value.strip()
    stripped = raw.lstrip("<").rstrip(">")
    for form in (raw, unquote(raw), stripped, quote(stripped, safe=""), quote(raw, safe="")):
        if form and form not in out:
            out.append(form)
    return out


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    url = sys.argv[1].strip()

    cfg = Config.load()
    gaps = cfg.missing()
    if gaps:
        print("Missing required settings:")
        for g in gaps:
            print(f"  - {g}")
        return 1

    print(f"Looking for a message identifier in:\n  {url}\n")
    voicemails = EmailSource(cfg).fetch_voicemails()
    if not voicemails:
        print("No voicemails found in the mailbox — nothing to match the URL against.")
        print("Widen IMAP_SINCE_DAYS, or check the VOICEMAIL_FROM / VOICEMAIL_SUBJECT filters.")
        return 1

    decoded_url = unquote(url)

    for vm in voicemails:
        values = {
            "message_id": vm.message_id,
            "gm_msgid": vm.gm_msgid,
            "uid": vm.uid,
            "mailbox": cfg.imap_mailbox,
        }
        template = url
        matched: list[str] = []

        for name in PLACEHOLDERS:
            for candidate in _candidates(values.get(name, "")):
                if len(candidate) < 2:
                    continue  # a one-character "identifier" matches everything; useless
                if candidate in template:
                    template = template.replace(candidate, "{" + name + "}")
                    matched.append(name)
                    break
                if candidate in decoded_url:
                    print(
                        f"  note: {name} appears in the URL only once decoded — the template below "
                        "may need the encoded form instead."
                    )

        if matched:
            print(f"Matched the voicemail from {vm.from_addr} ({vm.subject!r})")
            print(f"  using: {', '.join(matched)}\n")
            print("Put this in .env:\n")
            print(f"EMAIL_LINK_TEMPLATE={template}\n")
            print("Then run the pipeline once and click the sheet's 'Open email' link to confirm it")
            print("opens the right message.")
            return 0

    print("No identifier from any recent voicemail appears in that URL.")
    print()
    print("That usually means the webmail doesn't route per message — the address bar reads the same")
    print("whichever message is open. There's no template to write:")
    print()
    print("  EMAIL_LINK_TEMPLATE=")
    print()
    print("The sheet's 'Open email' column stays blank and nothing else is affected.")
    print()
    print("Worth one retry first: make sure the URL was copied while a *voicemail* was open (not the")
    print("inbox list), and that the voicemail is recent enough to be inside IMAP_SINCE_DAYS.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
