# TecAce voice agent dashboard — UI conventions

This app combines two front ends (design: `../docs/superpowers/specs/2026-09-21-combined-dashboard-design.md`):
the **transcribe screens** (from `../transcribe-dashboard-app`) and, from stage 3 on, the **promo
screens** (from the separate `voiceagent_promo` repo @ f482848). **All UI / styling / chart work
MUST follow the `tecace-dashboard-ui` skill** — invoke it before writing styles or charts.

## Two styling systems, kept apart by cascade layers

The header of `src/styles/index.css` explains the layer order and why; read it before touching CSS.

- **Transcribe screens: plain React + hand-rolled CSS** in `src/styles/legacy.css`, on the
  design-system tokens in `src/tecace/{fig-tokens,typography}.css`. Do not add Tailwind classes to
  them and do not migrate them to shadcn/Tailwind unless explicitly asked.
- **Promo screens: Tailwind v4 + shadcn/ui (on Base UI)**, rendered inside an element with class
  **`tw`**. Tailwind's reset, the promo base rules AND the utilities are all `@scope (.tw)` — they do
  nothing outside a `.tw` subtree.
  - Inside `@scope`, a plain selector matches **descendants** of `.tw`, never the `.tw` element
    itself. So the wrapper is a bare `<div className="tw">`; put utilities on its children.
  - The `.tw` root paints no background: promo screens sit on the dashboard canvas like transcribe
    cards. A full page (the public demo) gives itself a full-height `bg-background` child.
  - Anything rendered through a portal (dialog, popover, select, tooltip, toast) must portal into a
    `.tw` container, not straight into `<body>`, or it gets no styles.
  - Promo theme variables are prefixed **`--ui-`**; utility names are unchanged (`bg-primary`). In
    arbitrary values use Tailwind's namespaced names (`var(--color-secondary)`), never a bare
    `var(--border)` / `var(--radius)` / `var(--primary)` — those are the *transcribe* variables.
    The same goes for CSS variables read from JS (`getComputedStyle(…).getPropertyValue("--x")`):
    read the promo's own `--ui-x` (e.g. `--ui-chart-1`), never a bare `--x`.
  - Transcribe class names (`.card`, `.badge`, `.input`, `.muted`, `.error`, …) are global and also
    match inside `.tw`: don't reuse them in promo markup.
- `src/styles/ui-preflight.css` is **generated** — run `npm run gen:preflight` after upgrading
  tailwindcss; never edit it by hand (a test fails if it drifts).
- `src/main.tsx` imports `./styles/index.css` **first**: layer order in the built CSS is decided by
  first appearance, so no other CSS may be emitted before it. In `index.css`, nothing may sit
  before or between the `@import`s — PostCSS silently drops an `@import` that follows a rule.
- Theme: `src/themeCore.ts` sets `data-theme` **and** `.dark` on `<html>` together. Chart.js charts
  remount on theme change (`key={theme}`).
- Never hardcode a hex — reference a token (`var(--…)` in legacy CSS, a utility in promo markup).

## The Demos section

- **The demo data lives in transcribe-db, not the promo.** The promo's Redis was exported on
  2026-09-22 and imported into the `demo_*` tables; the promo has stopped collecting. transcribe-backend
  serves it under `/demo/*` — `analytics`, `customers`, `customers/:id`, `crm`, plus the CRUD
  writes — with bodies that still match the promo's `/api/admin/*` exactly, because the screens are
  verbatim ports that parse them as they are.
- `src/demos/api.ts` is the only code that knows that: `demoFetch(path, init)` sends
  `${__BACKEND_URL__}/demo${path}` with the dashboard's bearer token and returns the **raw
  `Response`**, because the ported screens call `readJson(response)` themselves. Paths lost their
  `/api/admin` prefix: `promoFetch("/api/admin/customers")` is `demoFetch("/customers")`.
- **There is one sign-in.** The demo routes are guarded by the dashboard's own admin session
  (`authenticateAdmin`), and the Demos nav group is admin-only. The promo's separate password,
  `PromoAuth`, `UnlockCard` and the `/promo-api` proxy are all gone. `DemosGate` is now just the
  `.tw` boundary, the flex column, the `Toaster` and one error card.
- **Everything the promo's admin does, this does** — including the three things an earlier stage
  removed and later restored: the **test call** (`POST /demo/session` + `/demo/calls/:id`, over the
  same `gpt-live-1` the agent app uses), **"Analyze"** (a real post-call review, never redone once a
  call has one), and **"Re-research"** plus `ResearchInputsPanel`'s run button
  (`POST /demo/customers/:id/research`). Prompts are generated from the business profile
  server-side, as the promo does it: rebuilt on read when unedited and behind `PROMPT_VERSION`,
  regenerated on save, and built on create.
