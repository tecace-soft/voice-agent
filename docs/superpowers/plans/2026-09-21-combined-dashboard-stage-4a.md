# Combined dashboard — stage 4a (promo foundation + Overview + Prospects) implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the stage-3 Demos placeholders for *Demo overview* and *Prospects* with the promo app's real screens (KPIs, charts, recent calls; the prospects table with search/filter/sort, pause/delete, copy link, and the "New customer" dialog), ported near-verbatim — and put in place the foundation stages 4b (prospect detail + test call) and 4c (pipeline) build on.

**Architecture:** Promo source files are copied **verbatim** from `voiceagent_promo @ f482848` into `src/demos/`, mirroring the promo's own layout (`components/ui`, `components/admin`, `components/charts`, `lib`, and the two pages as `screens/`), with the import alias `@/` → `src/demos/` so not one promo import needs rewriting. Only a short, fixed list of edits is applied, each recorded in `src/demos/PORTING.md`: `fetch("/api/…")` → `promoFetch("/api/…")` (same Response, routed through `/promo-api` and reporting 401s to the unlock gate); `next/link` → `<a href={demoHref(…)}>`; `next-themes` → `useDocumentTheme()`; `process.env.NEXT_PUBLIC_*` → `import.meta.env.VITE_*`; portals render into a `.tw` container; raw `var(--x)` → `var(--color-x)`; `"use client"` removed; strictness fixes for this app's stricter tsconfig. Everything renders inside the `.tw` scope (stage 2).

