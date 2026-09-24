# Ported from voiceagent_promo

Source: `voiceagent_promo` @ `f482848` (separate repo, `../../test_demo/voiceagent_promo`).
Files keep the promo's layout under `src/demos/` (`@/` = `src/demos/`), so a later sync is a diff.

Every file is a verbatim copy except for the edits listed below. Add a line for every deviation.

## Edits applied to every ported file
- `"use client"` directives removed (Vite has no server components).

## Per-file edits

- `lib/share.ts`: `process.env.NEXT_PUBLIC_BASE_URL` → `import.meta.env.VITE_PUBLIC_DEMO_BASE_URL` (typed `string | undefined`, matching Vite's `ImportMetaEnv`).
- `lib/links.ts`: `NEXT_PUBLIC_CONTACT_URL/PRICING_URL/CONTACT_EMAIL` → `VITE_CONTACT_URL/PRICING_URL/CONTACT_EMAIL`; the `||` fallbacks are unchanged.
- `lib/ambience.ts:137`: `fillImpulseResponse(channel, sampleRate, random)` → unused `sampleRate` param prefixed `_sampleRate` (part of the public signature; other callers pass it positionally, still unused inside). (strictness)
- `lib/call-audio.ts:315`: `VOICE_BANDS[index % VOICE_BANDS.length]` → `...]!` (index is `index % VOICE_BANDS.length`, always in range). (strictness)
- `lib/call-audio.ts:359`: `channel[i] *= expr` → `channel[i] = channel[i]! * expr` (`i` bounded by `i < channel.length`; non-null assertion can't sit on a compound-assignment target, so rewritten as a plain assignment with the same arithmetic). (strictness)
- `lib/prompt.ts:54`: `segments[segments.length - 1].toLowerCase()` → `...]!.toLowerCase()` (the `while` condition tests `segments.length` first, so the index is always valid). (strictness)
- `lib/prompt.ts:58`: `segments[segments.length - 2]` → `...]!` (guarded by the `if (segments.length < 2) return "";` two lines above). (strictness)
- `lib/prompt.ts:289`: `quoted[1].trim()` → `quoted[1]!.trim()` (capture group 1 is non-optional in `/"([^"]{4,})"/`, so it is always present when `quoted` is truthy). (strictness)
- `lib/voice-level.ts:13`: `samples[i] * samples[i]` → `samples[i]! * samples[i]!` (`i` bounded by `i < samples.length`). (strictness)
- `tests/promo/ambience.test.ts:108,118,147`: added `!` to `channel[i]`/`channel[i - 1]`/`channel[channel.length - 1]` reads, each bounded by the surrounding loop condition or a fixed buffer length. (strictness)
- `tests/promo/analytics.test.ts`: added `!` to `stats.cust1`/`stats.cust2` (keys just inserted by the fixture's own `call()`/`view()` calls above), `buckets[0]`/`buckets[6]` (array has exactly the requested 7 entries), and `rolled[0]`/`rolled[1]` (asserted length/order on the same or a preceding line). (strictness)
- `tests/promo/call-audio.test.ts:57`: added `!` to `channel[i]`/`channel[i - 1]`, bounded by the loop condition. (strictness)
- `tests/promo/crm-feed.test.ts:55,66,76`: added `!` to `feed[0]`, each preceded by a length/content assertion guaranteeing the entry exists. (strictness)
- `tests/promo/schedule.test.ts`: added `!` to `week[0]`/`week[1]`/`week[6]` (fixed 7-day week from `demoWeek`) and to `const monday = week[0]!` at its declaration. (strictness)
- `tests/promo/transcript.test.ts:19,20,29,43`: added `!` to `entries[0]`/`entries[1]`/`entries[2]`, each preceded by a `toHaveLength`/`.map` assertion on the same array. (strictness)
- `tests/promo/use-cases.test.ts:74,75`: added `!` to `cases[0]`/`cases[1]`, guaranteed live by the preceding "marks only what this demo actually does as live" test asserting the same two ids. (strictness)
- `components/ui/dialog.tsx`: `<DialogPrimitive.Portal data-slot="dialog-portal" {...props} />` → adds `container={twPortalContainer()}`; new import `import { twPortalContainer } from "@/portal"` (Base UI's `DialogPortalProps.container?: HTMLElement | ShadowRoot | React.RefObject<HTMLElement | ShadowRoot | null> | null | undefined` accepts the `HTMLElement` `twPortalContainer()` returns — pop-ups must render inside `.tw` for the scoped Tailwind styles to reach them). (portal)
- `components/ui/dropdown-menu.tsx`: `<MenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />` → adds `container={twPortalContainer()}`; `<MenuPrimitive.Portal>` (the submenu portal) → `<MenuPrimitive.Portal container={twPortalContainer()}>`; new import `import { twPortalContainer } from "@/portal"` (same `MenuPortalProps.container` type as dialog). (portal)
- `components/ui/select.tsx`: `<SelectPrimitive.Portal>` → `<SelectPrimitive.Portal container={twPortalContainer()}>`; new import `import { twPortalContainer } from "@/portal"` (same `SelectPortalProps.container` type). (portal)
- `components/ui/sonner.tsx`: `import { useTheme } from "next-themes"` → `import { useDocumentTheme } from "@/theme"`; `const { theme = "system" } = useTheme()` → `const theme = useDocumentTheme()`; in `style`, `var(--popover)` → `var(--color-popover)`, `var(--popover-foreground)` → `var(--color-popover-foreground)`, `var(--border)` → `var(--color-border)`, `var(--radius)` → `var(--radius-lg)` (bare names would read the *transcribe* app's variables; `--color-*`/`--radius-lg` come from `@theme inline`, mapped to `--ui-*`). No `container`/portal-like option exists on sonner 2.0.8's `ToasterProps` (checked `node_modules/sonner/dist/index.d.ts`: `id, invert, theme, position, hotkey, richColors, expand, duration, gap, visibleToasts, closeButton, toastOptions, className, style, offset, mobileOffset, dir, swipeDirections, icons, customAriaLabel, containerAriaLabel` — none accept an element/portal target), so no container prop was added; the `<Toaster>` itself must be rendered inside a `.tw` element, done in Task 6. (theme, raw vars)
- `components/ui/button.tsx`: in the `secondary` variant, `color-mix(in_oklch,var(--secondary),var(--foreground)_5%)` → `color-mix(in_oklch,var(--color-secondary),var(--color-foreground)_5%)` (same bare-vs-namespaced-var reasoning as sonner). `var(--radius-md)` left as-is (Tailwind emits it; not a bare/raw variable). (raw vars)

No `tsc` strictness fixes were needed for the 13 `components/ui/*.tsx` files (`npx tsc --noEmit` is clean).

### The remaining shadcn components (Task 2)

Copied (`"use client"` removed): `components/ui/{tabs,sheet,separator}.tsx`.

- `components/ui/sheet.tsx`: `<SheetPrimitive.Portal data-slot="sheet-portal" {...props} />` → adds `container={twPortalContainer()}`; new import `import { twPortalContainer } from "@/portal"` after the last import (same `SheetPortalProps.container` type as dialog/dropdown-menu/select). (portal)

`tabs.tsx` and `separator.tsx` have no edits beyond the directive (no portal, no bare `var(--`). No `tsc` strictness fixes were needed for these 3 files (`npx tsc --noEmit` is clean).

### Overview + Prospects screens (Task 5)

Copied (LF, `"use client"` removed): `components/admin/{shared,CustomerTable,NewCustomerDialog}.tsx`, `components/charts/{CallsPerDayChart,TopCustomersChart}.tsx`; `app/admin/(dashboard)/page.tsx` → `screens/OverviewScreen.tsx`; `app/admin/(dashboard)/customers/page.tsx` → `screens/ProspectsScreen.tsx`. `shared.tsx` has no edits beyond the directive.

- `components/admin/CustomerTable.tsx`: new first import `import { promoFetch } from "@/api"`; `:163` `fetch(`/api/admin/customers/${customer.id}`, { method: "PATCH", … })` and `:176` `fetch(`/api/admin/customers/${customer.id}`, { method: "DELETE" })` → `promoFetch(…)` (same arguments). (fetch)
- `components/admin/CustomerTable.tsx`: `import Link from "next/link"` removed; `import { demoHref } from "@/routes"` added after the `@/lib/types` import; `:300` `<Link href={`/admin/customers/${customer.id}`} className="hover:underline">…</Link>` → `<a href={demoHref("demoProspect", customer.id)} className="hover:underline">…</a>`; `:381` `render={<Link href={`/admin/customers/${customer.id}`} />}` → `render={<a href={demoHref("demoProspect", customer.id)} />}`. (next/link)
- `components/admin/NewCustomerDialog.tsx`: new first import `import { promoFetch } from "@/api"`; `:45` `fetch("/api/admin/customers", { method: "POST", … })` → `promoFetch(…)`. (fetch)
- `components/charts/CallsPerDayChart.tsx`, `components/charts/TopCustomersChart.tsx`: `import { useTheme } from "next-themes"` → `import { useDocumentTheme } from "@/theme"`; `const { resolvedTheme } = useTheme()` → `const resolvedTheme = useDocumentTheme()` (the `[resolvedTheme]` effect dependency and `key={resolvedTheme}` are unchanged). (theme)
- `screens/OverviewScreen.tsx`: new first import `import { promoFetch } from "@/api"`; `:73` `fetch(
  `/api/admin/analytics?days=…`, …)` → `promoFetch(…)`. `import Link from "next/link"` removed; `import { demoHref } from "@/routes"` added after the `@/lib/http` import; `:223` `<Link href={`/admin/customers/${call.customerId}`} …>` → `<a href={demoHref("demoProspect", call.customerId)} …>`. `export default function OverviewPage()` → `export function OverviewScreen()` (named export, app convention). (fetch, next/link, naming)
- `screens/ProspectsScreen.tsx`: new first import `import { promoFetch } from "@/api"`; `:20` `fetch("/api/admin/customers", { cache: "no-store" })` → `promoFetch(…)`. `export default function CustomersPage()` → `export function ProspectsScreen()`. The `PageHeader` `title` is the promo's own `"Customers"`: it was briefly `"Prospects"` to match the old sidebar label, and was put back when the Demo tabs took the promo's names (see "Demo tabs" below). (fetch, naming)

No `tsc` strictness fixes were needed for these 7 files (`npx tsc --noEmit` clean).

Legacy class-name scan (literal `className`s in `components/` + `screens/`): hits `sr-only` (`ui/dialog.tsx` — harmless, Tailwind's rule is a superset) and `grid` (`NewCustomerDialog.tsx`, `OverviewScreen.tsx`). `grid` is a false positive: `legacy.css` only defines `.areachart .grid` and `.barchart .grid` (descendant selectors setting SVG `stroke`/`stroke-width`), which cannot match promo markup (never inside `.areachart`/`.barchart`), so Tailwind's `grid` is kept, not renamed.

### Review fixes (Task 7)

- `lib/chart-theme.ts` `readChartTheme()`: the `getPropertyValue` reads `--chart-${i + 1}` → `--ui-chart-${i + 1}`, `--foreground` → `--ui-foreground`, `--muted-foreground` → `--ui-muted-foreground`, `--card` → `--ui-card`, `--border` → `--ui-border`, `--success` → `--ui-success`, `--destructive` → `--ui-destructive`, `--font-sans` → `--ui-font-sans`. The bare names read the *transcribe* variables on `<html>` or nothing at all (dark `--chart-1` is the 3-digit `#59f`, so the charts' `${color}1F` alpha suffix made an invalid colour and the fill/bars painted black; axis labels fell back to black). The `--ui-*` tokens are the promo theme's own, defined unlayered on `:root`/`.dark`. `CHART_SERIES`' comment (`--chart-1 .. --chart-7`) left verbatim. (raw vars, JS)

- `components/charts/CallsPerDayChart.tsx`, `TopCustomersChart.tsx`: `useEffect(() => applyChartDefaults(), [resolvedTheme])` -> `applyChartDefaults()` called during render; the now-unused `useEffect` import dropped. Fixes a bug that is also in the promo: the child `<Line>`/`<Bar>` effect built the chart before the parent's effect updated Chart.js defaults, so after a theme toggle the axis labels drew in the previous theme's colours. Found in the stage-4a re-review. (bug fix, upstream too)

### Prospect detail (stage 4b)

Copied (`"use client"` removed): `components/admin/{ActivityTab,KnowledgeEditor,PromptEditor,ResearchInputsPanel,SharePanel}.tsx`, `components/call/{CallPanel,Transcript}.tsx`, `components/public/{Exchange,SchedulePanel}.tsx`, `components/research/SourcesPanel.tsx`, `hooks/useLiveCall.ts`; `app/admin/(dashboard)/customers/[id]/page.tsx` → `screens/ProspectScreen.tsx`. `Exchange.tsx` has no directive and is byte-identical to the promo (modulo line endings); `PromptEditor`, `ResearchInputsPanel`, `SharePanel`, `CallPanel`, `Transcript`, `SchedulePanel`, `SourcesPanel` have no edits beyond the directive.

- `components/admin/ActivityTab.tsx`: new first import `import { promoFetch } from "@/api"`; `:160` `fetch(`/api/admin/customers/${customerId}/calls`, {…})` → `promoFetch(…)` (same arguments). (fetch)
- `components/admin/KnowledgeEditor.tsx:122`: `day: DAYS[profile.hours.length % 7],` → `day: DAYS[profile.hours.length % 7]!,` (`DAYS` is the fixed 7-entry weekday array at `:15`, so `% 7` is always in range). (strictness)
- `hooks/useLiveCall.ts`: new first import `import { promoFetch, promoUrl } from "@/api"`; `:163` `navigator.sendBeacon(url, …)` → `navigator.sendBeacon(promoUrl(url), …)` (a beacon can't go through `promoFetch`; `promoUrl` maps the same `/api/calls/${callId}` path onto the `/promo-api` proxy); `:166` `void fetch(url, {…})` → `void promoFetch(url, {…})` (the non-beacon fallback; `url` is still the `/api/…` path); `:315` `fetch("/api/session", {…})` → `promoFetch(…)`. (fetch, beacon)
- `screens/ProspectScreen.tsx`: new first import `import { promoFetch } from "@/api"`; `export default function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) { const { id } = use(params);` → `export function ProspectScreen({ id }: { id: string }) {` (Next's route params → a plain prop; everything after unchanged) and `use` dropped from the `react` import (now unused); the four `fetch(`/api/admin/customers/${id}…`, …)` calls (`:51` GET, `:102` PATCH, `:121` POST research, `:298` PATCH) → `promoFetch(…)` (same arguments). (params, fetch, naming)

Scans: no `var(--…)`, `getPropertyValue(` or other `--x` custom-property reference anywhere in these 12 files (the only inline `style` is `SharePanel.tsx:87`'s computed `width`; `SchedulePanel.tsx`'s literal hex fills are the Microsoft logo and the white initial on an integration's brand-colour monogram, theme-independent in the promo too). Legacy class-name scan (4a Task 5 Step 6 script over `components/` + `screens/`): only `grid` (new: `KnowledgeEditor`, `PromptEditor`, `ResearchInputsPanel`, `SchedulePanel`, `SharePanel`, `ProspectScreen`) and `sr-only` (`ui/dialog.tsx`, `ui/sheet.tsx`) — both allowed (see the 4a note above). A wider scan of every quoted string in the new files also matched `short`, `icon`, `line`, `session`, `error`, `muted` — all false positives (prose, the `size="icon"` cva variant key, `state === "error"`, Exchange's `muted` prop), none used as a class. Only `KnowledgeEditor.tsx:122` needed a `tsc` strictness fix.

### Stage 4b review fixes

- `hooks/useLiveCall.ts`: new `const aliveRef = useRef(true)` after `greetTimerRef`; the pagehide/unmount effect sets `aliveRef.current = true` in its body (so StrictMode's mount → cleanup → mount leaves it true) and `false` first thing in its cleanup, before `onLeave()`. In `dial`: after `getUserMedia` resolves, if not alive → stop the stream's tracks and return (before any peer connection, CallAudio or ringtone); after `waitForIceGathering`, if not alive → `teardown()` and return (before the ringtone and the session request); after the session answer is read, if not alive → `teardown()`, and if a `callId` came back set `callIdRef` and `report("abandoned", "unmounted", true)`, then return. `report` added to `dial`'s dependency list. Without this, leaving the page while the microphone prompt (or ICE gathering, or the session request) was pending let `dial` carry on after unmount — mic open, ringtone, `POST /api/session`, a live billed session with no UI and no end report (`onLeave` saw no `pcRef` yet, so did nothing). Worse here than in the promo: in this hash-routed SPA a sidebar click unmounts the page without a pagehide. (bug fix, upstream too)
- `lib/ringtone.ts` `start()`: after the `context.resume()` try/catch, added `if (!this.context) return;` — `stop()` can run while `resume()` is pending (a fast refusal from `/api/session` ends the call first), leaving `this.context` null, and the following `this.context.createGain()` threw inside the unawaited `void ringtone.start()` → an unhandled rejection. (bug fix, upstream too)

## Tests

Copied verbatim from `PROMO/tests/` into `tests/promo/`, with `"../lib/` rewritten to `"../../src/demos/lib/`:
`ambience.test.ts`, `analytics.test.ts`, `call-audio.test.ts`, `crm-feed.test.ts`, `integrations.test.ts`, `languages.test.ts`, `prompt.test.ts`, `proof.test.ts`, `schedule.test.ts`, `scroll.test.ts`, `transcript.test.ts`, `use-cases.test.ts`, `voice-level.test.ts` (13 files, 194 tests, all passing).

Skipped (test server-only libs not ported, or out of scope for this stage):
`kv.test.ts`, `maps.test.ts`, `research.test.ts`, `call-review.test.ts`, `crm.test.ts`, `store-migration.test.ts` — test server-only libs (`kv`, `maps`, `research*`, `call-review`, `crm`, `store`) that were not copied.
`public-view.test.ts` — belongs to stage 5.

In `tests/promo/analytics.test.ts`, removed `import { parseLiveMember } from "../../src/demos/lib/calls";` and the trailing `describe("the live session index", () => { … });` block (3 tests), since it exercises `lib/calls`, a server-only library not ported in this task.

### CRM pipeline (stage 4c)

Copied (`"use client"` removed): `components/admin/{crm-shared,PipelineBoard,ActivityFeed,CrmTab,CrmDrawer}.tsx`; `app/admin/(dashboard)/crm/page.tsx` → `screens/PipelineScreen.tsx`. `crm-shared.tsx` and `ActivityFeed.tsx` have no edits beyond the directive.

- `components/admin/PipelineBoard.tsx:69,71,80,83`: `CUSTOMER_STAGES[index - 1]` / `CUSTOMER_STAGES[index + 1]` (and the same reads inside `STAGE_LABEL[...]`) → `...]!` (the arrow-button `onClick`s are bounded by the sibling `disabled={index <= 0}` / `disabled={index >= CUSTOMER_STAGES.length - 1}` — a native `disabled` button fires no click event, so `onMove` never runs out of range; the `aria-label` ternaries are guarded by `index > 0` / `index < CUSTOMER_STAGES.length - 1` on the same line. Also covers `customer.stage` holding a value outside `CUSTOMER_STAGES`: `indexOf` then returns `-1`, so `index <= 0` is true and the *left* arrow is correctly disabled; the *right* arrow is enabled and reads `CUSTOMER_STAGES[index + 1]` = `CUSTOMER_STAGES[0]`, still in range, so the assertion holds for that case too). (strictness)
- `components/admin/CrmTab.tsx`: new first import `import { promoFetch } from "@/api"`; `:65` `fetch(`/api/admin/customers/${customer.id}/notes`, {…})` → `promoFetch(…)` (same arguments). (fetch)
- `components/admin/CrmDrawer.tsx`: new first import `import { promoFetch } from "@/api"`; `import Link from "next/link"` removed; `import { demoHref } from "@/routes"` added after the `@/lib/types` import; `:57` GET and `:80` PATCH `fetch(`/api/admin/customers/…`, …)` → `promoFetch(…)` (same arguments); `:121` `render={<Link href={`/admin/customers/${data.customer.id}`} />}` → `render={<a href={demoHref("demoProspect", data.customer.id)} />}`. (fetch, next/link)
- `screens/PipelineScreen.tsx`: new first import `import { promoFetch } from "@/api"`; `:25` `fetch("/api/admin/crm", { cache: "no-store" })` and `:52` `fetch(`/api/admin/customers/${customer.id}`, {…})` → `promoFetch(…)` (same arguments). `export default function CrmPage()` → `export function PipelineScreen()` (named export, app convention).

No `var(--…)` / `getPropertyValue(` reads and no other strictness fixes were needed for these 6 files beyond the 4 noted above (`npx tsc --noEmit` clean). Legacy class-name scan (4a Task 5 Step 6 script over `components/` + `screens/`): only `grid` (new: `PipelineBoard`, `CrmTab`, `PipelineScreen`) and `sr-only` (`ui/dialog.tsx`, `ui/sheet.tsx`) — both already allowed (see the 4a note above).

This is the last promo admin screen — every Demos view is now a ported screen. `DemosView.tsx` renders `<PipelineScreen />` for `demoPipeline`; `src/demos/pages/DemoPlaceholderPage.tsx` (and the now-empty `src/demos/pages/`) is deleted — there is no longer any placeholder Demos view.

### Stage 4c review fixes

- `components/admin/CrmDrawer.tsx`: new import `useRef` added to the `react` import; new `const wantedIdRef = useRef(customerId)` after the `error` state; in `load()`, new `const wanted = customerId;` right after the `if (!customerId) return;` guard, the response is read into a local `const payload = await readJson<Payload>(response);`, and `if (wanted !== wantedIdRef.current) return;` runs before `setData(payload)` (the following `setError(null)` is skipped too, since it's after the early return — the catch block is unchanged); the effect that clears `data`/`error` and calls `load()` now sets `wantedIdRef.current = customerId;` as its first line. Fixes an upstream bug found in review: a slower `GET` for a previously open prospect (e.g. Harbor) resolving after the drawer has since been reopened on a different one (e.g. Cedar) unconditionally overwrote the open drawer with the stale prospect's data, so `save()` would then `PATCH` the wrong prospect's id and "Open the customer" would link to the wrong record. A plain `customerId` re-check inside `load()` can't catch this — that identifier is a parameter captured once per closure and is invariant for the lifetime of that particular `load()` call, so it can never differ from its own snapshot; `wantedIdRef` is the mutable, always-current source of truth the guard needs, updated synchronously in the effect (i.e. before any pending fetch's continuation can run, since JS is single-threaded). (bug fix, upstream too)
- `screens/PipelineScreen.tsx`: new import `useRef` added to the `react` import; new `const hasLoadedRef = useRef(false)` before `load`; in `load()`'s success branch, `hasLoadedRef.current = true;` added after `setError(null)`; in the catch branch, the message is captured into a local `const message = …` (used for both `setError(message)` and, only `if (hasLoadedRef.current)`, `toast.error(message)`). Fixes an upstream bug found in review: `error` is rendered only in the `if (!data)` skeleton branch, so once the board has loaded once, a failed refresh (e.g. `move()`'s recovery `void load()` after a failed `PATCH`) set `error` somewhere nothing ever displays it — a stage-move failure that also failed to reload silently left the card parked in the wrong column with no visible message. `hasLoadedRef` keeps the first-load failure path identical (skeleton's `error` block still fires, no toast) while surfacing every later failure as a toast too. (bug fix, upstream too)
- `components/admin/CrmDrawer.tsx`: the same stale-read guard added to `load()`'s CATCH path (`if (wanted !== wantedIdRef.current) return;` before `setError`). Without it a stale prospect's failure is painted over the prospect now on screen, which loaded fine — cosmetic, but it reports a failure that didn't happen to the record being looked at. Found in the stage-4c re-review. (bug fix, upstream too)

### Demo tabs renamed to the promo's own (2026-09-22)

The Demo section's three tabs are the promo's three admin tabs, named as `components/admin/AppSidebar.tsx`
names them, and the group now sits below Settings:

| was | now | promo route |
| --- | --- | --- |
| Demos → Demo overview | **Demo → Overview** | `/admin` |
| Demos → Prospects | **Demo → Customers** | `/admin/customers` |
| Demos → Pipeline | **Demo → CRM** | `/admin/crm` |

Changed: `components/Sidebar.tsx` (group moved after Settings, group label `Demo`, three item labels),
`App.tsx` (`VIEW_TITLES` for the four demo views — one customer is `Detail`, as the promo's
`AdminBreadcrumb` calls it — and the breadcrumb's section word), `screens/ProspectsScreen.tsx`
(`title` back to `"Customers"`).

The route hashes are unchanged (`#/demos/overview`, `#/demos/prospects`, `#/demos/prospects/<id>`,
`#/demos/pipeline`), so existing links still work, and the `ViewId`s keep their `demo…` names.

One consequence worth knowing: the sidebar now has **two "Overview" items**, one in Dashboard and one
in Demo. That is what the promo's naming gives; the group labels tell them apart. `demos_e2e.py` gained
a `demo_nav()` helper that scopes a nav lookup to the Demo group, because `get_by_role("button",
name="Overview")` is now ambiguous.

### Demo tabs served from transcribe-backend (2026-09-22)

The demo records were imported into transcribe-db and transcribe-backend now serves them under
`/demo/*`, guarded by the dashboard's own admin session. voiceagent_promo is no longer called at
all, so everything that existed only to reach it is gone.

**`promoFetch` → `demoFetch`, and the paths lost `/api/admin`.** `api.ts` was rewritten around a
single `demoFetch(path, init)` that keeps `promoFetch`'s exact signature — it returns the raw
`Response`, so every ported screen's own `readJson(response)` is untouched. It targets
`` `${__BACKEND_URL__}/demo${path}` `` and sends `authorization: Bearer <dashboard token>` from
`src/api/backend.ts`'s `getToken()`. Deleted with the promo: `promoFetch`, `promoUrl`,
`promoRequest`, `probePromo`, `unlockPromo`, `lockPromo`, `setPromoLockedHandler`, `PromoError`,
`PromoErrorKind`, `PromoAccess`, `PROMO_API`.

Because `demoFetch`'s own base carries `/demo`, the promo's `/api/admin` prefix is dropped at every
call site — the rest of each path is the promo's own route shape, unchanged:

| file:line | was | now |
| --- | --- | --- |
| `screens/OverviewScreen.tsx:73` | `/api/admin/analytics?days=…` | `/analytics?days=…` |
| `screens/ProspectsScreen.tsx:20` | `/api/admin/customers` | `/customers` |
| `screens/PipelineScreen.tsx:27` | `/api/admin/crm` | `/crm` |
| `screens/PipelineScreen.tsx:61` | `/api/admin/customers/${customer.id}` | `/customers/${customer.id}` |
| `screens/ProspectScreen.tsx:51,102,298` | `/api/admin/customers/${id}` | `/customers/${id}` |
| `components/admin/CustomerTable.tsx:163,176` | `/api/admin/customers/${customer.id}` | `/customers/${customer.id}` |
| `components/admin/NewCustomerDialog.tsx:45` | `/api/admin/customers` | `/customers` |
| `components/admin/CrmDrawer.tsx:63,94` | `/api/admin/customers/…` | `/customers/…` |
| `components/admin/CrmTab.tsx:65` | `/api/admin/customers/${customer.id}/notes` | `/customers/${customer.id}/notes` |
| `components/admin/ActivityTab.tsx:160` | `/api/admin/customers/${customerId}/calls` | `/customers/${customerId}/calls` |

The import line in each of those nine files changed from `import { promoFetch } from "@/api"` to
`import { demoFetch } from "@/api"`, and each call's arguments are otherwise identical. Nothing else
in them changed.

**The gate lost its auth.** `DemosGate.tsx` keeps the `.tw` wrapper, the
`flex flex-col gap-4 md:gap-6` column and the `Toaster`, and nothing else: there is no promo
password to enter, and the Demo group is already admin-only, so there is no second sign-in to gate
on. `PromoAuth.tsx` and `UnlockCard.tsx` are **deleted**, and `PromoAuthProvider`, `lockPromo` and
the `setPromoLockedHandler` wiring (including the sign-out effect and its `useRef`) are gone from
`src/App.tsx`. The one card left is for a build with no `BACKEND_URL` baked in — see the deviation
note below.

**The two actions that could not move.** Both needed a promo service that no longer answers, and the
design doc puts them out of scope, so they are **removed from the UI rather than disabled** (the
user's choice):

- **Re-research** — `POST /api/admin/customers/:id/research` needed the promo's Claude research
  pipeline. Gone from `screens/ProspectScreen.tsx`: the header `Button`, the `research()` handler,
  the `researching` state and the `RefreshCw` import. **Reversed on 2026-09-23** —
  transcribe-backend ports the research pipeline and serves the route itself now; see "The research
  UI comes back" at the end of this file.
- **Call now / Test call** — `POST /api/session` and the call beacons needed the promo's OpenAI
  realtime session. Gone from `screens/ProspectScreen.tsx`: the whole "Test call" `<Card>`, the
  `useLiveCall(...)` call, the "refresh the call list once a test call finishes" effect, and the
  `CallPanel` / `Transcript` / `useLiveCall` imports (`CardHeader` and `CardTitle` with them — that
  card was their only user). **Reversed on 2026-09-23** — transcribe-backend serves the session
  itself now; see "The test call comes back" below.

Files **deleted** because nothing reaches them any more (every other importer checked first):

- `hooks/useLiveCall.ts` — only `ProspectScreen` used it (the `hooks/` folder is now empty and gone).
- `components/call/CallPanel.tsx` — same.
- `lib/ringtone.ts` — only `useLiveCall` used it, and no ported test covers it.

All three were **re-ported on 2026-09-23** — see "The test call comes back" below.

**Kept** although the live call was their only caller in the app: `components/call/Transcript.tsx`
(still rendered by `components/admin/ActivityTab.tsx` for a recorded call's transcript),
`lib/call-audio.ts` and `lib/ambience.ts` (still used by `components/admin/PromptEditor.tsx` for the
call-sound preview), and `lib/transcript.ts` (pure, and `tests/promo/transcript.test.ts` — a
verbatim promo test — still covers it; `lib/voice-level.ts` has been in that same "only its ported
test imports it" state since the original port).

**Everything else in the screens is still verbatim.** No other line of any ported screen or
component changed in this step.

#### Deviations, with reasoning

- `components/admin/ResearchInputsPanel.tsx`: **this deviation no longer exists.** It was: its "Run
  research again" `Button` — and with it the `onResearch` / `researching` props and the `Button` +
  `RefreshCw` imports — removed, the destructure collapsing to `({ customer, onChange }: Props)`,
  because the button was the *second* trigger for the same removed action (`ProspectScreen` passed
  it `onResearch={() => research(false)}`) and could not survive the handler. The panel's four input
  fields stayed throughout — they are ordinary customer fields that Save still writes. The whole
  file is the promo's again as of 2026-09-23; see "The research UI comes back".
- `screens/ProspectScreen.tsx` stalled banner: **this deviation no longer exists.** It was: the
  trailing sentence `Press Re-research.` dropped (the rest of the sentence unchanged), because it
  told the reader to press a button that no longer existed. The `isResearchStalled` check and the
  "Stalled" status badge were untouched throughout — a record stuck mid-research was still worth
  flagging even while this app could not restart one, and now that it can, the sentence is back and
  the banner is the promo's again (2026-09-23).
- `screens/ProspectScreen.tsx` layout: **this deviation no longer exists.** It was: with the call
  card gone the detail grid collapsed from `grid grid-cols-1 gap-4 lg:grid-cols-3` (tabs card at
  `lg:col-span-2`, the test-call card in the third column) to a single full-width column
  (`grid grid-cols-1 gap-4`, no `lg:col-span-2`), on the grounds that the wide tabs read better.
  The test call came back on 2026-09-23, so the grid is the promo's three-column one again and the
  tabs card carries `lg:col-span-2` again — the file matches the promo here line for line. The
  "wide tabs read better" observation still holds and is the one thing given up by restoring the
  promo's layout; it was not worth diverging from the promo over, now that the third column has its
  real occupant back.
- `DemosGate.tsx`'s error card is now "Backend URL not set", not "Demo service unreachable". There
  is no probe left to detect "unreachable" — each ported screen already catches its own failure and
  shows the message (`demoFetch` throws `Couldn't reach the server.`). The one failure a screen
  cannot explain is a build with an empty `__BACKEND_URL__`, where every request silently goes to
  this app's own origin and comes back as `index.html`; that is what the card names.
- `routes.ts` / `DemosView.tsx`: stale comments only (`/promo-api/admin/customers/<id>` →
  `<backend>/demo/customers/<id>`; "promo sign-in" dropped from the gate's description). The
  exported name `isPromoId` is unchanged — the ids really are still the promo's nanoids, and
  renaming it would churn `DemosView` and `tests/routes.test.ts` for nothing.

#### Outside `src/demos/`

- `vite.config.ts`: the `/promo-api` proxy, the `PROMO_API_URL` read and the `__PROMO_TARGET__`
  define are removed (`server` keeps only `port: 5175`; there is no `preview.proxy` left).
  `env.d.ts` drops the `__PROMO_TARGET__` declaration and `vitest.config.ts` its define.
  `VITE_PUBLIC_DEMO_BASE_URL` is deliberately **untouched**: the public demo page (`/c/<id>`) still
  lives on the promo and is still only linked to.
- `.env.example` and `README.md`: `PROMO_API_URL` and the "before the first deploy" Vercel-rewrite
  note removed — no rewrite is needed now, because `BACKEND_URL` already points at
  transcribe-backend. The README's promo section is rewritten around `/demo/*` and records the two
  removed actions; its "Trying a real test call" section goes with the feature.
- `tests/promoApi.test.ts` (26 tests) deleted — every function it covered is gone — and replaced by
  `tests/demoApi.test.ts` (7 tests) covering `demoFetch`: the `/demo` base, the bearer header
  present and absent, `content-type` only with a body, the `Response` passed through on an error
  status, the network-failure message, and the non-`/path` guard.
- `CLAUDE.md` still describes `promoFetch`, `promoRequest`, `PromoAuth` and the `/promo-api` proxy
  in its "The Demos section (promo)" block, and `scripts/regression/` still has `fake_promo.py`.
  Both left alone here: the harness is Task 10, and `CLAUDE.md` is the user's to change.

### "Analyze" removed (2026-09-22, review of Tasks 8–10), and back (2026-09-23)

`components/admin/ActivityTab.tsx`: the per-call **Analyze** button, its `onAnalyze` prop and type,
and the `Sparkles` / `Button` imports are gone.

It belonged to the same retired pipeline as "Re-research" and "Call now", but was missed when those
were removed because it lives inside a call card rather than on the page header. Left in, it was
worse than a dead control: it PATCHed `{ analyze: true }`, the backend returned the call unchanged
(the review model is gone), and the UI then raised a success toast reading **"Reviewed."** — a
confirmation that nothing had happened.

The explanatory sentence beside it ("Not reviewed — this call happened before reviews, or the model
was unreachable.") is now just "Not reviewed.", since neither reason is the operative one any more:
reviews cannot be produced at all. Calls that already carry a `review` from the promo still render
it in full; this only affects calls that never got one.

The backend still accepts `analyze: true` and ignores it (see the Task 4/6 notes) — nothing in the
UI sends it now, but the route stays tolerant rather than newly rejecting a field it used to take.

**Put back on 2026-09-23** (stage "demo test call", Task 8 Step 3). Reviews exist again: transcribe-backend
ports the promo's `lib/call-review.ts` as `src/demo/callReview.ts` and runs it from
`POST /demo/calls/:callId`, so a call placed from the restored Test call panel comes back with its
review and the "Not reviewed" branch is once more about a call that *happened* to miss one rather
than about a retired pipeline. `components/admin/ActivityTab.tsx` is therefore the promo's file
again, line for line, apart from the one `demoFetch` line: the per-call **Analyze** button, its
`onAnalyze` prop and type, the `Sparkles` / `Button` imports and the fuller sentence
"Not reviewed — this call happened before reviews, or the model was unreachable." are all back.

**It does what it says, as of Task 8b.** When this was first restored it did not: `analyze` was
still the no-op it became when the promo's pipeline was dropped, so pressing it on an older call
returned that call unchanged and raised the "Reviewed." toast anyway — the confirmation-of-nothing
the 2026-09-22 removal named. That gap was closed the same day. `PATCH /demo/customers/:id/calls`
now runs the promo's own branch: an existing review is never redone (it costs money and the operator
has already read the old wording), a call with too little of a caller in it is refused with 400
`"This call is too short to say anything about."`, a model that cannot be read back gives 502
`"The review could not be read back. Try again in a moment."`, and nothing is written until every
refusal is past. `transcribe-backend/src/routes/demoCall.pg.test.ts` pins all five cases.

### The test call comes back (2026-09-23)

transcribe-backend now serves the call itself — `POST /demo/session` (the promo's
`app/api/session/route.ts`, reduced to its `isTest` path) and `POST /demo/calls/:callId` (the
promo's `app/api/calls/[callId]/route.ts`) — so the three files deleted in "Demo tabs served from
transcribe-backend" are **re-ported from the promo**, the "Test call" card is back in the prospect
detail's third column, and "Analyze" is back on a call card (see the section above it).

Re-ported (`"use client"` removed): `hooks/useLiveCall.ts`, `components/call/CallPanel.tsx`,
`lib/ringtone.ts` — the `hooks/` folder exists again.

**Source commit.** These three come from the promo's HEAD at the time, `cf5473b`, not the `f482848` at
the top of this file. (`hooks/useLiveCall.ts` has since moved on to `90869c6` — see
"`hooks/useLiveCall.ts` — merged at `90869c6`" at the end of this file. `CallPanel.tsx` and
`lib/ringtone.ts` are still `cf5473b`, unchanged in the promo since.) Only `useLiveCall.ts` differs between the two: promo `6437467` ("Tell the
receptionist what day it is") added the three `timeZone` lines in the session body, and they are
wanted here — `POST /demo/session` reads `body.timeZone` through `safeTimeZone(...)` to date the
`callClock` text it appends to the prompt. `CallPanel.tsx` and `lib/ringtone.ts` are byte-identical
between `f482848` and `cf5473b`.

The two review fixes this file recorded under "Stage 4b review fixes" are **re-applied**, because
they are still true of this app and the deleted files carried them: `useLiveCall`'s `aliveRef`
(every `await` in `dial` is a point where the page may be gone, and in this hash-routed SPA a
sidebar click unmounts the page without a pagehide) and `Ringtone.start`'s `if (!this.context)
return;` after the `resume()` try/catch. Read those entries for the reasoning; nothing about them
changed.

#### Per-file edits

- `components/call/CallPanel.tsx`: no edits beyond the directive. No `var(--…)`, no
  `getPropertyValue(`, no `next/link`, no `next-themes`, no portal, no `process.env`.
- `lib/ringtone.ts`: no promo directive to remove; the one edit is the re-applied stage-4b fix
  (`start()`, after the `context.resume()` try/catch: `if (!this.context) return;`). Browser-only,
  no fetch, no CSS.
- `hooks/useLiveCall.ts`:
  - new first import `import { demoFetch } from "@/api";` (was `promoFetch, promoUrl`);
  - `:160` the `url` local drops the prefix: `/api/calls/<callId>` → `/calls/<callId>` (`demoFetch`'s
    own base carries `/demo`, as everywhere else in this file's table);
  - `:315` `fetch("/api/session", {…})` → `demoFetch("/session", {…})`, same arguments;
  - `:162-171` the `sendBeacon` branch is **gone** and `report`'s third parameter with it — see
    "The unload report" below;
  - `:408`, and the `aliveRef` unmount path, `report("abandoned", "page_hidden", true)` /
    `report("abandoned", "unmounted", true)` → the same calls without the third argument.
  - **Kept verbatim on purpose:** the body still sends `isTest`, and `useLiveCall(id,
    draft?.callSound, { isTest: true })` still passes the option. `POST /demo/session` does not
    read it — every call reachable through that admin-guarded route is a test call and the row is
    written `is_test = true` unconditionally — and Elysia 1.4 normalises unknown body keys away
    rather than refusing them, so the field is simply dropped server-side. Removing it would have
    meant editing the hook's public options type and its one call site for no behaviour change.

No `tsc` strictness fixes were needed for these three files (`npx tsc --noEmit` clean), and no
legacy class name appears in `CallPanel.tsx` (`flex`, `grid`-free; the `bg-success` /
`bg-destructive` / `bg-warning` / `bg-primary/30` / `hover:bg-primary-strong` utilities are the
promo theme's own tokens, already in this app's scoped Tailwind build).

#### The unload report

The promo reported an abandoned call from `pagehide` with
`navigator.sendBeacon(url, new Blob([payload], { type: "application/json" }))`, falling back to
`fetch(url, { keepalive: true })`. **That beacon cannot survive the move to transcribe-backend**,
for two independent reasons:

1. `sendBeacon` takes a URL and a body and nothing else — there is no way to set a header on it, so
   it cannot carry the `Authorization: Bearer <dashboard token>` that `demoFetch` adds and that
   `authenticateAdmin` on `POST /demo/calls/:callId` requires. It would arrive unauthenticated and
   be answered 401/403.
2. The backend is a different origin now, so the request is cross-origin; a beacon whose Blob type
   is `application/json` is not a CORS-safelisted request and needs a preflight it cannot usefully
   wait for, on top of carrying no credentials this backend recognises.

**Decision: one request for both paths — `demoFetch(url, { method: "POST", …, keepalive: true })`.**
`demoFetch` is an `async` function whose body runs synchronously up to its `await fetch(...)`, so
the request really is issued inside the `pagehide` handler, and `keepalive: true` is what lets it
outlive the document. `report`'s `beacon` parameter is deleted rather than left unused (this repo
compiles with `noUnusedParameters`), and its two call sites drop the `true`.

**The trade-off, stated plainly.** `keepalive` is weaker than a beacon:

- it is a newer guarantee than `sendBeacon` (Firefox only shipped `fetch` + `keepalive` in 133), so
  an old browser may drop the request at unload where a beacon would have gone;
- the `authorization` header makes it a preflighted cross-origin POST, so the report needs an
  `OPTIONS` round trip *and then* the POST after the page is already gone, where a beacon was one
  packet;
- the spec caps all in-flight `keepalive` bodies at 64 KiB. A long transcript can approach that
  (the backend caps the stored transcript at 500 entries, not bytes), and over the cap the fetch
  rejects and the report is lost.

**What losing it costs — very little, by design.** Nothing is corrupted: the `demo_calls` row
simply stays `status: "started"`, which the Activity tab renders as "Still on the line." and the
backend counts as in flight for ten minutes before it stops mattering. Nothing is double-counted
either, because the server, not the client, decides the first report wins: `POST /demo/calls/:callId`
answers `{ ok: true, alreadyReported: true }` and changes nothing for any report of a call that is
no longer `"started"` — so a *late* keepalive report that lands after the normal end-of-call report
is harmless, and so is the duplicate that `reportedRef` would have suppressed anyway. The failure
mode is a stale row, never a wrong number.

#### The layout

`screens/ProspectScreen.tsx` is the promo's page again in this area: the detail wrapper is
`grid grid-cols-1 gap-4 lg:grid-cols-3`, the tabs `<Card>` carries `lg:col-span-2`, and the third
column holds the "Test call" `<Card>` — `CardHeader` / `CardTitle` back on the card import, the
`CallPanel` / `Transcript` / `useLiveCall` imports back, `const call = useLiveCall(id,
draft?.callSound, { isTest: true })` back with its comment, and the "Refresh the call list once a
test call finishes" effect back, all copied from the promo unchanged. The earlier
single-column note under "Deviations, with reasoning" is marked as reversed there.

Everything else in `ProspectScreen.tsx` is untouched, so its remaining deviations are still the
ones already listed: the `{ id }` prop in place of Next's `params`, the named export, the four
`demoFetch` calls, and the removed Re-research action (with `Press Re-research.` dropped from the
stalled banner) — that last one **came back on 2026-09-23**; see "The research UI comes back" at
the end of this file.

#### Verification

`npx tsc --noEmit`, `npx vitest run` (18 files, 226 tests) and `npm run build` are all clean. No
vitest test asserted the call panel's absence or a single-column grid, so none needed changing.
`scripts/regression/demos_e2e.py` is **not** run at this point: the stage's next task reworks it,
and until `fake_backend.py` learns `/demo/session` the test-call checks cannot pass.

### The orb (2026-09-23)

The TecAce voice-orb kit, applied the way the promo applies it. The kit ships a `voice-agent-orb.js`
web component, a `preview.html` and a GIF/WebP; **none of them are used**, here or in the promo. What
is used is the film, and the promo's React component that plays it.

Ported (`"use client"` removed, no other edit): `components/call/VoiceOrb.tsx`. Its `@/lib/…`
specifiers are unchanged — `@/` is `src/demos/`, so they resolve as they do in the promo. The
playback logic, the reduced-motion early return, the `pointerdown` autoplay fallback and the
`RATE_STEP` throttle are all verbatim.

**Source commit.** `a4ee3b4` ("Make the orb the TecAce ribbon, and the ribbon the logo"), not the
`f482848` at the top of this file — the same reason `hooks/useLiveCall.ts` came from `cf5473b`.

**`lib/voice-level.ts` needed the rest of itself.** `a4ee3b4` added `OrbMode`, `orbMode()`, the
`PLAYBACK` table and `orbPlaybackRate()` to that file, and `VoiceOrb` imports two of them, so the
port was incomplete without them. Appended verbatim from the promo (no strictness fix needed; the
existing `levelFromSamples` non-null assertions are untouched). `tests/promo/voice-level.test.ts`
was re-taken from the promo at the same commit, with this repo's usual `"../lib/` →
`"../../src/demos/lib/` rewrite — the same 13 tests as before plus the 6 the commit added for
`orbMode`/`orbPlaybackRate`, so vitest goes from 226 to 232.

#### Assets

`public/` is new (this app had none). Two files, both served at the root by Vite, so the
component's `/voice-orb.mp4` and `/voice-orb.png` work with no edit:

- `public/voice-orb.mp4` — the kit's `tecace-hero.mp4`, byte-identical to the promo's
  `public/voice-orb.mp4` (md5 `7ccc8123e52aa7e3d392f50ba43cfcca`).
- `public/voice-orb.png` — **the promo's poster, not the kit's `voice-agent-poster.png`.** It is the
  still the source pairs with this film, and at 55 KB it is a third of the kit's 171 KB. The poster
  is the one asset fetched on every page load (see "What it costs" below), so the smaller of two
  correct files wins.

`vercel.json` rewrites `/(.*)` to `/index.html`, which does not shadow these: Vercel checks the
filesystem before applying `rewrites`.

#### Where it is used

**Two places, one of them a deliberate deviation from the promo's admin layout.**

1. `screens/ProspectScreen.tsx`, the "Test call" card: `<VoiceOrb state={call.state}
   meters={call.meters} size={64} />` centred in a `<div className="flex justify-center">` above
   `<CallPanel>`. The promo has no orb on this page — its live orbs are on the public hero and the
   sticky bar. It goes in the screen and not in `CallPanel.tsx` because that file is a verbatim
   port that takes no `meters` prop; keeping the orb one level up leaves it untouched. The card is
   inside `.tw`, so the component's Tailwind classes work with nothing extra.
2. `src/components/Sidebar.tsx`, the brand mark: `<VoiceOrb state="idle" size={28} />` in place of
   `<IconVoicemail size={16} />`, matching the promo's `BrandMark` (`components/public/Logo.tsx`,
   which its own `AppSidebar` renders at 32). `IconVoicemail` is dropped from the icon import — it
   had no other use in that file.

#### The `.tw` island, and the square behind it

The sidebar is **outside** the `.tw` boundary. Utilities live in `@layer utilities { @scope (.tw)
{ … } }`, and inside `@scope` a plain selector is relative to the scope root with an implied
descendant combinator — so `rounded-full`, `object-cover` and `shrink-0` reach descendants of a
`.tw` element and nothing else. The mark therefore wraps the orb in a `.tw` island of its own:

```jsx
<span className="brand-mark brand-mark-orb" aria-hidden="true">
  <span className="tw">
    <VoiceOrb state="idle" size={28} />
  </span>
</span>
```

Measured in Edge against a production build, rather than judged by eye — the video's own computed
style, and the same video moved out of the island as a negative control:

| | in the island | moved out of it |
| --- | --- | --- |
| `border-radius` | `3.35544e+07px` (Tailwind's `rounded-full`) | `0px` |
| `object-fit` | `cover` | `contain` |
| `flex-shrink` | `0` | `1` |
| box | 28 × 28 | 28 × 28 |

So without the island it is a square with the whole 1280-wide frame letterboxed into it (`contain`
is the browser's default for `<video>`, so it letterboxes rather than stretches), and with it the
centre 720 of the frame in a circle. `demos_e2e.py` asserts the first column.

**The `--primary` square is gone under the sidebar's mark.** `.brand-mark` is a 28×28 box with
`border-radius: 8px` and a `--primary` background, drawn as a tile behind a white icon. The orb is
an opaque circle that fills that box, so the tint could only ever show as four blue corners.
`legacy.css` gains a four-line `.brand-mark-orb` modifier (`background: none; color: inherit;
border-radius: 999px`) — the box itself is kept, so the orb occupies the same slot, at the same
size, centred the same way, and `.brand-mark` is unchanged for the login and setup pages, which
still show the icon on the tile. Measured: `.brand-mark` background-color `rgba(0, 0, 0, 0)`,
28 × 28.

#### What it costs, and what happens when autoplay is blocked

- **Reduced motion: nothing plays and the film is never fetched.** The component's effect returns
  before `preload`/`play()` when `(prefers-reduced-motion: reduce)` matches, and the element's own
  attribute is `preload="none"`, so only the 55 KB poster is requested and it stays up as a still.
  Verified in the harness, not assumed: `demos_e2e.py`'s `brand orb (reduce)` check records every
  request the page makes and asserts `/voice-orb.mp4` is not among them while `/voice-orb.png` is,
  with the element `paused` and its `playbackRate` still 1 (untouched). This is also the state
  `compare.py` runs in, which is why the film costs those 44 captures nothing.
- **Motion allowed: it autoplays muted at 0.65×**, the idle rate from `orbPlaybackRate("idle", 0)`.
  Asserted by the `brand orb (no-preference)` check.
- **Autoplay blocked: the poster stays up and the first press starts it.** `video.play()`'s
  rejection is swallowed, so a blocked autoplay is not an error — the still simply remains, and the
  component registers a one-shot `pointerdown` listener on `window`, so the next press anywhere
  (including the press that starts the call) starts the film. Chromium allows muted autoplay, so
  this is the fallback rather than the norm.

#### The harness

- `compare.py`: `'.sidebar-brand .brand-mark'` added to `HIDE`. The brand mark is in the sidebar,
  so it is on **all 44** transcribe captures; left visible, one change would end the "IDENTICAL"
  guarantee wholesale. Hidden in both apps, so the brand row lays out identically on each side and
  the fingerprint skips that subtree. Scoped to the sidebar on purpose: the sign-in page's
  `.brand-mark` still holds the icon in both apps and is still compared. Result: `IDENTICAL`.
- `demos_e2e.py`: four new checks on the orbs themselves (`ORB_JS`, `ORB_CENTRED_JS`) — the Test
  call orb at 64 px, circular, `object-fit: cover`, `aria-hidden`, muted, looping, on
  `/voice-orb.mp4` with the `/voice-orb.png` poster, centred in the card and above the panel; the
  sidebar orb at 28 px with the same utilities applied, inside a `.tw` parent, with no tint behind
  it — plus the two `brand orb (…)` checks above. All pass.
- `tw_probe.py`: untouched, 19 checks, all pass.

### CRM layout: no deviation, and why it can look like one (2026-09-23)

`screens/PipelineScreen.tsx` keeps the promo's `2xl:grid-cols-3` / `2xl:col-span-2` exactly. This
note exists because the Pipeline and Activity cards were reported as stacked where the source shows
them side by side, and the answer is worth writing down so it is not investigated twice.

**The markup is identical and behaves identically.** `2xl` is a *viewport* media query, so at any
given window width this page splits or stacks exactly as the promo's does. Measured: 1440px → one
track, 1536px → three. Screenshots taken at 1440px are below the threshold, which is what made it
look like a porting difference.

**What is genuinely different is the room, not the code.** This dashboard has a permanent ~232px
sidebar the promo's layout was not tuned against, so the same threshold buys ~232px less content
width here.

**Two fixes were tried and both rejected**, on the user's instruction that parity with the source
matters more than the split:

- `2xl` → `xl` reproduces exactly the bug the promo's own comment above that line warns about — at
  two thirds of a 1440px window the board is narrower than its `min-w-[52rem]`, so Won and Lost go
  behind the `overflow-x-auto`. Confirmed by measurement (`scrollWidth > clientWidth`), not by eye.
- A 3:1 split at `min-[1440px]` does work — the board clears its minimum at ~870px and the feed
  still reads at ~278px — but it is a real deviation from the source's proportions.

**If the split is ever wanted at ordinary widths**, the second option is the one that works, and it
is three class names. It was removed, not lost.

---

## Syncing the promo's 2026-09-23 update — `lib/analytics.ts` and `lib/call-limits.ts`

**Source commit.** `90869c6` ("Let the admin add demo time to a prospect from a menu"), not the
`f482848` at the top of this file — the same arrangement as `hooks/useLiveCall.ts` (`cf5473b`) and
`components/call/VoiceOrb.tsx` (`a4ee3b4`). Only the files named here came from it.

### `lib/analytics.ts` — re-copied at `90869c6`

Re-taken whole from the promo's `lib/analytics.ts` and still **byte-identical to it** (`diff` is
empty): this file never needed a porting edit, because it imports only `./types`, which resolves
here the same way it does in the promo, and it indexes nothing `noUncheckedIndexedAccess` objects
to. The re-copy brings across the two exports `90869c6` added at the end of the file:

- `DEMO_TIME_STEPS` — `[10, 30, 60] as const`, the minute steps the admin's "Add time" menu offers.
  `components/admin/AddDemoTimeMenu.tsx` imports it from here (a later task).
- `extendDemoMinutes(current, add, fallback)` — the new total, or `null` when `add` is not a
  positive finite number. It is the *server's* rule; it lives here because the promo put it here,
  and `transcribe-backend/src/demo/analytics.ts` has the same copy, which is what the customer
  PATCH will call.

`tests/promo/analytics.test.ts` gained the promo's two new cases for it (`describe("extendDemoMinutes")`,
13 lines at the end of the file) plus the `extendDemoMinutes` name in the import block. Both were
taken verbatim; the file's existing deviations are untouched — the `"../lib/` →
`"../../src/demos/lib/` rewrite, the `!` strictness fixes listed near the top of this file, and the
removed `parseLiveMember` import and `describe("the live session index")` block, which is why the
new block sits where that one used to.

### `lib/call-limits.ts` — new at `90869c6`

A **byte-for-byte copy** of the promo's `lib/call-limits.ts` (`diff` is empty; the promo's file
keeps its kebab-case name here, as every other file under `src/demos/lib/` does). It needed no
edit of any kind: it imports nothing, reads no `process.env`/`import.meta.env`, calls no `fetch`
and indexes no array, so none of this repo's three usual rewrites applies.

It holds `CALL_MAX_SEC` (10 minutes), `WRAP_UP_LEAD_SEC`, `IDLE_END_SEC`, `IDLE_CHECK_SEC`,
`AGENT_QUIET_SEC`, the `CallEnd`/`CallActivity` types, `callLimitSec`, `callEnd`, `shouldWrapUp`,
`shouldCheckIn` and the two instruction strings — the rules that end a call nobody hung up on.

**Nothing imports it yet.** `hooks/useLiveCall.ts` is what will (a later task); the module is here
first so the hook's change is a plain merge. The backend has its own copy at
`transcribe-backend/src/demo/callLimits.ts` (camelCase, that directory's convention), covered by its
`parity.test.ts`; the two files are the same file.

`tests/promo/call-limits.test.ts` is the promo's `tests/call-limits.test.ts`, all 81 lines, with the
one rewrite every test in this folder gets: `from "../lib/call-limits"` →
`from "../../src/demos/lib/call-limits"`. No strictness fix was needed — it indexes nothing. 11
tests across four `describe`s.

### `hooks/useLiveCall.ts` — merged at `90869c6`

**Source commit.** `90869c6`, up from the `cf5473b` this file was re-ported at. The change brought
across is promo `cbb0887` ("End the call on its own when nobody hangs up, and hold it to the demo
time"), +111 lines: the hook now ends a call that nobody hung up on.

**This was a merge, not a re-copy**, because our copy already carries three deliberate deviations
(all recorded above) that a re-copy would have destroyed. Method: `git merge-file --diff3` with
promo `cf5473b` as the base, our file as *ours* and promo `90869c6` as *theirs*. It produced exactly
**one conflict**, and only because both sides append to the same block of `useRef` declarations
after `greetTimerRef`:

- theirs: `limitSecRef`, `lastCallerAtRef`, `lastAgentAtRef`, `wrappedUpRef`, `checkedInRef`,
  `endingRef`, `endReasonRef`;
- ours: `aliveRef`.

Both are pure additions with no overlap, so both were kept, with the promo's seven first (in the
promo's own order and position) and `aliveRef` after them. Putting `aliveRef` last, rather than back
where it used to sit, keeps the promo's block contiguous and unmoved, so the next sync's diff stays
small. Nothing else conflicted: the promo's `callLimitSec(data.maxSec)` line lands after
`callIdRef.current = data.callId ?? null`, which is below our unmount check, and the promo's rewrite
of `hangup` into `closeCall("hangup")` touched lines we had never edited.

**What came across, in full** (verified present and reachable, and every identifier's occurrence
count in our file equals the promo's): the `@/lib/call-limits` import block, `limitSecRef` seeded
from `callLimitSec()` and re-seeded from `callLimitSec(data.maxSec)` once the session answers, the
new `maxSec?: number` field on the `readJson` type, `closeCall(reason)`, the per-second tick's
`callEnd` / `shouldWrapUp` / `shouldCheckIn` branches with their `session.instructions.append` sends
of `WRAP_UP_INSTRUCTION` and `CHECK_IN_INSTRUCTION`, the caller/agent activity timestamps
(`lastCallerAtRef`, `lastAgentAtRef`, `checkedInRef` reset when the caller speaks again),
`endReasonRef` winning over OpenAI's own `session.closed` reason, and the new `endedBy: CallEnd | null`
on `UseLiveCall`, cleared by `dial` and `reset`.

**`POST /demo/session` supplies `maxSec`.** `transcribe-backend/src/routes/demo.ts:842` answers
`maxSec: CALL_MAX_SEC` unconditionally, because every call reachable through that admin-guarded
route is an operator's test call and those skip the prospect's demo-minute allowance. So
`callLimitSec(data.maxSec)` here always resolves to the same ten minutes `callLimitSec()` seeds —
the wiring is the promo's, the value is simply never shortened on this side.

**The three deviations survive, and they are the only differences left.** `diff` against the promo's
`hooks/useLiveCall.ts` at `90869c6` shows these hunks and nothing else:

1. `"use client"` removed and `import { demoFetch } from "@/api";` added as the first import (the
   port-wide directive rule, plus this file's `promoFetch`→`demoFetch` move).
2. The unload report: `report`'s third parameter `beacon = false` and the whole
   `navigator.sendBeacon` branch are gone, `` const url = `/api/calls/${callId}` `` is
   `` `/calls/${callId}` ``, the request is `demoFetch(url, { …, keepalive: true })`, and
   `onLeave`'s call is `report("abandoned", "page_hidden")` without the `true`. Reasoning in
   "The unload report" above — unchanged by this merge. Also `fetch("/api/session", …)` →
   `demoFetch("/session", …)`.
3. The `aliveRef` guards from "Stage 4b review fixes": the ref itself, the three `!aliveRef.current`
   early returns in `dial` (after `getUserMedia`, after `waitForIceGathering`, after the session
   answer — the last one reporting `"abandoned", "unmounted"` if a `callId` came back), `report` in
   `dial`'s dependency list, and the effect setting `aliveRef.current` true in its body and false in
   its cleanup.

**No new deviation was needed.** The promo's change assumes nothing our copy lacks: it touches only
the data channel, timers and refs, never `fetch`, the unload path or anything an unmount guard sits
on.

**Not ported here:** whatever `90869c6` does with `endedBy` in the UI. `components/call/CallPanel.tsx`
is untouched by this task, so the new field is returned and currently unread — additive, so nothing
breaks.

#### Verification

`npx tsc --noEmit` clean, `npx vitest run` 19 files / 245 tests passing, `npm run build` clean (the
only warning is the pre-existing >500 kB chunk notice). `scripts/regression/demos_e2e.py` was **not**
run: a later task in this stage changes what it expects.

### "Add demo time" (Task 6 of the `90869c6` sync)

The rest of promo `90869c6` ("Let the admin add demo time to a prospect from a menu"): the
component, its three call sites, and the `lib/use-cases.ts` change that rode along in the same
commit range.

#### `components/admin/AddDemoTimeMenu.tsx` — new

Copied whole from the promo at `90869c6`. It exports **three** things: `addDemoTime(customerId,
minutes)` (the request plus its success toast), `AddDemoTimeMenu` (the header/Share-tab button,
"Demo time: N min" with a menu of steps) and `AddDemoTimeSubmenu` (the same steps as a submenu, for
the customer list's row menu). Two edits, both this repo's standing rules:

- `"use client"` removed and `import { demoFetch } from "@/api";` added as the first import.
- `` fetch(`/api/admin/customers/${customerId}`, …) `` → `` demoFetch(`/customers/${customerId}`, …) ``
  (`demoFetch`'s own base carries `/demo`, as in the table above). **The body is unchanged:**
  `{ addDemoMinutes: minutes }` — the *step*, never a computed total. The server adds it to what is
  stored, which is what stops a page open since earlier from undoing someone else's top-up;
  `transcribe-backend/src/routes/demo.pg.test.ts` pins that, and sending a total would defeat it.

Every shadcn primitive it uses (`DropdownMenuGroup`, `DropdownMenuLabel`, `DropdownMenuSub`,
`DropdownMenuSubTrigger`, `DropdownMenuSubContent`, plus the ones already in use) is exported by
this app's `components/ui/dropdown-menu.tsx`, so nothing had to be substituted or newly ported. The
submenu portal already carries `container={twPortalContainer()}` from the original port, so the
steps render inside `.tw`.

#### The three call sites

- `screens/ProspectScreen.tsx`: the `addedTime(customer)` handler and
  `<AddDemoTimeMenu customerId={id} demoMinutes={draft.demoMinutes} onAdded={addedTime} />` in the
  header, both verbatim from the promo, including the comment on the handler. It takes **only**
  `demoMinutes` from the answer on purpose: the response is the whole stored record, and writing all
  of it into the draft would clobber whatever the operator has typed but not yet saved. It sits
  where the promo puts it, after the Live switch — at the time, the Re-research button the promo
  has between it and Save was this app's long-standing removal, not a new deviation; it was put
  back later the same day, into exactly that slot, so the header is now the promo's own order.
  `SharePanel` gets `onAddedTime={addedTime}`, the same handler.
- `components/admin/SharePanel.tsx`: the new `onAddedTime` prop, the menu beside the Demo minutes
  input, and the promo's **reworded** paragraph — "Demo time adds minutes and saves straight away;
  the number field sets the total and waits for Save." in place of "Raise the number here to let
  them carry on." The file's only remaining difference from the promo is the removed directive.
- `components/admin/CustomerTable.tsx`: `<AddDemoTimeSubmenu customerId={customer.id}
  onAdded={onChanged} />` in the row menu, above the separator, plus the import. Its other
  differences are the ones already listed for it (`demoFetch`, `demoHref`/`next/link`).

#### `lib/use-cases.ts` — re-copied, and **dead here**

Re-taken whole from the promo at `90869c6` and **byte-identical to it** (`diff` is empty; it needed
no porting edit, then or now). The change it brings across is promo `d525196` ("Fix five things the
generated prompts got wrong"): a new exported `categoryMentions(category, keyword)` that matches a
keyword as a whole word — plural allowed, a trailing `*` making it a stem — and `businessNouns`
switched from `haystack.includes(keyword)` to it, with the bucket keyword lists reworked to suit.
Substring matching had made a barber shop a *bar* (with a table to book) and a coworking space a
*spa*.

**Almost nothing we render uses any of it.** In this app `lib/use-cases.ts` is imported only by
`lib/prompt.ts` — which *is* ported, but of which only `spokenGreeting` is reached, from
`hooks/useLiveCall.ts`. (The sentence here used to say `lib/prompt.ts` was not ported at all; that
was wrong when it was written and is listed as such in the `2026-09-23` section at the end of this
file.) So `businessNouns`, `buildUseCases` and `categoryMentions` are still exercised only by
`tests/promo/use-cases.test.ts` and, indirectly, by `tests/promo/prompt.test.ts`. The module is
copied whole so the next sync of it stays a plain diff rather than a three-way merge — not because
a screen needs it.

`tests/promo/use-cases.test.ts` gained the promo's two new cases ("matches whole words, not the
middle of one", "still reads stems and plurals"), taken verbatim and placed where the promo puts
them. The file's two existing deviations are untouched: the `"../lib/` → `"../../src/demos/lib/`
rewrite and the `!` on `cases[0]`/`cases[1]` listed near the top of this file.

#### Verification

`npx tsc --noEmit` clean, `npx vitest run` 19 files / **247** tests passing (245 + the two new
use-cases cases), `npm run build` clean (the only warning is the pre-existing >500 kB chunk notice).
`scripts/regression/demos_e2e.py` was **not** run: the next task in this stage reworks it, and it
cannot pass until then.


### `lib/prompt.ts` re-copied at `90869c6` (2026-09-23)

`src/demos/lib/prompt.ts` had drifted **213 diff lines** behind the promo's: it was still the copy
taken at `f482848`, so it had none of `483f4c8` (the restructure along the GPT-Live prompting
guide: `# Role and objective`, `# Personality and tone`, `# Language`, `# Backchannel policy`,
`# Interruption policy`, `# Unclear audio`, `# Delegation policy`, `# Honesty and escalation`,
`# What you know without checking`, plus `safetyLines`, `faqLines`, `backendProfile` and
`categoryMentions`), none of `d525196`'s five fixes, and none of `d3d4b07`'s register change. It is
now the promo's file at `90869c6`, re-taken whole.

Three edits, all this repo's standing strictness rule and all listed in the per-file table near the
top of this file: `!` on `prompt.ts:54`, `:58` and `:289`. **Nothing else differs** — `diff`
against the promo's `lib/prompt.ts` reports exactly those three lines. The file has no
`"use client"` to remove, its four imports are all relative and stay extensionless (this app
resolves with `moduleResolution: "bundler"`), and it reads no `process.env`.

`PROMPT_VERSION` came across with it and is now **6**, matching `transcribe-backend`'s copy, which
matters: the backend's `normalize()` rebuilds any unedited prompt behind that number, so a mismatch
would have had the two sides disagreeing about whether a stored prompt was current.

The one thing this app actually calls is still `spokenGreeting`, from `hooks/useLiveCall.ts`, and
its contract is unchanged (the quoted line, falling back to the whole text). The greeting the
backend hands the browser is built server-side, so this copy is the shared source of truth rather
than a second implementation.

#### Its three dependencies

`lib/hours.ts`, `lib/use-cases.ts` and `lib/languages.ts` were checked against the promo at
`90869c6` and are **already byte-identical to it** — `diff` is empty for all three, and none needed
a porting edit. Nothing was re-copied for them.

#### `tests/promo/prompt.test.ts`

Re-taken whole from the promo's `tests/prompt.test.ts` at `90869c6`, which restores the four
`describe` blocks this folder's stale copy had deleted along with the old prompt shape — "the
guide's policies", "register", "safetyLines", "city", "withArticle" and "backendProfile" — and
puts the two surviving assertions back on the promo's wording (`"\n\n# Personality and tone\n"`
rather than `"\n\nHow to speak:"`, and the opening sentence on line **1** rather than line 0, the
prompt now opening with a `# Role and objective` heading). Its only deviation is this folder's
standing one: the promo's `"../lib/prompt"` and `"../lib/types"` become
`"../../src/demos/lib/prompt"` and `"../../src/demos/lib/types"`. The import stays the promo's
multi-line block, because it now names seven exports rather than four.

#### `tests/promo/languages.test.ts`

One line, `:67`: `expect(korean.live).toContain("How to speak:")` → `toContain("# Personality and
tone")`, which is the promo's own line at `90869c6`. It had been left behind by the same drift —
the assertion was about `prompt.ts`'s output, not about languages — and it is the only difference
between this file and the promo's besides the import rewrite.

#### Verification

`npx tsc --noEmit` clean, `npx vitest run` 19 files / **265** tests passing (247 + the 18 cases the
re-taken `prompt.test.ts` restores), `npm run build` clean (the only warning is the pre-existing
>500 kB chunk notice). `scripts/regression/demos_e2e.py` was **not** run: a later task owns it.

### The research UI comes back (2026-09-23)

transcribe-backend now carries the research pipeline (the promo's `lib/research.ts`, `maps.ts` and
the OpenAI branch of `research-runner.ts`) and serves `POST /demo/customers/:id/research` with the
promo's status codes and error strings, while `POST /demo/customers` answers at
`status: "researching"` and runs the research in the background. Gap C in
`docs/superpowers/specs/2026-09-23-source-parity-audit.md` is therefore closed on the front end
too: **every piece removed in "The two actions that could not move" and its "Deviations" list is
restored from the promo at `90869c6`.** The three entries above are corrected in place rather than
contradicted here.

#### `components/admin/ResearchInputsPanel.tsx` — re-taken whole

The promo's file at `90869c6`, copied over the trimmed one, with this repo's one standing edit:
`"use client"` removed. `diff` against the promo is that hunk and nothing else. Back with it: the
`RefreshCw` and `Button` imports, the `onResearch` / `researching` props on `Props`, the four-name
destructure, and the closing

    <Button variant="outline" onClick={onResearch} disabled={researching}>
      <RefreshCw className="size-4" />
      {researching ? "Researching" : "Run research again"}
    </Button>

#### `screens/ProspectScreen.tsx` — the five pieces, put back where the promo has them

All copied from the promo at `90869c6`, in the promo's own positions:

- `import { RefreshCw } from "lucide-react";` after the `react` import;
- `const [researching, setResearching] = useState(false);` after `loadError`;
- the `research(regeneratePrompts: boolean)` handler after `save()`, verbatim but for its request
  line: `` fetch(`/api/admin/customers/${id}/research`, …) `` → ``
  demoFetch(`/customers/${id}/research`, …) `` — the same rewrite every other call in this file's
  table got, and **the body is unchanged** (`regeneratePrompts` plus the four draft inputs);
- the header `Button` between the Add-time menu and Save;
- `onResearch={() => research(false)}` / `researching={researching}` on `<ResearchInputsPanel>`;
- and `Press Re-research.` restored to the end of the stalled banner's sentence.

`diff` against the promo's `app/admin/(dashboard)/customers/[id]/page.tsx` at `90869c6` now reports
only this file's four known deviations: the removed directive plus the `demoFetch` import, the
`{ id }` prop and named export in place of Next's `params`, the four `demoFetch` call sites, and
the `VoiceOrb` in the Test call card.

#### `NewCustomerDialog`, `ProspectsScreen` and `CustomerTable` — fine all along

Checked rather than assumed: `diff` against the promo at `90869c6` shows each of these three has
**only** its already-recorded port edits (the directive, `demoFetch`, `demoHref`/`next/link`, the
named export). Nothing was ever taken out of them for the missing pipeline, so nothing had to go
back:

- `NewCustomerDialog` toasts "Customer added. Research is running." and calls `onCreated`, which is
  `ProspectsScreen`'s `load`. That sentence is now true rather than aspirational: the create really
  does answer `status: "researching"`.
- `ProspectsScreen` polls `/customers` every 5 s **only** while some record is `researching` and
  not stalled, and stops when none is — so a finished run reconciles the table on its own, and a
  stalled record never spins the poll forever.
- `CustomerTable` renders `isResearchStalled(customer)` as a **"Stalled"** badge (15 minutes, from
  `lib/analytics.ts` `RESEARCH_STALL_MS`) in place of "Researching", and `ProspectScreen`'s header
  badge does the same with the `negative` kind.

`lib/analytics.ts` — which both read `isResearchStalled` from — is byte-identical to the promo's.

#### The harness

- `fake_backend.py`: new `demo_research_route()` behind `POST /demo/customers/<id>/research`, and a
  `researched()` helper that writes the record a finished run leaves (`db/demoWrite.ts`
  `startResearch` then `saveResearch`: the four inputs, a real profile / dossier / sources, prompts
  rebuilt unless they were hand-edited and no rebuild was asked for, `status: "ready"`,
  `researchedAt`). The body is optional **as a whole**, as `t.Optional(t.Object(…))` makes it, so
  an absent one means "re-research with what is stored" rather than a 400; no business name at all
  is the route's 400. **A run is staged to fail** through `RESEARCH_FAIL_MARKER` in the research
  notes, which answers the route's 502 with `RESEARCH_FAILURE`
  (`"OPENAI_API_KEY is not set on the server."`, the message a deployment with no key gets). The
  marker lives in a field the operator already types into, so staging a failure is the product's
  own flow rather than a control endpoint, and the fake stays stateless. `POST /demo/customers`
  already answered `status: "researching"` (`new_customer()`) and needed no change; the route
  comment block now says so, and documents the research route.
- `demos_e2e.py`: a new `STATUS_BADGE_JS` (the prospect header's badge, found through the `<h1>`),
  one added assertion on the create — the `POST /demo/customers` **response** carries
  `status: "researching"` — and a research block walked on **Cedar Bakery**, the prospect the
  fixtures leave mid-research. It checks the badge reading "Researching" beside an enabled
  **Re-research**; the button POSTing the promo's exact body to `/demo/customers/cedar42/research`,
  toasting "Research finished." and landing the researched record on screen (badge "Ready", the new
  address) with no reload; **ResearchInputsPanel's run button** on the Sources tab under the
  dossier the run wrote, sending the inputs as edited; and a failed run showing the backend's
  message and re-reading the record. It is placed last on the prospect page on purpose: a finished
  run replaces the draft, and every check above it reads a prospect as the fixtures leave it.
  **Nothing was deleted**: the harness never asserted that research was absent, so there was no
  check that only made sense while it was. (Grep of `demos_e2e.py` for `research`/`Research` before
  this task: four hits, all of them the "Researching" row, the create toast, and the Sources tab's
  markdown — every one still wanted.)
- `scripts/regression/README.md`: the two new bullets describing the above.
- `compare.py` and `tw_probe.py`: untouched, and unaffected — no transcribe capture and no probe
  reaches the Demo section.

#### Outside `src/demos/`

- `README.md`: the sentence naming Re-research and the test call as gone is replaced — both are
  served by transcribe-backend now, and a research run is called out as a real, billable model call
  gated by the same `OPENAI_API_KEY` as the test call. (It was already wrong about the test call,
  which came back earlier the same day.)
- `CLAUDE.md` still names both removals in its "The Demos section" block. Left alone, as every
  earlier entry in this file has left it: it is the user's to change.

#### Verification

`npx tsc --noEmit` clean, `npx vitest run` 19 files / **265** tests passing (unchanged — no ported
test covers these components), `npm run build` clean (the only warning is the pre-existing >500 kB
chunk notice). All three harness scripts run: `compare.py` **IDENTICAL** (44 captures),
`tw_probe.py` **19/19**, `demos_e2e.py` **all checks pass**, including the nine new ones. No test
makes a model call — the fake answers the research route as it answers the session route.

---

## The prospect-facing pages (`/c/<id>`)

The demo page, its scenarios page and its pricing page were the last part of the promo that had not
been ported: they stayed on the promo, and this app linked to them through
`VITE_PUBLIC_DEMO_BASE_URL`. Unset in the deployed build, that fell back to this app's own origin, so
the Share tab's link and Open button opened the dashboard and landed on Overview. The variable is
gone and the pages are served here.

They are a **second entry document**, not a view: `c.html` → `src/public/main.tsx` →
`src/public/PublicApp.tsx`. That shape is what keeps the page unreachable from the Demos tabs (no
`ViewId`, no `PATHS` entry, no sidebar item) and keeps the admin bundle out of a prospect's browser.

### Copied verbatim

- `components/public/`: `BusinessKnowledge`, `ContactButtons`, `GoLive`, `Hero`, `HowItWorks`,
  `illustrations`, `LanguageNote`, `Logo`, `MissedCalls`, `PlanEstimator`, `Pricing`, `PromptView`,
  `ScenarioList`, `ScenarioTeaser`, `StickyCall` (`Exchange` and `SchedulePanel` were already here).
  `HowItWorks`, `MissedCalls` and `GoLive` are parked out of the page in the promo too — copied so a
  sync stays a plain diff.
- `hooks/useInView.ts`, `components/VersionBadge.tsx`, `lib/pricing.ts`.
- `public/tecace-logo.png`.

### Edited

- **`"use client"`** dropped from every copied file (`BusinessKnowledge`, `Hero`, `PlanEstimator`,
  `PromptView`, `StickyCall`, `useInView`) — a Next directive with no meaning here.
- **`next/image` → `<img>`** in `Logo.tsx`: same `src`, same intrinsic `width`/`height` (so the
  layout does not jump), `priority` → `loading="eager"`. Next's optimiser is what is gone.
- **`next/link` → `<a href>`** in `ScenarioTeaser.tsx` and `Pricing.tsx`. Unlike the admin ports,
  these are NOT `demoHref(…)`: `/c/<id>` is a real document this app serves, so the href is the path.
- **`VersionBadge`**: `process.env.NEXT_PUBLIC_APP_VERSION` → `import.meta.env.VITE_APP_VERSION`,
  same `"v0"` default. Nothing sets it; the badge is for telling two deploys apart while a demo is
  being worked on, which is not worth a required build variable.
- **`lib/links.ts`**: `pricingHref()` and `pricingMailto()` restored from the promo, and
  `PRICING_URL` back to its `""` default — meaning "use our own pricing page", which now exists. It
  had been pointed at the contact form while there was no page to link to.
- **`lib/share.ts`**: `baseUrl()` no longer reads a variable. It is `window.location.origin`, which
  is correct by construction now that this origin serves the page.
- **`Pricing.tsx`**: `const [solo, standard] = PLANS;` gains `if (!solo || !standard) return [];`
  for `noUncheckedIndexedAccess`. Behaviour identical — PLANS has three literal entries.
- **`hooks/useLiveCall.ts`**: `options` is now required and carries `api`, the fetcher to dial
  through (`demoFetch` from the admin panel, `publicFetch` from the public page). The promo had one
  route for both and told them apart by a body flag plus an admin cookie; here they are two routes,
  so the caller says which door it is at. Passing it in rather than choosing here is what keeps
  `api.ts` — and through it the session token — out of the public bundle. `isTest` still travels in
  the session body, where the admin route reads it as the promo's did and the public route has no
  such field. A public dial also sends `visitorId`.

### New (this app's own, not ported)

- `src/public/{main.tsx,PublicApp.tsx}`: the entry, the path router (`parsePath`), the one read that
  loads a demo, the promo's `not-found.tsx` inline as `NotAvailable`, and the `.tw` boundary —
  `DemosGate`'s job for the admin side, plus `bg-background` because this is a whole page rather
  than a card on the dashboard's canvas.
- `src/demos/publicApi.ts`: `publicFetch`, in its own module so importing it does not drag
  `api/backend.ts` in.
- `src/demos/lib/visitor.ts`: the promo minted its `va_vid` in `middleware.ts` and read the cookie
  server-side. There is no middleware here, so the browser mints it into `localStorage` under the
  same name. Every path tolerates storage refusing — a demo must not fail to open over an
  analytics id.
- `src/demos/screens/Public{Demo,Scenarios,Pricing}Screen.tsx`: `app/c/[id]/demo-call.tsx` renamed,
  and the two server components turned into components that take what they render. The loading and
  the "not available" case moved to the entry, which does it once for all three.
- `PublicDemoScreen`'s two fetches: `POST /api/track` → `publicFetch("/track", …)` with the visitor
  id in the body, and `GET /api/customers/:id/public` → `publicFetch("/customers/:id")`, reading the
  allowance out of `{ customer: { demo } }` — the promo had a route of its own that answered
  `{ demo }`.
- `tests/public-entry.test.ts` (8 tests): the import graph never reaches the dashboard's auth, both
  Vite inputs are named, `/c/*` is rewritten before the catch-all, the page is not a `ViewId`, no
  code reads a demo base URL again, and `parsePath` accepts the three pages and refuses an id that
  would not be safe in an API path.

### Outside this app

- `transcribe-backend`: `routes/demoPublic.ts` — `GET /demo/public/customers/:id` (the prospect-safe
  field list, `publicView`), `POST /demo/public/track`, `POST /demo/public/session` and
  `POST /demo/public/calls/:callId`, none behind the admin guard. The session route is the promo's
  `app/api/session/route.ts` along the path it took when `isTest` was false, so the three ceilings an
  earlier stage left out are back: the demo allowance, the per-prospect concurrency reservation and
  the global live-session seat. The promo's Redis live-set (`markLive`/`listLiveSessions`) is gone —
  `demoRead.listLiveSessions()` asks the table, so there is nothing to write, expire or disagree
  with the rows. `routes/demoCommon.ts` holds what both route files share (the dial rate limiter, as
  ONE map; `jsonError`; and `applyCallReport`, so a transcript is capped and validated by one
  implementation). `startCall` takes `isTest` as a required argument and an optional `visitorId`.
  Tests: `routes/demoPublicView.test.ts` (6) pins the public field list, and
  `routes/demoCall.pg.test.ts` gains 9 for the public routes — 283 passing in all.
- `vercel.json`, `vite.config.ts`, `.env.example`, `README.md`, `CLAUDE.md`,
  `scripts/regression/demos_e2e.py` and `scripts/regression/README.md`: the second entry, the
  rewrite, and the removal of the base-URL variable. The harness now expects a demo link to be its
  own server's origin.

#### Verification

`npx tsc --noEmit` clean, `npx vitest run` **273** tests passing (265 + 8 new), `npm run build`
clean and emitting both documents. The built `c.html` loads no chunk containing the session token's
storage key; `index.html`'s does.
