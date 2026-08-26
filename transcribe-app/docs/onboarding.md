# Onboarding a customer

Work down this in order, starting at §0 — before anything we control. Each stage ends with something
you can *check*, so a mistake surfaces at the step that caused it rather than three steps later as
"no rows in the sheet".

One poller instance polls **one mailbox**. If the customer wants several people's voicemails
transcribed separately, that's a poller instance each — the dashboard already handles many mailboxes.

---

## 0. Get the voicemails into a mailbox we can read

Everything downstream assumes voicemail audio is already arriving somewhere we can poll. With
Comcast that's three steps, and the middle one decides the shape of the whole setup.

### Step 1 — Turn on voicemail-to-email at Comcast, with the recording attached

A client who says "voicemails go to my email" has often enabled the *notification* version instead:
an email saying "you have a new voicemail", with no audio or a link into a portal. That is useless
to us — we need the file.

Where the setting lives depends on the product, and Comcast moves these menus, so look for the
setting rather than an exact path:

- **Xfinity Voice** (residential): Xfinity account → Voice / Voicemail settings → send voicemail to
  an email address.
- **Comcast Business VoiceEdge**: the VoiceEdge portal, under that user's voicemail settings →
  receive a copy by email.

**Check it yourself:** leave a test voicemail, open the message in the Comcast inbox, and confirm
there's a playable audio attachment on it. Don't take their word for it.

### Step 2 — Can we read the Comcast mailbox directly?

This is the decision point. Polling Comcast directly is the better setup — one less link to break,
and the sheet's `Received` time stays exactly as Comcast sent it. Find out before you set up any
forwarding:

1. Have them switch on **third-party access** in the Xfinity email settings. No IMAP client can
   connect until that's on. It's the user's own setting, not an admin's.
2. Get the **account password** — Comcast has no app passwords.
3. Point a `.env` at it (`IMAP_PROVIDER=comcast`, their address and password) and run
   `python scripts/checks/verify_imap.py`.

**If it logs in → poll Comcast directly.** Skip step 3 entirely; the mailbox in §3 is the Comcast
one, and the dashboard account in §5 uses the Comcast address.

You'll need an `EMAIL_LINK_TEMPLATE` for Comcast, because the one in `.env.example` is Gmail-only:
`{gm_msgid}` comes from `X-GM-MSGID`, a Gmail IMAP extension that no other provider sends. For
anything else the usable placeholders are `{uid}`, `{mailbox}` and `{message_id}`.

Don't work it out by eye — there's a script for it:

```bash
# 1. open one voicemail in Comcast webmail
# 2. copy the URL out of the address bar
python scripts/checks/derive_link_template.py "<the url you copied>"
```

It reads the recent voicemails over IMAP, finds the one whose identifiers appear in that URL, and
prints the finished line to paste into `.env` — handling the encoding along the way (a Message-ID
arrives as `<abc@host>` but reaches a URL as `abc%40host`, which is easy to miss by hand).

If it reports that **nothing in the URL identifies the message** — common for single-page webmail
that doesn't route per message — there is no template to write. **Leave `EMAIL_LINK_TEMPLATE`
empty.** The "Open email" column is then blank and everything else works exactly the same; it is
not a blocker.

Either way, run the pipeline once afterwards and actually click the link in the sheet.

### Step 3 — Only if we can't read Comcast: forward to Gmail

If `verify_imap.py` can't log in, put a Gmail account in the middle:

```
phone  →  Comcast voicemail-to-email  →  Comcast inbox  →  forward  →  Gmail  →  us
```

Comcast webmail → Settings → auto-forward, pointed at the Gmail address (keeping a copy or not is
up to them). Then leave a second test voicemail and confirm it arrives in **Gmail** with the
attachment intact.

From here the rest of the page is the Gmail path: the mailbox in §3 is the Gmail one, the dashboard
account in §5 uses the Gmail address, and `EMAIL_LINK_TEMPLATE` is the Gmail template already in
`.env.example`.

> **Prefer a plain auto-forward over "forward as attachment."** Either will work — we look inside
> nested messages, so the audio is still found — but a forward-as-attachment creates a *new* message
> with its own `Date`, and that becomes the sheet's `Received` time instead of when the caller
> actually rang. A straight auto-forward preserves the original.

### Verify

A voicemail you leave right now appears in the mailbox you settled on — Comcast or Gmail — within a
minute or two, with an audio attachment you can play, and `verify_imap.py` can log in to it. Until
both are true, nothing further on this page will work.

## 1. What to ask the customer for

Three things. Everything else on this page is ours to do — don't put any of it in front of them.

