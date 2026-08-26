# transcribe-app

Reads **voicemail audio attachments from email** (`.wav`, `.mp3`, `.m4a`, and other formats),
transcribes each one, extracts the important details, and appends a row per voicemail to a
**Google Sheet**.

It reads the mailbox over **IMAP** — the customer's voicemail system delivers mail in over SMTP,
which is a separate direction and needs nothing enabled; IMAP is how we fetch those messages back
out again.

It's a batch job: run it by hand or on a schedule. It's idempotent — voicemails it has already
handled are skipped — and it never modifies the mailbox.

**Setting this up for a customer? Follow [docs/onboarding.md](docs/onboarding.md)** — the
ordered checklist, with a verification step after each stage.

## Starting a fresh pass

The poller skips anything recorded in the state file (`STATE_FILE`, default `.processed.json`),
keyed by Message-ID + attachment name, so a voicemail is only ever transcribed once. To make it
treat everything as new again — e.g. to push current voicemails through a new backend or dashboard
setup:

```bash
python scripts/reset_state.py --dry-run   # what's remembered
python scripts/reset_state.py             # forget it
systemctl restart transcribe-poller       # if it runs under systemd
```

It reads `STATE_FILE` the same way the app does, so it clears the file the poller actually uses. It
never touches the mailbox — nothing is deleted, moved, or marked read on the mail server.

Two consequences worth planning for: every voicemail still within `IMAP_SINCE_DAYS` is transcribed
again, so each **appends a fresh row to the sheet** (clear the sheet, or point `SHEET_RANGE` at a
test tab, if you want a clean result), and each re-transcription is another Gemini call.

## The sheet's "Received" column

It carries **when the voicemail arrived** — read from the email's own `Date` header — converted to
`BUSINESS_TIMEZONE` (default `America/Los_Angeles`) and written as `2026-08-25 11:22:16`. The header
names the zone, e.g. `Received (Pacific)`.

Two deliberate choices: it is the arrival time rather than the time we transcribed it (otherwise a
backfill stamps every row with the moment the backfill ran), and the format is one Google Sheets
parses as a real datetime, so the column sorts and filters. A friendlier "Aug 25, 2026 11:22 AM PDT"
would land in the cell as text and sort alphabetically.

## Reporting

Each finished pass POSTs its counts to `<BACKEND_URL>/transcribe/runs` together with **the mailbox
it fetched from** (`IMAP_USERNAME`, or `VOICEMAIL_MAILBOX_EMAIL` when the username isn't an
address). The dashboard attributes voicemail data to that address and shows each person only the
mailbox matching their own account email, so it must be the address they sign in with. If neither
value looks like an email the run is reported unattributed rather than attributed to something
wrong.

## Pipeline

```
IMAP inbox ──▶ audio attachments ──▶ Gemini: transcript + fields ──▶ Google Sheet row
 (any provider)   (one per voicemail)      (one multimodal call)        (one row each)
```

Each recording is transcribed and extracted **independently** in a single Gemini call, so one
voicemail's audio never bleeds into another's transcript or row.

| Step | Module | Service |
| --- | --- | --- |
| Find voicemail mail, pull audio (`.wav`/`.mp3`/…) | `tools/email_source.py` | generic IMAP (Gmail, Outlook, Yahoo, …) |
| Transcribe audio + extract caller name / phone / requested time / summary | `tools/extractor.py` | Google Gemini (audio in, structured output) |
| Append a row (incl. an "Open email" link) | `tools/sheets.py` | Google Sheets (service account) |

**The recording is never stored or served by us.** Each sheet row gets an **Open email**
(`EMAIL_LINK_TEMPLATE`) webmail deep-link to the **source message**, so the person opens that email
and downloads the recording from it — for privacy and security, no copy is kept anywhere. It works
for people logged into that mailbox. Placeholders: `{message_id}` / `{uid}` / `{mailbox}` /
`{gm_msgid}` (Gmail opens directly via `{gm_msgid}`; Roundcube via `{uid}`).
| Orchestrate + idempotency | `pipeline.py` | local `.processed.json` |

## Layout

Mirrors the other apps in this workspace (`config/` + `tools/` + a root orchestrator; a
`scripts/` entry point plus `scripts/checks/` for connectivity verification).

