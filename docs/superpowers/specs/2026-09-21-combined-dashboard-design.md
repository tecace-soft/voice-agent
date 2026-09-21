# Combined dashboard — design

**Date:** 2026-09-21
**Project:** `tecace-voice-agent-dashboard/`
**Scope:** front end only. No backend changes in this piece of work.

## Goal

One front end that combines:

- **`transcribe-dashboard-app/`** (this repo) — voicemail stats plus the customer-facing voice-agent
  screens (calls, business information, agent numbers, API keys, accounts, feedback). Backend:
  `transcribe-backend`.
- **`voiceagent_promo`** (separate repo, `test_demo/voiceagent_promo`, taken at commit `f482848`) —
  the prospect demo tool: an admin area (prospects, research, knowledge/prompt editors, test call,
  share, analytics, CRM pipeline) and a public prospect page (`/c/:id`). Backend: its own Next.js
  API routes, left running as-is.

`admin-dashboard-app/` is out of scope.

## Decisions

| Question | Decision |
| --- | --- |
| Which promo parts | Admin side **and** the public prospect page |
| Promo backend | Unchanged for now; the combined app calls the promo's existing `/api` routes. Porting it into `transcribe-backend` is a later, separate piece of work |
| Sign-in | The transcribe account. Promo screens are admin-only and need a one-time promo password unlock |
| Styling | Keep the transcribe screens' plain CSS; add Tailwind v4 + shadcn/ui (Base UI) so promo components come over near-verbatim |
| Shape | One Vite app, one bundle, the public page code-split |

This overrides the "do not migrate to shadcn/Tailwind" line in `tecace-voice-agent-dashboard/CLAUDE.md`
for the promo screens only. `CLAUDE.md` is updated to say so (stage 2).

## 1. Project layout

- `src/` starts as a copy of `transcribe-dashboard-app/src/`, unchanged.
- `src/demos/` — promo admin screens, their components and the browser-safe promo libs.
- `src/public-demo/` — the prospect page and its components.
- `src/components/ui/` — shadcn components, copied from the promo.
- Browser-safe promo `lib/` modules are copied: `transcript`, `schedule`, `integrations`, `hours`,
  `proof`, `use-cases`, `voice-level`, `scroll`, `call-audio`, `ambience`, `ringtone`, `languages`,
  `links`, `share`, `types`, `utils`, `chart-theme`, `analytics` (all checked 2026-09-21: they import
  only each other, `cn`, or `chart.js`). Server-only modules (`store`, `kv`, `calls`, `crm`,
  `research*`, `openai`, `claude-cli`, `auth`,
  `visitor`, `api`, `http`, `maps`, `call-review`) are not. The rule: a module importing `node:*`,
  `next/server` or `next/headers` stays behind; where a client module imports one, the needed pure
  function is split out.
- Next.js couplings are replaced: `next/link` → the hash router's link/navigate, `usePathname` /
  `useRouter` → the route hook, `next/image` → `<img>`, `NEXT_PUBLIC_*` → `VITE_*`, the version
  badge reads a value `vite.config.ts` defines at build time.
- The two source apps stay untouched and deployed until they are retired separately.

## 2. Routing

- `main.tsx` checks `location.pathname` first:
  - `/c/:id` and `/c/:id/scenarios` → `React.lazy` public demo, no sign-in.
  - anything else → the signed-in dashboard.
- Dashboard views stay in the URL hash, as in the transcribe app today. `routing.ts` gains optional
  path parameters so a view can address a record: `#/demos/overview`, `#/demos/prospects`,
  `#/demos/prospects/<id>?tab=knowledge`, `#/demos/pipeline`.
- The existing bug where `apiKeys` is missing from the router's view list is fixed while in there.
- `vercel.json` already rewrites every path to `index.html`; the `/promo-api` and `/promo-page`
  rewrites (section 5) go before it.

## 3. Styling

- Layer order `@layer theme, legacy, base, components, utilities;` (entry: `src/styles/index.css`):
  - `theme` — Tailwind's default theme variables.
  - `legacy` — design-system tokens, type scale and the transcribe stylesheet, unchanged.
  - `base` — Tailwind's reset, **not global**: generated into `src/styles/ui-preflight.css` wrapped
    in `@scope (.tw)`, plus rules that undo the transcribe CSS's bare-element rules (`a:hover`,
    `code`, `table`, `th`, `td`, `:focus-visible`) inside `.tw`; and the promo's base rules, also
    scoped to `.tw`.
  - `utilities` — Tailwind utilities, **also scoped**: `@layer utilities { @scope (.tw) {
    @tailwind utilities; } }`. Found in stage 2: Tailwind scans the whole project and transcribe
    markup already uses names it knows (`grid` on SVG gridlines, `sr-only`); unscoped, those
    utilities restyled transcribe elements. Verified: hover/responsive/`dark:` variants all work
    inside the scope.