| Ask | Why it has to come from them |
| --- | --- |
| **The mailbox address** voicemails land in, and an **app password** for it | The app password is the credential we read the mailbox with. Google only issues one once **2-Step Verification is on** for that account, so if they don't have the option, that's why — and a Workspace admin can block app passwords entirely. |
| **A link to the Google Sheet**, shared with our service account as **Editor** | Send them the `client_email` from our key (ends `…iam.gserviceaccount.com`) and ask them to share the sheet with it. Viewer is not enough — we append rows. Adding our Cloud *project* is not the same thing, and it's what produces the 403. |
| **One sample voicemail email**, forwarded | Tells you whether this will work at all before you promise anything — see §2. |
| **IMAP switched on** — *only if it applies to them* | Depends entirely on the provider; see below. Ask for it up front when it applies, because it can need an admin and you don't want to discover that at §4. |

Two things to confirm in passing, not to make them go and find:

- **Their timezone**, if it isn't Pacific — it sets the sheet's `Received` column and the dashboard's "today".
- **Who else needs to see the dashboard.** Everyone signing in sees only the mailbox matching their own address, so two people on one mailbox means one of them needs an admin account from us.

### Does this customer need IMAP switched on?

We read the mailbox over IMAP. Their voicemail system *delivers* mail in over SMTP — a different
direction that needs nothing enabled — so pointing voicemails at the mailbox only covers half of it.
Whether IMAP needs enabling is entirely a provider question:

| Provider | What to ask for |
| --- | --- |
| **Personal Gmail** | Nothing. Google retired the on/off setting; IMAP is always on. Don't send them looking for it. Auth is an **app password**. |
| **Comcast / Xfinity** | A **third-party access** setting in Xfinity email settings has to be on before any IMAP client can connect. It's the user's own setting, so they can fix it themselves. Auth is the **account password** — Comcast has no app passwords. |
| **Google Workspace** | An **admin** can disable IMAP per organisational unit — Admin console → Apps → Google Workspace → Gmail → End user access. If it's off, only their admin can change it. |
| **Microsoft 365 / Outlook.com** | ⛔ **Not supported.** Microsoft retired basic auth for IMAP and requires OAuth2, which we don't implement — see below. |
| **Zoho, Yahoo, iCloud, cPanel hosts** | Usually a per-account toggle in the mail settings, and on some of these it is **off by default** — worth asking before you start. |

**We authenticate with plain IMAP LOGIN.** There's no OAuth in the poller, so a provider that has
retired basic auth can't be polled at all — no setting on their side fixes it. If a customer is on
Microsoft 365 or Outlook.com, the options are to route voicemails to a mailbox we *can* poll (a
Gmail account, as in §0) or to build OAuth support, which is real work rather than configuration.

`verify_imap.py` in §4 is the arbiter either way: it fails at login if IMAP is blocked, rather than
returning zero messages.

### Don't ask them for these

- **The sheet ID** — it's in the link they send; pull it out yourself.
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

**`SHEET_RANGE` needs the tab to exist**, spelled exactly as the tab is — the sheet ID alone isn't
enough, and Sheets matches the name character for character. A tab name containing a space has to
be quoted: `SHEET_RANGE='Voicemail 2026'!A1`. Get it wrong and the first real run dies with
`Unable to parse range: <tab>!A1:A1`; `verify_sheets.py` catches it first and prints the tab names
the sheet actually has.

## 4. Check each connection separately

Three scripts, each isolating one failure:

```bash
python scripts/checks/verify_imap.py                      # login works, and how many voicemails are visible
python scripts/checks/verify_sheets.py                    # credentials + sharing + sheet id + tab (read-only)
python scripts/checks/verify_extract.py sample.wav        # transcription quality, needs only GEMINI_API_KEY
```

Run `verify_extract.py` on **their** audio, not a test clip. It's the only way to see how the
transcription copes with their callers before the customer does.

If `verify_imap.py` **reports 0 voicemails** but the mailbox has some: check `IMAP_SINCE_DAYS`,
then the `VOICEMAIL_FROM`/`VOICEMAIL_SUBJECT` filters — a filter that doesn't match is the usual
cause.

If it **can't log in at all** and you're sure the app password is right, IMAP is switched off for
that account — see the provider table in §1 for who can turn it back on. On personal Gmail this
isn't possible, so look at the password instead.

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
| `Unable to parse range: <tab>!A1:A1` | No tab by that name. `verify_sheets.py` now lists the real ones |
| Customer signs in to an empty dashboard | Account email ≠ polled mailbox. **Per person** names it |
| Dashboard rows say "Unattributed" | The poller is running an older build that doesn't send `mailboxEmail` |
| Every `Received` is the same timestamp | An old build — it used to record transcription time, not arrival |
| Poller stops after a reboot | `systemctl enable transcribe-poller` was never run |
