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

## The Demos section (promo)

- `src/demos/api.ts` is the only code that knows where the promo backend is: same-origin
  `/promo-api/*`, proxied to voiceagent_promo's `/api/*` (`vite.config.ts`, `PROMO_API_URL`). Every
  promo call goes through `promoRequest`; its errors are `unreachable` / `locked` / `failed`, and
  `fromPromo` says whether the promo itself answered (only that proves its auth let us through).
- The promo has its own admin password until its backend is merged. `PromoAuth` holds that state
  (probed on the first Demos visit only, one probe at a time); `DemosGate` shows the unlock or
  unreachable card and is the `.tw` boundary for everything in the section. A promo 401 re-locks
  the demos; it never signs anyone out of the dashboard.
- The promo cookie is the real credential for the demos and knows nothing about dashboard roles, so
  `App` clears it whenever the dashboard session ends — a click, or an expired/revoked token. Keep
  it that way.
- Proxy only `/promo-api/*`. The prospect-facing demo page (`/c/<id>`) stays on the promo and is
  linked to via `VITE_PUBLIC_DEMO_BASE_URL` (decided in stage 5) — never proxy promo HTML onto this
  origin: the dashboard's session token lives in localStorage here, and that page is public.
- Ported promo code lives in `src/demos/` in the promo's own layout (`components/ui`,
  `components/admin`, `components/charts`, `lib`, and pages as `screens/`), imported as `@/…`
  (= `src/demos/`). It is a verbatim copy of voiceagent_promo @ f482848 plus the edits logged in
  `src/demos/PORTING.md` — keep that log current; it's what makes a later sync a plain diff
  (`diff --strip-trailing-cr`).
- Porting rules: `fetch("/api/…")` → `promoFetch("/api/…")` (`@/api`); `next/link` →
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

## Proving nothing broke

Run all three after any styling change:
- `npm test` — unit tests, incl. `tests/styles.test.ts` (layer order, the four `@scope` blocks, the
  promo theme and tw-animate are present, the reset isn't stale).
- `python scripts/regression/compare.py` — renders every transcribe view in the original app and
  in this one; must print `IDENTICAL` (see `scripts/regression/README.md`).
- `python scripts/regression/tw_probe.py` — checks the Tailwind side inside and outside `.tw`.
- `python scripts/regression/demos_e2e.py` — walks the Demos section against a fake promo
  (`fake_promo.py`).

Run the three Python scripts one at a time — they share ports.

## Hard rules (from the skill)
- Brand blue **#116DFF** only — never `#3366FF` or `#2AA25F`.
- Body text **weight 500** (not 400).
- **Sentence case** — no ALL CAPS / `text-transform: uppercase` for emphasis; write `TecAce` exactly.
- **Outlined cards at radius 16** — never both border and shadow; shadows ambient only.
- Header is a **plain 1px hairline** — no gradient strip, no blur.
- Spacing on the **4px grid**; motion is **.15s ease** fades only.
- The chart accent palette (`--chart-1…7` / `--ui-chart-1…7`) is for data-viz only, never controls.
