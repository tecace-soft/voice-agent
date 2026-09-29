# TODO — Calls features on real phone calls

Status of what the assistant can do on a **real phone call** (Twilio → `openai-agent-app` → `transcribe-backend`), and what is left.
In-app test calls and the public demo page (`/c/<id>`) already play these out; this list is about the phone.
Tick items off and add findings (date, who, call SID) as you go. Log anything others need in HISTORY.md too.

Last updated: 2026-09-27 · bottomup32

| Feature | Real phone call | Next |
|---|---|---|
| Appointments (book into the business calendar) | ✅ Works — verified on a real call | Keep an eye on it; see "Appointments" below |
| Send a text (SMS, "Text a link") | ❌ Not built | Build the sender, then test |
| Call transfer | ⚠ Built, **not tested on a real call** | Test (checklist below) |
| Take a message | ⚠ Built, **not tested on a real call** | Test (checklist below) |

Before any test: the phone agent's `BUSINESS_CONFIG_URL` points at the backend you are testing (staging: `https://va-staging-backend.vercel.app`) with the same `AGENT_CONFIG_KEY`, and the test account is in `production` or `unassigned` stage (demo / pre-production accounts get `not_live_stage`). Publish call settings before calling — the phone only uses the published copy.

---

## 1. Send a text (SMS) — build, then test

Today nothing sends SMS. The in-app/demo "Text a link" tool only shows the text in the test console. `sms_consents` table exists, no sender.

- [ ] Decide where the sender lives (backend route called by the agent with `x-agent-key`, like `/business/calendar/agent-tool`, is the likely fit).
- [ ] Twilio Messaging: US numbers need A2P 10DLC registration (brand + campaign) before carriers deliver texts. Start this early — approval takes days.
- [ ] Consent: ask the caller on the call before texting; record it in `sms_consents`. Handle STOP / HELP replies.
- [ ] Wire the "Text a link" tool (`send_link` / link rows from call settings) into `openai-agent-app` inbound tools, published settings only.
- [ ] Show sent texts in the dashboard call record.
- [ ] Test on a real call: link arrives on the caller's phone, correct link, sender number, no URL read aloud, refusal when caller says no.

## 2. Call transfer — test on a real call

How it works now: one `transferNumber` from the business profile. Agent calls `transfer_to_human` → bridge redirects the call out of the stream → whisper to the staff member → `POST /after-transfer` (answered and finished = hang up; not answered = back to the agent with `transfer_failed`).
The newer transfer scenarios in Calls settings (warm / waterfall / business hours, several numbers) reach **in-app/demo calls only** — phone wiring is phase 3 (integrator).

- [ ] Caller asks for a person → agent transfers → staff phone rings, whisper says who is calling and why → connected.
- [ ] Staff does not answer / is busy / declines → caller returns to the agent, agent says so and offers to take a message (and actually calls `take_message`).
- [ ] Agent only *offers* ("would you like me to put you through?") → no transfer until the caller says yes.
- [ ] Business with no transfer number → agent never promises a transfer (tool is removed).
- [ ] Caller ID shown to the staff member (business number vs caller's number) — note what appears.
- [ ] Transfer after a booking or a question mid-call.
- [ ] Call record in the dashboard shows the transfer outcome and talk time is right.
- [ ] Later (phase 3): scenarios from Calls settings on the phone — waterfall order, hours, warm transfer.

## 3. Take a message — test on a real call

How it works now: agent calls `take_message` (name, callback number read back, reason, requested time) → kept in the call state → at call end `POST /calls` saves the inbound call with `callerName`, `callbackNumber`, `request`, `requestedTime`, `callbackRequested` → shows in the dashboard, and transcribe-app copies it to the business's Google Sheet. The call log also gets a "MESSAGE TAKEN" block.
Message briefs (custom questions per scenario) reach **in-app/demo calls only**.

- [ ] Leave a message → it appears in the dashboard with the right name, callback number, reason, time.
- [ ] Caller gives a different callback number than the one they called from → the given one is saved.
- [ ] Caller refuses to give a name → call still files (anonymous) with the reason.
- [ ] Message after a failed transfer (see 2) is saved.
- [ ] Agent says "someone will call you back" → it must have called `take_message` (no message-less promises).
- [ ] Caller hangs up mid-message → what is saved?
- [ ] Message reaches the business's Google Sheet (transcribe-app polls `GET /calls/awaiting-sheet`, writes the row, then `POST /calls/:id/sheet-written`).
- [ ] Open question: there is no push alert (email / SMS) when a message arrives — only the dashboard and the Sheet. Decide if we need one.
- [ ] Later (phase 3): message briefs on the phone.

## 4. Appointments — done, keep watching

Verified on a real call 2026-09-27. Booked under the **published** rules; never published = booking off on the phone. Check: `python openai-agent-app/scripts/checks/verify_booking.py`.

- [ ] Re-test after each deploy of the agent or backend.
- [ ] Google / Outlook calendars need OAuth apps + env (`GOOGLE_CLIENT_ID/SECRET`, `MICROSOFT_CLIENT_ID/SECRET`, `PUBLIC_BACKEND_URL`) on each backend.
