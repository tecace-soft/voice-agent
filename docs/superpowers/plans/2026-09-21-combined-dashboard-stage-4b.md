# Combined dashboard — stage 4b (prospect detail + test call) implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the stage-3 prospect placeholder (`#/demos/prospects/<id>`) with the promo app's real prospect page — stats, the six tabs (Activity, Knowledge, Schedule, Prompt, Sources, Share), save / re-research, and the admin test call — ported near-verbatim with the stage-4a method.

**Architecture:** Same as 4a: promo files copied **verbatim** from `voiceagent_promo @ f482848` into `src/demos/` in the promo's own layout (`components/{ui,admin,call,public,research}`, `hooks/`, the page as `screens/ProspectScreen.tsx`), alias `@/` → `src/demos/`, every deviation logged in `src/demos/PORTING.md`. The fixed edit list: `"use client"` removed; `fetch("/api/…")` → `promoFetch("/api/…")`; the one `navigator.sendBeacon("/api/…")` → `sendBeacon(promoUrl("/api/…"))` (a beacon can't go through `promoFetch`); Next's `params`/`use(params)` → an `id` prop; portals → `twPortalContainer()`; no bare `var(--x)` / `getPropertyValue("--x")`; strictness fixes that keep behaviour identical. The test call runs through the promo's own session broker (`POST /api/session`, public route, admin cookie marks it a test) via the proxy.

**Tech Stack:** as 4a, plus `react-markdown` 10 + `remark-gfm` 4 (Sources tab). Edge with `--use-fake-device-for-media-stream` for the test-call check.

**Spec:** `docs/superpowers/specs/2026-09-21-combined-dashboard-design.md` §1, §3, §4, stage 4 (4b). Previous: `docs/superpowers/plans/2026-09-21-combined-dashboard-stage-4a.md` (method, glue, gotchas).

**Decided for this stage:** the active tab stays component state, as in the promo (a refresh returns to Activity); the spec's `?tab=` idea is dropped — not worth deviating from the source. The live conversation itself (WebRTC to OpenAI) can't be faked; the end-to-end check proves everything up to the session request, and a manual check against the real promo covers the call (Task 8).

**Git:** do **not** commit. The user handles all git.

**Conventions:** paths relative to `tecace-voice-agent-dashboard/` (`APP`) unless starting with `docs/`. `PROMO` = `/c/Users/Michael Knutsen/Documents/projects/test_demo/voiceagent_promo` (Git Bash; quote it). Line endings don't matter (autocrlf); diff against the promo with `diff --strip-trailing-cr`. Python scripts one at a time (ports 5198/5199/8898/8899). Never `taskkill` by image name. Every edit to a ported file gets a line in `src/demos/PORTING.md`.

**Checks:** `npx vitest run`; `npm run build`; `python scripts/regression/compare.py` (must stay `IDENTICAL` + `expected changes confirmed: admin:apiKeys:light`); `tw_probe.py`; `demos_e2e.py`.

---

## File map

- Modify `package.json` (deps), `src/demos/api.ts` (`promoUrl`; later remove `getProspect`/`PromoProspect`), `tests/promoApi.test.ts` — Tasks 1, 5.
- Create `src/demos/components/ui/{tabs,sheet,separator}.tsx` — Task 2.
- Create `src/demos/components/admin/{ActivityTab,KnowledgeEditor,PromptEditor,ResearchInputsPanel,SharePanel}.tsx`, `src/demos/components/call/{CallPanel,Transcript}.tsx`, `src/demos/components/public/{Exchange,SchedulePanel}.tsx`, `src/demos/components/research/SourcesPanel.tsx`, `src/demos/hooks/useLiveCall.ts` — Task 3.
- Create `src/demos/screens/ProspectScreen.tsx` — Task 4.
- Modify `src/demos/DemosView.tsx`, `src/App.tsx`; delete `src/demos/pages/DemoProspectPage.tsx`, `src/demos/prospectStatus.ts` — Task 5.
- Modify `scripts/regression/fake_promo.py`, `scripts/regression/demos_e2e.py` — Tasks 6–7.
- Modify `README.md`, `CLAUDE.md`, the spec — Task 8.