- **A research run and a test call both cost real money**, and both are gated by the one
  `OPENAI_API_KEY` on transcribe-backend. Without it every other Demo tab works and only those two
  refuse, with the promo's own message. Research is the OpenAI branch of the promo's runner only —
  its Anthropic and Claude-CLI branches are not ported, so an unsupported `RESEARCH_PROVIDER`
  throws a named error rather than failing quietly.
- **The prospect-facing demo page (`/c/<id>`) is served by this app, as a SECOND ENTRY DOCUMENT —
  not a view.** `c.html` → `src/public/main.tsx` → `src/public/PublicApp.tsx`, which reads the path
  (`/c/<id>`, `/c/<id>/scenarios`, `/c/<id>/pricing`), loads the demo from `/demo/public/*` and
  renders `screens/Public{Demo,Scenarios,Pricing}Screen`. `vercel.json` sends `/c/*` to it;
  `vite.config.ts` names both inputs (adding one replaces Vite's default of index.html alone).
  - It is not a `ViewId`, has no `PATHS` entry and no sidebar item, so it cannot be reached from the
    Demos tabs — the link is the only way in. Don't add one.
  - Nothing reachable from `src/public/` may import the dashboard's auth (`api/backend.ts`,
    `auth.tsx`, `App.tsx`, or `demos/api.ts`, which reads the token). That is why the prospect's API
    client is its own module, `demos/publicApi.ts`, and why `useLiveCall` is **handed** its fetcher
    (`{ api: demoFetch, isTest: true }` from the admin panel, `{ api: publicFetch }` from the public
    page) instead of choosing one. `tests/public-entry.test.ts` walks the import graph and fails if
    that stops being true. It is not a security boundary — one origin, one localStorage — it keeps
    the admin code out of a public bundle.
  - There is **no base-URL variable**. A demo link is this origin plus `/c/<id>`
    (`demos/lib/share.ts`). The old `VITE_PUBLIC_DEMO_BASE_URL` fell back to this origin when unset
    and produced a link that opened the dashboard's Overview; that is the bug this replaced.
- Ported promo code lives in `src/demos/` in the promo's own layout (`components/ui`,
  `components/admin`, `components/charts`, `lib`, and pages as `screens/`), imported as `@/…`
  (= `src/demos/`). It is a verbatim copy of voiceagent_promo @ f482848 plus the edits logged in
  `src/demos/PORTING.md` — keep that log current; it's what makes a later sync a plain diff
  (`diff --strip-trailing-cr`).
- Porting rules: `fetch("/api/admin/x")` → `demoFetch("/x")` (`@/api`); `next/link` →
  `<a href={demoHref(…)}>` (`@/routes`); `next-themes` → `useDocumentTheme()` (`@/theme`); pop-ups
  render into `twPortalContainer()` (`@/portal`); `process.env.NEXT_PUBLIC_*` →
  `import.meta.env.VITE_*`; no bare `var(--x)` in CSS/markup and no bare
  `getPropertyValue("--x")` in JS (read `--ui-x`); don't reuse transcribe class names; strictness
  fixes must keep behaviour identical. `navigator.sendBeacon` to a promo path → `sendBeacon(promoUrl("/api/…"))`; a
  Next page's `params` → an `id` prop (see `screens/ProspectScreen.tsx`). The toaster lives inside `DemosGate` (sonner can't portal).
- Toasts live inside the gate, so they survive navigation between Demos views but vanish when
  leaving the section or when it re-locks.
