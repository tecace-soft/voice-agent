# Onboarding a customer

Work down this in order. Each stage ends with something you can *check*, so a mistake surfaces at
the step that caused it rather than three steps later as "no rows in the sheet".

One poller instance polls **one mailbox**. If the customer wants several people's voicemails
transcribed separately, that's a poller instance each — the dashboard already handles many mailboxes.

---

## 1. What to ask the customer for

Three things. Everything else on this page is ours to do — don't put any of it in front of them.

| Ask | Why it has to come from them |
| --- | --- |
| **The mailbox address** voicemails land in, and an **app password** for it | The app password is the credential we read the mailbox with. Google only issues one once **2-Step Verification is on** for that account, so if they don't have the option, that's why — and a Workspace admin can block app passwords entirely. |
| **A link to the Google Sheet**, shared with our service account as **Editor** | Send them the `client_email` from our key (ends `…iam.gserviceaccount.com`) and ask them to share the sheet with it. Viewer is not enough — we append rows. Adding our Cloud *project* is not the same thing, and it's what produces the 403. |
| **One sample voicemail email**, forwarded | Tells you whether this will work at all before you promise anything — see §2. |

Two things to confirm in passing, not to make them go and find:

- **Their timezone**, if it isn't Pacific — it sets the sheet's `Received` column and the dashboard's "today".
- **Who else needs to see the dashboard.** Everyone signing in sees only the mailbox matching their own address, so two people on one mailbox means one of them needs an admin account from us.

### Don't ask them for these

- **The sheet ID** — it's in the link they send; pull it out yourself.
- **Anything about IMAP.** Google retired the on/off setting for personal Gmail and it's always on
  now. If access genuinely fails, §4 catches it and the answer is their Workspace admin, not them.
- **Anything on our side**: `GEMINI_API_KEY`, the service-account key, `TRANSCRIBE_INGEST_KEY`,
  `BACKEND_URL`, the webmail link template.

## 2. Read the sample email before you promise anything

Open it and confirm three things:

1. **The recording is an attachment**, not a download link. We accept wav, mp3, m4a, mp4, aac, ogg,
   flac, aiff, amr, and anything with an `audio/*` content type. A provider that emails a *link* to
   a portal will transcribe nothing — that's a dealbreaker to discover now, not after go-live.
2. **What else lands in that mailbox.** If it receives only voicemails, leave the filters empty. If
   it receives other mail, note the sender or subject pattern for `VOICEMAIL_FROM` /
   `VOICEMAIL_SUBJECT`.
3. **Whether the body states the call time.** We use the email's own `Date` header for `Received`,
   which is when the voicemail system sent it — usually seconds after the call. If the body carries
   a more precise call time and the customer cares, that's a small parsing change; ask first.

## 3. Configure the poller

On the VPS, in `transcribe-app/.env` (start from `.env.example`):

```bash
IMAP_PROVIDER=gmail                    # or IMAP_HOST/IMAP_PORT for anything else
IMAP_USERNAME=voicemail@customer.com
IMAP_PASSWORD=<app password>
IMAP_MAILBOX=INBOX
IMAP_SINCE_DAYS=7                      # how far back the FIRST run reaches — sets the backfill size

# only if that mailbox receives more than voicemails
# VOICEMAIL_FROM=voicemail@theirprovider.com
# VOICEMAIL_SUBJECT=New voicemail

GEMINI_API_KEY=<ours>
GOOGLE_CREDENTIALS_FILE=<path to our service-account key>
GOOGLE_SHEET_ID=<the id out of their sheet link>
SHEET_RANGE=Voicemails!A1              # the TAB must exist; we write the header row if it's empty
EMAIL_LINK_TEMPLATE=https://mail.google.com/mail/u/0/#all/{gm_msgid}   # Gmail; empty = no link column
BUSINESS_TIMEZONE=America/Los_Angeles

BACKEND_URL=<transcribe-backend URL>
TRANSCRIBE_INGEST_KEY=<matches the backend>
# VOICEMAIL_MAILBOX_EMAIL=              # only if IMAP_USERNAME isn't an email address
POLL_INTERVAL_SECONDS=300
```

