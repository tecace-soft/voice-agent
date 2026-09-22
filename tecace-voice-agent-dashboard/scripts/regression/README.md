# Regression harness

Proves a change to this app left the transcribe screens exactly as they were.

    cd tecace-voice-agent-dashboard
    python scripts/regression/compare.py

It builds `../transcribe-dashboard-app` (the original) and this app with
`VITE_BACKEND_URL=http://127.0.0.1:8899` (production `vite build` into a temp dir, served with
`vite preview`), points both at `fake_backend.py`, and renders the same 44 captures in Edge with
the clock pinned to the fake's `NOW`, the timezone set to America/Los_Angeles, the locale en-US
and reduced motion. It then compares old vs new.

## Captures (44)

- Sign-in screen, light and dark.
- Admin, light: every view — overview, analytics, people, activity, runs, failed, feedback,
  allFeedback, calls, business, numbers, apiKeys, accounts. `#/apiKeys` lands on Overview in both
  apps (it's missing from `routing.ts`'s view list; fixed in stage 3).
- Admin scoped to one mailbox (`?mailbox=sam%40tecace.com`): overview, analytics, activity, runs,
  failed, calls, business.
- Admin scoped to unattributed runs (`?mailbox=unattributed`): overview, runs.
- User (non-admin), light: overview, analytics, activity, runs, feedback, calls, business.
- Dark: admin overview, failed, business, accounts; user overview.
- Interactions (id `…+<what>`), each fingerprinted while the state is held: runs page after four
  Tabs (focus ring); runs row hover; sidebar nav-button hover (the app has no `<a>` links);
  Columns menu open; mailbox picked in the MailboxPicker; accounts "Add user" form open; a call
  expanded (user); sign-in with bad credentials (error state).

## What is compared, per capture

- `document.body.innerText` (unified diff on a mismatch),
- every element under `<html>`/`<body>` (not `<head>`): a fixed list of computed style properties
  plus its document-relative box (`@x/@y/@w/@h`), keyed by a tag+class path,
- which element has focus,
- every custom property (token) declared in the page's stylesheets, resolved on `<html>` —
  only names the OLD app declares are compared, so new (e.g. Tailwind) variables aren't noise,
- the loaded web fonts (family, weight, style),
- console errors and page errors.

## Intended differences

Two lists at the top of `compare.py` cover changes made on purpose:

- `HIDE` — selectors for elements that exist only in the new app (e.g. the admin-only Demos nav
  group). They get `display:none` before every capture in both runs — which removes them from
  layout, so the rest of the page lays out as in the old app — and the fingerprint skips them.
- `EXPECTED_CHANGES` — capture ids that must differ, each with a marker text that must be in the
  new app's text and not the old app's. A proven change, not a skipped capture.

Add to these only for a change the plan calls for, with a comment naming the stage.

## Output and exit codes

- `0` — prints `IDENTICAL`.
- `1` — differences; the console shows the first 60, the complete list is in `.regression/diff.txt`.
- `2` — harness failure (`HARNESS FAILURE: …`): a port in use, a build or preview that failed, an
  interaction whose locator matches nothing in the OLD app, or any other exception.

Raw captures land in `.regression/old.json` / `new.json` (~27 MB each); build and preview output
in `.regression/<old|new>-build.log` / `-preview.log`.

## Requirements and caveats

- Python Playwright (`pip install playwright`); it drives the installed Microsoft Edge
  (`channel="msedge"`), so no `playwright install` is needed.
- `npm install` must have been run in both apps.
- Ports 5198 (old preview), 5199 (new preview) and 8899 (fake backend) must be free; the harness
  checks first and exits 2 if one answers.
- Don't run two copies at once — they share the ports and `.regression/`.
- The web fonts (Pretendard, Poppins) are `@import`ed from CDNs, so the run needs network access.
- A full run takes about three minutes.
- One capture: `--only admin:overview:light` (or any id above, e.g. `--only admin:runs:light+hover-row`).

## tw_probe.py

    cd tecace-voice-agent-dashboard
    python scripts/regression/tw_probe.py

Checks the other half of the stylesheet: that Tailwind's scoped reset and utilities work inside a
`.tw` wrapper and don't leak outside one. It builds and serves this app the same way
`compare.py` does (reusing its `build`/`serve`/`stop`/`check_ports_free`), points it at
`fake_backend.py` on port 8899, injects `../tw-probe.html` (kept in `scripts/` so Tailwind's
automatic source scan generates the classes it uses) into the running page, and asserts computed
styles on it in Edge, light and dark. Exit `0` = all checks pass (prints `ALL PROBE CHECKS PASS`),
`1` = failures listed, `2` = harness failure (`HARNESS FAILURE: …`), matching `compare.py`. Needs
port 5199 and 8899 free; don't run it at the same time as `compare.py` (they'd share ports).