**Tech Stack:** React 19, Vite 8, TypeScript 5 (strict + `noUncheckedIndexedAccess`), Tailwind 4 (scoped), shadcn/ui on `@base-ui/react` 1.8, `cn` (shadcn's clsx+tailwind-merge), `class-variance-authority`, `lucide-react` 1.47, `sonner` 2, `chart.js` 4 + `react-chartjs-2` 5, Vitest 5, Python 3.14 + Playwright (Edge).

**Spec:** `docs/superpowers/specs/2026-09-21-combined-dashboard-design.md` §1, §3 (raw `var()`, legacy class names, portals), §4, stage 4. Stage 4 is split: **4a** (this plan) · **4b** prospect detail tabs + test call · **4c** pipeline — each its own plan.

**Git:** do **not** commit. The user handles all git. Steps end at "files ready for review".

**Conventions:** paths relative to `tecace-voice-agent-dashboard/` (`APP`) unless starting with `docs/`. `PROMO` = `/c/Users/Michael Knutsen/Documents/projects/test_demo/voiceagent_promo` (Git Bash path; quote it). Git Bash on Windows. Line endings don't matter (git `core.autocrlf=true` normalises on commit); don't spend effort converting them. When diffing a ported file against the promo, ignore them (`diff --strip-trailing-cr`). Run the Python scripts one at a time (shared ports 5198/5199/8898/8899). Never `taskkill` by image name.

**Checks available:** `npx vitest run`; `npm run build` (tsc + vite); `python scripts/regression/compare.py` (transcribe screens identical — must stay `IDENTICAL` + `expected changes confirmed: admin:apiKeys:light`); `python scripts/regression/tw_probe.py`; `python scripts/regression/demos_e2e.py` (Demos section vs `fake_promo.py`).

---

## File map

- Create `src/demos/PORTING.md` — source commit + every deviation from the promo source (all tasks append).
- Modify `package.json` (deps), `tsconfig.json`, `vite.config.ts`, `vitest.config.ts` (alias) — Task 1.
- Create `src/demos/lib/*.ts` (20 files) + `tests/promo/*.test.ts` (13 files) — Task 2.
- Modify `src/theme.tsx` (`useDocumentTheme`); create `src/demos/theme.ts`, `src/demos/portal.ts`, `src/demos/routes.ts`; modify `src/demos/api.ts` (`promoFetch`, remove `listProspects`) + `tests/promoApi.test.ts` — Task 3.
- Create `src/demos/components/ui/{badge,button,card,dialog,dropdown-menu,input,label,select,skeleton,sonner,switch,table,textarea}.tsx` — Task 4.
- Create `src/demos/components/admin/{shared,CustomerTable,NewCustomerDialog}.tsx`, `src/demos/components/charts/{CallsPerDayChart,TopCustomersChart}.tsx`, `src/demos/screens/{OverviewScreen,ProspectsScreen}.tsx` — Task 5.
- Modify `src/demos/DemosView.tsx`, `src/demos/DemosGate.tsx`; delete `src/demos/pages/DemoProspectsPage.tsx` — Task 6.
- Modify `scripts/regression/fake_promo.py`, `scripts/regression/demos_e2e.py` — Task 7.
- Modify `CLAUDE.md`, `.env.example`, the spec — Task 8.

---

### Task 1: Dependencies and the `@/` alias

**Files:** Modify `package.json` (via npm), `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`; Create `src/demos/PORTING.md`

- [ ] **Step 1: Install the promo's UI dependencies (the versions the promo uses)**

Run:
```bash
npm install @base-ui/react@^1.8.0 class-variance-authority@^0.7.1 cn@^0.3.0 lucide-react@^1.47.0 sonner@^2.0.8 chart.js@^4.5.1 react-chartjs-2@^5.3.1
```
Expected: added packages, no peer-dependency errors. (`cn` is shadcn's official package — "drop-in replacement for clsx + tailwind-merge", repo `shadcn-ui/cn`.)

- [ ] **Step 2: Alias `@/` → `src/demos/` in TypeScript**

In `tsconfig.json` `compilerOptions`, add (after `"types": ["vite/client"]`, adding a comma to that line):
```json
    "paths": { "@/*": ["./src/demos/*"] }
```

- [ ] **Step 3: …in Vite and Vitest**

In `vite.config.ts`: add `import { fileURLToPath } from "node:url";` to the imports, and in the returned config object add, after `plugins: [react()],`:
```ts
    // Ported promo code imports "@/components/…", "@/lib/…" exactly as in its own repo; @/ is
    // src/demos, which mirrors the promo's layout. The regex only matches "@/" — never "@base-ui/…".
    resolve: {
      alias: [{ find: /^@\//, replacement: fileURLToPath(new URL("./src/demos/", import.meta.url)) }],
    },
```
In `vitest.config.ts`: add the same `import { fileURLToPath } from "node:url";` and, inside `defineConfig({ … })` next to `test`, the same `resolve` block.

- [ ] **Step 4: The porting log**

Create `src/demos/PORTING.md` (CRLF):
```markdown
# Ported from voiceagent_promo

Source: `voiceagent_promo` @ `f482848` (separate repo, `../../test_demo/voiceagent_promo`).
Files keep the promo's layout under `src/demos/` (`@/` = `src/demos/`), so a later sync is a diff.

Every file is a verbatim copy except for the edits listed below. Add a line for every deviation.

## Edits applied to every ported file
- `"use client"` directives removed (Vite has no server components).

## Per-file edits
```

- [ ] **Step 5: Verify nothing changed yet**

Run: `npm run build && npx vitest run`
Expected: clean build; all tests pass (no code uses the alias yet).

- [ ] **Step 6: Files ready for review** (no commit)

---

### Task 2: The promo's browser-safe libraries and their tests

**Files:** Create `src/demos/lib/*.ts`, `tests/promo/*.test.ts`; Modify `src/demos/PORTING.md`

- [ ] **Step 1: Copy the libraries verbatim**

Run:
```bash
mkdir -p src/demos/lib && for f in ambience analytics call-audio chart-theme hours http integrations languages links prompt proof ringtone schedule scroll share transcript types use-cases utils voice-level; do cp "$PROMO/lib/$f.ts" src/demos/lib/; done && ls src/demos/lib | wc -l
```
(with `PROMO="/c/Users/Michael Knutsen/Documents/projects/test_demo/voiceagent_promo"`). Expected: `20`. These import only each other, `cn` and `chart.js` (verified 2026-09-21). The server-only libs (`store`, `kv`, `calls`, `crm`, `research*`, `openai`, `claude-cli`, `auth`, `visitor`, `api`, `maps`, `call-review`) are NOT copied.

- [ ] **Step 2: Replace the Next.js env reads**

In `src/demos/lib/share.ts` replace
```ts
  const configured = process.env.NEXT_PUBLIC_BASE_URL;
```
with
```ts
  const configured: string | undefined = import.meta.env.VITE_PUBLIC_DEMO_BASE_URL;
```
In `src/demos/lib/links.ts` replace each `process.env.NEXT_PUBLIC_CONTACT_URL`, `process.env.NEXT_PUBLIC_PRICING_URL`, `process.env.NEXT_PUBLIC_CONTACT_EMAIL` with `import.meta.env.VITE_CONTACT_URL`, `import.meta.env.VITE_PRICING_URL`, `import.meta.env.VITE_CONTACT_EMAIL` (the `||` fallbacks stay).
Verify: `grep -rn "process\." src/demos/lib` prints nothing.

- [ ] **Step 3: Copy the matching tests**

Run:
```bash
mkdir -p tests/promo && for f in ambience analytics call-audio crm-feed integrations languages prompt proof schedule scroll transcript use-cases voice-level; do sed 's#"\.\./lib/#"../../src/demos/lib/#g' "$PROMO/tests/$f.test.ts" > tests/promo/$f.test.ts; done && grep -l '\.\./lib/' tests/promo/*.ts | grep -v "src/demos" ; ls tests/promo | wc -l
```
Expected: `13`. (Skipped, with reason: `kv`, `maps`, `research`, `call-review`, `crm`, `store-migration` test server-only libs; `public-view` belongs to stage 5.)
In `tests/promo/analytics.test.ts`, remove the line `import { parseLiveMember } from "../../src/demos/lib/calls";` and the whole `describe("the live session index", () => { … });` block at the end (it tests the server-only `lib/calls`). Nothing else in the file changes.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/promo`
Expected: all 13 files pass. If one fails, it's a real porting problem (e.g. an env read) — fix the lib, not the test, and log it.

- [ ] **Step 5: Make the libraries pass this app's stricter tsconfig**

Run: `npx tsc --noEmit 2>&1 | grep "src/demos/lib"`
Known from a trial (2026-09-21), expect ~10 errors: `ambience.ts` unused `sampleRate`; `call-audio.ts` `band` possibly undefined (×4) and an object possibly undefined; `prompt.ts` `string | undefined` and an object possibly undefined; `voice-level.ts` possibly undefined (×2). Fix each with the smallest change that keeps behaviour identical:
- an index you can see is in range (loop bound, fixed-length array) → `!` non-null assertion;
- otherwise → an explicit guard that does what the original would have done (usually `?? <the value it effectively had>`), never a silent behaviour change;
- an unused parameter that's part of a public signature → prefix it `_` (`_sampleRate`).
Then `npx tsc --noEmit` must print nothing for `src/demos/lib` and `tests/promo`.

- [ ] **Step 6: Log it**

Append to `src/demos/PORTING.md` under "Per-file edits", one line per edit, e.g.:
```markdown
- `lib/share.ts`: `process.env.NEXT_PUBLIC_BASE_URL` → `import.meta.env.VITE_PUBLIC_DEMO_BASE_URL`.
- `lib/links.ts`: `NEXT_PUBLIC_CONTACT_URL/PRICING_URL/CONTACT_EMAIL` → `VITE_CONTACT_URL/PRICING_URL/CONTACT_EMAIL`.
- `lib/call-audio.ts:320`: `band` → `band!` (index bounded by the loop). (strictness)
```
and a "## Tests" section listing the 13 copied tests, the 7 skipped with reasons, and the removed `parseLiveMember` block.

- [ ] **Step 7: Verify**

Run: `npx vitest run && npm run build`
Expected: all tests pass; clean build.

- [ ] **Step 8: Files ready for review** (no commit)

---

### Task 3: Glue — theme hook, portal container, `promoFetch`, `demoHref`

**Files:** Modify `src/theme.tsx`, `src/demos/api.ts`, `tests/promoApi.test.ts`; Create `src/demos/theme.ts`, `src/demos/portal.ts`, `src/demos/routes.ts`

- [ ] **Step 1: Failing tests for `promoFetch`**

Append to `tests/promoApi.test.ts` (and add `promoFetch` to its import list from `../src/demos/api`):
```ts
// promoFetch is the drop-in the ported promo screens use in place of fetch("/api/…"): same Response
// back (their own readJson still reads it), routed through the proxy, with 401s reported to the gate.
describe("promoFetch", () => {
  it("routes /api/… through /promo-api with the cookie and passes init through", async () => {
    const fetchFn = stubFetch(async () => json(200, { customers: [] }));
    const res = await promoFetch("/api/admin/customers", { method: "PATCH", body: "{}" });
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("/promo-api/admin/customers");
    expect(init.method).toBe("PATCH");
    expect(init.body).toBe("{}");
    expect(init.credentials).toBe("same-origin");
    expect(res.status).toBe(200);
  });

  it("reports a 401 to the gate and still returns the response", async () => {
    const onLocked = vi.fn();
    setPromoLockedHandler(onLocked);
    stubFetch(async () => json(401, { error: "Not signed in." }));
    const res = await promoFetch("/api/admin/customers");
    expect(res.status).toBe(401);
    expect(onLocked).toHaveBeenCalledOnce();
  });

  it("turns a network failure into a readable error", async () => {
    stubFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(promoFetch("/api/admin/customers")).rejects.toThrow("Couldn't reach the demo service.");
  });

  it("refuses anything that isn't a promo /api/ path", async () => {
    stubFetch(async () => json(200, {}));
    await expect(promoFetch("https://example.com/api/x")).rejects.toThrow(/only takes \/api\//);
  });
});
```
Run: `npx vitest run tests/promoApi.test.ts` → FAIL (`promoFetch` is not exported).

- [ ] **Step 2: Implement `promoFetch`; drop `listProspects`**

In `src/demos/api.ts`, after `setPromoLockedHandler`, add:
```ts
/**
 * The drop-in the ported promo screens use in place of `fetch("/api/…")`: it sends the request
 * through the /promo-api proxy with the cookie and returns the Response untouched, so the promo's
 * own `readJson` goes on reading it exactly as before. The one addition: a 401 tells the gate, which
 * swaps in the unlock card.
 */
export async function promoFetch(input: string, init?: RequestInit): Promise<Response> {
  if (!input.startsWith("/api/")) {
    throw new Error(`promoFetch only takes /api/ paths (got ${input})`);
  }
  let response: Response;
  try {
    response = await fetch(`${PROMO_API}${input.slice("/api".length)}`, {
      credentials: "same-origin",
      ...init,
    });
  } catch {
    throw new Error("Couldn't reach the demo service.");
  }
  if (response.status === 401) onLocked?.();
  return response;
}
```
Delete `listProspects` (the ported Prospects screen fetches the list itself) and its two tests in `tests/promoApi.test.ts` (`"lists them"` and the missing-`customers` test). Keep `getProspect` and `PromoProspect` (stage-3 detail placeholder, until 4b).
Run: `npx vitest run` → all pass.

- [ ] **Step 3: A theme hook that follows the toggle**

The promo's charts and toaster read the theme from `next-themes`. Here the toggle writes `data-theme` on `<html>` (`themeCore.applyTheme`), and any component must re-render when it changes. In `src/theme.tsx`, add `useSyncExternalStore` to the React import and append:
```tsx
// The current theme as a subscribable value, for components that must redraw when it changes
// (Chart.js charts, the toaster). Watches <html data-theme>, which every toggle writes.
function subscribeTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

export function useDocumentTheme(): Theme {
  return useSyncExternalStore(subscribeTheme, () => readTheme(document.documentElement), () => "light");
}
```
Create `src/demos/theme.ts` (so ported code imports it as `@/theme`):
```ts
// Stands in for next-themes in ported promo code: `useTheme().resolvedTheme` → `useDocumentTheme()`.
export { useDocumentTheme } from "../theme";
```

- [ ] **Step 4: The portal container**

Create `src/demos/portal.ts`:
```ts
// Where the promo's pop-ups render. Base UI portals render into <body> by default — outside every
// .tw element, where the scoped Tailwind styles don't reach. This is one shared `.tw` element at the
// end of <body>, created the first time a pop-up opens, so dialogs, menus, selects and tooltips get
// the promo styling. It's never created on transcribe screens.
let container: HTMLElement | null = null;

export function twPortalContainer(): HTMLElement {
  if (!container || !container.isConnected) {
    container = document.createElement("div");
    container.className = "tw";
    container.setAttribute("data-tw-portal", "");
    document.body.appendChild(container);
  }
  return container;
}
```

- [ ] **Step 5: Links to Demos routes**

Create `src/demos/routes.ts`:
```ts
import type { ViewId } from "../components/Sidebar";
import { formatHash } from "../routing";

// Stands in for next/link targets in ported promo code: `/admin/customers/<id>` →
// `demoHref("demoProspect", id)`, `/admin/customers` → `demoHref("demoProspects")`,
// `/admin/crm` → `demoHref("demoPipeline")`, `/admin` → `demoHref("demoOverview")`.
// A plain <a href="#/…"> is enough: the hash router picks the change up.
export function demoHref(view: ViewId, id?: string): string {
  return formatHash(id === undefined ? { view, mailbox: undefined } : { view, mailbox: undefined, id });
}
```

- [ ] **Step 6: Verify**

Run: `npx vitest run && npm run build` → all pass; clean.

- [ ] **Step 7: Files ready for review** (no commit)

---

### Task 4: The shadcn components 4a needs

**Files:** Create `src/demos/components/ui/{badge,button,card,dialog,dropdown-menu,input,label,select,skeleton,sonner,switch,table,textarea}.tsx`; Modify `src/demos/PORTING.md`

(`tabs`, `sheet`, `separator`, `tooltip`, `scroll-area`, `avatar` come with 4b/4c. `sidebar`, `breadcrumb` are not ported — the dashboard shell replaces the promo's.)

- [ ] **Step 1: Copy verbatim, strip the directive**

Run:
```bash
mkdir -p src/demos/components/ui && for f in badge button card dialog dropdown-menu input label select skeleton sonner switch table textarea; do cp "$PROMO/components/ui/$f.tsx" src/demos/components/ui/; sed -i '1{/^"use client";\?$/d}' src/demos/components/ui/$f.tsx; done && grep -l "use client" src/demos/components/ui/*.tsx; ls src/demos/components/ui | wc -l
```
Expected: no file listed by the grep; `13`.

- [ ] **Step 2: Portals into the `.tw` container**

Apply with this script (it asserts each edit matches exactly once):
```bash
python - <<'EOF'
from pathlib import Path
base = Path("src/demos/components/ui")
imp = 'import { twPortalContainer } from "@/portal"\n'
edits = {
  "dialog.tsx": [('<DialogPrimitive.Portal data-slot="dialog-portal" {...props} />',
                  '<DialogPrimitive.Portal data-slot="dialog-portal" container={twPortalContainer()} {...props} />')],
  "dropdown-menu.tsx": [('<MenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />',
                         '<MenuPrimitive.Portal data-slot="dropdown-menu-portal" container={twPortalContainer()} {...props} />'),
                        ('    <MenuPrimitive.Portal>\n', '    <MenuPrimitive.Portal container={twPortalContainer()}>\n')],
  "select.tsx": [('    <SelectPrimitive.Portal>\n', '    <SelectPrimitive.Portal container={twPortalContainer()}>\n')],
}
for name, reps in edits.items():
    p = base / name
    s = p.read_text(encoding="utf-8")
    for a, b in reps:
        assert s.count(a) == 1, (name, a)
        s = s.replace(a, b)
    # the import goes after the last existing import line
    lines = s.split("\n")
    last = max(i for i, l in enumerate(lines) if l.startswith("import "))
    while not lines[last].rstrip().endswith(('"', "'", '";', "';")):
        last += 1  # a multi-line import ends on its `from "…"` line
    lines.insert(last + 1, imp.rstrip("\n"))
    p.write_text("\n".join(lines), encoding="utf-8")
print("ok")
EOF
```
Then confirm Base UI's `Portal` accepts `container` with an `HTMLElement`: `grep -n "container" node_modules/@base-ui/react/esm/**/portal/*.d.ts 2>/dev/null | head` (or search `node_modules/@base-ui/react` for the Portal props type); `npx tsc --noEmit` will also reject it if not.

- [ ] **Step 3: Theme and raw variables in the toaster and button**

`sonner.tsx`: replace `import { useTheme } from "next-themes"` with `import { useDocumentTheme } from "@/theme"`; replace `const { theme = "system" } = useTheme()` with `const theme = useDocumentTheme()`; and in its `style` object replace `var(--popover)` → `var(--color-popover)`, `var(--popover-foreground)` → `var(--color-popover-foreground)`, `var(--border)` → `var(--color-border)`, `var(--radius)` → `var(--radius-lg)` (the design doc's rule: bare names here read the *transcribe* variables; the `--color-*` / `--radius-lg` names come from `@theme inline` and map to `--ui-*`). Also give the toaster the portal container so toasts are styled: add the prop `container={twPortalContainer()}` only if sonner 2's `ToasterProps` has a `container`-like option — check `node_modules/sonner/dist/index.d.ts`; if it doesn't, leave it and note that the `<Toaster>` itself must be rendered inside a `.tw` element (Task 6 does).
`button.tsx`: in the `secondary` variant replace `var(--secondary),var(--foreground)_5%` with `var(--color-secondary),var(--color-foreground)_5%`. Leave `var(--radius-md)` (Tailwind emits it; transcribe CSS doesn't define it — spec §3).
Verify: `grep -n "var(--" src/demos/components/ui/*.tsx` shows only `--color-*`, `--radius-md` and `--radius-lg`.

- [ ] **Step 4: Type-check and fix strictness**

Run: `npx tsc --noEmit 2>&1 | grep "src/demos/components/ui"`. Fix any error with the smallest behaviour-preserving change (as in Task 2 Step 5). None of these files is imported yet, but tsc checks them because they're under `src/`.

- [ ] **Step 5: Log and verify**

Append each edit to `src/demos/PORTING.md` (portals ×3 files, sonner theme + vars, button var, any strictness fix). Run `npm run build && npx vitest run` → clean; all pass.

- [ ] **Step 6: Files ready for review** (no commit)

---

### Task 5: Port the Overview and Prospects screens

**Files:** Create `src/demos/components/admin/{shared,CustomerTable,NewCustomerDialog}.tsx`, `src/demos/components/charts/{CallsPerDayChart,TopCustomersChart}.tsx`, `src/demos/screens/{OverviewScreen,ProspectsScreen}.tsx`; Modify `src/demos/PORTING.md`

- [ ] **Step 1: Copy verbatim, strip the directive**

Run:
```bash
mkdir -p src/demos/components/admin src/demos/components/charts src/demos/screens
cp "$PROMO/components/admin/shared.tsx" "$PROMO/components/admin/CustomerTable.tsx" "$PROMO/components/admin/NewCustomerDialog.tsx" src/demos/components/admin/
cp "$PROMO/components/charts/CallsPerDayChart.tsx" "$PROMO/components/charts/TopCustomersChart.tsx" src/demos/components/charts/
cp "$PROMO/app/admin/(dashboard)/page.tsx" src/demos/screens/OverviewScreen.tsx
cp "$PROMO/app/admin/(dashboard)/customers/page.tsx" src/demos/screens/ProspectsScreen.tsx
for f in src/demos/components/admin/*.tsx src/demos/components/charts/*.tsx src/demos/screens/*.tsx; do sed -i '1{/^"use client";\?$/d}' "$f"; done
grep -l "use client" src/demos/components/admin/*.tsx src/demos/components/charts/*.tsx src/demos/screens/*.tsx
```
Expected: the final grep prints nothing.

- [ ] **Step 2: `fetch("/api/…")` → `promoFetch("/api/…")`**

Every promo API call in these files becomes a `promoFetch` call — one word each; the arguments and the `readJson` that reads the response stay as they are. Apply:
```bash
python - <<'EOF'
import re
from pathlib import Path
files = ["src/demos/components/admin/CustomerTable.tsx", "src/demos/components/admin/NewCustomerDialog.tsx",
         "src/demos/screens/OverviewScreen.tsx", "src/demos/screens/ProspectsScreen.tsx"]
expected = {"CustomerTable.tsx": 2, "NewCustomerDialog.tsx": 1, "OverviewScreen.tsx": 1, "ProspectsScreen.tsx": 1}
for f in files:
    p = Path(f); s = p.read_text(encoding="utf-8")
    n = len(re.findall(r"\bfetch\(\s*[`\"]/api/", s))
    assert n == expected[p.name], (f, n)
    s = re.sub(r"\bfetch\((\s*[`\"])/api/", r"promoFetch(\1/api/", s)
    lines = s.split("\n")
    first_import = next(i for i, l in enumerate(lines) if l.startswith("import "))
    lines.insert(first_import, 'import { promoFetch } from "@/api";')
    p.write_text("\n".join(lines), encoding="utf-8")
print("ok")
EOF
grep -rn "\bfetch(" src/demos/components src/demos/screens | grep -v promoFetch
```
Expected: `ok`, and the grep prints nothing. (OverviewScreen's call is a template literal split across lines — `fetch(\n        \`/api/admin/analytics?…\``; the regex allows the whitespace. If an assertion fails, look at the call and adjust the count/regex — don't skip a call.)

- [ ] **Step 3: `next/link` → plain anchors to Demos routes**

In `src/demos/screens/OverviewScreen.tsx`: delete `import Link from "next/link";`, add `import { demoHref } from "@/routes";`, and replace
```tsx
                      <Link
                        href={`/admin/customers/${call.customerId}`}
                        className="hover:underline"
                      >
                        {call.customerName}
                      </Link>
```
with
```tsx
                      <a
                        href={demoHref("demoProspect", call.customerId)}
                        className="hover:underline"
                      >
                        {call.customerName}
                      </a>
```
In `src/demos/components/admin/CustomerTable.tsx`: delete the `next/link` import, add `import { demoHref } from "@/routes";`, replace
```tsx
                  <Link
                    href={`/admin/customers/${customer.id}`}
                    className="hover:underline"
                  >
                    {customer.profile.name || "Unnamed"}
                  </Link>
```
with
```tsx
                  <a
                    href={demoHref("demoProspect", customer.id)}
                    className="hover:underline"
                  >
                    {customer.profile.name || "Unnamed"}
                  </a>
```
and replace `render={<Link href={`/admin/customers/${customer.id}`} />}` with `render={<a href={demoHref("demoProspect", customer.id)} />}`.
Verify: `grep -rn "next/\|<Link\|process\.env" src/demos` prints nothing.

- [ ] **Step 4: Charts follow the dashboard theme**

In both chart files replace `import { useTheme } from "next-themes";` with `import { useDocumentTheme } from "@/theme";` and `const { resolvedTheme } = useTheme();` with `const resolvedTheme = useDocumentTheme();` (the rest — the `useMemo` on `[resolvedTheme]` and `key={resolvedTheme}` — stays).

- [ ] **Step 5: Screen names**

The ported pages are `export default function OverviewPage()` / `CustomersPage()`. Rename the functions to `OverviewScreen` / `ProspectsScreen` and make them named exports (`export function …`, drop `default`) to match this app's convention. In `ProspectsScreen.tsx` change the `PageHeader` `title="Customers"` to `title="Prospects"` (the sidebar calls them Prospects; everything else keeps the promo's wording for now).

- [ ] **Step 6: Type-check, strictness fixes, legacy class check**

Run: `npx tsc --noEmit`. Fix errors in the ported files with the smallest behaviour-preserving change; log each. Then check promo markup for transcribe class names (spec §3 — legacy classes like `.card`, `.badge`, `.muted` are global and would restyle promo elements). Run:
```bash
python - <<'EOF'
import re
from pathlib import Path
css = re.sub(r"/\*.*?\*/", "", Path("src/styles/legacy.css").read_text(encoding="utf-8"), flags=re.S)
legacy = set(re.findall(r"\.(-?[_a-zA-Z][\w-]*)", css))
hits = {}
for p in list(Path("src/demos/components").rglob("*.tsx")) + list(Path("src/demos/screens").rglob("*.tsx")):
    text = p.read_text(encoding="utf-8")
    for m in re.finditer(r'className=\{?[`"]([^`"]*)[`"]', text):
        for tok in m.group(1).split():
            if tok in legacy:
                hits.setdefault(tok, set()).add(p.name)
print(hits or "no collisions in literal classNames")
EOF
```
Expected: at most `sr-only` (Tailwind's `sr-only` sets a superset of the transcribe rule's properties — harmless, spec §3). Any other hit: rename the class on the promo side (e.g. a custom class) and log it. (Classes built inside `cn(...)`/`cva(...)` calls aren't covered by this literal scan — the end-to-end check in Task 7 does a runtime check over every rendered element.)

- [ ] **Step 7: Log and verify**

Append every edit from Steps 2–6 to `src/demos/PORTING.md`. Run `npm run build && npx vitest run` → clean; all pass.

- [ ] **Step 8: Files ready for review** (no commit)

---

### Task 6: Show the real screens

**Files:** Modify `src/demos/DemosView.tsx`, `src/demos/DemosGate.tsx`; Delete `src/demos/pages/DemoProspectsPage.tsx`

- [ ] **Step 1: The gate lays out the page and hosts the toaster**

In `src/demos/DemosGate.tsx`, add `import { Toaster } from "@/components/ui/sonner";` and replace `{state === "unlocked" && children}` with:
```tsx
      {state === "unlocked" && (
        // The promo's pages are fragments that relied on their layout's `flex-col gap` — this is it.
        // The toaster lives here, inside .tw, so toasts get the promo styling and only exist on
        // Demos views.
        <div className="flex flex-col gap-4 md:gap-6">
          {children}
          <Toaster position="bottom-right" />
        </div>
      )}
```

- [ ] **Step 2: Real screens in the view switch**

In `src/demos/DemosView.tsx`: import `{ OverviewScreen } from "./screens/OverviewScreen"` and `{ ProspectsScreen } from "./screens/ProspectsScreen"`; render `<OverviewScreen />` for `demoOverview` and `<ProspectsScreen />` for `demoProspects`; for `demoProspect` without an id render `<ProspectsScreen />`; remove the `onOpenProspect` prop from `DemosView` (the ported screens link with `demoHref`) and from the `<DemosView …>` call in `src/App.tsx`. Keep `DemoProspectPage` (detail placeholder, until 4b) and the Pipeline `DemoPlaceholderPage`. Delete `src/demos/pages/DemoProspectsPage.tsx`, and with it `listProspects` in `src/demos/api.ts` and its two tests in `tests/promoApi.test.ts` (`"lists them"` and the missing-`customers` test) — Task 3 had to keep them because this page still used them.

- [ ] **Step 3: Verify**

Run: `npm run build && npx vitest run` → clean; all pass. Then `python scripts/regression/compare.py` → `IDENTICAL` with `expected changes confirmed: admin:apiKeys:light` (transcribe screens must not have moved; the portal container is only created when a pop-up opens on a Demos view).

- [ ] **Step 4: Files ready for review** (no commit)

---

### Task 7: A fake promo the real screens can run on, and end-to-end checks

**Files:** Modify `scripts/regression/fake_promo.py`, `scripts/regression/demos_e2e.py`

The ported screens need the promo's full records. `fake_promo.py` must now answer, statelessly, with the shapes of `voiceagent_promo @ f482848` (read the real route handlers and `lib/types.ts` / `lib/analytics.ts` in the promo repo for exact field names):

- [ ] **Step 1: Full `CustomerWithStats` records**

Replace `PROSPECTS` with two complete `CustomerWithStats` objects (every required `Customer` field: `id, active, businessName, profile{name, category, address, hours[], services[], highlights[], policies{}, faqs[]}, dossier, sources[], prompts{live, backend, greeting, edited}, voice, agentName, status, createdAt, updatedAt`; plus `stats{views, calls, totalSec, visitors, lastCallAt?, lastViewAt?}` and `heat{score, level, reason}`). Keep ids `pr0SPct1` ("Harbor Dental", ready, active, some calls/views, heat "hot") and `cedar42` (researching, `profile.name` empty, no calls, heat "cold").

- [ ] **Step 2: The routes the two screens call**

- `GET /api/admin/analytics?days=N[&includeTests=1]` → `{kpis{customers, testedCustomers, totalCalls, totalMinutes, avgCallSec, totalViews}, window: N, callsPerDay: [N × {date, calls, minutes}], topCustomers: [{id, name, minutes, calls}], recentCalls: [{id, customerId, customerName, contactName, startedAt, durationSec, status, isTest, turns}], realCallCount, testCallCount, includeTests}` — deterministic values derived from `days`.
- `POST /api/admin/customers` → `201 {customer: <a new record>}`; a body without `businessName` → `400 {error}` (mirror the real route's message).
- `PATCH /api/admin/customers/<id>` → `{customer}`; `DELETE /api/admin/customers/<id>` → `{ok: true}`; unknown id → `404 {error: "Customer not found."}`.
Stateless: writes answer as if they worked and change nothing.

- [ ] **Step 3: Update and extend the end-to-end checks**

In `demos_e2e.py`, keep every existing check's intent; update locators the port changed (the prospects list is now a table of links — e.g. `get_by_role("link", name="Harbor Dental")` — and its status badge text comes from `CustomerTable`). Add checks:
- **Overview:** "Demo overview" shows the promo's KPI cards (e.g. the "Customers", "Calls", "Minutes" stat titles with the fake's values), a `<canvas>` for each chart, and the "Recent calls" table with a row linking to `#/demos/prospects/pr0SPct1`; toggling the theme (the topbar toggle) re-renders the charts (the canvas element is replaced — compare element handles before/after).
- **Prospects:** the table lists both prospects; searching "cedar" leaves one row; the "More actions" menu opens and its items render inside `[data-tw-portal]` with promo styling (the popup's computed `background-color` equals the `--ui-popover` value, not transparent); "Copy link" shows a toast; the "New customer" dialog opens inside `[data-tw-portal]`, submitting without a business name shows the fake's 400 error, submitting with one shows the success toast and closes the dialog; toggling a prospect's live switch shows "Demo is paused."/"Demo is live.".
- **Legacy class collisions (runtime):** after rendering Overview, Prospects, the open menu and the open dialog, collect every class name used in rules inside the built CSS's `@layer legacy` block (walk `document.styleSheets` → `CSSLayerBlockRule` with `name === "legacy"` → `selectorText`), then every class on every element under `main .tw` and `[data-tw-portal]`; the intersection must be ⊆ `{"sr-only", "grid"}` plus `.ta-*` classes whose legacy rule the promo's own scoped copy fully shadows (as built: `grid` only appears in legacy as `.areachart .grid`/`.barchart .grid`, which can't match promo markup; the `.ta-*` scale is deliberately defined twice — spec §3).
- **No page errors** (existing check) must still pass across all of it.

- [ ] **Step 4: Run everything**

Run one at a time: `python scripts/regression/demos_e2e.py` → `ALL DEMOS CHECKS PASS`; `python scripts/regression/compare.py` → `IDENTICAL` (+ expected apiKeys change); `python scripts/regression/tw_probe.py` → `ALL PROBE CHECKS PASS`.
If a check fails, decide app vs script as in stage 3: script locators/timing are yours; an app problem is reported with evidence (and fixed only as a logged, behaviour-preserving port edit).

- [ ] **Step 5: Files ready for review** (no commit)

---

### Task 8: Documentation

**Files:** Modify `CLAUDE.md`, `.env.example`, `docs/superpowers/specs/2026-09-21-combined-dashboard-design.md`

- [ ] **Step 1: `CLAUDE.md`** — add to "The Demos section (promo)":
```markdown
- Ported promo code lives in `src/demos/` in the promo's own layout (`components/ui`,
  `components/admin`, `components/charts`, `lib`, `screens`), imported as `@/…` (= `src/demos/`).
  It's a verbatim copy of voiceagent_promo @ f482848 plus the edits logged in
  `src/demos/PORTING.md` — keep that log current, it's what makes a later sync possible.
- Porting rules: `fetch("/api/…")` → `promoFetch("/api/…")`; `next/link` → `<a href={demoHref(…)}>`;
  `next-themes` → `useDocumentTheme()` (`@/theme`); pop-ups render into `twPortalContainer()`
  (`@/portal`); `process.env.NEXT_PUBLIC_*` → `import.meta.env.VITE_*`; no bare `var(--x)`.
```
- [ ] **Step 2: `.env.example`** — append:
```bash

# Origin used in the demo links the Prospects screen copies and emails (no trailing slash). Until
# this app serves the public demo page (stage 5), point it at the promo's own origin.
VITE_PUBLIC_DEMO_BASE_URL=http://localhost:3000
# Optional: contact links shown on the public demo page (stage 5). Defaults are TecAce's.
# VITE_CONTACT_URL=
# VITE_PRICING_URL=
# VITE_CONTACT_EMAIL=
```
- [ ] **Step 3: Spec** — §1: replace the `src/components/ui/` bullet with "`src/demos/components/ui/` — shadcn components, copied from the promo; ported promo code keeps the promo's layout under `src/demos/`, imported via `@/` = `src/demos/` (stage 4a)". Add under stages: "Stage 4 split into 4a (foundation + Overview + Prospects), 4b (prospect detail + test call), 4c (pipeline)."
- [ ] **Step 4: Final checks** — one at a time: `npx vitest run`, `npm run build`, `python scripts/regression/compare.py`, `python scripts/regression/tw_probe.py`, `python scripts/regression/demos_e2e.py` → all pass.
- [ ] **Step 5: Files ready for review** (no commit) — **Stage 4a done.**
