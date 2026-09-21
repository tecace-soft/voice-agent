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
- `lib/prompt.ts:37`: `segments[segments.length - 2]` → `...]!` (guarded by `segments.length >= 2` on the same line, so the index is always valid). (strictness)
- `lib/prompt.ts:144`: `quoted[1].trim()` → `quoted[1]!.trim()` (capture group 1 is non-optional in `/"([^"]{4,})"/`, so it is always present when `quoted` is truthy). (strictness)
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

### Overview + Prospects screens (Task 5)

Copied (LF, `"use client"` removed): `components/admin/{shared,CustomerTable,NewCustomerDialog}.tsx`, `components/charts/{CallsPerDayChart,TopCustomersChart}.tsx`; `app/admin/(dashboard)/page.tsx` → `screens/OverviewScreen.tsx`; `app/admin/(dashboard)/customers/page.tsx` → `screens/ProspectsScreen.tsx`. `shared.tsx` has no edits beyond the directive.

- `components/admin/CustomerTable.tsx`: new first import `import { promoFetch } from "@/api"`; `:163` `fetch(`/api/admin/customers/${customer.id}`, { method: "PATCH", … })` and `:176` `fetch(`/api/admin/customers/${customer.id}`, { method: "DELETE" })` → `promoFetch(…)` (same arguments). (fetch)
- `components/admin/CustomerTable.tsx`: `import Link from "next/link"` removed; `import { demoHref } from "@/routes"` added after the `@/lib/types` import; `:300` `<Link href={`/admin/customers/${customer.id}`} className="hover:underline">…</Link>` → `<a href={demoHref("demoProspect", customer.id)} className="hover:underline">…</a>`; `:381` `render={<Link href={`/admin/customers/${customer.id}`} />}` → `render={<a href={demoHref("demoProspect", customer.id)} />}`. (next/link)
- `components/admin/NewCustomerDialog.tsx`: new first import `import { promoFetch } from "@/api"`; `:45` `fetch("/api/admin/customers", { method: "POST", … })` → `promoFetch(…)`. (fetch)
- `components/charts/CallsPerDayChart.tsx`, `components/charts/TopCustomersChart.tsx`: `import { useTheme } from "next-themes"` → `import { useDocumentTheme } from "@/theme"`; `const { resolvedTheme } = useTheme()` → `const resolvedTheme = useDocumentTheme()` (the `[resolvedTheme]` effect dependency and `key={resolvedTheme}` are unchanged). (theme)
- `screens/OverviewScreen.tsx`: new first import `import { promoFetch } from "@/api"`; `:73` `fetch(
  `/api/admin/analytics?days=…`, …)` → `promoFetch(…)`. `import Link from "next/link"` removed; `import { demoHref } from "@/routes"` added after the `@/lib/http` import; `:223` `<Link href={`/admin/customers/${call.customerId}`} …>` → `<a href={demoHref("demoProspect", call.customerId)} …>`. `export default function OverviewPage()` → `export function OverviewScreen()` (named export, app convention). (fetch, next/link, naming)
- `screens/ProspectsScreen.tsx`: new first import `import { promoFetch } from "@/api"`; `:20` `fetch("/api/admin/customers", { cache: "no-store" })` → `promoFetch(…)`. `export default function CustomersPage()` → `export function ProspectsScreen()`; `PageHeader` `title="Customers"` → `title="Prospects"` (matches the sidebar; subtitle and all other wording unchanged). (fetch, naming)

No `tsc` strictness fixes were needed for these 7 files (`npx tsc --noEmit` clean).

Legacy class-name scan (literal `className`s in `components/` + `screens/`): hits `sr-only` (`ui/dialog.tsx` — harmless, Tailwind's rule is a superset) and `grid` (`NewCustomerDialog.tsx`, `OverviewScreen.tsx`). `grid` is a false positive: `legacy.css` only defines `.areachart .grid` and `.barchart .grid` (descendant selectors setting SVG `stroke`/`stroke-width`), which cannot match promo markup (never inside `.areachart`/`.barchart`), so Tailwind's `grid` is kept, not renamed.

### Review fixes (Task 7)

- `lib/chart-theme.ts` `readChartTheme()`: the `getPropertyValue` reads `--chart-${i + 1}` → `--ui-chart-${i + 1}`, `--foreground` → `--ui-foreground`, `--muted-foreground` → `--ui-muted-foreground`, `--card` → `--ui-card`, `--border` → `--ui-border`, `--success` → `--ui-success`, `--destructive` → `--ui-destructive`, `--font-sans` → `--ui-font-sans`. The bare names read the *transcribe* variables on `<html>` or nothing at all (dark `--chart-1` is the 3-digit `#59f`, so the charts' `${color}1F` alpha suffix made an invalid colour and the fill/bars painted black; axis labels fell back to black). The `--ui-*` tokens are the promo theme's own, defined unlayered on `:root`/`.dark`. `CHART_SERIES`' comment (`--chart-1 .. --chart-7`) left verbatim. (raw vars, JS)

- `components/charts/CallsPerDayChart.tsx`, `TopCustomersChart.tsx`: `useEffect(() => applyChartDefaults(), [resolvedTheme])` -> `applyChartDefaults()` called during render; the now-unused `useEffect` import dropped. Fixes a bug that is also in the promo: the child `<Line>`/`<Bar>` effect built the chart before the parent's effect updated Chart.js defaults, so after a theme toggle the axis labels drew in the previous theme's colours. Found in the stage-4a re-review. (bug fix, upstream too)

## Tests

Copied verbatim from `PROMO/tests/` into `tests/promo/`, with `"../lib/` rewritten to `"../../src/demos/lib/`:
`ambience.test.ts`, `analytics.test.ts`, `call-audio.test.ts`, `crm-feed.test.ts`, `integrations.test.ts`, `languages.test.ts`, `prompt.test.ts`, `proof.test.ts`, `schedule.test.ts`, `scroll.test.ts`, `transcript.test.ts`, `use-cases.test.ts`, `voice-level.test.ts` (13 files, 194 tests, all passing).

Skipped (test server-only libs not ported, or out of scope for this stage):
`kv.test.ts`, `maps.test.ts`, `research.test.ts`, `call-review.test.ts`, `crm.test.ts`, `store-migration.test.ts` — test server-only libs (`kv`, `maps`, `research*`, `call-review`, `crm`, `store`) that were not copied.
`public-view.test.ts` — belongs to stage 5.

In `tests/promo/analytics.test.ts`, removed `import { parseLiveMember } from "../../src/demos/lib/calls";` and the trailing `describe("the live session index", () => { … });` block (3 tests), since it exercises `lib/calls`, a server-only library not ported in this task.