---

### Task 1: Dependencies and `promoUrl`

**Files:** Modify `package.json` (via npm), `src/demos/api.ts`, `tests/promoApi.test.ts`

- [ ] **Step 1: Install the Sources tab's markdown renderer**

Run: `npm install react-markdown@^10.1.0 remark-gfm@^4.0.1`
Expected: added, no peer conflicts (the versions the promo uses).

- [ ] **Step 2: Failing test for `promoUrl`**

`useLiveCall` reports a call's end with `navigator.sendBeacon(url, …)` when the page is closing — a beacon can't go through `promoFetch`, so it needs the proxied URL itself. Add `promoUrl` to the import list in `tests/promoApi.test.ts` and append:
```ts
describe("promoUrl", () => {
  it("maps a promo /api/ path onto the proxy", () => {
    expect(promoUrl("/api/calls/abc123")).toBe("/promo-api/calls/abc123");
  });

  it("refuses anything that isn't a promo /api/ path", () => {
    expect(() => promoUrl("https://example.com/api/x")).toThrow(/only takes \/api\//);
  });
});
```
Run: `npx vitest run tests/promoApi.test.ts` → FAIL (`promoUrl` is not exported).

- [ ] **Step 3: Implement it, and make `promoFetch` use it**

In `src/demos/api.ts`, add above `promoFetch`:
```ts
/** A promo `/api/…` path as the same-origin proxy URL — for what can't use promoFetch (a beacon). */
export function promoUrl(path: string): string {
  if (!path.startsWith("/api/")) {
    throw new Error(`promoFetch only takes /api/ paths (got ${path})`);
  }
  return `${PROMO_API}${path.slice("/api".length)}`;
}
```
and in `promoFetch` replace its own path check and URL building with `const url = promoUrl(input);` then `fetch(url, …)` (same behaviour; the existing `promoFetch` tests must still pass unchanged).
Run: `npx vitest run` → all pass; `npm run build` → clean.

- [ ] **Step 4: Files ready for review** (no commit)

---

### Task 2: The remaining shadcn components

**Files:** Create `src/demos/components/ui/{tabs,sheet,separator}.tsx`; Modify `src/demos/PORTING.md`

- [ ] **Step 1: Copy and strip the directive**

```bash
for f in tabs sheet separator; do cp "$PROMO/components/ui/$f.tsx" src/demos/components/ui/; sed -i '1{/^"use client";\?$/d}' src/demos/components/ui/$f.tsx; done
grep -l "use client" src/demos/components/ui/{tabs,sheet,separator}.tsx
```
Expected: the grep prints nothing.

- [ ] **Step 2: The sheet's portal into the `.tw` container**

In `src/demos/components/ui/sheet.tsx` replace
`<SheetPrimitive.Portal data-slot="sheet-portal" {...props} />` with
`<SheetPrimitive.Portal data-slot="sheet-portal" container={twPortalContainer()} {...props} />`
and add `import { twPortalContainer } from "@/portal"` after the last import (no semicolon, matching the file). Check `tabs.tsx` and `separator.tsx` have no portal and no bare `var(--`: `grep -n "Portal\|var(--" src/demos/components/ui/{tabs,sheet,separator}.tsx` should show only the edited sheet line.

- [ ] **Step 3: Type-check, log, verify**

`npx tsc --noEmit` clean (fix strictness minimally if needed). Log the sheet portal edit (and any fix) in `PORTING.md`. `npm run build && npx vitest run` → clean; all pass.

- [ ] **Step 4: Files ready for review** (no commit)

---

### Task 3: Port the tab components, the call panel and `useLiveCall`