**`SHEET_RANGE` needs the tab to exist.** The sheet ID alone isn't enough.

## 4. Check each connection separately

Three scripts, each isolating one failure:

```bash
python scripts/checks/verify_imap.py                      # login works, and how many voicemails are visible
python scripts/checks/verify_sheets.py                    # credentials + sharing + sheet id (read-only)
python scripts/checks/verify_extract.py sample.wav        # transcription quality, needs only GEMINI_API_KEY
```

Run `verify_extract.py` on **their** audio, not a test clip. It's the only way to see how the
transcription copes with their callers before the customer does.

If `verify_imap.py` **reports 0 voicemails** but the mailbox has some: check `IMAP_SINCE_DAYS`,
then the `VOICEMAIL_FROM`/`VOICEMAIL_SUBJECT` filters — a filter that doesn't match is the usual
cause.

If it **can't log in at all** and you're sure the app password is right, their Workspace admin has
IMAP disabled for the organisation. That's the only remaining place it can be switched off, and the
only point at which IMAP is worth mentioning to anyone.

## 5. Create their dashboard account

```bash
cd transcribe-backend
bun run auth create voicemail@customer.com "Customer Name"
```

**The account email must be exactly the mailbox we poll.** Sign-in works either way, so a mismatch
looks like a working login onto an empty dashboard. Leave them as a `user`; admin is for us.

Hand over the generated password — it's shown once — and tell them to change it (Accounts page,
Reset password) after their first sign-in.

## 6. First run

```bash
python scripts/run_transcribe.py          # one pass, in the foreground, so you can watch it
```

Then check, in order:

- **The sheet** — a header row plus one row per voicemail. `Received (Pacific)` should show when
  each voicemail *arrived*, not all the same timestamp.
- **The dashboard** — sign in as them. Overview shows their runs; the sidebar says `Showing <their
  address>`.
- **Per person** (as admin) — their row should show volume with **no** warning badge. **No account**
  means the mailbox has no matching login; **No data** means the login has no mailbox. Either badge
  means §5 and §3 disagree about the address.

## 7. Leave it running

```bash
sudo systemctl enable --now transcribe-poller
systemctl status transcribe-poller
systemctl is-enabled transcribe-poller       # confirms it survives a reboot
journalctl -u transcribe-poller -f           # a "cycle done" line every ~5 minutes
```

`is-enabled` is worth the extra second — a poller that runs now but not after a reboot looks fine
until the box restarts.

---

## Starting over

Safe to re-run; do them in this order:

```bash
# 1. clear the dashboard's metrics (accounts and feedback are untouched)
cd transcribe-backend && bun run db:clear --dry-run && bun run db:clear

# 2. clear the sheet by hand — rows are appended, so a re-run duplicates them

# 3. forget which voicemails have been transcribed, so everything is treated as new
cd transcribe-app && python scripts/reset_state.py

sudo systemctl restart transcribe-poller
```

Re-running costs a Gemini call per voicemail and only reaches back as far as `IMAP_SINCE_DAYS`.

## When something looks wrong

| Symptom | Look at |
| --- | --- |
| Sheet stays empty, no errors | `IMAP_SINCE_DAYS`; the `VOICEMAIL_FROM`/`SUBJECT` filters; that the recording is an attachment |
| 403 from Sheets | The sheet isn't shared with the service account's `client_email` as **Editor** |
| Customer signs in to an empty dashboard | Account email ≠ polled mailbox. **Per person** names it |
| Dashboard rows say "Unattributed" | The poller is running an older build that doesn't send `mailboxEmail` |
| Every `Received` is the same timestamp | An old build — it used to record transcription time, not arrival |
| Poller stops after a reboot | `systemctl enable transcribe-poller` was never run |
