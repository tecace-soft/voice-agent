# transcribe-app

Reads **voicemail `.wav` attachments from email**, transcribes each one, extracts the
important details, and appends a row per voicemail to a **Google Sheet**.

It's a batch job: run it by hand or on a schedule. It's idempotent — voicemails it has already
handled are skipped — and it never modifies the mailbox.

## Pipeline

```
IMAP inbox ──▶ .wav attachments ──▶ Gemini: transcript + fields ──▶ Google Sheet row
 (any provider)   (one per voicemail)      (one multimodal call)        (one row each)
```

Each `.wav` is transcribed and extracted **independently** in a single Gemini call, so one
voicemail's audio never bleeds into another's transcript or row.

| Step | Module | Service |
| --- | --- | --- |
| Find voicemail mail, pull `.wav`s | `tools/email_source.py` | generic IMAP (Outlook.com, Gmail, Yahoo, …) |
| Transcribe `.wav` + extract caller name / phone / requested time / summary | `tools/extractor.py` | Google Gemini (audio in, structured output) |
| Append a row | `tools/sheets.py` | Google Sheets (service account) |
| Orchestrate + idempotency | `pipeline.py` | local `.processed.json` |

## Layout

Mirrors the other apps in this workspace (`config/` + `tools/` + a root orchestrator; a
`scripts/` entry point plus `scripts/checks/` for connectivity verification).

```
transcribe-app/
  src/transcribe_app/
    config/settings.py     # Config.load(), all env-backed settings + IMAP provider presets
    tools/                 # one module per external service
      email_source.py      #   IMAP: find voicemail mail, pull .wav attachments
      extractor.py         #   Google Gemini: audio -> transcript + structured fields (one call)
      sheets.py            #   Google Sheets: append a row
    pipeline.py            # orchestrates the four tools; per-file isolation + idempotency
  scripts/
    run_transcribe.py      # primary entry point — one full pass
    checks/                # connectivity checks (run these first when something's off)
      verify_imap.py       #   confirms the mailbox login + counts visible voicemails
      verify_sheets.py     #   confirms the service account can open the sheet (read-only)
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

## Run

```bash
python scripts/run_transcribe.py
```

It prints how many voicemails were uploaded, skipped (already done), and failed. Missing
settings are reported up front rather than failing deep in an API call.

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