## demos_e2e.py

    python scripts/regression/demos_e2e.py

Builds this app, serves it with `vite preview` proxied (`PROMO_API_URL`) to `fake_promo.py` — a
stand-in for voiceagent_promo's API that answers, statelessly, with the promo's full record shapes
(two `CustomerWithStats` prospects; Harbor Dental's detail with four calls — transcripts, reviews
sharing a gap, one test call — 14 page views and a CRM note; analytics that agree with it;
POST/PATCH/DELETE answer as if they worked and change nothing; the public `/api/session` always
refuses with the promo's "All the demo lines are busy" 429) — and walks the Demos section in Edge:

- a user never sees it; an admin unlocks it (wrong password rejected);
- the Prospects screen: table, search, the "More actions" menu and the "New customer" dialog
  rendered inside `[data-tw-portal]` with promo styling, copy-link / add / pause / resume toasts,
  the promo's 400 for a blank name; "Copy link" copies `VITE_PUBLIC_DEMO_BASE_URL/c/<id>` (the
  build sets it to `http://promo.example`);
- the Overview screen: KPI values, a `<canvas>` per chart, recent calls linking to the prospect; a
  theme toggle replaces both canvases, and in dark mode the chart colour variables are 6-digit hex
  and the canvases are actually painted in `--ui-chart-1`, not black (the dark Overview is saved to
  `DEMOS_E2E_SCREENSHOT`, default `%TEMP%/demos-e2e-chart-dark.png`); a promo session that ends
  mid-use (cookie cleared) re-locks the section on the next fetch;
- the prospect page: header and stat cards; Activity (a card per call, the gap roll-up count, the
  transcript sheet inside `[data-tw-portal]`, "count as your test" PATCHes `{callId, isTest}`);
  Knowledge (Save PATCHes the edited profile, "Saved."); Schedule (the week grid follows the
  hours, says it's a mock-up); Prompt (the three prompts; an edit saves `prompts.edited: true`);
  Sources (the dossier as markdown, source links with `target="_blank"`); Share (link, Copy,
  email); Re-research (POST, "Research finished."); a refresh keeps it; an unknown id shows the
  promo's "Customer not found."; a malformed id (`..%2F..%2Fanalytics`) shows the list and sends
  no promo request outside `/promo-api/admin/customers`;
- **the test call**: Edge runs with a fake microphone (`--use-fake-device-for-media-stream
  --use-fake-ui-for-media-stream`, microphone permission granted), so pressing "Call now" builds a
  real WebRTC offer. The check proves the request the promo would get — `POST
  /promo-api/session` with `customerId`, `isTest: true` and an SDP offer (`v=0…`) — that the
  promo's refusal is shown, that "Call again" makes a second attempt possible, and (through a
  `getUserMedia` hook added by an init script) that each attempt's microphone tracks end up
  stopped. The hook can also hold `getUserMedia` open like an unanswered permission prompt: the
  check leaves the page mid-dial, releases it, and requires that no `/promo-api/session` request
  follows and the late microphone is stopped (the microphone part is supporting evidence only:
  against the fake's 429 it holds even without the guard; the no-session-request check is the
  proof). A second check holds the session request itself (a Playwright route), leaves the page,
  then answers it with a grant: exactly one report must follow, `POST /promo-api/calls/held42`
  with `status: "abandoned"`, `endReason: "unmounted"`, and nothing may throw. It does **not**
  prove a call connects: the fake can't answer with an OpenAI SDP, so the
  live conversation (audio both ways, transcript, hang-up, the end-of-call report) is checked by
  hand against the real promo;
- a runtime check that no class used in `@layer legacy` lands on promo markup (bar `sr-only`,
  `grid`, and the `.ta-*` type scale where the promo's unlayered copy fully shadows the transcribe
  one) — over Overview, Prospects, the menu, the dialog, and each prospect tab, the transcript
  sheet and the refused call, one check line per prospect-page state;
- `#/apiKeys` survives a refresh; signing out clears the promo cookie; a promo that's down shows
  the "unreachable" card and "Try again" recovers; no page errors throughout.

Exit 0/1/2 like the others. Needs ports 5199, 8898 and 8899 free — don't run it at the same time
as `compare.py`.