**Files:** Create the 11 files listed in the file map; Modify `src/demos/PORTING.md`

- [ ] **Step 1: Copy verbatim, strip the directive**

```bash
mkdir -p src/demos/components/call src/demos/components/public src/demos/components/research src/demos/hooks
for f in ActivityTab KnowledgeEditor PromptEditor ResearchInputsPanel SharePanel; do cp "$PROMO/components/admin/$f.tsx" src/demos/components/admin/; done
cp "$PROMO/components/call/CallPanel.tsx" "$PROMO/components/call/Transcript.tsx" src/demos/components/call/
cp "$PROMO/components/public/Exchange.tsx" "$PROMO/components/public/SchedulePanel.tsx" src/demos/components/public/
cp "$PROMO/components/research/SourcesPanel.tsx" src/demos/components/research/
cp "$PROMO/hooks/useLiveCall.ts" src/demos/hooks/
for f in src/demos/components/admin/{ActivityTab,KnowledgeEditor,PromptEditor,ResearchInputsPanel,SharePanel}.tsx src/demos/components/call/*.tsx src/demos/components/public/*.tsx src/demos/components/research/*.tsx src/demos/hooks/useLiveCall.ts; do sed -i '1{/^"use client";\?$/d}' "$f"; done
grep -rl "use client" src/demos/components src/demos/hooks
```
Expected: the last grep prints nothing. Every `@/` import these files use now resolves (verified 2026-09-21: after Task 2 all of `components/ui`, `components/admin/shared`, `lib/*` they import exist).

- [ ] **Step 2: Promo API calls**

```bash
python - <<'EOF'
import re
from pathlib import Path
expected = {"src/demos/components/admin/ActivityTab.tsx": 1, "src/demos/hooks/useLiveCall.ts": 2}
for f, n_expected in expected.items():
    p = Path(f); s = p.read_text(encoding="utf-8")
    n = len(re.findall(r"\bfetch\(\s*[`\"]/api/", s)) + len(re.findall(r"\bfetch\(url,", s))
    assert n == n_expected, (f, n)
    s = re.sub(r"\bfetch\((\s*[`\"])/api/", r"promoFetch(\1/api/", s)
    s = s.replace("void fetch(url, {", "void promoFetch(url, {")
    lines = s.split("\n")
    first = next(i for i, l in enumerate(lines) if l.startswith("import "))
    lines.insert(first, 'import { promoFetch, promoUrl } from "@/api";' if "useLiveCall" in f else 'import { promoFetch } from "@/api";')
    p.write_text("\n".join(lines), encoding="utf-8")