```
transcribe-app/
  src/transcribe_app/
    config/settings.py     # Config.load(), all env-backed settings + IMAP provider presets
    tools/                 # one module per external service
      email_source.py      #   IMAP: find voicemail mail, pull audio attachments (.wav/.mp3/…)
      extractor.py         #   Google Gemini: audio -> transcript + structured fields (one call)
      google_auth.py       #   service-account credentials for Google Sheets
      sheets.py            #   Google Sheets: append a row (incl. the "Open email" link)
    pipeline.py            # orchestrates the tools; per-file isolation + idempotency
  scripts/
    run_transcribe.py      # primary entry point — one full pass over the mailbox
    ingest_file.py         # manually ingest local audio files (no email/IMAP needed)
    checks/                # connectivity checks (run these first when something's off)
      verify_imap.py       #   confirms the mailbox login + counts visible voicemails
      verify_sheets.py     #   confirms the service account can open the sheet (read-only)
      verify_extract.py    #   runs Gemini on a local audio file (transcript + fields)
  .env.example · requirements.txt · pyproject.toml
```

## Setup

```bash
cd transcribe-app
python -m venv .venv && . .venv/Scripts/activate   # Windows; use .venv/bin/activate on macOS/Linux
pip install -e .        # installs deps AND puts transcribe_app on the path (so the scripts import)
cp .env.example .env    # then fill it in
```

Fill in `.env` (see the comments there):

- **Email** — `IMAP_PROVIDER=outlook` for testing (or set `IMAP_HOST` for any other provider),
  plus `IMAP_USERNAME` / `IMAP_PASSWORD`. Use an **app password** if the account has 2FA
  (Outlook.com, Gmail, and Yahoo require one for IMAP).
- **Google Gemini** — `GEMINI_API_KEY` (transcription + extraction, one call; get one from [AI Studio](https://aistudio.google.com/apikey)).
- **Google Sheets** — a service account: create one in Google Cloud, download its JSON key to
  `service-account.json`, set `GOOGLE_SHEET_ID`, and **share the sheet with the service
  account's email as an Editor**.
- **Open-email link** (`EMAIL_LINK_TEMPLATE`) — the webmail deep-link the sheet uses so people
  open the source email and download the recording from it (no copy is ever stored). Set the
  template to match your webmail:
  - **Gmail** (opens the message directly): `https://mail.google.com/mail/u/0/#all/{gm_msgid}`
  - **Roundcube** (cPanel): `https://mail.<host>/?_task=mail&_action=show&_mbox={mailbox}&_uid={uid}`

  Leave it blank to omit the link (transcript-only rows).

## Run

**One pass** (manual / cron):

```bash
python scripts/run_transcribe.py
```

It prints how many voicemails were uploaded, skipped (already done), and failed. Missing
settings are reported up front rather than failing deep in an API call.

**Always on** (the poller) — runs a pass every `POLL_INTERVAL_SECONDS` (default 5 min), forever:

```bash
python scripts/run_poller.py
```

Each pass skips voicemails already in the state file, so it never creates duplicate rows. A failing
pass is logged and the loop continues. Keep it running under **systemd** (recommended on the VPS):

```bash
cp deploy/transcribe-poller.service /etc/systemd/system/transcribe-poller.service
systemctl daemon-reload
systemctl enable --now transcribe-poller     # start now + on boot; restarts on crash
journalctl -u transcribe-poller -f           # watch the logs
```

(Adjust the paths in `deploy/transcribe-poller.service` if the repo/venv aren't at
`/root/voice-agent/transcribe-app`.) For a quick, non-persistent run instead: `nohup python
scripts/run_poller.py &`.

### Manually ingest audio files (no email needed)

When IMAP access isn't set up yet, download the voicemail(s) from webmail and transcribe them
straight into the sheet:

```bash
python scripts/ingest_file.py ~/Downloads/voicemail1.mp3 ~/Downloads/voicemail2.mp3
```

Each file is transcribed and a row appended to the sheet. Since these are local files (no source
email), the row has the transcript + caller details but no "Open email" link — for a one-off
transcript. Needs `GEMINI_API_KEY` and the Sheets service account; the IMAP settings are not
required.

If something's off, run the connectivity checks first — they isolate the two usual blockers
(mailbox login and the sheet share) without touching any data:

```bash
python scripts/checks/verify_imap.py             # mailbox login + how many voicemails are visible
python scripts/checks/verify_sheets.py           # service account can open the sheet (read-only)
python scripts/checks/verify_extract.py foo.wav  # Gemini transcript + fields on a local .wav (no email/sheet)
```

## Notes

- **Provider-agnostic email.** Any IMAP mailbox works — set `IMAP_PROVIDER` for a preset, or
  `IMAP_HOST`/`IMAP_PORT` for anything else. We test against Outlook.com.
- **Picking out voicemail mail.** By default any message with a `.wav` attachment is treated as
  a voicemail. Narrow it with `VOICEMAIL_FROM` / `VOICEMAIL_SUBJECT` to match your
  voicemail-to-email sender/subject.
- **Idempotency.** Handled voicemails are recorded in `STATE_FILE` (default `.processed.json`)
  keyed by Message-ID + attachment name. Delete that file to reprocess everything.