- **`@scope` matches descendants, not the root.** A plain selector inside `@scope (.tw)` matches
  elements *under* a `.tw` element, never the `.tw` element itself (the base rules style the root
  via `:scope`). So the `.tw` wrapper is a bare `<div className="tw">` and utilities go on its
  children. Content rendered through a portal (dialogs, popovers, selects, tooltips, toasts) must be
  portalled into a `.tw` container, not straight into `<body>` — stage 4 sets that up once for the
  shadcn components.
- **The `.tw` root paints no background** (decided in stage 2 review). Embedded promo screens sit on
  the dashboard canvas like transcribe cards; the stage-5 public page gives itself a full-height
  child with `bg-background` (the wrapper itself can't carry utilities).
- **Raw `var()` in ported promo code (stage 4).** After the `--ui-` rename, a raw `var(--border)` or
  `var(--radius)` in promo markup silently reads the *transcribe* value, and `var(--secondary)` /
  `var(--foreground)` become undefined. Found so far: `components/ui/sonner.tsx` (4 uses),
  `button.tsx` (secondary hover `color-mix` over `--secondary`/`--foreground`), `sidebar.tsx`
  (`--sidebar-border`, `--sidebar-accent`). Rule for the port: grep every ported file for `var(--`
  and rewrite colour references to Tailwind's namespaced names (`var(--color-secondary)` etc.),
  which `@theme inline` maps to `--ui-*` and which legacy never defines. `var(--radius-md)` is safe
  (Tailwind emits it; legacy doesn't define it).
- **Legacy class names are global (stage 4).** Transcribe component classes (`.card`, `.badge`,
  `.input`, `.select`, `.muted`, `.error`, `.icon`, `.sr-only`, …) also match inside `.tw`. When
  porting, check promo class strings against the legacy class list and rename any collision on the
  promo side.
- Every promo screen renders inside an element with class `tw`. Result: the transcribe screens are
  written against browser defaults and still get them (the reset can't reach them); inside `.tw`,
  the reset beats transcribe's bare element rules because `base` comes after `legacy`; transcribe
  CSS can't override promo utilities.
- The promo's `.ta-*` type scale is kept unlayered and scoped to `.tw`, because in the promo it beat
  utilities and its markup relies on that.
- **Every** variable in the promo theme's `:root` / `.dark` blocks is renamed with a `--ui-` prefix,
  with the `@theme inline` mapping updated (plus the raw `var()` uses in ported
  components — see "Raw `var()` in ported promo code" above). Tailwind class names (`bg-primary`) are unaffected. Beyond
  the nine obvious collisions (`--accent`, `--border`, `--chart-1`, `--muted`, `--primary`,
  `--radius`, `--radius-sm`, `--success`, `--warning`), the promo theme also redefines design-system
  names (`--label-*`, `--fill-strong`, `--primary-strong`, `--font-*`, `--shadow-*`).
- One theme hook sets `data-theme` on `<html>` **and** toggles the `.dark` class; `next-themes` is
  not used. Chart.js charts remount on theme change (`key={theme}`).
- The pre-paint script in `index.html` sets both too, so there's no flash.

## 4. Navigation and the promo unlock

- New admin-only sidebar group **Demos**: Demo overview · Prospects · Pipeline. A prospect's detail
  view keeps the promo's tabs (Activity, Knowledge, Schedule, Prompt, Sources, Share) and its test
  call panel.
- A `user` never sees the group; the views render the usual "only an admin" line if reached by URL.
- Promo lock state lives in a `PromoAuth` context: `unknown` → `locked` | `unlocked`. It is probed
  with `GET /promo-api/admin/health` on first Demos visit (401 → locked).
- Locked Demos views render an **Unlock demos** card: one password field, `POST
  /promo-api/admin/login`. Success sets the promo's own 7-day httpOnly cookie on our origin.
- A 401 from any promo call flips the context to `locked`. It never signs the user out of the
  dashboard.
- Every end of the dashboard session — a sign-out click, or an expired/revoked token — also calls
  `DELETE /promo-api/admin/login` (stage 3 review). The promo cookie is the real credential for the
  demos and knows nothing about dashboard roles, so it must never outlive the session that unlocked
  it.
- Decide in stage 4: a promo outage *during* use currently shows as an inline error on the page;
  only the first-visit probe shows the "unreachable" card.

## 5. Backends

- **transcribe-backend:** unchanged — `VITE_BACKEND_URL`, Bearer token, `src/api/backend.ts`.
- **promo:** `src/demos/api.ts` is the only code that knows the promo's location. Every promo
  request goes to same-origin `/promo-api/*`, so the promo's cookie works with no promo changes.
  - dev: Vite `server.proxy` maps `/promo-api` → `${PROMO_API_URL}/api` (default
    `http://localhost:3000`) and `/promo-page/c/` → `${PROMO_API_URL}/c/` —
    narrowed in the stage 3 review: only the public demo page, never the promo's admin UI or API
    under another path, is served on the dashboard origin (where the dashboard's admin token
    lives in localStorage).
  - prod: `vercel.json` rewrites `/promo-api/:path*` → `<promo deployment>/api/:path*` and
    `/promo-page/c/:path*` → `<promo deployment>/c/:path*` (equally narrow). Vercel rewrites can't read env vars, so the
    promo origin is written into `vercel.json` and documented in the README.
    - Deferred at stage 3 (2026-09-21): the promo's deployed URL isn't settled, so only the
      dev/preview proxy is wired; the app README lists the two rewrites to add at first deploy.
- When the promo backend moves later, `src/demos/api.ts` and the proxy entries are what change.
- **Visitor cookie.** The promo assigns its `va_vid` visitor cookie only in middleware on `/c/*`
  page loads on its own origin. On load, the public page issues one `fetch('/promo-page/c/<id>')`
  (response ignored), which runs that middleware and sets the cookie on our origin, before calling
  `/promo-api/track` and `/promo-api/session`.
- **To verify in prod, not assume:** the promo's per-IP limit on `/api/session` reads
  `x-forwarded-for`; confirm it sees the caller's IP through the rewrite rather than one shared
  Vercel address.
- **Out of this work, noted:** share links are built by the promo from its `NEXT_PUBLIC_BASE_URL`.
  Pointing them at the combined app is a promo config change made when the combined app is deployed.

## 6. Errors

- Promo unreachable (network error / 502 from the proxy): a "Demo service unreachable" card on
  Demos views, with the proxy target named in dev. Transcribe views are unaffected.
- Other promo errors: shown inline where the promo shows them now (its `{ error }` body).
- Public page: unknown or inactive demo → the promo's "This demo isn't available" not-found view.
- Transcribe behaviour: unchanged.

## 7. Testing

- **Vitest** added. The promo's unit tests for the copied libs come across and must pass. The
  router's new path-param parsing gets its own tests.
- **Transcribe regression:** the Playwright before/after check already used in this repo — run
  `transcribe-dashboard-app` and the combined app against one deterministic fake backend, render
  every transcribe view × role × scope, compare `main.content` innerText and console errors. Run at
  the end of stage 1 and again after stage 2.
- **Promo screens:** exercised in a browser against a locally running promo (`npm run dev` on :3000)
  through the proxy.
- **Live call:** checked by hand — needs a microphone and an OpenAI key.
- Every stage ends with `npm run build` (typecheck + build) clean.

## Stages

Each stage leaves the app working and gets its own implementation plan.

1. **Transcribe in.** Copy transcribe-dashboard-app into the project; regression check passes.
2. **Tailwind + shadcn.** Add Tailwind v4, shadcn theme with the `--ui-` rename, cascade layers,
   unified theme hook, Vitest; regression check passes again; `CLAUDE.md` updated.
3. **Promo plumbing.** `src/demos/api.ts`, Vite proxy + `vercel.json` rewrites, `PromoAuth` context,
   Unlock card, Demos sidebar group with placeholder views, router path params.
4. **Promo admin screens.** Demo overview, Prospects list + new prospect dialog, prospect detail
   tabs + test call, Pipeline.
5. **Public demo.** `/c/:id` and `/c/:id/scenarios`, the live call hook, call audio, orb, visitor
   cookie priming.

## Out of scope

- Any change to `transcribe-backend`, `backend-app` or the promo repo's code.
- Moving the promo backend into `transcribe-backend`.
- Retiring `transcribe-dashboard-app` or the promo deployment.
- `admin-dashboard-app`.