print("ok")
EOF
```
Then in `src/demos/hooks/useLiveCall.ts` replace
```ts
      const url = `/api/calls/${callId}`;

      if (beacon && typeof navigator !== "undefined" && navigator.sendBeacon) {
        navigator.sendBeacon(url, new Blob([payload], { type: "application/json" }));
```
with
```ts
      const url = `/api/calls/${callId}`;

      if (beacon && typeof navigator !== "undefined" && navigator.sendBeacon) {
        navigator.sendBeacon(promoUrl(url), new Blob([payload], { type: "application/json" }));
```
(the `promoFetch(url, …)` fallback below already takes the `/api/…` path). Verify: `grep -rn "\bfetch(\|sendBeacon(" src/demos/components src/demos/hooks | grep -v "promoFetch\|promoUrl"` prints nothing.

- [ ] **Step 3: Scans — raw variables, JS variable reads, legacy class names**

- `grep -rn "var(--\|getPropertyValue(" src/demos/components/{admin,call,public,research} src/demos/hooks` — any bare `--x` (not `--color-*`, `--radius-*`, `--ui-*`) gets rewritten per `CLAUDE.md` and logged. (`call-audio`/`voice-level` libs were already checked in 4a.)
- Run the 4a literal-className collision scan (plan 4a, Task 5 Step 6 script) over `src/demos/components` and `src/demos/screens`; allowed: `sr-only`, `grid`. Anything else: rename on the promo side and log.

- [ ] **Step 4: Type-check and strictness fixes**

`npx tsc --noEmit`. Fix each error in the ported files with the smallest behaviour-preserving change (bounded index → `!`; otherwise a guard reproducing the original behaviour; unused parameter → `_name`). Log each with file:line, before → after, and why it's safe.

- [ ] **Step 5: Log and verify**

Log every edit from Steps 1–4 in `PORTING.md` (a "### Prospect detail (stage 4b)" heading). `npm run build && npx vitest run` → clean; all pass.

- [ ] **Step 6: Files ready for review** (no commit)

---

### Task 4: Port the prospect page as `ProspectScreen`

**Files:** Create `src/demos/screens/ProspectScreen.tsx`; Modify `src/demos/PORTING.md`

- [ ] **Step 1: Copy**

```bash
cp "$PROMO/app/admin/(dashboard)/customers/[id]/page.tsx" src/demos/screens/ProspectScreen.tsx && sed -i '1{/^"use client";\?$/d}' src/demos/screens/ProspectScreen.tsx
```

- [ ] **Step 2: Next's route params → an `id` prop**

Replace
```tsx
export default function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
```
with
```tsx
export function ProspectScreen({ id }: { id: string }) {
```
(read the actual lines first — keep everything after `use(params)` unchanged) and remove `use` from the `react` import if it's now unused.

- [ ] **Step 3: API calls**

The page has four `fetch(\`/api/admin/customers/${id}…\`` calls (GET, PATCH ×2, POST research). Apply the Task 3 Step 2 regex to this file with an expected count of 4, add `import { promoFetch } from "@/api";`, and verify `grep -n "\bfetch(" src/demos/screens/ProspectScreen.tsx | grep -v promoFetch` prints nothing.

- [ ] **Step 4: Type-check, scans, log, verify**

`npx tsc --noEmit` (strictness fixes as before); the raw-variable and class scans from Task 3 Step 3 over this file; log everything; `npm run build && npx vitest run` → clean.

- [ ] **Step 5: Files ready for review** (no commit)

---

### Task 5: Show it, and retire the stage-3 placeholder

**Files:** Modify `src/demos/DemosView.tsx`, `src/demos/api.ts`, `tests/promoApi.test.ts`, `src/App.tsx` if needed; Delete `src/demos/pages/DemoProspectPage.tsx`, `src/demos/prospectStatus.ts`

- [ ] **Step 1: Render the real page**

In `src/demos/DemosView.tsx`: import `{ ProspectScreen } from "./screens/ProspectScreen"`; for `demoProspect` with an id render `<ProspectScreen key={id} id={id} />` (`key` so switching prospects remounts it, like a Next route change); keep `<ProspectsScreen />` for no id. Remove the `DemoProspectPage` import and, if nothing else uses it, the `onShowProspects` prop (and its argument in `src/App.tsx`).

- [ ] **Step 2: Remove what only the placeholder used**

Delete `src/demos/pages/DemoProspectPage.tsx` and `src/demos/prospectStatus.ts` (check nothing else imports them: `grep -rn "prospectStatus\|DemoProspectPage" src`). In `src/demos/api.ts` remove `PromoProspect`, `PROSPECT_ID`, `getProspect` and the related comment; in `tests/promoApi.test.ts` remove their tests and imports. If `src/demos/pages/` is then empty except `DemoPlaceholderPage.tsx` (still used by Pipeline until 4c), keep it.

- [ ] **Step 3: Verify**

`npm run build && npx vitest run` → clean; all pass. `python scripts/regression/compare.py` → `IDENTICAL` + the expected apiKeys change.

- [ ] **Step 4: Files ready for review** (no commit)

---

### Task 6: Teach the fake promo the prospect page's routes

**Files:** Modify `scripts/regression/fake_promo.py`

Read the real handlers in the promo repo (`app/api/admin/customers/[id]/route.ts`, `…/[id]/research/route.ts`, `…/[id]/calls/route.ts`, `app/api/session/route.ts`, `app/api/calls/[callId]/route.ts`) and `lib/types.ts` (`CallLog`, `TranscriptEntry`, `CallReview`, `CrmNote`, `TrackEvent`). Stay stateless: writes answer as if they worked and change nothing.

- [ ] **Step 1: A realistic record for Harbor Dental**

`GET /api/admin/customers/pr0SPct1` returns `{customer, stats, calls, events, notes}` with:
- `calls`: at least 3 `CallLog`s newest first — one completed with a `transcript` (caller/receptionist `TranscriptEntry`s with `startMs`/`endMs`) and a `review` (`tested`, `worked`, `struggled`, `gaps` sharing one gap with another call so the gap roll-up shows a count ≥ 2, `sentiment`); one completed with a review sharing that gap; one `isTest: true`. Keep them consistent with the list's `stats` and the analytics fake (3 real + 1 test).
- `events`: a few `page_view`s with `visitorId`s; `notes`: `[]` or one `CrmNote`.
Cedar Bakery (`cedar42`) returns empty `calls`/`events`/`notes`.

- [ ] **Step 2: The write routes**

- `PATCH /api/admin/customers/<id>` — already present; confirm it returns `{customer}` with the body's fields merged (the page saves the whole draft: profile, prompts, voice, language, callSound, etc.).
- `POST /api/admin/customers/<id>/research` → `{customer}` (the record, `status: "ready"`, `researchedAt` now); a blank `businessName` → `400 {error: "Enter the business name."}`.
- `GET /api/admin/customers/<id>/calls` → `{calls}`; `PATCH …/calls` with `{callId, isTest}` or `{callId, analyze: true}` → `{call}`; missing both → `400 {error: "Send a callId with isTest or analyze."}`; unknown call → `404 {error: "Call not found."}`.
- `POST /api/session` (public — NOT under `/api/admin`, no cookie required, as in the promo; the promo checks the cookie itself only to allow `isTest`): body without `customerId` or `sdp` → `400 {error: "Missing customerId or sdp."}`; otherwise answer the promo's "every line busy" refusal: `429 {error: "All the demo lines are busy right now. Try again in a moment."}` — a fake can't mint an OpenAI SDP answer, and a real refusal is what the UI must handle gracefully.
- `POST /api/calls/<callId>` → `{ok: true}`.

- [ ] **Step 3: Smoke-test**

With the fake on 8898 and a cookie from `POST /api/admin/login`, `curl` each new route once and check status + shape. Document the new routes in the fake's docstring (and that `/api/session` always refuses).

- [ ] **Step 4: Files ready for review** (no commit)

---

### Task 7: End-to-end checks for the prospect page and the test call

**Files:** Modify `scripts/regression/demos_e2e.py`, `scripts/regression/README.md`

- [ ] **Step 1: Give the browser a fake microphone**

Launch Edge with `args=["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"]` and grant `permissions=["microphone", "clipboard-read", "clipboard-write"]` on the admin contexts, so `getUserMedia` succeeds without a prompt and a real WebRTC offer is built.

- [ ] **Step 2: Update the existing prospect checks**

The stage-3 placeholder is gone: "a prospect gets its own URL", "refresh keeps the prospect", "an unknown prospect says so" now target the real page (read `ProspectScreen.tsx` for its heading and its not-found/error rendering — keep each check's intent).

- [ ] **Step 3: New checks** (read the ported components for real labels)

- **Header and stats:** Harbor Dental's page shows its name and the stat cards ("Link opens", "Calls", …) with the fake's numbers.
- **Activity:** one card per call; the gap roll-up names the shared gap with its count; opening a call shows its transcript in a sheet rendered inside `[data-tw-portal]`; "mark as test" (or the reclassify control) sends `PATCH /promo-api/admin/customers/pr0SPct1/calls` with `{callId, isTest}` and shows its toast.
- **Knowledge:** change one field (e.g. the phone), Save → `PATCH /promo-api/admin/customers/pr0SPct1` whose JSON body carries the new value, then the "Saved." toast.
- **Schedule:** the week grid renders from the profile's hours (the fake's Mon–Fri 08:00–17:00 appear; Saturday/Sunday closed) and says it's a mock-up.
- **Prompt:** the three prompts' text appears; editing one and saving marks prompts edited in the PATCH body (`prompts.edited` true) — read `resolvePrompts` semantics in `lib/prompt.ts` if unsure what the client sends.
- **Sources:** the dossier renders as markdown (give the fake's dossier a `**bold**` phrase and a list; assert a `<strong>` and `<li>` render) and the cited source links are present with `target="_blank"`.
- **Share:** the link shown/copied is `http://promo.example/c/pr0SPct1` (the build's `VITE_PUBLIC_DEMO_BASE_URL`); the email template names the business.
- **Re-research:** triggering it sends `POST /promo-api/admin/customers/pr0SPct1/research` and shows "Research finished.".
- **Test call:** start it → a `POST /promo-api/session` is sent whose JSON body has `customerId: "pr0SPct1"`, `isTest: true` and an `sdp` starting with `v=0`; the UI shows the fake's "All the demo lines are busy right now…" message and returns to a state where the call can be tried again; no page errors; the fake microphone track is stopped afterwards (optional: `navigator.mediaDevices` has no live tracks — check via a page hook if practical, else skip and say so).
- **Legacy class collisions:** extend the existing runtime check to run after visiting each tab and with the transcript sheet open.

- [ ] **Step 4: Run everything**

One at a time: `demos_e2e.py` → `ALL DEMOS CHECKS PASS`; `compare.py` → `IDENTICAL` (+ apiKeys); `tw_probe.py` → pass. Script problems are yours to fix without weakening intent; app problems → report with evidence, fix only as a logged behaviour-preserving port edit.

- [ ] **Step 5: Document** — update the `demos_e2e.py` section of `scripts/regression/README.md` (fake microphone, what the test-call check does and doesn't prove).

- [ ] **Step 6: Files ready for review** (no commit)

---

### Task 8: Documentation and the manual test-call check

**Files:** Modify `README.md`, `CLAUDE.md`, `docs/superpowers/specs/2026-09-21-combined-dashboard-design.md`

- [ ] **Step 1: README — how to try a real test call**

Add a section "Trying a real test call": run voiceagent_promo locally (`npm run dev` in its repo, with its `.env.local` holding `OPENAI_API_KEY`, `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET`), set `PROMO_API_URL=http://localhost:3000` here, `npm run dev`, sign in as an admin, unlock Demos with the promo password, open a ready prospect, press the test call and allow the microphone. Say plainly: it's a real GPT-Live-1 session billed to that OpenAI key, it's tagged as a test (it doesn't spend the prospect's demo minutes), and the end-to-end script can't cover the conversation itself.

- [ ] **Step 2: CLAUDE.md** — add to the porting rules: "`navigator.sendBeacon` to a promo path → `sendBeacon(promoUrl('/api/…'))`; a Next page's `params` → an `id` prop (see `screens/ProspectScreen.tsx`)".

- [ ] **Step 3: Spec** — §2: replace `#/demos/prospects/<id>?tab=knowledge` with `#/demos/prospects/<id>` and add: "The active tab is component state, as in the promo (decided in 4b)."

- [ ] **Step 4: Final checks** — one at a time: `npx vitest run`, `npm run build`, `compare.py`, `tw_probe.py`, `demos_e2e.py` → all pass.

- [ ] **Step 5: Files ready for review** (no commit) — **Stage 4b done.**
