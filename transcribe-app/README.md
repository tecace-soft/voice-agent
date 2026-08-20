# transcribe-app

Reads **voicemail audio attachments from email** (`.wav`, `.mp3`, `.m4a`, and other formats),
transcribes each one, extracts the important details, and appends a row per voicemail to a
**Google Sheet**.

It's a batch job: run it by hand or on a schedule. It's idempotent — voicemails it has already
handled are skipped — and it never modifies the mailbox.

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
| Upload the audio → a "Listen" link | `tools/drive.py` | Google Drive (same service account) |
| Append a row (incl. the Listen link) | `tools/sheets.py` | Google Sheets (service account) |

Each sheet row includes a clickable **Listen** link — the audio is uploaded to Google Drive so
the team can play the voicemail straight from the spreadsheet.
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
      drive.py             #   Google Drive: upload the audio -> a "Listen" link
      google_auth.py       #   shared service-account credentials (Sheets + Drive)
      sheets.py            #   Google Sheets: append a row
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
- **Google Drive** (for the Listen links) — in the **same** Google Cloud project, **enable the
  Google Drive API**. Recommended: create a Drive folder, share it with the service account
  (Editor) and your team (Viewer), and set `GOOGLE_DRIVE_FOLDER_ID`. Leave `GOOGLE_DRIVE_PUBLIC=true`
  for the simplest setup (each upload gets an "anyone with the link" view permission so the Listen
  link just works), or set it `false` to rely on the folder's sharing instead.

## Run

```bash
python scripts/run_transcribe.py
```

It prints how many voicemails were uploaded, skipped (already done), and failed. Missing
settings are reported up front rather than failing deep in an API call.

### Manually ingest audio files (no email needed)

When IMAP access isn't set up yet, download the voicemail(s) from webmail and run them straight
through the same Gemini → Drive → Sheet path:

```bash
python scripts/ingest_file.py ~/Downloads/voicemail1.mp3 ~/Downloads/voicemail2.mp3
```

Each file is transcribed, its audio uploaded to Drive, and a row (with a Listen link) appended to
the sheet — exactly like the full pipeline, but sourced from local files. Needs `GEMINI_API_KEY`
and the Sheets/Drive service account; the IMAP settings are not required.

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