- Every Demos view is now a ported promo screen — `screens/{OverviewScreen,ProspectsScreen,
  ProspectScreen,PipelineScreen}.tsx` (stage 4c finished the promo's admin side). There is no
  `src/demos/pages/` any more.
- Routes live in `src/routing.ts` `PATHS` (a `Record<ViewId, string>` — add every new view there;
  `:id` marks a record segment, e.g. `demos/prospects/:id`). `DEMO_VIEWS` lists the Demos views.

## Receptionist settings (`src/settings/`)

- One settings screen with a left menu serves a real business (`BusinessSettings`, inside
  `pages/BusinessPage.tsx`) and a demo (`DemoSettings`, the Settings tab of `ProspectScreen`). The
  sections are controlled editors; the two containers own saving (a business saves per section to
  `/business/*`; a demo rides on the page's own Save, except call settings, which PATCH at once).
- Transfers, Text a link and Take a message are **call settings** (`callSettings.ts`, mirroring
  transcribe-backend's `business/callSettings.ts`). A business edits a draft and publishes it; the
  phone line only ever uses the published copy.
- The open section is in the URL (`#/business/transfers`, `#/demos/prospects/<id>/faqs`); new
  sections need an id in `SECTION_IDS` (`src/routing.ts`) and an entry in `SECTION_META`.

## List screens (tables that grow) — one pattern for all of them

Customers is the reference (`src/demos/components/admin/CustomerTable.tsx`); build every new list the
same way, from the kit in `src/demos/components/ui/data-table.tsx`, so they search, sort and page alike:
- **Width:** the view goes in `App.tsx` `WIDE_VIEWS` (`.content-wide`: no 1440px cap). The table is
  `table-fixed` with percentage widths per column and `truncate` + `title` in text cells, so it **never
  scrolls sideways** at 1280px and up. Merge related numbers into one two-line cell ("3 calls · 9 min" /
  "14 opens · 4 people") instead of adding columns.
- **Height:** rows have one fixed height (two lines, 57px); `useFitRows` sizes the default page to the
  window ("Fit to screen"), so the page **never scrolls down**. `TablePagination` offers 25 / 50 / 100 and
  shows "1–25 of 1,240 …"; `usePaged` resets to page 1 when a filter changes; `useRemembered` keeps the
  viewer's page size and sort.
- **Finding things:** segment tabs with counts for the main split (phase), one search box that matches
  every text column, then `Select` filters (category, status), a Sort select, and `SortableHead` on the
  sortable columns (second click flips the direction). Always show a created date.
- **Selection:** a checkbox column; select-all covers the current page; bulk actions appear at the right of
  the toolbar only while something is ticked.
- Paging is client-side today; keep the (page, pageSize, total) shape so a list can move to a server-side
  `?page=&pageSize=&q=` without changing the UI once it passes a few thousand rows.

## Proving nothing broke

Run all three after any styling change:
- `npm test` — unit tests, incl. `tests/styles.test.ts` (layer order, the four `@scope` blocks, the
  promo theme and tw-animate are present, the reset isn't stale).
- `python scripts/regression/compare.py` — renders every transcribe view in the original app and
  in this one; must print `IDENTICAL` (see `scripts/regression/README.md`).
- `python scripts/regression/tw_probe.py` — checks the Tailwind side inside and outside `.tw`.
- `python scripts/regression/demos_e2e.py` — walks the Demos section against a fake backend
  (`fake_backend.py`).
- `python scripts/regression/business_tabs.py` — opens the Business page's receptionist settings
  (`src/settings/`): the ten-item menu, each section holding the business's data and saving to its
  own `/business/*` endpoint (never `/demo/`), a transfer saved as a draft, refused by the backend
  under its field, then published, the composed-session preview, and the `.tw` boundary.
- `python scripts/regression/public_page.py` — opens a demo link (`/c/<id>`) in a browser: the page
  renders the business and not the dashboard, carries none of the operator's fields, the scenarios
  and pricing links navigate, an unknown or unready id is the quiet page, `/` is still the
  dashboard, and pressing call dials `/demo/public/session`. This is the one that would have caught
  the Share link opening Overview.
- `python scripts/regression/accounts_lifecycle.py` — opens the Accounts page's Stage panel: the
  three controls go to three endpoints (`/auth/users/:id/business`, `/status`, `/promote`), each
  carrying only its own field, the copy is refused until a demo is linked, and the page says the
  copy happens once.
- `python scripts/regression/demo_customer.py` — signs in as a demo-stage customer: one item in the
  rail, their own record and no other, none of the operator's controls on it (live switch, add time,
  re-research, Activity/Sources/Share, the test call), and no way out by typing a URL.

- `python scripts/regression/signup.py` — sign-up and getting in: `/start` closed without email and
  open with it (details, code, the build screen, landing signed in), the sign-in page's Forgot
  password / sign-up links only when the backend has email, and an invite link that takes its token
  out of the address bar and signs in. `public_page.py` covers the demo page's Request setup.
- `python scripts/regression/numbers_twilio.py` — the Agent numbers page against Twilio (faked): sync,
  the Type and Webhooks columns, Configure, the Buy card (kind, area code, search, buy with a request
  id), Release by typing the number back, un-assign; then the Accounts Go live checklist assigning a
  number from the pool, with Go live opening once the checklist re-reads.

Run the Python scripts one at a time — they share ports. The six browser scripts serve the build from
Python's `http.server` with the MIME types stated explicitly: left to the OS, a Windows registry that
maps `.js` to `text/plain` makes Edge refuse every module script, and every check fails on an empty
page with no error to explain it.

## Hard rules (from the skill)
- Brand blue **#116DFF** only — never `#3366FF` or `#2AA25F`.
- Body text **weight 500** (not 400).
- **Sentence case** — no ALL CAPS / `text-transform: uppercase` for emphasis; write `TecAce` exactly.
- **Outlined cards at radius 16** — never both border and shadow; shadows ambient only.
- Header is a **plain 1px hairline** — no gradient strip, no blur.
- Spacing on the **4px grid**; motion is **.15s ease** fades only.
- The chart accent palette (`--chart-1…7` / `--ui-chart-1…7`) is for data-viz only, never controls.
