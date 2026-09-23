# Regression harness

Three checks over one fake backend. `compare.py` proves a change to this app left the transcribe
screens exactly as they were, `tw_probe.py` that Tailwind stays inside `.tw`, and `demos_e2e.py`
that the Demo tabs still work — all three against `fake_backend.py`, which answers every route
the dashboard calls: sign-in, `/transcribe/*`, `/business/*`, `/calls`, `/usage/*`, `/feedback`,
`/api-keys` and the Demo tabs' `/demo/*`. It is stateless and deterministic: a write answers as
if it worked and changes nothing, so every run starts from the same records.

## compare.py

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

Builds this app, serves it, points it at `fake_backend.py` and walks the Demos section in Edge.
There is no promo in this any more: the demo records live in transcribe-db, transcribe-backend
serves them under `/demo/*`, and the Demo screens reach them with the dashboard's own admin bearer
token — no proxy, no second sign-in, no cookie. The fake promo that used to stand behind the proxy
folded into `fake_backend.py`, fixtures and all, so what the screens are asserted against is
unchanged: two `CustomerWithStats` prospects (Harbor "interested", Cedar "contacted" with an
overdue follow-up); Harbor Dental's detail with four calls — transcripts, reviews sharing a gap,
one test call — 14 page views and a CRM note, Cedar a note of its own; analytics and the CRM feed
built from that same table, so every screen's numbers agree.

What it checks:

- **who gets in**: a signed-in user sees no Demo group, is refused a Demos URL and asks for no demo
  data — and that user's own token is refused by the `/demo` routes themselves (403 `forbidden`),
  as is no token at all (401 `unauthorized`); an admin's first click opens the Prospects table with
  nothing else asked of them (no second sign-in, one request) and signing out ends it — the
  sign-in screen returns, the token is gone, and a Demos URL then asks the backend for nothing;
- the Prospects screen: table, search, the "More actions" menu and the "New customer" dialog
  rendered inside `[data-tw-portal]` with promo styling, copy-link / add / pause / resume toasts,
  the backend's 400 for a blank name; "Copy link" copies `VITE_PUBLIC_DEMO_BASE_URL/c/<id>` (the
  build sets it to `http://promo.example`);
- the Overview screen: KPI values, a `<canvas>` per chart, recent calls linking to the prospect; a
  theme toggle replaces both canvases, and in dark mode the chart colour variables are 6-digit hex
  and the canvases are actually painted in `--ui-chart-1`, not black (the dark Overview is saved to
  `DEMOS_E2E_SCREENSHOT`, default `%TEMP%/demos-e2e-chart-dark.png`); picking a reporting period
  from its portalled listbox re-reads `/demo/analytics` for that window;
- the prospect page: header and stat cards; the tabs card now has the page width to itself (the
  call panel went with the test call, and its column with it); Activity (a card per call, the gap
  roll-up count, the transcript sheet inside `[data-tw-portal]`, "count as your test" PATCHes
  `{callId, isTest}`); Knowledge (Save PATCHes the edited profile, "Saved."); Schedule (the week
  grid follows the hours, says it's a mock-up); Prompt (the three prompts; an edit saves
  `prompts.edited: true`); Sources (the dossier as markdown, source links with `target="_blank"`);
  Share (link, Copy, email); a refresh keeps it; an unknown id shows "Customer not found."; a
  malformed id (`..%2F..%2Fanalytics`) shows the list and sends no request outside
  `/demo/customers`;
- the pipeline (CRM) page: the stage board's columns, counts and cards (Harbor in Interested,
  Cedar in Contacted), the "Due now" section naming Cedar, the activity feed across both
  prospects (its first four rows asserted in order), and stage moves, each with the `PATCH` held
  so the harness decides the answer — a granted move moves the card before the answer arrives
  and toasts where it went; a refused one puts the card back and says why; a refused move whose
  recovery reload also fails still says so, rather than leaving the card parked in a stage the
  backend never accepted;
- the drawer, opened all three ways (a board card, an activity-feed row, a "Due now" chip):
  inside `[data-tw-portal]` with that prospect's timeline and a link to
  `#/demos/prospects/pr0SPct1` (followed, it lands there); its own writes — the Stage select is a
  second portal surface (a popover beside the modal sheet), and picking a stage `PATCH`es
  `{stage}` while the follow-up date field `PATCH`es `{followUpAt}`; notes — a blank one can't be
  sent (the button stays disabled, no request), a real one `POST`s `{text}`, clears the box and
  shows no toast (the component reports only failures); and a slow read for a prospect that has
  since been closed must not take over the drawer on screen, nor send its next save to that
  older record. Because the fake is stateless, none of the drawer's writes change what the next
  read returns, so the board behind it isn't asserted to follow them;
- a runtime check that no class used in `@layer legacy` lands on promo markup (bar `sr-only`,
  `grid`, and the `.ta-*` type scale where the promo's unlayered copy fully shadows the transcribe
  one) — over Overview, Prospects, the menu, the dialog, and each prospect tab, the transcript
  sheet and the pipeline page with and without its drawer, one check line per state;
- `#/apiKeys` survives a refresh; no page errors throughout.

Because the backend is a different origin from the app (:8899 vs :5199), every request carrying the
bearer token is preflighted, and any response the harness fulfils itself has to carry
`Access-Control-Allow-Origin` (`fulfill_json`) or the browser drops it. Route handlers therefore
fall back for anything that isn't the method they mean to hold, so the preflight reaches the fake.

Exit 0/1/2 like the others. Needs ports 5199 and 8899 free — don't run it at the same time as
`compare.py`.
